// Paxel-style insight cards — a deck of specific, shareable "wrapped" cards
// built from a user's stored deep-session data. Pure, deterministic, rule-based.
//
// CRITICAL DOCTRINE: emit a card ONLY when its real signal is present and
// sufficient. Never fabricate, approximate, or back-fill a number we don't
// actually have. Each card is a small function returning InsightCard | null;
// the builder filters the nulls. Cards whose data hasn't arrived yet (e.g.
// commit-timing histograms before an upgraded-CLI sync) simply don't appear.
import type { GithubStats, InsightsPayload, SessionRecord } from "../db/schema.js";
import type { Efficiency } from "./efficiency.js";
import { shipped, survivingLoc, type OutcomeEconomics } from "./craft-score.js";

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
  // Verified-by-GitHub public footprint (issue #48). Optional: older callers
  // and GitHub-less profiles simply get no gh_ cards.
  github?: GithubStats | null;
  // Usage-days rhythm (weekend share, streaks). Optional like github.
  rhythm?: { weekendShare: number; currentStreak: number; longestStreak: number; activeDays: number } | null;
  // Payload-level deep extras (merged across machines). Optional like github.
  extras?: {
    maxConcurrentSessions?: number;
    topPrompt?: { text: string; count: number; sessions: number } | null;
  } | null;
  // Outcome economics (cost per surviving line, commits per $100). Optional:
  // absent on older callers or when craft data is unavailable.
  economics?: OutcomeEconomics | null;
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
  if (withModel < 1) return null;
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
  if (total === 0) return null;
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
  if (total < 1) return null;
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
  if (total < 1) return null;
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
  if (input.merged.sessions < 1) return null;
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
  if (total < 1) return null;
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
  if (input.merged.sessions < 1) return null;
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
  if (mins <= 0 || mins >= 7 * 24 * 60) return null;
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
  if (shippingSessions.length < 1) return null;
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

// ── GitHub cards (verified public footprint, issue #48 subset) ──────────────
// Same doctrine: each guards on ITS OWN real signal; `github` null → none.

function ghMergedPrsCard(input: InsightCardInput): InsightCard | null {
  const g = input.github;
  if (!g || g.mergedPublicPrs < 1) return null;
  return card(
    "gh_merged_prs",
    "How much lands upstream?",
    `${g.mergedPublicPrs} public PR${g.mergedPublicPrs === 1 ? "" : "s"} merged`,
    "Merged into public repos, verified by GitHub",
    String(g.mergedPublicPrs),
  );
}

function ghStarsCard(input: InsightCardInput): InsightCard | null {
  const g = input.github;
  if (!g || g.totalStars < 1) return null;
  return card(
    "gh_stars",
    "Does your work resonate?",
    `${g.totalStars.toLocaleString("en-US")} stars earned`,
    "Stars across your public repos",
    `★ ${g.totalStars.toLocaleString("en-US")}`,
  );
}

function ghLanguagesCard(input: InsightCardInput): InsightCard | null {
  const g = input.github;
  if (!g || g.topLanguages.length < 1) return null;
  const names = g.topLanguages.map((l) => l.name);
  const headline = names.length >= 3 ? "Polyglot" : `${names[0]} country`;
  const body =
    names.length >= 2
      ? `Your public repos speak ${names.slice(0, 3).join(", ")}`
      : `${names[0]} leads your public repos`;
  return card("gh_languages", "What do you build in?", headline, body, names[0]);
}

function ghStreakCard(input: InsightCardInput): InsightCard | null {
  const g = input.github;
  if (!g || g.longestStreakDays < 2) return null;
  const current = g.currentStreakDays;
  const body =
    current >= 2
      ? `Longest contribution run on GitHub. ${current} days and counting right now`
      : "Your longest contribution run on GitHub";
  return card("gh_streak", "How consistent are you?", `${g.longestStreakDays}-day streak`, body, `${g.longestStreakDays}d`);
}

function ghReviewsCard(input: InsightCardInput): InsightCard | null {
  const g = input.github;
  if (!g || g.reviewsLastYear < 1) return null;
  return card(
    "gh_reviews",
    "Do you review others' work?",
    "You review code",
    `${g.reviewsLastYear} pull-request reviews in the last year`,
    String(g.reviewsLastYear),
  );
}

function ghFootprintCard(input: InsightCardInput): InsightCard | null {
  const g = input.github;
  if (!g || g.reposContributedTo < 1) return null;
  return card(
    "gh_footprint",
    "How far does your code reach?",
    "Beyond your own repos",
    `Contributed to ${g.reposContributedTo} repos you don't own`,
    String(g.reposContributedTo),
  );
}

