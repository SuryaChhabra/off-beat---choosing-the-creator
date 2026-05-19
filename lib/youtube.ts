// YouTube Data API v3 client. Phase 1 ships only what `/api/health` needs:
// `searchChannels` and `getChannelDetails`. Other functions in the integration
// spec (getChannelVideos, getVideoDetails, getVideoComments) come with the pipeline.

import { google, youtube_v3 } from "googleapis";

export type RecentVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
};

export type ChannelSearchResult = {
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
};

export type ChannelDetails = {
  channelId: string;
  title: string;
  description: string;
  customUrl?: string;
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
  country?: string;
  publishedAt: string;
  thumbnailUrl: string;
};

let cachedClient: youtube_v3.Youtube | null = null;

function getClient(): youtube_v3.Youtube {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set");
  cachedClient = google.youtube({ version: "v3", auth: apiKey });
  return cachedClient;
}

function isQuotaExceeded(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: number; errors?: { reason?: string }[] };
  if (e.code !== 403) return false;
  return (e.errors ?? []).some((x) => x.reason === "quotaExceeded");
}

export async function searchChannels(
  query: string,
  maxResults: number = 10,
): Promise<ChannelSearchResult[]> {
  const yt = getClient();
  const startedAt = Date.now();
  console.log(`[YouTube] searchChannels query="${query}" maxResults=${maxResults}`);

  try {
    const res = await yt.search.list({
      part: ["snippet"],
      q: query,
      type: ["channel"],
      maxResults,
    });

    const items = res.data.items ?? [];
    const results: ChannelSearchResult[] = items
      .map((item) => {
        const channelId = item.snippet?.channelId ?? item.id?.channelId;
        if (!channelId) return null;
        return {
          channelId,
          title: item.snippet?.title ?? "",
          description: item.snippet?.description ?? "",
          thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? "",
        } satisfies ChannelSearchResult;
      })
      .filter((x): x is ChannelSearchResult => x !== null);

    console.log(`[YouTube] searchChannels returned ${results.length} in ${Date.now() - startedAt}ms`);
    return results;
  } catch (err) {
    if (isQuotaExceeded(err)) throw new Error("YouTube API quota exceeded for the day");
    throw err;
  }
}

// Resolves any user input — @handle, channel URL, plain creator name — to a single
// channel via YouTube search. Returns null if nothing plausible was found.
export async function findChannel(query: string): Promise<ChannelSearchResult | null> {
  const cleaned = query.trim();
  if (!cleaned) return null;

  // Strip URL prefixes + leading @ so search treats "@therebelkid" and
  // "https://youtube.com/@therebelkid" the same as "therebelkid".
  const stripped = cleaned
    .replace(/^https?:\/\/(www\.)?youtube\.com\//i, "")
    .replace(/^\/+/, "")
    .replace(/^@/, "")
    .replace(/^c\//, "")
    .replace(/^channel\//, "")
    .replace(/^user\//, "")
    .split(/[/?#]/)[0]
    .trim();

  const searchTerm = stripped || cleaned;
  const results = await searchChannels(searchTerm, 5);
  return results[0] ?? null;
}

export async function getRecentVideos(
  channelId: string,
  maxResults: number = 15,
): Promise<RecentVideo[]> {
  const yt = getClient();
  const startedAt = Date.now();
  console.log(`[YouTube] getRecentVideos channelId="${channelId}" max=${maxResults}`);

  try {
    const res = await yt.search.list({
      part: ["snippet"],
      channelId,
      type: ["video"],
      order: "date",
      maxResults,
    });

    const items = res.data.items ?? [];
    const videos: RecentVideo[] = items
      .map((item) => {
        const videoId = item.id?.videoId;
        if (!videoId) return null;
        return {
          videoId,
          title: item.snippet?.title ?? "",
          description: item.snippet?.description ?? "",
          publishedAt: item.snippet?.publishedAt ?? "",
        } satisfies RecentVideo;
      })
      .filter((x): x is RecentVideo => x !== null);

    console.log(`[YouTube] getRecentVideos returned ${videos.length} in ${Date.now() - startedAt}ms`);
    return videos;
  } catch (err) {
    if (isQuotaExceeded(err)) throw new Error("YouTube API quota exceeded for the day");
    throw err;
  }
}

export async function getChannelDetails(channelId: string): Promise<ChannelDetails | null> {
  const yt = getClient();
  const startedAt = Date.now();
  console.log(`[YouTube] getChannelDetails channelId="${channelId}"`);

  try {
    const res = await yt.channels.list({
      part: ["snippet", "statistics"],
      id: [channelId],
    });

    const item = res.data.items?.[0];
    if (!item) return null;

    const snippet = item.snippet ?? {};
    const stats = item.statistics ?? {};
    const details: ChannelDetails = {
      channelId: item.id ?? channelId,
      title: snippet.title ?? "",
      description: snippet.description ?? "",
      customUrl: snippet.customUrl ?? undefined,
      subscriberCount: Number(stats.subscriberCount ?? 0),
      totalViews: Number(stats.viewCount ?? 0),
      videoCount: Number(stats.videoCount ?? 0),
      country: snippet.country ?? undefined,
      publishedAt: snippet.publishedAt ?? "",
      thumbnailUrl: snippet.thumbnails?.default?.url ?? "",
    };

    console.log(`[YouTube] getChannelDetails ok in ${Date.now() - startedAt}ms`);
    return details;
  } catch (err) {
    const e = err as { code?: number };
    if (e?.code === 404) return null;
    if (isQuotaExceeded(err)) throw new Error("YouTube API quota exceeded for the day");
    throw err;
  }
}
