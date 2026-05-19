// GET /api/sponsors/[handle]
// Resolves handle → channelId, then returns the sponsor scorecard for the
// past 6 months. 24h cache by channelId since the underlying Haiku run is
// the expensive part (~50+ extraction calls + N sentiment calls).

import { findChannel } from "@/lib/youtube";
import { buildScorecardSummary, getSponsorScorecard } from "@/lib/sponsors";
import { cached, DAY_MS, HOUR_MS } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteParams = Promise<{ handle: string }>;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function GET(_req: Request, { params }: { params: RouteParams }) {
  const { handle } = await params;
  const decoded = safeDecode(handle).trim();
  if (!decoded) {
    return Response.json({ error: "Missing handle" }, { status: 400 });
  }

  try {
    // Channel resolution is itself cacheable — same handle hits the same
    // channelId virtually forever.
    const channel = await cached(`findChannel:v1:${decoded.toLowerCase()}`, HOUR_MS, () =>
      findChannel(decoded),
    );
    if (!channel) {
      return Response.json({ error: `No channel matched "${decoded}"` }, { status: 404 });
    }

    const scorecard = await cached(
      `sponsors:v1:${channel.channelId}`,
      DAY_MS,
      () => getSponsorScorecard(channel.channelId),
    );

    return Response.json(
      {
        channelId: channel.channelId,
        channelTitle: channel.title,
        scorecard,
        summary: buildScorecardSummary(scorecard),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error(`[/api/sponsors/${decoded}] failed:`, err);
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}