function ghPrsWorkedCard(input: InsightCardInput): InsightCard | null {
  const n = input.github?.windowPrs ?? 0;
  if (n < 1) return null;
  return card(
    "gh_prs_worked",
    "How many PRs are in flight?",
    `${n} PR${n === 1 ? "" : "s"} this window`,
    "Pull requests you worked in the last 40 days, verified by GitHub",
    String(n),
  );
}

function ghVeteranCard(input: InsightCardInput): InsightCard | null {
  const g = input.github;
  if (!g) return null;
  const created = Date.parse(g.accountCreatedAt);
  if (!Number.isFinite(created)) return null;
  const years = (Date.now() - created) / (365.25 * 86_400_000);
  if (years < 1) return null;
  const sinceYear = new Date(created).getUTCFullYear();
  return card(
    "gh_veteran",
    "How long have you been shipping?",
    `Shipping since ${sinceYear}`,
    `${Math.floor(years)} year${Math.floor(years) === 1 ? "" : "s"} on GitHub`,
    String(sinceYear),
  );
}

// ── Session-depth / git-shape cards ─────────────────────────────────────────

function marathonerCard(input: InsightCardInput): InsightCard | null {
  const n = input.sessions.length;
  if (n < 1) return null;
  const mean = sum(input.sessions.map((s) => s.durationMinutes)) / n;
  if (mean <= 0) return null;
  const headline = mean > 90 ? "Marathoner" : mean < 20 ? "Sprinter" : "Steady pacer";
  const h = Math.floor(mean / 60);
  const m = round(mean % 60);
  const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return card("marathoner", "How long do you go?", headline, `Your average session runs ${label}`, label);
}

function exploreFirstCard(input: InsightCardInput): InsightCard | null {
  const ratio = input.merged.exploreBeforeEditRatio;
  if (ratio <= 0) return null;
  return card(
    "explore_first",
    "Do you look before you leap?",
    "You read before you write",
    `${round(ratio * 100)}% of your editing sessions explore the code first`,
  );
}

function aiCommitsCard(input: InsightCardInput): InsightCard | null {
  const linked = sum(input.sessions.map((s) => s.git?.aiLinkedCommits ?? 0));
  if (linked < 1) return null;
  return card(
    "ai_commits",
    "Does agent work actually land?",
    `${linked} commit${linked === 1 ? "" : "s"} traced to agent edits`,
    `${linked} of your commits touch files your agents edited`,
    String(linked),
  );
}

function localReposCard(input: InsightCardInput): InsightCard | null {
  const repos = new Set(input.sessions.map((s) => s.git?.repoIdHash).filter((h): h is string => !!h)).size;
  if (repos < 2) return null;
  return card(
    "local_repos",
    "How wide is your battlefield?",
    `${repos} repos deep`,
    `Your agents rode along in ${repos} different repos this window`,
    String(repos),
  );
}

function cleanHistoryCard(input: InsightCardInput): InsightCard | null {
  const tidy = input.sessions.some((s) => s.git?.rebaseDetected || s.git?.squashMergeDetected);
  if (!tidy) return null;
  return card(
    "clean_history",
    "What does your git log look like?",
    "You curate history",
    "Rebases or squash merges keep your log readable",
  );
}

// ── Paxel-parity cards (new deep signals; every guard = real data only) ─────

function totalHoursCard(input: InsightCardInput): InsightCard | null {
  const mins = sum(input.sessions.map((s) => s.durationMinutes));
  if (mins <= 0) return null;
  const hours = mins / 60;
  const headline = hours >= 1 ? `${(Math.round(hours * 10) / 10).toLocaleString("en-US")} hours` : `${round(mins)} minutes`;
  return card(
    "total_hours",
    "How much time did you put in?",
    headline,
    `Across ${input.sessions.length} session${input.sessions.length === 1 ? "" : "s"} this window`,
    hours >= 1 ? `${Math.round(hours)}h` : `${round(mins)}m`,
  );
}

