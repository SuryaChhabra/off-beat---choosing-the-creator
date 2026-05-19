// Sponsor scorecard pipeline (v2 — full spec).
//
// Output: SponsorScorecard[] — one row per canonical brand.
//
// Two-pass video fetch:
//   Pass A (past 18mo, ≤100 longform + ≤100 shorts): full metadata → Haiku
//     extraction (multi-brand per video, sponsored vs affiliate, paid-
//     placement flag cross-reference) → per-brand grouping → sentiment.
//   Pass B (all-time, lightweight): playlistItems.list snippet only, used
//     for recurrence/firstSeen/lastSeen substring scan. No Haiku.
//
// Brand normalization runs once (Haiku) across the unique raw brand strings
// from Pass A so "Tetley" / "Tetley Tea" / "Tata Tetley" collapse to one row.
//
// Cost shape: ~150 Pass-A extractions + 1 normalization + ~15 sentiments ≈
// ~170 Haiku calls per uncached run. Caller MUST go through the 24h cache.

import { complete, HAIKU_MODEL } from "./anthropic";
import {
  buildBrandNormalizationUserPrompt,
  buildCommentSentimentUserPrompt,
  buildSponsorExtractionUserPrompt,
  BRAND_NORMALIZATION_PROMPT,
  COMMENT_SENTIMENT_PROMPT,
  SPONSOR_EXTRACTION_PROMPT,
} from "./prompts";
import {
  getAllPlaylistVideosLight,
  getPlaylistVideoIds,
  getUploadsPlaylistId,
  getVideoComments,
  getVideoDetails,
  type DetailedVideo,
  type LightVideo,
} from "./youtube";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const SPONSOR_SIGNALS = ["Strong", "Solid", "Mixed", "Flopped"] as const;
export type SponsorSignal = (typeof SPONSOR_SIGNALS)[number];

export const SPONSOR_SENTIMENTS = ["positive", "neutral", "mixed", "negative"] as const;
export type SponsorSentiment = (typeof SPONSOR_SENTIMENTS)[number];

export type Freshness = "Active" | "Recent" | "Dormant";
export type ContentType = "longform" | "shorts" | "both";

export type SponsorScorecard = {
  brand: string; // canonical name
  contentType: ContentType;
  integrationsRecent: number; // count of sponsored videos in past 18mo
  videoIdsRecent: string[];
  totalAppearancesAllTime: number;
  firstSeenAt: string; // ISO date (all-time)
  lastSeenAt: string; // ISO date (all-time)
  freshness: Freshness;
  avgViewsVsBaseline: number; // weighted across format-specific baselines
  sentiment: SponsorSentiment | null;
  sentimentEvidence: string | null;
  returnedAfterFirst: boolean; // totalAppearancesAllTime > 1
  affiliate: boolean; // true if appearances were affiliate-only, not sponsored
  signal: SponsorSignal;
};

// ---------------------------------------------------------------------------
// Tunables — keep at the top.
// ---------------------------------------------------------------------------

const WINDOW_MONTHS = 18;
const WINDOW_MS = WINDOW_MONTHS * 30 * 24 * 60 * 60 * 1000;

const SHORTS_THRESHOLD_SECONDS = 60;
const MAX_LONGFORM = 100;
const MAX_SHORTS = 100;
const MAX_VIDEOS_TO_INSPECT = 250; // Pass-A pre-classification page cap

const ALL_TIME_LIGHT_CAP = 5000; // safety bound on Pass B

const EXTRACTION_CONCURRENCY = 8;
const SENTIMENT_CONCURRENCY = 4;
const SENTIMENT_COMMENT_COUNT = 50;

const ACTIVE_CUTOFF_MS = 3 * 30 * 24 * 60 * 60 * 1000; // 3 months
const RECENT_CUTOFF_MS = 12 * 30 * 24 * 60 * 60 * 1000; // 12 months

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RawExtraction = {
  sponsored: boolean;
  brands: string[];
  affiliate: boolean;
  evidence: string;
};

