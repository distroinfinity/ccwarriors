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
}

const metric = (e: Entry, b: Board) => (b === "30d" ? e.cost30d : e.costAllTime);

export class LeaderboardStore {
  private entries = new Map<string, Entry>();

  upsert(e: Entry): void {
    this.entries.set(e.id, e);
  }

  count(): number {
    return this.entries.size;
  }

  private sorted(board: Board): Entry[] {
    return [...this.entries.values()].sort((a, b) => metric(b, board) - metric(a, board));
  }

  getTop(board: Board, limit: number): Entry[] {
    return this.sorted(board).slice(0, limit);
  }

  getRank(board: Board, id: string): number | null {
    const idx = this.sorted(board).findIndex((e) => e.id === id);
    return idx === -1 ? null : idx + 1;
  }
}
