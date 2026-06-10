// Paxel-style insight cards — a deck of specific, shareable "wrapped" cards
// built from a user's stored deep-session data. Pure, deterministic, rule-based.
//
// CRITICAL DOCTRINE: emit a card ONLY when its real signal is present and
// sufficient. Never fabricate, approximate, or back-fill a number we don't
// actually have. Each card is a small function returning InsightCard | null;
// the builder filters the nulls. Cards whose data hasn't arrived yet (e.g.
// commit-timing histograms before an upgraded-CLI sync) simply don't appear.
import type { InsightsPayload, SessionRecord } from "../db/schema.js";
import type { Efficiency } from "./efficiency.js";
import { shipped, survivingLoc } from "./craft-score.js";

export interface InsightCard {
  key: string; // stable id, e.g. "model", "night_owl"
  question: string; // Paxel-style, e.g. "When are you most productive?"
  headline: string; // bold answer, e.g. "Night owl"
  body: string; // 1-2 sentence narrative with the real number
  stat?: string; // optional short stat for emphasis, e.g. "11 PM"
  shareText: string; // for the X intent
}

export interface InsightCardInput {
  sessions: SessionRecord[];
  merged: InsightsPayload; // from deriveAggregate
  efficiency: Efficiency | null;
  archetype: string | null;
  pillars: Record<string, number> | null;
}

const round = (n: number) => Math.round(n);

/** "{headline}. {body}." capped, plus the @ccwarriorsxyz attribution tail.
    No em-dash (design language); body's trailing period is stripped to avoid "..". */
function shareText(headline: string, body: string): string {
  const cleanBody = body.replace(/[.\s]+$/, "");
  const lead = `${headline}. ${cleanBody}`;
  const trimmed = lead.length > 180 ? `${lead.slice(0, 177)}...` : lead;
  return `${trimmed}. My build profile on @ccwarriorsxyz, extended from YC Paxel.`;
}

// ── friendlyModel ──────────────────────────────────────────────────────────
// Strip vendor prefix and prettify a raw model id into a human label.
//   claude-opus-4-7      → Opus 4.7
//   claude-sonnet-4-5    → Sonnet 4.5
//   claude-3-5-haiku-... → Haiku 3.5
//   gpt-4o / o3 / o4-... → GPT-4o / GPT-o3 (best-effort)
//   anything else        → the raw id
export function friendlyModel(id: string): string {
  const raw = id.trim();
  const lower = raw.toLowerCase();

  // Claude families. Handle both new (family-major-minor) and legacy
  // (claude-3-5-haiku) orderings.
  const fam = lower.includes("opus") ? "Opus" : lower.includes("sonnet") ? "Sonnet" : lower.includes("haiku") ? "Haiku" : null;
  if (fam) {
    // Collect numeric version segments (major[.minor]) from the id, ignoring the
    // date suffix (e.g. -20250219) which is 6+ digits.
    const nums = (lower.match(/\d+/g) ?? []).filter((d) => d.length <= 2).map(Number);
    if (nums.length >= 2) return `${fam} ${nums[0]}.${nums[1]}`;
    if (nums.length === 1) return `${fam} ${nums[0]}`;
    return fam;
  }

  // OpenAI GPT / o-series.
  if (/^gpt[-_]?/.test(lower)) {
    const rest = raw.replace(/^gpt[-_]?/i, "");
    return rest ? `GPT-${rest}` : "GPT";
  }
  if (/^o[0-9]/.test(lower)) return `GPT-${raw}`;

  return raw;
}

