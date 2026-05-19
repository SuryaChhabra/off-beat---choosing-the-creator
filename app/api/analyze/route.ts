// POST /api/analyze
// Body: { prompt: string } (from useCompletion) OR { query: string } (direct).
// Returns a plain text/event-style stream consumed by `useCompletion` with
// streamProtocol: "text". The stream is prefixed with an OFFBEAT meta envelope
// (see lib/pipeline.ts) so the client can render the channel header before tokens.

import { analyzeCreator, CreatorNotFoundError } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { prompt?: unknown; query?: unknown };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = typeof body.query === "string" ? body.query : body.prompt;
  const query = typeof raw === "string" ? raw.trim() : "";
  if (!query) {
    return Response.json({ error: "Missing 'query' or 'prompt' in body" }, { status: 400 });
  }

  try {
    const { stream } = await analyzeCreator(query);
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    if (err instanceof CreatorNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    console.error("[/api/analyze] failed:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}
