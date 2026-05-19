// POST /api/concepts
// Body: { channelTitle: string, country?: string, profile: string }
// Returns: { concepts: BrandConcept[] } — exactly 3, ordered by risk tier.
//
// Called by the results page once the Creator Profile stream has finished.

import { generateConcepts } from "@/lib/concepts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  channelTitle?: unknown;
  country?: unknown;
  profile?: unknown;
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

  if (!channelTitle) {
    return Response.json({ error: "Missing 'channelTitle'" }, { status: 400 });
  }
  if (!profile) {
    return Response.json({ error: "Missing 'profile'" }, { status: 400 });
  }

  try {
    const concepts = await generateConcepts({ channelTitle, country, profile });
    return Response.json({ concepts }, { status: 200 });
  } catch (err) {
    console.error("[/api/concepts] failed:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}
