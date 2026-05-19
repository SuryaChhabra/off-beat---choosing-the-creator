// Anthropic Claude client + model constants. Adds a thin non-streaming `complete` helper;
// streaming + Vercel-AI-SDK wiring will be added when refinement chat is built.

import Anthropic from "@anthropic-ai/sdk";

export const SONNET_MODEL = "claude-sonnet-4-6";
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

let cachedClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export type CompleteParams = {
  model: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  temperature?: number;
};

export type CompleteResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
};

export async function complete(params: CompleteParams): Promise<CompleteResult> {
  const client = getAnthropicClient();
  const startedAt = Date.now();
  const response = await client.messages.create({
    model: params.model,
    system: params.system,
    messages: params.messages,
    max_tokens: params.maxTokens ?? 2048,
    temperature: params.temperature ?? 0.5,
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  console.log(
    `[Anthropic] model=${params.model} latency=${Date.now() - startedAt}ms ` +
      `in=${usage.inputTokens} out=${usage.outputTokens}`,
  );

  return { text, usage };
}
