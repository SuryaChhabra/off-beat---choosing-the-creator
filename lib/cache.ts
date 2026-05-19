// In-memory TTL cache used by the YouTube + sponsor scorecard pipeline.
// Lives per warm function instance (no Redis/KV yet). Phase 1 — keeps repeated
// /api/analyze + /api/sponsors hits cheap; cold starts still pay full cost.

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function cacheGet<V>(key: string): V | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as V;
}

export function cacheSet<V>(key: string, value: V, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

// Memoize an async loader behind the cache. Concurrent callers for the same
// missing key will each call the loader — that's deliberate; we don't dedupe
// in-flight requests at this layer. Add an in-flight map here later if
// Haiku-burn shows up on the bill.
export async function cached<V>(
  key: string,
  ttlMs: number,
  loader: () => Promise<V>,
): Promise<V> {
  const hit = cacheGet<V>(key);
  if (hit !== null) {
    console.log(`[cache] HIT ${key}`);
    return hit;
  }
  console.log(`[cache] MISS ${key}`);
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
}
