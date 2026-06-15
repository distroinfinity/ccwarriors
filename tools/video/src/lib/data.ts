import snapshot from "../../data/leaderboard.json";

export interface Warrior {
  id: string;
  login: string;
  tier: string;
  cost30d: number;
  costAllTime: number;
  avatar: string | null;
}

export interface Snapshot {
  fetchedAt: string;
  totalBurned30d: number;
  warriorCount: number;
  entries: Warrior[];
}

export const DATA = snapshot as Snapshot;
