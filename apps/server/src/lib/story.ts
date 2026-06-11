// Story generation (#50): redacted transcripts → Claude → structured StoryDoc.
// One call per user per refresh window; the source payload is purged by the
// service after a successful generation.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { StoryDoc } from "../db/schema.js";

export const STORY_MODEL = "claude-opus-4-8";

const StoryDocSchema = z.object({
  narrative: z.string(),
  whatYouBuilt: z.string(),
  decisionPatterns: z.array(z.object({ name: z.string(), count: z.number().int(), evidence: z.string() })),
  strengths: z.array(z.object({ title: z.string(), detail: z.string() })),
  growthAreas: z.array(z.object({ title: z.string(), detail: z.string() })),
  aiArchetypes: z.array(z.object({ name: z.string(), blurb: z.string(), evidence: z.number().int() })),
  crypticPrompt: z.string().nullable(),
  sessionsAnalyzed: z.number().int(),
});

// Raw JSON Schema for output_config.format (the server is on zod v3, so the
// SDK's zodOutputFormat helper — zod v4 — can't be used; the schema is small
// and stable enough to keep by hand, validated by StoryDocSchema on the way in).
const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const STORY_JSON_SCHEMA = obj(
  {
    narrative: { type: "string" },
    whatYouBuilt: { type: "string" },
    decisionPatterns: {
      type: "array",
      items: obj({ name: { type: "string" }, count: { type: "integer" }, evidence: { type: "string" } }, ["name", "count", "evidence"]),
    },
    strengths: { type: "array", items: obj({ title: { type: "string" }, detail: { type: "string" } }, ["title", "detail"]) },
    growthAreas: { type: "array", items: obj({ title: { type: "string" }, detail: { type: "string" } }, ["title", "detail"]) },
    aiArchetypes: {
      type: "array",
      items: obj({ name: { type: "string" }, blurb: { type: "string" }, evidence: { type: "integer" } }, ["name", "blurb", "evidence"]),
    },
    crypticPrompt: { type: ["string", "null"] },
    sessionsAnalyzed: { type: "integer" },
  },
  ["narrative", "whatYouBuilt", "decisionPatterns", "strengths", "growthAreas", "aiArchetypes", "crypticPrompt", "sessionsAnalyzed"],
);

const SYSTEM = `You analyze how a software developer works with AI coding agents, from their real session transcripts (user prompts + tool-call counts; code and file paths are never included). Write their profile in the second person.

Voice: write like a sharp senior engineer who actually read the transcripts, not like a language model. Plain words. Short sentences. Concrete specifics. It should read like a peer review from a staff engineer who respects the reader.

Style rules, hard:
- No em-dashes or en-dashes anywhere. Use commas, periods, or parentheses.
- Banned: delve, leverage, seamless, robust, holistic, journey, landscape, testament, masterful, elevate, empower, unleash, supercharge, "it's worth noting", "in essence", "dive into", "a consistent X emerges".
- No flattery padding and no filler. Cut any sentence that does not carry a specific observation.
- Their own words beat your adjectives. Quote short verbatim phrases from their prompts where it lands.
- Numbers over vibes. "You interrupted 41 times to check prod" beats "you are diligent".

Substance rules:
- Every claim must trace to the transcripts. Count real occurrences for decisionPatterns/aiArchetypes evidence numbers, never invent counts.
- decisionPatterns: name recurring moves (like "Full Stop and Investigate") with how often they appear and one concrete evidence line.
- strengths: 2-4. growthAreas: 2-3, specific enough to act on this week, not career advice.
- aiArchetypes: 2-4 behavioral archetypes, a one-line blurb, an evidence count.
- crypticPrompt: the single most cryptic-yet-effective short prompt they sent (verbatim), or null.
- narrative: one tight headline paragraph. whatYouBuilt: what the work was about, inferred from the prompts.
- sessionsAnalyzed: the number of sessions in the input.`;

export interface GenerateStoryOpts {
  apiKey: string;
  model?: string;
  fetcher?: typeof fetch;
}

export interface StoryUsage {
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number | null;
  durationMs: number;
}

// $/MTok for the models we generate with — cost lands in telemetry so spend
// is visible per generation (null when the model is unknown).
const STORY_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
};

export type StoryResult = { doc: StoryDoc; model: string; usage?: StoryUsage } | { failed: string };
export type StoryGenerate = (login: string, source: unknown) => Promise<StoryResult | null>;

/** Call Claude for one user's story. Failures come back as { failed } with
    the reason — the caller keeps the old story, logs it, and retries on the
    next upload. */
export async function generateStory(
  opts: GenerateStoryOpts,
  login: string,
  source: unknown,
): Promise<StoryResult> {
  const startedAt = Date.now();
  try {
    const model = opts.model ?? STORY_MODEL;
    const client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.fetcher ? { fetch: opts.fetcher } : {}),
      maxRetries: 1,
    });
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Developer: ${login}\n\nSession transcripts (JSON):\n${JSON.stringify(source).slice(0, 600_000)}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: STORY_JSON_SCHEMA } },
    });
    const text = response.content.find((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text");
    if (!text) return { failed: "no_text_block" };
    const doc = StoryDocSchema.parse(JSON.parse(text.text));
    const price = STORY_PRICES[model];
    const usage: StoryUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      estCostUsd: price
        ? Math.round((response.usage.input_tokens * price.input + response.usage.output_tokens * price.output) / 10) / 100_000
        : null,
      durationMs: Date.now() - startedAt,
    };
    return { doc: doc as StoryDoc, model, usage };
  } catch (err) {
    // Typed reasons beat opaque nulls: api_429 / api_401 / parse errors etc.
    const e = err as { status?: number; message?: string };
    const reason = typeof e.status === "number" ? `api_${e.status}` : (e.message ?? "unknown").slice(0, 120);
    return { failed: reason };
  }
}
