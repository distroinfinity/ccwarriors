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

export interface Snapshot {
  type: "snapshot" | "update";
  count: number;
  top30d: Entry[];
  topAllTime: Entry[];
}
