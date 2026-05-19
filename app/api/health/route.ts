// Deploy-time verification: hits all three external APIs in parallel and aggregates
// results so a single failure doesn't mask the others. Spec: API_INTEGRATION_SPEC.md §"/api/health".

import { NextResponse } from "next/server";
import { getChannelDetails, searchChannels } from "@/lib/youtube";
import { search as tavilySearch } from "@/lib/tavily";
import { complete, HAIKU_MODEL } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

type ProbeOk<T> = { ok: true; result: T };
type ProbeErr = { ok: false; error: string };
type Probe<T> = ProbeOk<T> | ProbeErr;

function toError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function probeYouTube(): Promise<Probe<string>> {
  try {
    const channels = await searchChannels("MrBeast", 1);
    const first = channels[0];
    if (!first) return { ok: false, error: "No channels returned" };
    const details = await getChannelDetails(first.channelId);
    const subs = details ? details.subscriberCount.toLocaleString("en-US") : "unknown";
    return { ok: true, result: `${first.title} — ${subs} subscribers` };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

async function probeTavily(): Promise<Probe<string[]>> {
  try {
    const results = await tavilySearch("top wellness creators India 2026", { maxResults: 5 });
    return { ok: true, result: results.slice(0, 3).map((r) => r.title) };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

async function probeAnthropic(): Promise<Probe<string>> {
  try {
    const { text } = await complete({
      model: HAIKU_MODEL,
      messages: [{ role: "user", content: "Say hi in 5 words" }],
      maxTokens: 50,
      temperature: 0,
    });
    return { ok: true, result: text.trim() };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

export async function GET() {
  const [youtube, tavily, anthropic] = await Promise.all([
    probeYouTube(),
    probeTavily(),
    probeAnthropic(),
  ]);

  const allOk = youtube.ok && tavily.ok && anthropic.ok;
  return NextResponse.json({ youtube, tavily, anthropic }, { status: allOk ? 200 : 503 });
}
