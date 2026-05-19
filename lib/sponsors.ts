// Sponsor scorecard pipeline.
// Given a channelId, extracts every paid brand integration in the last 6 months,
// measures it against the creator's view baseline, samples audience sentiment
// per brand, and scores each entry Strong / Solid / Mixed / Flopped.
//
// This module makes a lot of Haiku calls (~50 for extraction + N for sentiment).
// Callers MUST go through the 24h cache wrapper at the route layer.

import { complete, HAIKU_MODEL } from "./anthropic";
import {
  buildCommentSentimentUserPrompt,
  buildSponsorExtractionUserPrompt,
  COMMENT_SENTIMENT_PROMPT,
  SPONSOR_EXTRACTION_PROMPT,
} from "./prompts";
import {
  getPlaylistVideoIds,
  getUploadsPlaylistId,
  getVideoComments,
  getVideoDetails,
  type DetailedVideo,
} from "./youtube";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const SPONSOR_SIGNALS = ["Strong", "Solid", "Mixed", "Flopped"] as const;
export type SponsorSignal = (typeof SPONSOR_SIGNALS)[number];

export const SPONSOR_SENTIMENTS = ["positive", "neutral", "mixed", "negative"] as const;
export type SponsorSentiment = (typeof SPONSOR_SENTIMENTS)[number];

export type SponsorEntry = {
  brand: string;
  integrationCount: number;
  videoIds: string[];
  topVideoId: string;
  avgViewsVsBaseline: number; // ratio: 1.0 = baseline; 1.4 = 40% above
  sentiment: SponsorSentiment;
  sentimentEvidence: string;
  recurrence: boolean;
  signal: SponsorSignal;
};

export type SponsorScorecard = {
  windowDays: number;
  totalVideosInWindow: number;
  baselineMedianViews: number;
  sponsoredVideoCount: number;
  sponsors: SponsorEntry[];
};

// ---------------------------------------------------------------------------
// Tunables — keep at the top so it's easy to dial up/down without spelunking.
// ---------------------------------------------------------------------------

const WINDOW_DAYS = 180; // ~6 months
const MAX_VIDEOS_TO_FETCH = 50;
const EXTRACTION_CONCURRENCY = 6;
const SENTIMENT_CONCURRENCY = 4;
const SENTIMENT_COMMENT_COUNT = 50;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Extraction = { sponsored: boolean; brand: string | null; evidence: string | null };
type Sentiment = { sentiment: SponsorSentiment; evidence: string };

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function isExtraction(x: unknown): x is Extraction {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.sponsored !== "boolean") return false;
  if (o.brand !== null && typeof o.brand !== "string") return false;
  if (o.evidence !== null && typeof o.evidence !== "string") return false;
  return true;
}

function isSentiment(x: unknown): x is Sentiment {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.sentiment !== "string") return false;
  if (!(SPONSOR_SENTIMENTS as readonly string[]).includes(o.sentiment)) return false;
  if (typeof o.evidence !== "string") return false;
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

