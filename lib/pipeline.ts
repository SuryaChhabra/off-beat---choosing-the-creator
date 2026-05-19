// Orchestration for the Phase-1 Creator Profile step:
// findChannel → getChannelDetails → getRecentVideos → streamText(Claude Sonnet 4.6).
//
// `analyzeCreator` returns the resolved channel meta plus a ReadableStream<Uint8Array>
// that the route handler can return directly. The stream is prefixed with a JSON
// envelope (delimited by __OFFBEAT_META_START__ / __OFFBEAT_META_END__) so the client
// can render the channel header before the analysis tokens start arriving.

import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import {
  findChannel,
  getChannelDetails,
  getRecentVideos,
  type ChannelDetails,
} from "./youtube";
import { buildCreatorProfileUserPrompt, CREATOR_PROFILE_SYSTEM } from "./prompts";
import { SONNET_MODEL } from "./anthropic";

export type CreatorMeta = {
  channelId: string;
  title: string;
  customUrl?: string;
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
  country?: string;
  thumbnailUrl: string;
};

export const META_START = "__OFFBEAT_META_START__";
export const META_END = "__OFFBEAT_META_END__";

function toCreatorMeta(d: ChannelDetails): CreatorMeta {
  return {
    channelId: d.channelId,
    title: d.title,
    customUrl: d.customUrl,
    subscriberCount: d.subscriberCount,
    totalViews: d.totalViews,
    videoCount: d.videoCount,
    country: d.country,
    thumbnailUrl: d.thumbnailUrl,
  };
}

export class CreatorNotFoundError extends Error {
  constructor(query: string) {
    super(`No YouTube channel matched "${query}"`);
    this.name = "CreatorNotFoundError";
  }
}

export async function analyzeCreator(query: string): Promise<{
  meta: CreatorMeta;
  stream: ReadableStream<Uint8Array>;
}> {
  const startedAt = Date.now();

  const match = await findChannel(query);
  if (!match) throw new CreatorNotFoundError(query);

  const [details, recentVideos] = await Promise.all([
    getChannelDetails(match.channelId),
    getRecentVideos(match.channelId, 15),
  ]);
  if (!details) throw new CreatorNotFoundError(query);

  const meta = toCreatorMeta(details);
  console.log(
    `[pipeline] analyzeCreator resolved "${query}" → ${details.title} ` +
      `(${details.subscriberCount.toLocaleString("en-US")} subs, ` +
      `${recentVideos.length} recent videos) in ${Date.now() - startedAt}ms`,
  );

  const userPrompt = buildCreatorProfileUserPrompt({
    channelTitle: details.title,
    channelDescription: details.description,
    subscriberCount: details.subscriberCount,
    totalViews: details.totalViews,
    videoCount: details.videoCount,
    country: details.country,
    publishedAt: details.publishedAt,
    recentVideos,
  });

  const result = streamText({
    model: anthropic(SONNET_MODEL),
    system: CREATOR_PROFILE_SYSTEM,
    prompt: userPrompt,
    temperature: 0.4,
    maxOutputTokens: 1500,
    onError({ error }) {
      console.error("[pipeline] streamText error:", error);
    },
  });

  const encoder = new TextEncoder();
  const envelope = `${META_START}${JSON.stringify(meta)}${META_END}\n`;
  const textStream = result.textStream;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(envelope));
      try {
        for await (const chunk of textStream) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        console.error("[pipeline] stream pump error:", err);
        controller.error(err);
      }
    },
  });

  return { meta, stream };
}
