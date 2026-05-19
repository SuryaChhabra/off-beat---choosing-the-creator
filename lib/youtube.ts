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

// ---------------------------------------------------------------------------
// Sponsor scorecard support: uploads playlist → video details → comments.
// These are deliberately separate from getRecentVideos (which uses search and
// gives the streamed Profile its evidence base). The scorecard pipeline needs
// stats (viewCount) and pages well past the most recent 15.
// ---------------------------------------------------------------------------

export type DetailedVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  viewCount: number;
  durationSeconds: number;
  paidProductPlacement: boolean;
};

export type LightVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
};

export function parseIsoDurationToSeconds(iso: string): number {
  if (!iso) return 0;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export async function getUploadsPlaylistId(channelId: string): Promise<string | null> {
  const yt = getClient();
  const startedAt = Date.now();
  try {
    const res = await yt.channels.list({
      part: ["contentDetails"],
      id: [channelId],
    });
    const uploads = res.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
    console.log(
      `[YouTube] getUploadsPlaylistId channelId="${channelId}" → ${uploads ?? "null"} in ${Date.now() - startedAt}ms`,
    );
    return uploads;
  } catch (err) {
    if (isQuotaExceeded(err)) throw new Error("YouTube API quota exceeded for the day");
    throw err;
  }
}

export async function getPlaylistVideoIds(
  playlistId: string,
  max: number = 50,
): Promise<{ videoId: string; publishedAt: string }[]> {
  const yt = getClient();
  const startedAt = Date.now();
  const results: { videoId: string; publishedAt: string }[] = [];
  let pageToken: string | undefined = undefined;

  try {
    while (results.length < max) {
      const remaining = max - results.length;
      const pageSize = Math.min(50, remaining);
      const res: youtube_v3.Schema$PlaylistItemListResponse = (
        await yt.playlistItems.list({
          part: ["contentDetails"],
          playlistId,
          maxResults: pageSize,
          pageToken,
        })
      ).data;
      for (const item of res.items ?? []) {
        const vid = item.contentDetails?.videoId;
        const published = item.contentDetails?.videoPublishedAt;
        if (vid && published) results.push({ videoId: vid, publishedAt: published });
      }
      pageToken = res.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    console.log(
      `[YouTube] getPlaylistVideoIds playlist=${playlistId} returned ${results.length} in ${Date.now() - startedAt}ms`,
    );
    return results.slice(0, max);
  } catch (err) {
    if (isQuotaExceeded(err)) throw new Error("YouTube API quota exceeded for the day");
    throw err;
  }
}

export async function getVideoDetails(videoIds: string[]): Promise<DetailedVideo[]> {
  if (videoIds.length === 0) return [];
  const yt = getClient();
  const startedAt = Date.now();
  const results: DetailedVideo[] = [];

  try {
    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const res = await yt.videos.list({
        part: ["snippet", "statistics", "contentDetails", "paidProductPlacementDetails"],
        id: chunk,
      });
      for (const item of res.data.items ?? []) {
        const duration = item.contentDetails?.duration ?? "";
        results.push({
          videoId: item.id ?? "",
          title: item.snippet?.title ?? "",
          description: item.snippet?.description ?? "",
          publishedAt: item.snippet?.publishedAt ?? "",
          viewCount: Number(item.statistics?.viewCount ?? 0),
          durationSeconds: parseIsoDurationToSeconds(duration),
          paidProductPlacement: Boolean(item.paidProductPlacementDetails?.hasPaidProductPlacement),
        });
      }
    }
    console.log(
      `[YouTube] getVideoDetails returned ${results.length}/${videoIds.length} in ${Date.now() - startedAt}ms`,
    );
    return results;
  } catch (err) {
    if (isQuotaExceeded(err)) throw new Error("YouTube API quota exceeded for the day");
    throw err;
  }
}

// Pass-B fetch: paginate the entire uploads playlist with snippet only.
// No videos.list / Haiku calls — pure text capture used for the all-time
// recurrence scan in the sponsor scorecard. Caller passes a generous max
// (e.g. 5000) to grab everything the channel has uploaded.
export async function getAllPlaylistVideosLight(
  playlistId: string,
  max: number = 5000,
): Promise<LightVideo[]> {
  const yt = getClient();
  const startedAt = Date.now();
  const results: LightVideo[] = [];
  let pageToken: string | undefined = undefined;
  let pages = 0;

  try {
    while (results.length < max) {
      const remaining = max - results.length;
      const pageSize = Math.min(50, remaining);
      const res: youtube_v3.Schema$PlaylistItemListResponse = (
        await yt.playlistItems.list({
          part: ["snippet"],
          playlistId,
          maxResults: pageSize,
          pageToken,
        })
      ).data;
      pages++;
      for (const item of res.items ?? []) {
        const vid = item.snippet?.resourceId?.videoId ?? "";
        if (!vid) continue;
        results.push({
          videoId: vid,
          title: item.snippet?.title ?? "",
          description: item.snippet?.description ?? "",
          publishedAt: item.snippet?.publishedAt ?? "",
        });
      }
      pageToken = res.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    console.log(
      `[YouTube] getAllPlaylistVideosLight playlist=${playlistId} returned ${results.length} ` +
        `across ${pages} pages in ${Date.now() - startedAt}ms`,
    );
    return results;
  } catch (err) {
    if (isQuotaExceeded(err)) throw new Error("YouTube API quota exceeded for the day");
    throw err;
  }
}

export async function getVideoComments(
  videoId: string,
  max: number = 50,
): Promise<string[]> {
  const yt = getClient();
  const startedAt = Date.now();
  try {
    const res = await yt.commentThreads.list({
      part: ["snippet"],
      videoId,
      maxResults: Math.min(max, 100),
      order: "relevance",
    });
    const comments = (res.data.items ?? [])
      .map((c) => c.snippet?.topLevelComment?.snippet?.textOriginal ?? "")
      .filter(Boolean);
    console.log(
      `[YouTube] getVideoComments videoId=${videoId} returned ${comments.length} in ${Date.now() - startedAt}ms`,
    );
    return comments;
  } catch (err) {
    const e = err as { code?: number; errors?: { reason?: string }[] };
    // Comments disabled on this video is a common, expected case — don't blow up
    // the whole pipeline, just return [] so the sentiment step can mark neutral.
    if (e?.code === 403) {
      const reason = e.errors?.[0]?.reason ?? "forbidden";
      console.log(`[YouTube] comments unavailable for ${videoId} (${reason})`);
      return [];
    }
    if (isQuotaExceeded(err)) throw new Error("YouTube API quota exceeded for the day");
    throw err;
  }
}
