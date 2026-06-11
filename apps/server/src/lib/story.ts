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

const SYSTEM = `You analyze how a software developer works with AI coding agents, from their real session transcripts (user prompts + tool-call counts; code and file paths are never included). Write a sharp, specific, evidence-grounded profile in the second person ("You ..."). Tone: respectful, direct, a little literary — like a great performance review, never sycophantic.

Rules:
- Every claim must trace to the transcripts. Count real occurrences for decisionPatterns/aiArchetypes evidence numbers — never invent counts.
- decisionPatterns: name recurring moves (e.g. "Full Stop and Investigate") with how often they appear and one concrete evidence line.
- strengths: 2-4. growthAreas: 2-3, constructive and specific.
- aiArchetypes: 2-4 behavioral archetypes with a one-line blurb and an evidence count.
- crypticPrompt: the single most cryptic-yet-effective short prompt they sent (verbatim), or null.
- narrative: one headline paragraph. whatYouBuilt: what the work itself was about, inferred from the prompts.
- sessionsAnalyzed: the number of sessions in the input.`;

export interface GenerateStoryOpts {
  apiKey: string;
  model?: string;
  fetcher?: typeof fetch;
}

export type StoryGenerate = (login: string, source: unknown) => Promise<{ doc: StoryDoc; model: string } | null>;

/** Call Claude for one user's story. Returns null on any failure — the caller
    keeps the old story (if any) and retries on the next upload. */
export async function generateStory(
  opts: GenerateStoryOpts,
  login: string,
  source: unknown,
): Promise<{ doc: StoryDoc; model: string } | null> {
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
    if (!text) return null;
    const doc = StoryDocSchema.parse(JSON.parse(text.text));
    return { doc: doc as StoryDoc, model };
  } catch {
    return null;
  }
}
