import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { insightsRoute } from "../src/routes/insights.js";
import { profileRoute } from "../src/routes/profile.js";
import { InsightsStore } from "../src/lib/insights-store.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { maybeGenerateStory, STORY_REFRESH_MS } from "../src/lib/story-service.js";
import { generateStory, prepareStorySource } from "../src/lib/story.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, userStories, storySources, type StoryDoc } from "../src/db/schema.js";

// Story pipeline (#50): redacted transcripts in → Claude → StoryDoc out →
// transcripts PURGED. Raw prompts never persist beyond generation.

const TOKEN = "tok_story";
const MID = "ab12cd34ef56ab78";
const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

function doc(over: Partial<StoryDoc> = {}): StoryDoc {
  return {
    narrative: "You steer agents with architectural conviction.",
    whatYouBuilt: "A leaderboard platform with deep insights.",
    decisionPatterns: [{ name: "Full Stop and Investigate", count: 41, evidence: "Halts agents to verify production claims" }],
    strengths: [{ title: "Frame correction", detail: "Rewrites the question before answering" }],
    growthAreas: [{ title: "Review delegation", detail: "Could delegate more reviews" }],
    aiArchetypes: [{ name: "Frame Breaker", blurb: "Refuses the menu.", evidence: 27 }],
    crypticPrompt: "continue mb",
    sessionsAnalyzed: 12,
    ...over,
  };
}

function transcriptsBody() {
  return {
    machineId: MID,
    windowDays: 40,
    sessions: [
      {
        startedDay: "2026-06-01",
        durationMinutes: 90,
        model: "claude-opus-4-7",
        interrupts: 2,
        prompts: ["implement the plan", "no, check prod first"],
        toolCounts: { Edit: 12, Bash: 5 },
      },
    ],
  };
}

/** Build a body with N minimal sessions. */
function bodyWithNSessions(n: number) {
  const session = {
    startedDay: "2026-06-01",
    durationMinutes: 10,
    model: null,
    interrupts: 0,
    prompts: ["hi"],
    toolCounts: {},
  };
  return { machineId: MID, windowDays: 40, sessions: Array(n).fill(session) };
}