function dialogueCard(input: InsightCardInput): InsightCard | null {
  const n = input.sessions.length;
  if (n < 1) return null;
  const prompts = sum(input.sessions.map((s) => s.prompts));
  const turns = sum(input.sessions.map((s) => s.assistantTurns));
  if (prompts < 1 || turns < 1) return null;
  const perSession = prompts / n;
  const headline = perSession >= 5 ? "A back-and-forth" : perSession <= 2 ? "Fire and forget" : "Measured dialogue";
  const body =
    perSession >= 5
      ? `${round(perSession)} prompts a session — you shape the work as you go`
      : perSession <= 2
        ? `${Math.round(perSession * 10) / 10} prompts a session — you brief it and let it run`
        : `${round(perSession)} prompts a session`;
  return card("dialogue", "How do you work with your agent?", headline, body);
}

function burstProfileCard(input: InsightCardInput): InsightCard | null {
  const n = input.sessions.length;
  if (n < 1) return null;
  const bursts = input.sessions.filter((s) => s.durationMinutes < 15).length;
  const deep = input.sessions.filter((s) => s.durationMinutes >= 90 && s.interrupts === 0);
  const burstShare = bursts / n;
  if (burstShare > 0.5) {
    return card(
      "burst_profile",
      "Which kind of builder are you?",
      "Burst builder",
      `${round(burstShare * 100)}% of your sessions are short bursts under 15 minutes`,
    );
  }
  if (deep.length >= 1) {
    const avgFocus = round(sum(deep.map((s) => s.durationMinutes)) / deep.length);
    return card(
      "burst_profile",
      "Which kind of builder are you?",
      "Deep diver",
      `${deep.length} deep session${deep.length === 1 ? "" : "s"} averaging ${avgFocus} minutes of unbroken focus`,
    );
  }
  return card("burst_profile", "Which kind of builder are you?", "Mixed cadence", "Short bursts and long hauls in equal measure");
}

function thankYousCard(input: InsightCardInput): InsightCard | null {
  // Old payloads lack the field entirely — absence of signal, not a zero.
  const withField = input.sessions.filter((s) => typeof s.thankYous === "number");
  if (withField.length === 0) return null;
  const total = sum(withField.map((s) => s.thankYous ?? 0));
  if (total < 1) return null;
  return card(
    "thank_yous",
    "How polite are you?",
    `${total} thank-you${total === 1 ? "" : "s"}`,
    `You thanked your agent ${total} time${total === 1 ? "" : "s"} this window`,
    String(total),
  );
}

function avgPromptWordsCard(input: InsightCardInput): InsightCard | null {
  const withField = input.sessions.filter((s) => typeof s.wordTotal === "number");
  if (withField.length === 0) return null;
  const words = sum(withField.map((s) => s.wordTotal ?? 0));
  const prompts = sum(withField.map((s) => s.prompts));
  if (words < 1 || prompts < 1) return null;
  const avg = round(words / prompts);
  const headline = `${avg} word${avg === 1 ? "" : "s"} per prompt`;
  const body = avg >= 50 ? "You write briefs, not commands" : avg <= 8 ? "Terse and trusted" : "Mostly conversational prompts";
  return card("avg_prompt_words", "How long are your prompts, really?", headline, body, String(avg));
}

function recoveryCard(input: InsightCardInput): InsightCard | null {
  const withField = input.sessions.filter((s) => s.recovery && typeof s.recovery.loops === "number");
  if (withField.length === 0) return null;
  const loops = sum(withField.map((s) => s.recovery!.loops));
  if (loops < 1) return null;
  const breakouts = withField.map((s) => s.recovery!.medianBreakoutMs).filter((ms) => ms > 0);
  const medianMin = breakouts.length > 0 ? Math.round(breakouts.sort((a, b) => a - b)[Math.floor((breakouts.length - 1) / 2)]! / 60_000) : 0;
  const body =
    medianMin > 0
      ? `When the agent spirals into errors, you break it out in ~${medianMin} minute${medianMin === 1 ? "" : "s"}`
      : "When the agent spirals into errors, you step in and break the loop";
  return card("recovery", "What happens when it gets stuck?", `${loops} error loop${loops === 1 ? "" : "s"} broken`, body);
}

function breadthLocalCard(input: InsightCardInput): InsightCard | null {
  const merged = new Map<string, number>();
  for (const s of input.sessions) {
    for (const [ext, n] of Object.entries(s.extensions ?? {})) merged.set(ext, (merged.get(ext) ?? 0) + n);
  }
  if (merged.size < 2) return null;
  const ranked = [...merged.entries()].sort((a, b) => b[1] - a[1]);
  const names = ranked.slice(0, 3).map(([e]) => `.${e}`);
  return card(
    "breadth_local",
    "How wide do you range?",
    `${merged.size} languages this window`,
    `Your agents edited ${names.join(", ")} and more — measured from real edits, not repo labels`,
    names[0],
  );
}

