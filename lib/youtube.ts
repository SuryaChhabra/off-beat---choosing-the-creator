// YouTube Data API v3 client. Phase 1 ships only what `/api/health` needs:
// `searchChannels` and `getChannelDetails`. Other functions in the integration
// spec (getChannelVideos, getVideoDetails, getVideoComments) come with the pipeline.

import { google, youtube_v3 } from "googleapis";

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