type Sentiment = { sentiment: SponsorSentiment; evidence: string };

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

function isExtraction(x: unknown): x is RawExtraction {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.sponsored === "boolean" &&
    typeof o.affiliate === "boolean" &&
    isStringArray(o.brands) &&
    typeof o.evidence === "string"
  );
}

function isSentiment(x: unknown): x is Sentiment {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.sentiment === "string" &&
    (SPONSOR_SENTIMENTS as readonly string[]).includes(o.sentiment) &&
    typeof o.evidence === "string"
  );
}

function isStringMap(x: unknown): x is Record<string, string> {
  if (!x || typeof x !== "object") return false;
  for (const v of Object.values(x as Record<string, unknown>)) {
    if (typeof v !== "string") return false;
  }
  return true;
}

async function pMap<T, R>(items: T[], fn: (t: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeBrandKey(raw: string): string {
  return raw
    .replace(/[®™©]/g, "")
    .replace(/[.,'"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanBrandRaw(raw: string): string {
  return raw
    .replace(/[®™©]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function withinWindow(publishedAt: string): boolean {
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= WINDOW_MS;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brandMentionRegex(canonical: string): RegExp {
  // Word-boundary lookalike that also accepts non-ASCII letters in the brand
  // (e.g. "L'Oréal Paris"). We require boundaries on the ends so "plum" doesn't
  // match "plumber".
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(canonical)}(?=$|[^\\p{L}\\p{N}])`, "iu");
}

function freshnessFor(lastSeenAt: string): Freshness {
  const ts = Date.parse(lastSeenAt);
  if (Number.isNaN(ts)) return "Dormant";
  const age = Date.now() - ts;
  if (age <= ACTIVE_CUTOFF_MS) return "Active";
  if (age <= RECENT_CUTOFF_MS) return "Recent";
  return "Dormant";
}

function tier(
  ratio: number,
  sentiment: SponsorSentiment | null,
  totalAppearancesAllTime: number,
): SponsorSignal {
  // Hard veto: negative sentiment is Flopped regardless of views.
  if (sentiment === "negative") return "Flopped";
  if (ratio > 0 && ratio < 0.8) return "Flopped";

  const returned = totalAppearancesAllTime > 1;
  if (ratio >= 1.2 && sentiment === "positive" && returned) return "Strong";
  if (ratio >= 1.0) return "Solid";
  if (sentiment === "positive" && returned) return "Solid";
  if (sentiment === "mixed") return "Mixed";
  if (ratio >= 0.8 && ratio < 1.0) return "Mixed";
  // No ratio data and no useful sentiment — call it Mixed rather than Strong/Flopped.
  return "Mixed";
}

const TIER_RANK: Record<SponsorSignal, number> = {
  Strong: 0,
  Solid: 1,
  Mixed: 2,
  Flopped: 3,
};

// ---------------------------------------------------------------------------
// Haiku calls
// ---------------------------------------------------------------------------

async function extractSponsor(
  video: DetailedVideo,
): Promise<RawExtraction> {
  const empty: RawExtraction = {
    sponsored: false,
    brands: [],
    affiliate: false,
    evidence: "",
  };

  // Even when the description is empty, if YouTube's paidProductPlacement flag
  // is set we still want a row in the scorecard. Pre-fill from the flag and
  // let the Haiku call try to find a brand name; if it can't, we fall back to
  // "Unknown" below.
  if (!video.description || video.description.trim().length < 5) {
    if (!video.paidProductPlacement) return empty;
    return {
      sponsored: true,
      brands: [],
      affiliate: false,
      evidence: "YouTube paidProductPlacement flag set; description empty.",
    };
  }

  try {
    const { text } = await complete({
      model: HAIKU_MODEL,
      system: SPONSOR_EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: buildSponsorExtractionUserPrompt({
            title: video.title,
            description: video.description,
            paidProductPlacement: video.paidProductPlacement,
          }),
        },
      ],
      maxTokens: 320,
      temperature: 0,
    });
    const cleaned = stripJsonFence(text);
    const parsed: unknown = JSON.parse(cleaned);
    if (!isExtraction(parsed)) {
      console.warn("[sponsors] extraction shape mismatch:", parsed);
      return video.paidProductPlacement
        ? { sponsored: true, brands: [], affiliate: false, evidence: "Malformed model output, PPP flag set." }
        : empty;
    }
    return parsed;
  } catch (err) {
    console.warn("[sponsors] extraction failed:", err);
    return video.paidProductPlacement
      ? { sponsored: true, brands: [], affiliate: false, evidence: "Extraction failed, PPP flag set." }
      : empty;
  }
}

async function normalizeBrands(rawBrands: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(rawBrands.map((s) => cleanBrandRaw(s)).filter(Boolean)));
  if (unique.length === 0) return {};

  // Identity fallback used when the model returns junk.
  const identity = Object.fromEntries(unique.map((b) => [b, b]));

  try {
    const { text } = await complete({
      model: HAIKU_MODEL,
      system: BRAND_NORMALIZATION_PROMPT,
      messages: [
        { role: "user", content: buildBrandNormalizationUserPrompt(unique) },
      ],
      maxTokens: 800,
      temperature: 0,
    });
    const cleaned = stripJsonFence(text);
    const parsed: unknown = JSON.parse(cleaned);
    if (!isStringMap(parsed)) {
      console.warn("[sponsors] normalization shape mismatch, using identity map");
      return identity;
    }
    // Fill in any missing keys with identity to be safe.
    const merged: Record<string, string> = { ...identity, ...parsed };
    return merged;
  } catch (err) {
    console.warn("[sponsors] normalization failed, using identity map:", err);
    return identity;
  }
}

async function analyzeSentiment(brand: string, comments: string[]): Promise<Sentiment> {
  if (comments.length === 0) {
    return { sentiment: "neutral", evidence: "No brand-specific reaction observed." };
  }
  try {
    const { text } = await complete({
      model: HAIKU_MODEL,
      system: COMMENT_SENTIMENT_PROMPT,
      messages: [
        { role: "user", content: buildCommentSentimentUserPrompt(brand, comments) },
      ],
      maxTokens: 220,
      temperature: 0,
    });
    const cleaned = stripJsonFence(text);
    const parsed: unknown = JSON.parse(cleaned);
    if (!isSentiment(parsed)) {
      console.warn("[sponsors] sentiment shape mismatch, defaulting neutral:", parsed);
      return { sentiment: "neutral", evidence: "Sentiment model returned an unparseable response." };
    }
    return parsed;
  } catch (err) {
    console.warn("[sponsors] sentiment failed, defaulting neutral:", err);
    return { sentiment: "neutral", evidence: "Sentiment analysis failed." };
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function getSponsorScorecard(channelId: string): Promise<SponsorScorecard[]> {
  const overallStart = Date.now();
  console.log(`[sponsors] v2 start channelId=${channelId}`);

  const uploadsId = await getUploadsPlaylistId(channelId);
  if (!uploadsId) {
    console.log(`[sponsors] no uploads playlist for ${channelId}`);
    return [];
  }

  // ---------- Pass A: recent window with full metadata --------------------
  const allRecentIds = await getPlaylistVideoIds(uploadsId, MAX_VIDEOS_TO_INSPECT);
  const inWindowIds = allRecentIds
    .filter((v) => withinWindow(v.publishedAt))
    .map((v) => v.videoId);

  if (inWindowIds.length === 0) {
    console.log(`[sponsors] no videos in last ${WINDOW_MONTHS}mo for ${channelId}`);
    return [];
  }

  const passADetails = await getVideoDetails(inWindowIds);

  // Classify shorts vs longform, then cap each format by recency.
  const sortedByDate = [...passADetails].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
  const longform: DetailedVideo[] = [];
  const shorts: DetailedVideo[] = [];
  for (const v of sortedByDate) {
    if (v.durationSeconds > 0 && v.durationSeconds <= SHORTS_THRESHOLD_SECONDS) {
      if (shorts.length < MAX_SHORTS) shorts.push(v);
    } else {
      if (longform.length < MAX_LONGFORM) longform.push(v);
    }
  }
  const passA = [...longform, ...shorts];

  console.log(
    `[sponsors] Pass A: ${passA.length} videos (longform=${longform.length}, shorts=${shorts.length})`,
  );

  // ---------- Pass B: all-time lightweight scan ---------------------------
  // Runs in parallel with the per-video extractions. We don't need it until
  // Step 6 (recurrence), so kick it off as a side promise.
  const passBPromise: Promise<LightVideo[]> = getAllPlaylistVideosLight(
    uploadsId,
    ALL_TIME_LIGHT_CAP,
  ).catch((err) => {
    console.warn("[sponsors] Pass B failed, recurrence will be limited to Pass A:", err);
    return passA.map((v) => ({
      videoId: v.videoId,
      title: v.title,
      description: v.description,
      publishedAt: v.publishedAt,
    })) satisfies LightVideo[];
  });

  // ---------- Step 2: extract sponsors from Pass A ------------------------
  const extractions = await pMap(passA, (v) => extractSponsor(v), EXTRACTION_CONCURRENCY);

  // Per-video classification with paidProductPlacement fallback.
  type PerVideo = {
    video: DetailedVideo;
    brands: string[]; // raw extracted brands, post-PPP fallback
    sponsored: boolean;
    affiliate: boolean;
  };
  const annotated: PerVideo[] = passA.map((video, i) => {
    const ext = extractions[i];
    let brands = ext.brands.map(cleanBrandRaw).filter(Boolean);

    // PPP fallback: YouTube says paid but the model couldn't name a brand.
    if (video.paidProductPlacement && (ext.sponsored || brands.length === 0) && brands.length === 0) {
      brands = ["Unknown"];
    }

    return {
      video,
      brands,
      sponsored: ext.sponsored || video.paidProductPlacement,
      affiliate: ext.affiliate,
    };
  });

  // ---------- Step 3: brand normalization ---------------------------------
  const rawSponsorBrands = annotated.flatMap((a) =>
    a.sponsored || a.affiliate ? a.brands.filter((b) => b && b !== "Unknown") : [],
  );
  const normalizationMap = await normalizeBrands(rawSponsorBrands);

  function canonical(raw: string): string {
    if (raw === "Unknown") return "Unknown";
    const clean = cleanBrandRaw(raw);
    return normalizationMap[clean] ?? clean;
  }

  // ---------- Step 4: format-specific baselines ---------------------------
  const sponsoredVideoIds = new Set<string>();
  for (const a of annotated) {
    if ((a.sponsored || a.affiliate) && a.brands.length > 0) {
      sponsoredVideoIds.add(a.video.videoId);
    }
  }

  const longformNonSponsoredViews = longform
    .filter((v) => !sponsoredVideoIds.has(v.videoId))
    .map((v) => v.viewCount);
  const shortsNonSponsoredViews = shorts
    .filter((v) => !sponsoredVideoIds.has(v.videoId))
    .map((v) => v.viewCount);

  const longformBaseline =
    longformNonSponsoredViews.length > 0
      ? median(longformNonSponsoredViews)
      : median(longform.map((v) => v.viewCount));
  const shortsBaseline =
    shortsNonSponsoredViews.length > 0
      ? median(shortsNonSponsoredViews)
      : median(shorts.map((v) => v.viewCount));

  // ---------- Step 5: group by canonical brand ----------------------------
  type BrandGroup = {
    canonical: string;
    integrations: {
      video: DetailedVideo;
      sponsored: boolean;
      affiliate: boolean;
      format: "longform" | "shorts";
    }[];
  };
  const byBrand = new Map<string, BrandGroup>();

  for (const a of annotated) {
    if (!(a.sponsored || a.affiliate)) continue;
    if (a.brands.length === 0) continue;

    const format: "longform" | "shorts" =
      a.video.durationSeconds > 0 && a.video.durationSeconds <= SHORTS_THRESHOLD_SECONDS
        ? "shorts"
        : "longform";

    // Dedupe brands within a single video (same canonical mentioned twice).
    const seenInVideo = new Set<string>();
    for (const rawBrand of a.brands) {
      const canon = canonical(rawBrand);
      if (seenInVideo.has(canon)) continue;
      seenInVideo.add(canon);

      const key = normalizeBrandKey(canon);
      const existing = byBrand.get(key);
      const entry = { video: a.video, sponsored: a.sponsored, affiliate: a.affiliate, format };
      if (existing) {
        existing.integrations.push(entry);
      } else {
        byBrand.set(key, { canonical: canon, integrations: [entry] });
      }
    }
  }

  // ---------- Step 6: all-time recurrence scan ----------------------------
  const passB = await passBPromise;

  type Recurrence = {
    totalAppearancesAllTime: number;
    firstSeenAt: string;
    lastSeenAt: string;
  };

  function scanRecurrence(brandCanonical: string): Recurrence {
    if (brandCanonical === "Unknown") {
      // We can't substring-search for "Unknown" — fall back to Pass A counts.
      return { totalAppearancesAllTime: 0, firstSeenAt: "", lastSeenAt: "" };
    }
    const rx = brandMentionRegex(brandCanonical);
    const matches: string[] = []; // publishedAt of each match
    for (const v of passB) {
      const haystack = `${v.title}\n${v.description}`;
      if (rx.test(haystack)) matches.push(v.publishedAt);
    }
    if (matches.length === 0) {
      return { totalAppearancesAllTime: 0, firstSeenAt: "", lastSeenAt: "" };
    }
    const sorted = matches.sort();
    return {
      totalAppearancesAllTime: matches.length,
      firstSeenAt: sorted[0],
      lastSeenAt: sorted[sorted.length - 1],
    };
  }

  // ---------- Step 8: sentiment per brand ---------------------------------
  const groups = [...byBrand.values()];

  const sentiments = await pMap(
    groups,
    async (g) => {
      // Skip sentiment for Unknown — no real signal to extract.
      if (g.canonical === "Unknown") return null;
      const topVideo = [...g.integrations].sort(
        (a, b) => b.video.viewCount - a.video.viewCount,
      )[0].video;
      const comments = await getVideoComments(topVideo.videoId, SENTIMENT_COMMENT_COUNT);
      return analyzeSentiment(g.canonical, comments);
    },
    SENTIMENT_CONCURRENCY,
  );

  // ---------- Steps 5/6/7/9 assembly --------------------------------------
  const cards: SponsorScorecard[] = groups.map((g, i) => {
    // Recent (Pass A) integration data
    const recentIntegrations = g.integrations;
    const integrationsRecent = recentIntegrations.length;
    const videoIdsRecent = recentIntegrations.map((x) => x.video.videoId);

    // Content format
    const hasLong = recentIntegrations.some((x) => x.format === "longform");
    const hasShort = recentIntegrations.some((x) => x.format === "shorts");
    const contentType: ContentType =
      hasLong && hasShort ? "both" : hasLong ? "longform" : "shorts";

    // Views vs baseline (format-aware)
    const ratios = recentIntegrations
      .map((x) => {
        const baseline = x.format === "shorts" ? shortsBaseline : longformBaseline;
        return baseline > 0 ? x.video.viewCount / baseline : 0;
      })
      .filter((r) => Number.isFinite(r) && r > 0);
    const avgViewsVsBaseline =
      ratios.length > 0 ? Number((ratios.reduce((s, r) => s + r, 0) / ratios.length).toFixed(2)) : 0;

    // All-sponsored-by-affiliate-only? Then the brand is "affiliate".
    const affiliateOnly =
      recentIntegrations.every((x) => x.affiliate && !x.sponsored) &&
      recentIntegrations.length > 0;

    // Recurrence (Pass B)
    const rec = scanRecurrence(g.canonical);
    // The most recent appearance is at least Pass-A's newest integration; merge
    // with Pass B's last-seen so freshness reflects whichever is fresher.
    const passALast = [...recentIntegrations]
      .map((x) => x.video.publishedAt)
      .sort()
      .reverse()[0];
    const lastSeenAt =
      [rec.lastSeenAt, passALast].filter(Boolean).sort().reverse()[0] ?? "";
    const firstSeenAt =
      [rec.firstSeenAt, passALast].filter(Boolean).sort()[0] ?? "";
    const totalAppearancesAllTime =
      g.canonical === "Unknown"
        ? integrationsRecent
        : Math.max(rec.totalAppearancesAllTime, integrationsRecent);

    const freshness = lastSeenAt ? freshnessFor(lastSeenAt) : "Dormant";

    // Sentiment
    const s = sentiments[i];
    const sentiment: SponsorSentiment | null = s?.sentiment ?? null;
    const sentimentEvidence = s?.evidence ?? null;

    // Composite signal
    const signal: SponsorSignal =
      g.canonical === "Unknown"
        ? "Mixed" // Unknown rows aren't surfaced in the main table anyway
        : tier(avgViewsVsBaseline, sentiment, totalAppearancesAllTime);

    return {
      brand: g.canonical,
      contentType,
      integrationsRecent,
      videoIdsRecent,
      totalAppearancesAllTime,
      firstSeenAt,
      lastSeenAt,
      freshness,
      avgViewsVsBaseline,
      sentiment,
      sentimentEvidence,
      returnedAfterFirst: totalAppearancesAllTime > 1,
      affiliate: affiliateOnly,
      signal,
    } satisfies SponsorScorecard;
  });

  // Sort: signal (Strong first), then lastSeenAt desc.
  cards.sort((a, b) => {
    const tierDiff = TIER_RANK[a.signal] - TIER_RANK[b.signal];
    if (tierDiff !== 0) return tierDiff;
    return Date.parse(b.lastSeenAt || "0") - Date.parse(a.lastSeenAt || "0");
  });

  console.log(
    `[sponsors] v2 channelId=${channelId} done in ${Date.now() - overallStart}ms — ` +
      `passA=${passA.length} sponsoredBrands=${cards.length} ` +
      `longformBaseline=${longformBaseline.toLocaleString("en-US")} ` +
      `shortsBaseline=${shortsBaseline.toLocaleString("en-US")}`,
  );

  return cards;
}

// ---------------------------------------------------------------------------
// Summary string consumed by the Concept Seed prompt.
// ---------------------------------------------------------------------------

export function buildScorecardSummary(cards: SponsorScorecard[]): string {
  if (cards.length === 0) {
    return "No paid brand integrations detected in the last 18 months.";
  }
  const lines: string[] = [];
  for (const c of cards) {
    if (c.brand === "Unknown") continue;
    const ratio = `${c.avgViewsVsBaseline.toFixed(2)}× baseline`;
    const monthsSpan = monthsBetween(c.firstSeenAt, c.lastSeenAt);
    const partnership =
      c.totalAppearancesAllTime >= 3 && monthsSpan >= 12 ? " · long-term partner" : "";
    const sentimentBit = c.sentiment ? ` · sentiment ${c.sentiment}` : "";
    const relationship = c.affiliate ? "affiliate-only" : "sponsored";
    lines.push(
      `- ${c.brand} — ${c.signal} · ${c.freshness} · ${c.contentType} · ${relationship} · ` +
        `${ratio} · ${c.integrationsRecent}× recent / ${c.totalAppearancesAllTime}× all-time${partnership}${sentimentBit}`,
    );
  }
  if (lines.length === 0) {
    return "Only unidentified paid placements detected — no named sponsors usable for guidance.";
  }
  return lines.join("\n");
}

function monthsBetween(firstIso: string, lastIso: string): number {
  const a = Date.parse(firstIso);
  const b = Date.parse(lastIso);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / (30 * 24 * 60 * 60 * 1000));
}
