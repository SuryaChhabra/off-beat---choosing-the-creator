// Generates 3 brand concepts (one per risk tier) for a creator, given the
// already-streamed Creator Profile. Non-streaming on purpose: the UI needs the
// whole structured payload to render the 3 cards.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { SONNET_MODEL } from "./anthropic";
import { buildConceptSeedPrompt, CONCEPT_SEED_SYSTEM } from "./prompts";

export const RISK_TIERS = ["Proven extension", "Adjacent leap", "Whitespace bet"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

const ConceptSchema = z.object({
  riskTier: z.enum(RISK_TIERS),
  names: z.array(z.string().min(1)).length(3),
  category: z.string().min(1),
  positioning: z.string().min(1),
  wedge: z.string().min(1),
  whyThisCreatorWins: z.string().min(1),
});

const ConceptsResponseSchema = z.object({
  concepts: z.array(ConceptSchema).length(3),
});

export type BrandConcept = z.infer<typeof ConceptSchema>;

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function generateConcepts(args: {
  channelTitle: string;
  country?: string;
  profile: string;
}): Promise<BrandConcept[]> {
  const startedAt = Date.now();
  const { text } = await generateText({
    model: anthropic(SONNET_MODEL),
    system:
      CONCEPT_SEED_SYSTEM +
      `\n\nFinal output rule: respond with ONE raw JSON object matching this exact shape and nothing else (no markdown fences, no commentary, no leading prose):\n` +
      `{"concepts":[{"riskTier":"Proven extension","names":["x","y","z"],"category":"...","positioning":"...","wedge":"...","whyThisCreatorWins":"..."},{"riskTier":"Adjacent leap",...},{"riskTier":"Whitespace bet",...}]}`,
    prompt: buildConceptSeedPrompt({
      channelTitle: args.channelTitle,
      country: args.country,
      profile: args.profile,
    }),
    temperature: 0.65,
    maxOutputTokens: 2000,
  });

  const cleaned = stripJsonFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("[concepts] JSON parse failed. Raw text:\n", text);
    throw new Error("Concept model returned non-JSON output");
  }

  const result = ConceptsResponseSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[concepts] schema validation failed:", result.error.issues);
    throw new Error("Concept model returned a payload that did not match the schema");
  }

  // Enforce risk-tier order and uniqueness so the UI can render in the expected sequence.
  const byTier = new Map(result.data.concepts.map((c) => [c.riskTier, c]));
  const ordered: BrandConcept[] = [];
  for (const tier of RISK_TIERS) {
    const concept = byTier.get(tier);
    if (!concept) {
      throw new Error(`Concept model missing required risk tier: ${tier}`);
    }
    ordered.push(concept);
  }

  console.log(
    `[concepts] generated ${ordered.length} concepts for "${args.channelTitle}" in ${Date.now() - startedAt}ms`,
  );
  return ordered;
}
