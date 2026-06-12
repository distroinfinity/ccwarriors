export interface Entry {
  id: string;
  githubLogin: string;
  avatarUrl: string;
  xHandle: string | null;
  tier: string;
  cardScene: string;
  cost30d: number; // all-tools 30d total
  costAllTime: number;
  // Per-tool 30d cost (server-computed). Absent on frames from an old server
  // during deploy overlap — every consumer must tolerate undefined.
  breakdown?: Partial<Record<string, number>>;
  // Verified org memberships (slugs) — drives the org badge on rows.
  orgs?: string[];
  // 8 activity levels (0-7) over the last 30 days (~3.75d per bucket).
  // Absent on entries from an old server or users with no spend in the window.
  spark?: number[];
  // Craft Score chip: present only when the user is consented + public + scored.
  // Absent means no chip is rendered — do not fabricate zeros.
  craft?: { score: number; tier: string };
}

export interface ToolInfo {
  key: string;
  label: string;
  count: number;
}

export interface Snapshot {
  type: "snapshot" | "update";
  count: number;
  top30d: Entry[];
  topAllTime: Entry[];
  // Additive fields (new server). Old servers omit them — the UI degrades to
  // exactly the pre-multi-tool experience.
  byTool?: Record<string, { top30d: Entry[] }>;
  tools?: ToolInfo[];
  totals?: { burned30d: number; count: number };
}
