import { tierOf } from "./craft-score.js";

export type Board = "30d" | "allTime";

export interface Entry {
  id: string;
  githubLogin: string;
  avatarUrl: string;
  xHandle: string | null;
  tier: string;
  cardScene: string;
  cost30d: number;
  costAllTime: number;
  // Per-tool 30d cost (server-computed). Legacy rows are derived as
  // { claude: cost30d } when loaded, so consumers can rely on it being set.
  breakdown?: Record<string, number>;
  // Shadow-quarantined users stay in the store (their card still works) but
  // are excluded from every board, count, and total.
  flagged?: boolean;
  // Verified org memberships (slugs from the org registry). Drives org-scoped
  // boards and the org badge on the global board.
  orgs?: string[];
  // Epoch ms of the user's last sync — used as a tie-breaker in sorted().
  lastSyncedAt?: number;
  // 8 buckets (levels 0-8) over the last 30 days, one per ~3.75d. Absent when
  // the user has no spend in the window (legacy rows before spark rollout).
  spark?: number[];
  // Craft Score: present ONLY when insightsConsent===true AND
  // insightsVisibility==="public" AND craftScore!=null. Absent for all others.
  craft?: { score: number; tier: string };
}

/** Returns the craft payload to store on a leaderboard entry, or undefined if
 *  the three-condition privacy gate is not satisfied:
 *  insightsConsent===true AND insightsVisibility==="public" AND craftScore!=null.
 *  This is the single authoritative implementation — all call sites MUST use it. */
export function craftEntryFor(user: {
  insightsConsent: boolean;
  insightsVisibility: string;
  craftScore: string | number | null | undefined;
}): Entry["craft"] {
  if (!user.insightsConsent) return undefined;
  if (user.insightsVisibility !== "public") return undefined;
  if (user.craftScore == null) return undefined;
  const score = Math.round(Number(user.craftScore));
  if (!Number.isFinite(score)) return undefined;
  const { name } = tierOf(score);
  return { score, tier: name };
}

export interface ToolSummary {
  key: string;
  count: number;
}

const metric = (e: Entry, b: Board, tool?: string): number => {
  if (tool) return e.breakdown?.[tool] ?? 0;
  return b === "30d" ? e.cost30d : e.costAllTime;
};

export class LeaderboardStore {
  private entries = new Map<string, Entry>();
  // Secondary index: lowercased login → id, so getByLogin (hit on every profile
  // request) is O(1) instead of a full scan. Kept in sync by upsert.
  private loginIndex = new Map<string, string>();
  // sorted() results survive until the next mutation. Boards are read far more
  // often than written (every request, rank lookup, and WS broadcast re-sorts
  // otherwise), and the churn of short-lived sorted copies is real RSS.
  private sortCache = new Map<string, Entry[]>();

  private invalidate(): void {
    this.sortCache.clear();
  }

  upsert(e: Entry): void {
    const prev = this.entries.get(e.id);
    // On a GitHub rename the old login key would dangle — drop it.
    if (prev && prev.githubLogin.toLowerCase() !== e.githubLogin.toLowerCase()) {
      this.loginIndex.delete(prev.githubLogin.toLowerCase());
    }
    this.entries.set(e.id, e);
    this.loginIndex.set(e.githubLogin.toLowerCase(), e.id);
    this.invalidate();
  }

  get(id: string): Entry | undefined {
    return this.entries.get(id);
  }

  /** Case-insensitive login lookup (profile URLs arrive in user-typed case). */
  getByLogin(login: string): Entry | undefined {
    const lower = login.toLowerCase();
    const id = this.loginIndex.get(lower);
    if (!id) return undefined;
    const e = this.entries.get(id);
    // Defensive: only return on an exact (case-insensitive) login match, so a
    // stale index key can never resolve to the wrong warrior.
    return e && e.githubLogin.toLowerCase() === lower ? e : undefined;
  }

  setFlagged(id: string, flagged: boolean): void {
    const e = this.entries.get(id);
    if (e) {
      this.entries.set(id, { ...e, flagged });
      this.invalidate();
    }
  }

  setOrgs(id: string, orgs: string[]): void {
    const e = this.entries.get(id);
    if (e) {
      this.entries.set(id, { ...e, orgs });
      this.invalidate();
    }
  }

  /** Set or strip craft on an existing entry. Pass undefined to strip (on consent revoke
   *  or visibility → private). No-op when the entry is not in the store. */
  setCraft(id: string, craft: Entry["craft"]): void {
    const e = this.entries.get(id);
    if (!e) return;
    const updated = { ...e };
    if (craft === undefined) {
      delete updated.craft;
    } else {
      updated.craft = craft;
    }
    this.entries.set(id, updated);
    this.invalidate();
  }

  private visible(org?: string): Entry[] {
    return [...this.entries.values()].filter(
      (e) => !e.flagged && (!org || e.orgs?.includes(org)),
    );
  }

  count(org?: string): number {
    return this.visible(org).length;
  }

  totals(org?: string): { burned30d: number; count: number } {
    let burned30d = 0;
    let count = 0;
    for (const e of this.visible(org)) {
      burned30d += e.cost30d;
      count++;
    }
    return { burned30d: Math.round(burned30d * 100) / 100, count };
  }

  /** Tools that have at least one visible user with nonzero 30d spend. */
  toolSummaries(org?: string): ToolSummary[] {
    const counts = new Map<string, number>();
    for (const e of this.visible(org)) {
      for (const [tool, cost] of Object.entries(e.breakdown ?? {})) {
        if (cost > 0) counts.set(tool, (counts.get(tool) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  /**
   * Stable total-order sort:
   *   1. board metric desc (primary rank signal)
   *   2. costAllTime desc (breaks equal 30d spend; no-op on the allTime board)
   *   3. lastSyncedAt asc (earlier sync wins — "got there first"; undefined sinks to last)
   *   4. githubLogin asc (lexicographic guarantee — always unique)
   */
  private sorted(board: Board, tool?: string, org?: string): Entry[] {
    const key = `${board}|${tool ?? ""}|${org ?? ""}`;
    const hit = this.sortCache.get(key);
    if (hit) return hit;
    const pool = tool
      ? this.visible(org).filter((e) => metric(e, board, tool) > 0)
      : this.visible(org);
    const result = pool.sort((a, b) => {
      const md = metric(b, board, tool) - metric(a, board, tool);
      if (md !== 0) return md;
      const ad = b.costAllTime - a.costAllTime;
      if (ad !== 0) return ad;
      const aAt = a.lastSyncedAt ?? Infinity;
      const bAt = b.lastSyncedAt ?? Infinity;
      if (aAt !== bAt) return aAt - bAt;
      return a.githubLogin.localeCompare(b.githubLogin);
    });
    this.sortCache.set(key, result);
    return result;
  }

  getTop(board: Board, limit: number, offset = 0, tool?: string, org?: string): Entry[] {
    return this.sorted(board, tool, org).slice(offset, offset + limit);
  }

  getRank(board: Board, id: string, tool?: string, org?: string): number | null {
    const idx = this.sorted(board, tool, org).findIndex((e) => e.id === id);
    return idx === -1 ? null : idx + 1;
  }
}