// 24h hour → "11 PM" style label.
function hour12(h: number): string {
  const hr = ((h % 24) + 24) % 24;
  const period = hr < 12 ? "AM" : "PM";
  const display = hr % 12 === 0 ? 12 : hr % 12;
  return `${display} ${period}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function argmax(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if ((arr[i] ?? 0) > (arr[best] ?? 0)) best = i;
  return best;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function card(
  key: string,
  question: string,
  headline: string,
  body: string,
  stat?: string,
): InsightCard {
  headline = headline.replace(/\s+/g, " ").trim(); // collapse any accidental doubles
  return { key, question, headline, body, stat, shareText: shareText(headline, body) };
}

// ── 1. archetype ────────────────────────────────────────────────────────────
const ARCHETYPE_COPY: Record<string, string> = {
  "The Tactician": "You plan before you build. Most sessions open with a map, not a guess.",
  "The Berserker": "You move fast and let momentum carry. Velocity is your signature.",
  "The Summoner": "You orchestrate a swarm of agents and let them do the heavy lifting.",
  "The Commander": "You steer hard and keep the agent on mission, redirecting the moment it drifts.",
  "The Falconer": "You set the agent loose on long runs and trust it to come back with the kill.",
};

function archetypeCard(input: InsightCardInput): InsightCard | null {
  const a = input.archetype;
  if (!a) return null;
  const body = ARCHETYPE_COPY[a] ?? "A distinctive build style, all your own.";
  return card("archetype", "Which archetype are you?", `THE ${a.replace(/^The\s+/i, "").toUpperCase()}`, body);
}

// ── 2. model ──────────────────────────────────────────────────────────────
function modelCard(input: InsightCardInput): InsightCard | null {
  const counts = new Map<string, number>();
  let withModel = 0;
  for (const s of input.sessions) {
    if (!s.model) continue;
    withModel++;
    counts.set(s.model, (counts.get(s.model) ?? 0) + 1);
  }
  if (withModel < 5) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topId, topN] = ranked[0]!;
  const topPct = round((topN / withModel) * 100);
  const top = friendlyModel(topId);
  let body = `${topPct}% of your sessions ran ${top}`;
  const second = ranked[1];
  // Only mention a clear second (not a tie with the top, and non-trivial).
  if (second && second[1] < topN) {
    const secondPct = round((second[1] / withModel) * 100);
    if (secondPct >= 5) body += `, ${friendlyModel(second[0])} ${secondPct}%`;
  }
  return card("model", "Which model do you use most?", `You love ${top}`, body, top);
}

// ── 3. night_owl ──────────────────────────────────────────────────────────
function nightOwlCard(input: InsightCardInput): InsightCard | null {
  const hist = input.merged.hourHistogram;
  const total = sum(hist);
  if (input.merged.sessions < 10 || total === 0) return null;
  const peak = argmax(hist);
  const nightShare = sum([22, 23, 0, 1, 2].map((h) => hist[h] ?? 0)) / total;
  const morningShare = sum([5, 6, 7, 8, 9].map((h) => hist[h] ?? 0)) / total;
  const headline = nightShare > 0.35 ? "Night owl" : morningShare > 0.3 ? "Early bird" : "Daytime builder";
  const stat = hour12(peak);
  return card("night_owl", "When are you most productive?", headline, `You start most sessions around ${stat}`, stat);
}

// ── 4. ships_on ───────────────────────────────────────────────────────────
// Real commit-day-of-week data only — appears after an upgraded-CLI sync.
function shipsOnCard(input: InsightCardInput): InsightCard | null {
  const dows = Array(7).fill(0) as number[];
  let any = false;
  for (const s of input.sessions) {
    const cd = s.git?.commitDows;
    if (!cd || cd.length !== 7) continue;
    any = true;
    for (let i = 0; i < 7; i++) dows[i] = (dows[i] ?? 0) + (cd[i] ?? 0);
  }
  if (!any) return null;
  const total = sum(dows);
  if (total < 10) return null;
  const peak = argmax(dows);
  const weekday = WEEKDAYS[peak]!;
  return card("ships_on", "When do you ship most?", `${weekday}s`, `Your biggest push lands on ${weekday}`);
}

// ── 5. commits_at_night ───────────────────────────────────────────────────
function commitsAtNightCard(input: InsightCardInput): InsightCard | null {
  const hours = Array(24).fill(0) as number[];
  let any = false;
  for (const s of input.sessions) {
    const ch = s.git?.commitHours;
    if (!ch || ch.length !== 24) continue;
    any = true;
    for (let i = 0; i < 24; i++) hours[i] = (hours[i] ?? 0) + (ch[i] ?? 0);
  }
  if (!any) return null;
  const total = sum(hours);
  if (total < 10) return null;
  const nightShare = sum([22, 23, 0, 1, 2].map((h) => hours[h] ?? 0)) / total;
  const pct = round(nightShare * 100);
  if (nightShare > 0.4) {
    return card(
      "commits_at_night",
      "When do your commits land?",
      "After dark",
      `${pct}% of your commits land between 10 PM and 2 AM`,
    );
  }
  return card(
    "commits_at_night",
    "When do your commits land?",
    "Steady through the day",
    `Only ${pct}% of your commits land between 10 PM and 2 AM`,
  );
}

// ── 6. plan_mode ──────────────────────────────────────────────────────────
function planModeCard(input: InsightCardInput): InsightCard | null {
  if (input.merged.sessions < 5) return null;
  const pct = input.merged.planModeSessionsPct;
  const r = round(pct);
  const body = `You open in plan mode before ${pct > 40 ? "most" : "some"} sessions${
    pct < 20 ? ", skipping it on quick fixes" : ""
  }`;
  return card("plan_mode", "How often do you plan?", `${r}% in plan mode`, body, `${r}%`);
}

// ── 7. agents ─────────────────────────────────────────────────────────────
function agentsCard(input: InsightCardInput): InsightCard | null {
  const max = input.merged.maxParallelAgents;
  if (max < 1) return null;
  const repos = new Set(input.sessions.map((s) => s.git?.repoIdHash).filter((h): h is string => !!h)).size;
  const headline = `${max} agent${max === 1 ? "" : "s"} in parallel`;
  const body = repos > 1 ? `across ${repos} repos` : "your peak orchestration";
  return card("agents", "How many agents do you run?", headline, body);
}

// ── 8. prompt_length ──────────────────────────────────────────────────────
function promptLengthCard(input: InsightCardInput): InsightCard | null {
  const h = input.merged.promptWordHistogram;
  const total = h["1-5"] + h["6-10"] + h["11-25"] + h["26+"];
  if (total < 20) return null;
  const shortPct = (h["1-5"] + h["6-10"]) / total;
  const headline = shortPct > 0.6 ? "Straight to the point" : shortPct < 0.3 ? "You write essays" : "Measured";
  return card(
    "prompt_length",
    "How long are your prompts?",
    headline,
    `${round(shortPct * 100)}% of your prompts are under 10 words`,
  );
}

// ── 9. course_correction ──────────────────────────────────────────────────
function courseCorrectionCard(input: InsightCardInput): InsightCard | null {
  if (input.merged.sessions < 5) return null;
  const rate = input.merged.interruptsPer100Turns;
  const headline = rate > 8 ? "You steer hard" : rate < 2 ? "You let it run" : "You nudge";
  return card(
    "course_correction",
    "How often do you change course?",
    headline,
    `About ${round(rate)} course-corrections per 100 agent turns`,
  );
}

// ── 10. longest_run ───────────────────────────────────────────────────────
function longestRunCard(input: InsightCardInput): InsightCard | null {
  const mins = input.merged.longestSessionMinutes;
  // Skip the 7-day clamp artifact (deriveAggregate caps at 7*24*60).
  if (mins < 30 || mins >= 7 * 24 * 60) return null;
  const h = Math.floor(mins / 60);
  const m = round(mins % 60);
  const headline = `${h}h ${m}m`;
  return card("longest_run", "What's your longest agent run?", headline, "Your longest unbroken session", headline);
}

// ── 11. shipped ───────────────────────────────────────────────────────────
function shippedCard(input: InsightCardInput): InsightCard | null {
  const commits = sum(input.sessions.map((s) => s.git?.commitsInWindow ?? 0));
  if (commits < 1) return null;
  const totalLoc = sum(input.sessions.map(survivingLoc));
  return card(
    "shipped",
    "How much did you ship?",
    `${totalLoc.toLocaleString("en-US")} lines`,
    `Across ${commits} commits this window`,
    `${totalLoc.toLocaleString("en-US")} LOC`,
  );
}

// ── 12. you_test ──────────────────────────────────────────────────────────
function youTestCard(input: InsightCardInput): InsightCard | null {
  const shippingSessions = input.sessions.filter(shipped);
  if (shippingSessions.length < 5) return null;
  const withTests = shippingSessions.filter((s) => (s.git?.testFilesTouched ?? 0) > 0).length;
  const pct = withTests / shippingSessions.length;
  const headline = pct > 0.5 ? "You actually test" : pct < 0.15 ? "Ship first, test later" : "You test sometimes";
  return card(
    "you_test",
    "Do you verify your work?",
    headline,
    `${round(pct * 100)}% of your shipping sessions added tests`,
  );
}

const BUILDERS: Array<(i: InsightCardInput) => InsightCard | null> = [
  archetypeCard,
  modelCard,
  nightOwlCard,
  shipsOnCard,
  commitsAtNightCard,
  planModeCard,
  agentsCard,
  promptLengthCard,
  courseCorrectionCard,
  longestRunCard,
  shippedCard,
  youTestCard,
];

/** Build the ordered deck of insight cards, emitting only cards with real data. */
export function buildInsightCards(input: InsightCardInput): InsightCard[] {
  return BUILDERS.map((b) => b(input)).filter((c): c is InsightCard => c !== null);
}
