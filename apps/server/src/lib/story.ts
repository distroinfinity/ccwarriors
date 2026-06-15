// Story generation (#50): redacted transcripts → Claude → structured StoryDoc.
// One call per user per refresh window; the source payload is purged by the
// service after a successful generation.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { StoryDoc } from "../db/schema.js";

// Cost notes (2026-06, claude-opus-4-8 @ $5/MTok input, $25/MTok output):
//   Typical generation with a 500k-char budget ≈ $0.70–0.90/call.
//   Rate: 1/day/user (STORY_REFRESH_MS throttle in story-service.ts).
//   Prompt caching: NOT used — the system prompt is well under the 4096-token
//   minimum cacheable prefix, and calls are ≥24h apart (cache TTL is 5 min).
//   Batch API: NOT used — poll-loop complexity isn't worth it until ~1k calls/day.
export const STORY_MODEL = "claude-opus-4-8";

// Characters budget fed to the LLM per generation. Trimming to this cap in
// prepareStorySource (whole-session granularity) prevents mid-JSON truncation.
const SERVER_INPUT_CHAR_CAP = 600_000;

const StoryDocSchema = z.object({
  narrative: z.string(),
  whatYouBuilt: z.string(),
  decisionPatterns: z.array(z.object({ name: z.string(), count: z.number().int(), evidence: z.string() })),
  strengths: z.array(z.object({ title: z.string(), detail: z.string() })),
  growthAreas: z.array(z.object({ title: z.string(), detail: z.string() })),
  aiArchetypes: z.array(z.object({ name: z.string(), blurb: z.string(), evidence: z.number().int() })),
  crypticPrompt: z.string().nullable(),
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
  },
  ["narrative", "whatYouBuilt", "decisionPatterns", "strengths", "growthAreas", "aiArchetypes", "crypticPrompt"],
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
- narrative: one tight headline paragraph. whatYouBuilt: what the work was about, inferred from the prompts.`;

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

export type StoryResult =
  | { doc: StoryDoc; model: string; usage?: StoryUsage; sessionsUsed: number; sessionsReceived: number }
  | { failed: string };
export type StoryGenerate = (login: string, source: unknown) => Promise<StoryResult | null>;

/**
 * Validate and budget-trim a raw story source payload.
 *
 * Sessions are accumulated in ARRAY ORDER (client sends most-recent-first),
 * so oldest sessions are dropped when the serialized budget is exhausted.
 * Whole sessions are always kept or dropped — never sliced mid-JSON.
 */
export function prepareStorySource(source: unknown):
  | { serialized: string; sessionsUsed: number; sessionsReceived: number; windowDays: number | null }
  | { failed: "invalid_source" } {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return { failed: "invalid_source" };
  }
  const s = source as Record<string, unknown>;
  if (!Array.isArray(s.sessions)) return { failed: "invalid_source" };

  const sessions = s.sessions as unknown[];
  const sessionsReceived = sessions.length;
  const windowDays =
    typeof s.windowDays === "number" && Number.isFinite(s.windowDays) ? s.windowDays : null;

  // Pre-stringify each session, accumulate in order (client sends newest first),
  // skipping any that won't fit. Skip-and-continue rather than break so one
  // oversized session can't starve the smaller older ones behind it.
  const kept: string[] = [];
  let totalLen = 2; // "[" + "]"
  for (const session of sessions) {
    const encoded = JSON.stringify(session);
    const addLen = kept.length === 0 ? encoded.length : 1 + encoded.length; // comma separator
    if (totalLen + addLen > SERVER_INPUT_CHAR_CAP) continue;
    kept.push(encoded);
    totalLen += addLen;
  }

  const serialized = "[" + kept.join(",") + "]";
  return { serialized, sessionsUsed: kept.length, sessionsReceived, windowDays };
}

/** Call Claude for one user's story. Failures come back as { failed } with
    the reason — the caller keeps the old story, logs it, and retries on the
    next upload. */
export async function generateStory(
  opts: GenerateStoryOpts,
  login: string,
  source: unknown,
): Promise<StoryResult> {
  const startedAt = Date.now();

  const prepared = prepareStorySource(source);
  if ("failed" in prepared) return { failed: prepared.failed };
  const { serialized, sessionsUsed, sessionsReceived, windowDays } = prepared;
  // A source whose every session is oversized trims to nothing — never ask
  // Claude to invent a story from an empty transcript array.
  if (sessionsUsed === 0) return { failed: "no_sessions_after_trim" };

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
          content: `Developer: ${login}\nWindow: last ${windowDays ?? 40} days\n\nSession transcripts (JSON, ${sessionsUsed} sessions):\n${serialized}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: STORY_JSON_SCHEMA } },
    });
    const text = response.content.find((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text");
    if (!text) return { failed: "no_text_block" };
    const parsed = StoryDocSchema.parse(JSON.parse(text.text));
    // Server-stamp sessionsAnalyzed and windowDays — never trust the LLM's count.
    const docStamped: StoryDoc = {
      ...parsed,
      sessionsAnalyzed: sessionsUsed,
      windowDays: windowDays ?? 40,
    };
    const price = STORY_PRICES[model];
    const usage: StoryUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      estCostUsd: price
        ? Math.round((response.usage.input_tokens * price.input + response.usage.output_tokens * price.output) / 10) / 100_000
        : null,
      durationMs: Date.now() - startedAt,
    };
    return { doc: docStamped, model, usage, sessionsUsed, sessionsReceived };
  } catch (err) {
    // Typed reasons beat opaque nulls: api_429 / api_401 / parse errors etc.
    const e = err as { status?: number; message?: string };
    const reason = typeof e.status === "number" ? `api_${e.status}` : (e.message ?? "unknown").slice(0, 120);
    return { failed: reason };
  }
}
