// Tavily search client. Phase 1: just the basic `search` wrapper used by `/api/health`
// and (later) by the discovery + competitor-landscape pipeline steps.

import { tavily } from "@tavily/core";

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
};

export type TavilySearchOptions = {
  searchDepth?: "basic" | "advanced";
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
};

let cachedClient: ReturnType<typeof tavily> | null = null;

function getClient(): ReturnType<typeof tavily> {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  cachedClient = tavily({ apiKey });
  return cachedClient;
}

export async function search(
  query: string,
  options: TavilySearchOptions = {},
): Promise<TavilySearchResult[]> {
  const client = getClient();
  const startedAt = Date.now();
  const depth = options.searchDepth ?? "basic";
  const maxResults = options.maxResults ?? 8;
  console.log(`[Tavily] search depth=${depth} max=${maxResults} query="${query}"`);

  try {
    const res = await client.search(query, {
      searchDepth: depth,
      maxResults,
      includeDomains: options.includeDomains,
      excludeDomains: options.excludeDomains,
    });

    const results: TavilySearchResult[] = (res.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? "",
      score: typeof r.score === "number" ? r.score : 0,
      publishedDate: r.publishedDate,
    }));

    console.log(`[Tavily] search returned ${results.length} in ${Date.now() - startedAt}ms`);
    return results;
  } catch (err) {
    const e = err as { status?: number; statusCode?: number };
    if (e?.status === 429 || e?.statusCode === 429) throw new Error("Tavily credits exhausted");
    throw err;
  }
}