describe("POST /insights/transcripts", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
  });

  async function seed(consentVersion: number | null, mode = "deep") {
    const u = (await seedUser(db, { login: "storyteller", token: TOKEN }))!;
    await db
      .update(users)
      .set({ insightsConsent: mode === "deep", insightsMode: mode, consentVersion })
      .where(eq(users.id, u.id));
    return u;
  }

  it("rejects below consent v2 (text never accepted without the ack)", async () => {
    await seed(null);
    const app = insightsRoute({ db, insightsStore: store });
    const res = await app.request("/transcripts", { method: "POST", headers: auth, body: JSON.stringify(transcriptsBody()) });
    expect(res.status).toBe(403);
  });

  it("rejects when mode is off", async () => {
    await seed(2, "off");
    const app = insightsRoute({ db, insightsStore: store });
    const res = await app.request("/transcripts", { method: "POST", headers: auth, body: JSON.stringify(transcriptsBody()) });
    expect(res.status).toBe(403);
  });

  it("stores the source and kicks generation; source is purged after", async () => {
    const u = await seed(2);
    const generate = vi.fn().mockResolvedValue({ doc: doc(), model: "claude-opus-4-8", sessionsUsed: 1, sessionsReceived: 1 });
    const app = insightsRoute({ db, insightsStore: store, storyGenerate: generate });
    const res = await app.request("/transcripts", { method: "POST", headers: auth, body: JSON.stringify(transcriptsBody()) });
    expect(res.status).toBe(200);

    await vi.waitFor(async () => {
      const [story] = await db.select().from(userStories).where(eq(userStories.userId, u.id));
      expect(story?.doc.narrative).toContain("architectural conviction");
    });
    // PURGED: the raw transcripts must not survive generation.
    expect(await db.select().from(storySources).where(eq(storySources.userId, u.id))).toHaveLength(0);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("without a generator (no API key) the source is stored, dormant", async () => {
    const u = await seed(2);
    const app = insightsRoute({ db, insightsStore: store });
    const res = await app.request("/transcripts", { method: "POST", headers: auth, body: JSON.stringify(transcriptsBody()) });
    expect(res.status).toBe(200);
    expect(await db.select().from(storySources).where(eq(storySources.userId, u.id))).toHaveLength(1);
    expect(await db.select().from(userStories).where(eq(userStories.userId, u.id))).toHaveLength(0);
  });

  // ── New: session-count and payload-size limits ────────────────────────────

  it("accepts exactly 300 sessions (new server limit)", async () => {
    await seed(2);
    const app = insightsRoute({ db, insightsStore: store });
    const body = bodyWithNSessions(300);
    const res = await app.request("/transcripts", { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
  });

  it("rejects 301 sessions (exceeds MAX_STORY_SESSIONS_SERVER)", async () => {
    await seed(2);
    const app = insightsRoute({ db, insightsStore: store });
    const body = bodyWithNSessions(301);
    const res = await app.request("/transcripts", { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
  });

  it("rejects a payload whose serialized sessions exceed 800k chars", async () => {
    await seed(2);
    const app = insightsRoute({ db, insightsStore: store });
    // Build a session with a very long prompt to inflate the payload.
    const bigPrompt = "x".repeat(2000);
    const bigSession = {
      startedDay: "2026-06-01",
      durationMinutes: 10,
      model: null,
      interrupts: 0,
      prompts: Array(60).fill(bigPrompt), // 60 × 2000 = 120k chars per session
      toolCounts: {},
    };
    // 7 such sessions ≈ 840k chars — well over the 800k limit, well under 300 count.
    const body = { machineId: MID, windowDays: 40, sessions: Array(7).fill(bigSession) };
    const res = await app.request("/transcripts", { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("payload_too_large");
  });

  it("accepts a ≤30-session upload (backward compat with old CLIs)", async () => {
    await seed(2);
    const app = insightsRoute({ db, insightsStore: store });
    const body = bodyWithNSessions(30);
    const res = await app.request("/transcripts", { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
  });
});

describe("maybeGenerateStory concurrency", () => {
  it("two simultaneous triggers (multi-machine upload) generate exactly once", async () => {
    const db = await makeDb();
    const u = (await seedUser(db, { login: "twinrig", token: "tok_tw" }))!;
    await db.insert(storySources).values({ userId: u.id, payload: transcriptsBody() });
    // Slow generator so both calls overlap — the race that double-billed in prod.
    const generate = vi.fn().mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ doc: doc(), model: "m", sessionsUsed: 1, sessionsReceived: 1 }), 50)),
    );
    await Promise.all([maybeGenerateStory({ db, generate }, u), maybeGenerateStory({ db, generate }, u)]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await db.select().from(userStories).where(eq(userStories.userId, u.id))).toHaveLength(1);
  });
});

describe("maybeGenerateStory throttle", () => {
  it("skips regeneration within the refresh window", async () => {
    const db = await makeDb();
    const u = (await seedUser(db, { login: "throttled", token: TOKEN }))!;
    await db.insert(storySources).values({ userId: u.id, payload: transcriptsBody() });
    await db.insert(userStories).values({ userId: u.id, doc: doc(), model: "m", generatedAt: new Date() });

    const generate = vi.fn().mockResolvedValue({ doc: doc(), model: "m", sessionsUsed: 1, sessionsReceived: 1 });
    await maybeGenerateStory({ db, generate }, u);
    expect(generate).not.toHaveBeenCalled();
    expect(STORY_REFRESH_MS).toBeGreaterThan(0);

    // Stale story → regenerates.
    await db
      .update(userStories)
      .set({ generatedAt: new Date(Date.now() - STORY_REFRESH_MS - 60_000) })
      .where(eq(userStories.userId, u.id));
    await maybeGenerateStory({ db, generate }, u);
    expect(generate).toHaveBeenCalledOnce();
  });
});

describe("GET /profile/:login/story", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;

  beforeEach(async () => {
    db = await makeDb();
  });

  function app() {
    return profileRoute({ db, store: new LeaderboardStore(), insightsStore: new InsightsStore(), githubToken: null });
  }

  it("serves the story publicly when the profile is public", async () => {
    const u = (await seedUser(db, { login: "publik", token: TOKEN }))!;
    await db.insert(userStories).values({ userId: u.id, doc: doc(), model: "m" });
    const res = await app().request("/publik/story");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { login: string; story: StoryDoc };
    expect(body.login).toBe("publik");
    expect(body.story.decisionPatterns[0]?.count).toBe(41);
  });

  it("404s for private profiles (visitors) and when no story exists", async () => {
    const u = (await seedUser(db, { login: "privat", token: TOKEN }))!;
    await db.update(users).set({ insightsVisibility: "private" }).where(eq(users.id, u.id));
    await db.insert(userStories).values({ userId: u.id, doc: doc(), model: "m" });
    expect((await app().request("/privat/story")).status).toBe(404);

    await seedUser(db, { login: "storyless", token: "tok_s2" });
    expect((await app().request("/storyless/story")).status).toBe(404);
  });

  it("profile deck gains a story teaser card when a story exists", async () => {
    const u = (await seedUser(db, { login: "teased", token: TOKEN }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
    await db.insert(userStories).values({ userId: u.id, doc: doc(), model: "m" });
    const store = new InsightsStore();
    store.upsert(u.id, "m1", {
      windowDays: 40,
      sessions: 2,
      promptWordHistogram: { "1-5": 2, "6-10": 1, "11-25": 0, "26+": 0 },
      planModeSessionsPct: 0,
      exploreBeforeEditRatio: 0,
      avgTurnsBetweenUserMsgs: 4,
      interruptsPer100Turns: 0,
      subagentSpawnsPerSession: 0,
      maxParallelAgents: 0,
      hourHistogram: Array(24).fill(0).map((_, h) => (h === 10 ? 2 : 0)),
      editToolCallsPerSession: 2,
      longestSessionMinutes: 30,
    });
    const pApp = profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, githubToken: null });
    const body = (await (await pApp.request("/teased")).json()) as {
      insights: { locked: boolean; cards: Array<{ key: string }> };
    };
    expect(body.insights.locked).toBe(false);
    expect(body.insights.cards.some((c) => c.key === "story")).toBe(true);
  });
});

describe("prepareStorySource", () => {
  it("small payload passes through complete (sessionsUsed === sessionsReceived)", () => {
    const source = transcriptsBody();
    const result = prepareStorySource(source);
    if ("failed" in result) throw new Error("unexpected failure");
    expect(result.sessionsUsed).toBe(result.sessionsReceived);
    expect(result.sessionsUsed).toBe(1);
    const parsed = JSON.parse(result.serialized) as unknown[];
    expect(parsed.length).toBe(result.sessionsUsed);
    expect(result.windowDays).toBe(40);
  });

  it("oversized payload drops whole oldest sessions; serialized is valid JSON and sessionsUsed < sessionsReceived", () => {
    // Each session: 60 prompts × 2000 chars ≈ 120k chars. 8 sessions ≈ 960k → exceeds 600k cap.
    const bigPrompt = "x".repeat(2000);
    const bigSession = {
      startedDay: "2026-06-01",
      durationMinutes: 10,
      model: null,
      interrupts: 0,
      prompts: Array(60).fill(bigPrompt),
      toolCounts: {},
    };
    const source = { windowDays: 30, sessions: Array(8).fill(bigSession) };
    const result = prepareStorySource(source);
    if ("failed" in result) throw new Error("unexpected failure");
    expect(result.sessionsUsed).toBeLessThan(result.sessionsReceived);
    expect(result.sessionsReceived).toBe(8);
    // Must be valid JSON and an array of the expected length.
    const parsed = JSON.parse(result.serialized) as unknown[];
    expect(parsed.length).toBe(result.sessionsUsed);
    // Serialized must not exceed the cap.
    expect(result.serialized.length).toBeLessThanOrEqual(600_000);
  });

  it("garbage input → { failed: 'invalid_source' }", () => {
    expect(prepareStorySource(null)).toEqual({ failed: "invalid_source" });
    expect(prepareStorySource("string")).toEqual({ failed: "invalid_source" });
    expect(prepareStorySource(42)).toEqual({ failed: "invalid_source" });
    expect(prepareStorySource([])).toEqual({ failed: "invalid_source" });
    expect(prepareStorySource({ notSessions: true })).toEqual({ failed: "invalid_source" });
  });
});

describe("generateStory (SDK integration, stubbed transport)", () => {
  // Model response does NOT include sessionsAnalyzed — server stamps it.
  function cannedResponse(storyDoc: Omit<StoryDoc, "sessionsAnalyzed" | "windowDays">) {
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [{ type: "text", text: JSON.stringify(storyDoc) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  it("parses a structured StoryDoc from the model response; server-stamps sessionsAnalyzed and windowDays", async () => {
    // Build a canned doc WITHOUT sessionsAnalyzed (model no longer returns it).
    const modelResponse = {
      narrative: "Stubbed narrative.",
      whatYouBuilt: "A leaderboard platform with deep insights.",
      decisionPatterns: [{ name: "Full Stop and Investigate", count: 41, evidence: "Halts agents" }],
      strengths: [{ title: "Frame correction", detail: "Rewrites the question" }],
      growthAreas: [{ title: "Review delegation", detail: "Could delegate more" }],
      aiArchetypes: [{ name: "Frame Breaker", blurb: "Refuses the menu.", evidence: 27 }],
      crypticPrompt: "continue mb",
    };
    const fetcher = (async () => cannedResponse(modelResponse)) as unknown as typeof fetch;

    const source = transcriptsBody(); // 1 session, windowDays: 40
    const result = await generateStory({ apiKey: "test-key", fetcher }, "distroinfinity", source);
    if ("failed" in result) throw new Error(`unexpected failure: ${result.failed}`);
    expect(result.doc.narrative).toBe("Stubbed narrative.");
    expect(result.model).toBe("claude-opus-4-8");
    // Server-stamped values must reflect the actual sessions sent, not an LLM count.
    expect(result.doc.sessionsAnalyzed).toBe(1); // 1 session in transcriptsBody()
    expect(result.doc.windowDays).toBe(40);
    expect(result.sessionsUsed).toBe(1);
    expect(result.sessionsReceived).toBe(1);
    // Usage + estimated cost ride along for telemetry.
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.usage?.outputTokens).toBe(200);
    expect(result.usage?.estCostUsd).toBeCloseTo((100 * 5 + 200 * 25) / 1_000_000, 6);
  });

  it("server-stamp overrides a bogus sessionsAnalyzed the LLM might include", async () => {
    // Simulate a rogue/old model that returns sessionsAnalyzed in the JSON.
    const modelResponseWithBogus = {
      narrative: "Override test.",
      whatYouBuilt: "Whatever.",
      decisionPatterns: [],
      strengths: [],
      growthAreas: [],
      aiArchetypes: [],
      crypticPrompt: null,
      sessionsAnalyzed: 9999, // bogus — must be ignored
    };
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-8",
          content: [{ type: "text", text: JSON.stringify(modelResponseWithBogus) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 50, output_tokens: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const source = transcriptsBody(); // 1 session
    const result = await generateStory({ apiKey: "test-key", fetcher }, "distroinfinity", source);
    if ("failed" in result) throw new Error(`unexpected failure: ${result.failed}`);
    // Server stamp must WIN regardless of what the model returned.
    expect(result.doc.sessionsAnalyzed).toBe(1);
    expect(result.doc.windowDays).toBe(40);
  });

  it("fails typed when every session trims away — never calls Claude with an empty array", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    // One session whose serialized form alone exceeds the 600k input cap.
    const oversized = { windowDays: 40, sessions: [{ prompts: ["x".repeat(700_000)] }] };
    const result = await generateStory({ apiKey: "test-key", fetcher }, "x", oversized);
    expect("failed" in result && result.failed).toBe("no_sessions_after_trim");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports a typed failure instead of a silent null", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const result = await generateStory({ apiKey: "test-key", fetcher }, "x", transcriptsBody());
    expect("failed" in result && result.failed).toBe("api_429");
  });
});

describe("maybeGenerateStory failure handling", () => {
  it("keeps the source for retry and writes no story on a failed generation", async () => {
    const db = await makeDb();
    const u = (await seedUser(db, { login: "unlucky", token: "tok_u" }))!;
    await db.insert(storySources).values({ userId: u.id, payload: transcriptsBody() });
    const generate = vi.fn().mockResolvedValue({ failed: "api_429" });
    await maybeGenerateStory({ db, generate }, u);
    expect(await db.select().from(userStories).where(eq(userStories.userId, u.id))).toHaveLength(0);
    expect(await db.select().from(storySources).where(eq(storySources.userId, u.id))).toHaveLength(1);
  });
});
