// POST /api/refine
// Body: { messages: UIMessage[], creatorTitle, country?, creatorProfile, concept }
// Streams a Sonnet 4.6 reply as a UI Message stream, consumable by useChat.

import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { SONNET_MODEL } from "@/lib/anthropic";
import {
  buildRefinementChatContext,
  REFINEMENT_CHAT_SYSTEM_PROMPT,
  type RefinementContextInput,
} from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  messages?: unknown;
  creatorTitle?: unknown;
  country?: unknown;
  creatorProfile?: unknown;
  concept?: unknown;
};

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

function isConcept(x: unknown): x is RefinementContextInput["concept"] {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return (
    typeof c.riskTier === "string" &&
    isStringArray(c.names) &&
    typeof c.category === "string" &&
    typeof c.positioning === "string" &&
    typeof c.wedge === "string" &&
    typeof c.whyThisCreatorWins === "string"
  );
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const creatorTitle =
    typeof body.creatorTitle === "string" ? body.creatorTitle.trim() : "";
  const creatorProfile =
    typeof body.creatorProfile === "string" ? body.creatorProfile.trim() : "";
  const country = typeof body.country === "string" ? body.country : undefined;

  if (!creatorTitle) {
    return Response.json({ error: "Missing 'creatorTitle'" }, { status: 400 });
  }
  if (!creatorProfile) {
    return Response.json({ error: "Missing 'creatorProfile'" }, { status: 400 });
  }
  if (!isConcept(body.concept)) {
    return Response.json({ error: "Missing or malformed 'concept'" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "Missing 'messages'" }, { status: 400 });
  }

  const messages = body.messages as UIMessage[];

  const system =
    REFINEMENT_CHAT_SYSTEM_PROMPT +
    "\n\n" +
    buildRefinementChatContext({
      creatorTitle,
      country,
      creatorProfile,
      concept: body.concept,
    });

  const modelMessages = await convertToModelMessages(messages);
  const result = streamText({
    model: anthropic(SONNET_MODEL),
    system,
    messages: modelMessages,
    temperature: 0.55,
    maxOutputTokens: 1200,
    onError({ error }) {
      console.error("[/api/refine] streamText error:", error);
    },
  });

  return result.toUIMessageStreamResponse();
}
