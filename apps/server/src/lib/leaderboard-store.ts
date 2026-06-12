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

  upsert(e: Entry): void {
    this.entries.set(e.id, e);
  }

  get(id: string): Entry | undefined {
    return this.entries.get(id);
  }

  /** Case-insensitive login lookup (profile URLs arrive in user-typed case). */
  getByLogin(login: string): Entry | undefined {
    const lower = login.toLowerCase();
    for (const e of this.entries.values()) {
      if (e.githubLogin.toLowerCase() === lower) return e;
    }
    return undefined;
  }

  setFlagged(id: string, flagged: boolean): void {
    const e = this.entries.get(id);
    if (e) this.entries.set(id, { ...e, flagged });
  }

  setOrgs(id: string, orgs: string[]): void {
    const e = this.entries.get(id);
    if (e) this.entries.set(id, { ...e, orgs });
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
   *   2. costAllTime desc (breaks equal 30d spend)
   *   3. lastSyncedAt asc (earlier sync wins — "got there first"; undefined sinks to last)
   *   4. githubLogin asc (lexicographic guarantee — always unique)
   */
  private sorted(board: Board, tool?: string, org?: string): Entry[] {
    const pool = tool
      ? this.visible(org).filter((e) => metric(e, board, tool) > 0)
      : this.visible(org);
    return pool.sort((a, b) => {
      const md = metric(b, board, tool) - metric(a, board, tool);
      if (md !== 0) return md;
      const ad = b.costAllTime - a.costAllTime;
      if (ad !== 0) return ad;
      const aAt = a.lastSyncedAt ?? Infinity;
      const bAt = b.lastSyncedAt ?? Infinity;
      if (aAt !== bAt) return aAt - bAt;
      return a.githubLogin.localeCompare(b.githubLogin);
    });
  }

  getTop(board: Board, limit: number, offset = 0, tool?: string, org?: string): Entry[] {
    return this.sorted(board, tool, org).slice(offset, offset + limit);
  }

  getRank(board: Board, id: string, tool?: string, org?: string): number | null {
    const idx = this.sorted(board, tool, org).findIndex((e) => e.id === id);
    return idx === -1 ? null : idx + 1;
  }
}