function fixesFeaturesCard(input: InsightCardInput): InsightCard | null {
  let fixes = 0, features = 0, refactors = 0, other = 0;
  let any = false;
  for (const s of input.sessions) {
    const k = s.git?.commitKinds;
    if (!k) continue;
    any = true;
    fixes += k.fixes;
    features += k.features;
    refactors += k.refactors;
    other += k.other;
  }
  const total = fixes + features + refactors + other;
  if (!any || total < 1) return null;
  const headline = features > fixes ? "Mostly features" : fixes > features ? "Mostly fixes" : "Half building, half mending";
  return card(
    "fixes_features",
    "What kind of work is it?",
    headline,
    `${features} feature${features === 1 ? "" : "s"} and ${fixes} fix${fixes === 1 ? "" : "es"} in your commits`,
  );
}

function firstTryCard(input: InsightCardInput): InsightCard | null {
  const shippedSessions = input.sessions.filter(shipped);
  if (shippedSessions.length < 1) return null;
  const clean = shippedSessions.filter((s) => s.interrupts === 0 && (s.git?.revertedLinesWithin14d ?? 0) === 0).length;
  const pct = round((clean / shippedSessions.length) * 100);
  const headline = pct >= 60 ? "Lands it first try" : "Iterates to green";
  return card(
    "first_try",
    "How often does direction just land?",
    headline,
    `${pct}% of your shipping sessions had no interrupts and nothing reverted`,
    `${pct}%`,
  );
}

function taskModelFitCard(input: InsightCardInput): InsightCard | null {
  const withModel = input.sessions.filter((s) => s.model);
  if (withModel.length < 4) return null;
  const fam = (id: string) => (id.includes("opus") ? "opus" : id.includes("sonnet") ? "sonnet" : id.includes("haiku") ? "haiku" : "other");
  const families = new Set(withModel.map((s) => fam(s.model!)));
  if (families.size < 2) return null;
  const difficulty = (s: SessionRecord) => s.editCalls + s.assistantTurns + s.durationMinutes / 10;
  const heavy = withModel.filter((s) => fam(s.model!) === "opus");
  const light = withModel.filter((s) => fam(s.model!) !== "opus");
  if (heavy.length === 0 || light.length === 0) return null;
  const heavyMean = sum(heavy.map(difficulty)) / heavy.length;
  const lightMean = sum(light.map(difficulty)) / light.length;
  const fits = heavyMean > lightMean;
  return card(
    "task_model_fit",
    "Do you right-size your models?",
    fits ? "Right blade for the fight" : "One blade for everything",
    fits
      ? "Your heaviest sessions run the heavyweight models, the rote ones run lighter"
      : "Heavy and light work get the same model — there's spend to reclaim",
  );
}

function maxConcurrentCard(input: InsightCardInput): InsightCard | null {
  const n = input.extras?.maxConcurrentSessions ?? 0;
  if (n < 2) return null;
  return card(
    "max_concurrent",
    "How many sessions at once?",
    `${n} at once`,
    `As many as ${n} sessions running at the same time`,
    String(n),
  );
}

function goToPromptCard(input: InsightCardInput): InsightCard | null {
  const tp = input.extras?.topPrompt;
  if (!tp || tp.count < 3) return null;
  return card(
    "go_to_prompt",
    "What's your go-to prompt?",
    `“${tp.text}”`,
    `You sent it ${tp.count} times across ${tp.sessions} session${tp.sessions === 1 ? "" : "s"}`,
  );
}

// ── Outcome economics ────────────────────────────────────────────────────────
// Emits only when economics is present AND at least one ratio is non-null.

function outcomePerDollarCard(input: InsightCardInput): InsightCard | null {
  const e = input.economics;
  if (!e) return null;
  if (e.costPerSurvivingLoc === null && e.commitsPer100Usd === null) return null;

  let headline: string;
  let stat: string;
  let secondary: string;
  if (e.costPerSurvivingLoc !== null) {
    // Format: $0.21 per surviving line, or $0.0034 when < $0.01.
    const fmt = e.costPerSurvivingLoc < 0.01
      ? `$${e.costPerSurvivingLoc}`
      : `$${e.costPerSurvivingLoc.toFixed(2)}`;
    headline = `${fmt} per surviving line`;
    stat = fmt;
    secondary = e.commitsPer100Usd !== null ? `${e.commitsPer100Usd} commits per $100` : "";
  } else {
    headline = `${e.commitsPer100Usd} commits per $100`;
    stat = String(e.commitsPer100Usd);
    secondary = "";
  }

  const locPart = `${e.survivingLoc.toLocaleString("en-US")} lines that survived 14 days`;
  const costPart = `$${e.windowCostUsd % 1 === 0 ? e.windowCostUsd.toFixed(0) : e.windowCostUsd.toFixed(2)} burned in 30d`;
  const body = secondary
    ? `${secondary} — ${locPart}, ${costPart}`
    : `${locPart}, ${costPart}`;

  return card("outcome_per_dollar", "What does a dollar buy?", headline, body, stat);
}

