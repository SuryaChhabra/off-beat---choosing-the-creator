// POST /api/concepts
// Body: { channelTitle, country?, profile, scorecardSummary? }
// Returns: { concepts: BrandConcept[] } — exactly 3, ordered by risk tier.
//
// Called by the results page once the Creator Profile stream finishes AND
// the sponsor scorecard has loaded. scorecardSummary is the short string
// produced by buildScorecardSummary(); it gets folded into the prompt so
// concepts lean toward Strong/Solid categories and avoid Flopped ones.

import { generateConcepts } from "@/lib/concepts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  channelTitle?: unknown;
  country?: unknown;
  profile?: unknown;
  scorecardSummary?: unknown;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channelTitle = typeof body.channelTitle === "string" ? body.channelTitle.trim() : "";
  const profile = typeof body.profile === "string" ? body.profile.trim() : "";
  const country = typeof body.country === "string" ? body.country : undefined;
  const scorecardSummary =
    typeof body.scorecardSummary === "string" ? body.scorecardSummary : undefined;

  if (!channelTitle) {
    return Response.json({ error: "Missing 'channelTitle'" }, { status: 400 });
  }
  if (!profile) {
    return Response.json({ error: "Missing 'profile'" }, { status: 400 });
  }

  try {
    const concepts = await generateConcepts({
      channelTitle,
      country,
      profile,
      scorecardSummary,
    });
    return Response.json({ concepts }, { status: 200 });
  } catch (err) {
    console.error("[/api/concepts] failed:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}