function normalizeBrand(raw: string): string {
  return raw
    .replace(/[®™©]/g, "")
    .replace(/[.,'"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function brandKey(raw: string): string {
  return normalizeBrand(raw).toLowerCase();
}

function withinWindow(publishedAt: string, days: number): boolean {
  if (!publishedAt) return false;
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= days * 24 * 60 * 60 * 1000;
}

function tier(
  ratio: number,
  sentiment: SponsorSentiment,
  recurrence: boolean,
): SponsorSignal {
  // Negative sentiment is a hard veto — even high views read as backlash.
  if (sentiment === "negative") return "Flopped";
  if (ratio < 0.8) return "Flopped";
  if (ratio >= 1.2 && sentiment === "positive" && recurrence) return "Strong";
  if (ratio >= 1.0) return "Solid";
  if (sentiment === "positive" && recurrence) return "Solid";
  if (sentiment === "mixed") return "Mixed";
  if (ratio < 1.0) return "Mixed"; // i.e. 0.8 ≤ ratio < 1.0
  return "Solid";
}

const TIER_RANK: Record<SponsorSignal, number> = {
  Strong: 0,
  Solid: 1,
  Mixed: 2,
  Flopped: 3,
};

// ---------------------------------------------------------------------------
// Haiku calls (one per video / one per brand)
// ---------------------------------------------------------------------------

async function extractSponsor(description: string): Promise<Extraction> {
  // Short-circuit obvious empties — saves a Haiku call.
  if (!description || description.trim().length < 20) {
    return { sponsored: false, brand: null, evidence: null };
  }

  try {
    const { text } = await complete({
      model: HAIKU_MODEL,
      system: SPONSOR_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: buildSponsorExtractionUserPrompt(description) }],
      maxTokens: 200,
      temperature: 0,
    });
    const cleaned = stripJsonFence(text);
    const parsed: unknown = JSON.parse(cleaned);
    if (!isExtraction(parsed)) {
      console.warn("[sponsors] extraction shape mismatch, dropping:", parsed);
      return { sponsored: false, brand: null, evidence: null };
    }
    // Defensive: model may say sponsored:true with brand:null — treat as false.
    if (parsed.sponsored && (!parsed.brand || !parsed.brand.trim())) {
      return { sponsored: false, brand: null, evidence: null };
    }
    return parsed;
  } catch (err) {
    console.warn("[sponsors] extraction failed (treating as not-sponsored):", err);
    return { sponsored: false, brand: null, evidence: null };
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
      maxTokens: 200,
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

export async function getSponsorScorecard(channelId: string): Promise<SponsorScorecard> {
  const overallStart = Date.now();
  console.log(`[sponsors] start channelId=${channelId}`);

  const uploadsId = await getUploadsPlaylistId(channelId);
  if (!uploadsId) {
    return emptyScorecard();
  }

  const ids = await getPlaylistVideoIds(uploadsId, MAX_VIDEOS_TO_FETCH);
  const inWindow = ids.filter((x) => withinWindow(x.publishedAt, WINDOW_DAYS));
  if (inWindow.length === 0) {
    console.log(`[sponsors] no videos in last ${WINDOW_DAYS}d for ${channelId}`);
    return emptyScorecard();
  }

  const videos = await getVideoDetails(inWindow.map((x) => x.videoId));
  // Filter again on videos.list timestamps (uploads playlist sometimes returns
  // republished items with a later videoPublishedAt than the snippet date).
  const inWindowDetailed = videos.filter((v) => withinWindow(v.publishedAt, WINDOW_DAYS));
  if (inWindowDetailed.length === 0) {
    return emptyScorecard();
  }

  // 1) Per-video sponsor extraction (Haiku × N, bounded concurrency).
  const extractions = await pMap(
    inWindowDetailed,
    (v) => extractSponsor(v.description),
    EXTRACTION_CONCURRENCY,
  );

  const sponsoredVideos: { video: DetailedVideo; brand: string; evidence: string | null }[] = [];
  const nonSponsoredViews: number[] = [];

  inWindowDetailed.forEach((video, i) => {
    const x = extractions[i];
    if (x.sponsored && x.brand) {
      sponsoredVideos.push({
        video,
        brand: normalizeBrand(x.brand),
        evidence: x.evidence,
      });
    } else {
      nonSponsoredViews.push(video.viewCount);
    }
  });

  // 2) Baseline = median views of non-sponsored. Fall back to all videos if the
  //    creator's recent slate is mostly paid (rare but possible).
  const baseline =
    median(nonSponsoredViews.length > 0 ? nonSponsoredViews : inWindowDetailed.map((v) => v.viewCount));

  if (sponsoredVideos.length === 0) {
    console.log(
      `[sponsors] no sponsored videos detected for ${channelId} ` +
        `(checked ${inWindowDetailed.length}; baseline=${baseline.toLocaleString("en-US")}) ` +
        `in ${Date.now() - overallStart}ms`,
    );
    return {
      windowDays: WINDOW_DAYS,
      totalVideosInWindow: inWindowDetailed.length,
      baselineMedianViews: baseline,
      sponsoredVideoCount: 0,
      sponsors: [],
    };
  }

  // 3) Group by brand (case-insensitive). Pick the most-viewed video per brand
  //    for the sentiment probe.
  type BrandGroup = {
    displayName: string;
    videos: DetailedVideo[];
  };
  const byBrand = new Map<string, BrandGroup>();
  for (const s of sponsoredVideos) {
    const key = brandKey(s.brand);
    if (!key) continue;
    const existing = byBrand.get(key);
    if (existing) {
      existing.videos.push(s.video);
    } else {
      byBrand.set(key, { displayName: s.brand, videos: [s.video] });
    }
  }

  const brandList = [...byBrand.values()];

  // 4) Sentiment per brand (Haiku × M, bounded concurrency). Fetch comments
  //    from the brand's most-viewed sponsored video.
  const sentiments = await pMap(
    brandList,
    async (group) => {
      const topVideo = [...group.videos].sort((a, b) => b.viewCount - a.viewCount)[0];
      const comments = await getVideoComments(topVideo.videoId, SENTIMENT_COMMENT_COUNT);
      return analyzeSentiment(group.displayName, comments);
    },
    SENTIMENT_CONCURRENCY,
  );

  // 5) Score every brand and assemble.
  const sponsors: SponsorEntry[] = brandList.map((group, i) => {
    const sorted = [...group.videos].sort((a, b) => b.viewCount - a.viewCount);
    const top = sorted[0];
    const avgViews =
      group.videos.reduce((s, v) => s + v.viewCount, 0) / group.videos.length;
    const ratio = baseline > 0 ? avgViews / baseline : 0;
    const integrationCount = group.videos.length;
    const recurrence = integrationCount >= 2;
    const s = sentiments[i];
    const signal = tier(ratio, s.sentiment, recurrence);
    return {
      brand: group.displayName,
      integrationCount,
      videoIds: group.videos.map((v) => v.videoId),
      topVideoId: top.videoId,
      avgViewsVsBaseline: Number(ratio.toFixed(2)),
      sentiment: s.sentiment,
      sentimentEvidence: s.evidence,
      recurrence,
      signal,
    } satisfies SponsorEntry;
  });

  sponsors.sort((a, b) => {
    const tierDiff = TIER_RANK[a.signal] - TIER_RANK[b.signal];
    if (tierDiff !== 0) return tierDiff;
    if (b.integrationCount !== a.integrationCount) return b.integrationCount - a.integrationCount;
    return b.avgViewsVsBaseline - a.avgViewsVsBaseline;
  });

  console.log(
    `[sponsors] channelId=${channelId} done in ${Date.now() - overallStart}ms — ` +
      `videos=${inWindowDetailed.length} sponsored=${sponsoredVideos.length} brands=${sponsors.length} ` +
      `baseline=${baseline.toLocaleString("en-US")}`,
  );

  return {
    windowDays: WINDOW_DAYS,
    totalVideosInWindow: inWindowDetailed.length,
    baselineMedianViews: baseline,
    sponsoredVideoCount: sponsoredVideos.length,
    sponsors,
  };
}

function emptyScorecard(): SponsorScorecard {
  return {
    windowDays: WINDOW_DAYS,
    totalVideosInWindow: 0,
    baselineMedianViews: 0,
    sponsoredVideoCount: 0,
    sponsors: [],
  };
}

// ---------------------------------------------------------------------------
// Summary string used by the Concept Seed prompt.
// ---------------------------------------------------------------------------

export function buildScorecardSummary(scorecard: SponsorScorecard): string {
  if (scorecard.sponsors.length === 0) {
    return "No paid brand integrations detected in the last 6 months.";
  }
  const lines: string[] = [];
  lines.push(
    `Window: last ${scorecard.windowDays} days. Baseline (median non-sponsored views): ${scorecard.baselineMedianViews.toLocaleString(
      "en-US",
    )}.`,
  );
  for (const s of scorecard.sponsors) {
    const ratio = `${s.avgViewsVsBaseline.toFixed(2)}× baseline`;
    const recur = s.recurrence ? `${s.integrationCount}x integrations` : "1 integration";
    lines.push(
      `- ${s.brand} — ${s.signal} · ${ratio} · ${recur} · sentiment ${s.sentiment} (${s.sentimentEvidence})`,
    );
  }
  return lines.join("\n");
}