// ── Usage/rhythm cards (cost ground truth + active-day cadence) ─────────────

function cacheWarmCard(input: InsightCardInput): InsightCard | null {
  const ratio = input.efficiency?.cacheReadRatio;
  if (ratio === null || ratio === undefined) return null;
  const pct = round(ratio * 100);
  return card(
    "cache_warm",
    "How warm is your context?",
    `${pct}% from cache`,
    pct >= 90
      ? "Long, continuous sessions keep your context hot"
      : "Share of your context served from cache",
    `${pct}%`,
  );
}

function modelMixCard(input: InsightCardInput): InsightCard | null {
  const mix = input.efficiency?.modelMix ?? [];
  if (mix.length < 2) return null;
  const parts = mix.slice(0, 3).map((m) => `${m.family} ${round(m.share * 100)}%`);
  return card(
    "model_mix",
    "Do you reach for the right blade?",
    `${mix.length} models in rotation`,
    `Cost split: ${parts.join(", ")}`,
  );
}

function weekendWarriorCard(input: InsightCardInput): InsightCard | null {
  const r = input.rhythm;
  if (!r || r.activeDays < 1 || r.weekendShare <= 0) return null;
  const pct = round(r.weekendShare * 100);
  const headline = r.weekendShare >= 0.4 ? "Weekend warrior" : "Weekdays do the work";
  return card(
    "weekend_warrior",
    "When does the real work happen?",
    headline,
    `${pct}% of your spend lands on weekends`,
    `${pct}%`,
  );
}

function grindStreakCard(input: InsightCardInput): InsightCard | null {
  const r = input.rhythm;
  if (!r || r.longestStreak < 2) return null;
  const body =
    r.currentStreak >= 2
      ? `Longest run of consecutive active days. ${r.currentStreak} and counting right now`
      : "Your longest run of consecutive active days";
  return card("grind_streak", "How relentless are you?", `${r.longestStreak} days straight`, body, `${r.longestStreak}d`);
}

const BUILDERS: Array<(i: InsightCardInput) => InsightCard | null> = [
  archetypeCard,
  goToPromptCard,
  outcomePerDollarCard,
  totalHoursCard,
  modelCard,
  burstProfileCard,
  dialogueCard,
  maxConcurrentCard,
  nightOwlCard,
  shipsOnCard,
  commitsAtNightCard,
  planModeCard,
  agentsCard,
  promptLengthCard,
  avgPromptWordsCard,
  courseCorrectionCard,
  recoveryCard,
  longestRunCard,
  marathonerCard,
  exploreFirstCard,
  firstTryCard,
  shippedCard,
  fixesFeaturesCard,
  aiCommitsCard,
  localReposCard,
  breadthLocalCard,
  cleanHistoryCard,
  youTestCard,
  thankYousCard,
  taskModelFitCard,
  ghMergedPrsCard,
  ghPrsWorkedCard,
  ghStarsCard,
  ghLanguagesCard,
  ghStreakCard,
  ghReviewsCard,
  ghFootprintCard,
  ghVeteranCard,
  cacheWarmCard,
  modelMixCard,
  weekendWarriorCard,
  grindStreakCard,
];

/** Every key the deck can emit — the pins endpoint validates against this. */
export const CARD_KEYS = new Set([
  "archetype", "go_to_prompt", "outcome_per_dollar", "total_hours", "model", "burst_profile", "dialogue", "max_concurrent",
  "night_owl", "ships_on", "commits_at_night", "plan_mode", "agents", "prompt_length", "avg_prompt_words",
  "course_correction", "recovery", "longest_run", "marathoner", "explore_first", "first_try", "shipped",
  "fixes_features", "ai_commits", "local_repos", "breadth_local", "clean_history", "you_test", "thank_yous",
  "task_model_fit", "gh_merged_prs", "gh_prs_worked", "gh_stars", "gh_languages", "gh_streak", "gh_reviews", "gh_footprint",
  "gh_veteran", "cache_warm", "model_mix", "weekend_warrior", "grind_streak", "story",
]);

/** Reorder a deck so pinned keys lead (their relative pin order preserved). */
export function applyPins(cards: InsightCard[], pins: string[] | null | undefined): InsightCard[] {
  if (!pins || pins.length === 0) return cards;
  const rank = new Map(pins.map((k, i) => [k, i]));
  const pinned = cards.filter((c) => rank.has(c.key)).sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
  return [...pinned, ...cards.filter((c) => !rank.has(c.key))];
}

// ── Curation: Wrapped-sized deck, not an everything-bagel ───────────────────
// The builders stay exhaustive (every signal extracted); selection ships only
// the strongest few. Spotify Wrapped and Paxel land at 12-16 cards — each one
// feels special because the boring ones never appear.

export const DECK_LIMIT = 14;

// Lower rank = stronger card. 1 = headliner, 2 = strong, 3 = filler that only
// appears on thin profiles where nothing better exists.
const CARD_RANK: Record<string, number> = {
  story: 1, archetype: 1, go_to_prompt: 1, outcome_per_dollar: 1, total_hours: 1, max_concurrent: 1, shipped: 1,
  model: 2, burst_profile: 2, night_owl: 2, thank_yous: 2, recovery: 2, fixes_features: 2,
  first_try: 2, you_test: 2, agents: 2, task_model_fit: 2, gh_merged_prs: 2, gh_stars: 2, gh_streak: 2,
  dialogue: 3, plan_mode: 3, prompt_length: 3, avg_prompt_words: 3, course_correction: 3,
  longest_run: 3, marathoner: 3, explore_first: 3, ai_commits: 3, local_repos: 3, breadth_local: 3,
  clean_history: 3, ships_on: 3, commits_at_night: 3, gh_languages: 3, gh_reviews: 3,
  gh_footprint: 3, gh_veteran: 3, gh_prs_worked: 3, cache_warm: 3, model_mix: 3,
  weekend_warrior: 3, grind_streak: 3,
};

// Near-twins: at most one per family ships (first present in listed order
// wins). Pinned cards are exempt — the owner outranks the curator.
const DEDUPE_FAMILIES: string[][] = [
  ["model", "model_mix"],
  ["avg_prompt_words", "prompt_length"],
  ["burst_profile", "marathoner", "longest_run"],
  ["night_owl", "commits_at_night"],
  ["gh_streak", "grind_streak"],
  ["breadth_local", "gh_languages"],
];

/**
 * Curate the full deck down to DECK_LIMIT: dedupe near-twin families, then
 * keep the best-ranked cards. Pins always survive (cap and dedupe both).
 * Original deck order is preserved in the output.
 */
export function selectDeck(cards: InsightCard[], pins: string[] | null | undefined): InsightCard[] {
  const pinned = new Set(pins ?? []);
  if (cards.length <= DECK_LIMIT && pinned.size === 0) return cards;

  // Dedupe: drop later family members unless pinned.
  const dropped = new Set<string>();
  const present = new Set(cards.map((c) => c.key));
  for (const family of DEDUPE_FAMILIES) {
    const members = family.filter((k) => present.has(k));
    for (const k of members.slice(1)) if (!pinned.has(k)) dropped.add(k);
  }

  const survivors = cards.filter((c) => !dropped.has(c.key));
  if (survivors.length <= DECK_LIMIT) return survivors;

  // Keep: every pinned card + the best-ranked rest up to the limit. Stable
  // sort (rank, then original position) so ties resolve by deck order.
  const indexOf = new Map(survivors.map((c, i) => [c.key, i]));
  const keep = new Set(survivors.filter((c) => pinned.has(c.key)).map((c) => c.key));
  const ranked = survivors
    .filter((c) => !keep.has(c.key))
    .sort((a, b) => (CARD_RANK[a.key] ?? 3) - (CARD_RANK[b.key] ?? 3) || indexOf.get(a.key)! - indexOf.get(b.key)!);
  for (const c of ranked) {
    if (keep.size >= Math.max(DECK_LIMIT, pinned.size)) break;
    keep.add(c.key);
  }
  return survivors.filter((c) => keep.has(c.key));
}

/** Build the ordered deck of insight cards, emitting only cards with real data. */
export function buildInsightCards(input: InsightCardInput): InsightCard[] {
  return BUILDERS.map((b) => b(input)).filter((c): c is InsightCard => c !== null);
}
