// Stale-daemon detection. The autosync daemon can die silently — e.g. a
// self-update that installs the new bundle but never relaunches it (issue #91,
// macOS launchd KeepAlive not respawning). Nothing on the client beacons that,
// so we catch it server-side: a user who synced like a daemon (many syncs in
// the last week) but whose last sync has gone stale is a likely-dead daemon.
//
// This module is the pure detection core (no DB, no HTTP) so it's trivially
// testable; routes/daemon-health.ts feeds it rows and exposes the report, and
// the scheduled health workflow polls that endpoint and alerts on a spike.

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function staleDaemonThresholds() {
  return {
    // Min syncs in the trailing 7 days to count as a daemon (vs. occasional
    // manual `ccwarriors`). Even at the 15-min heartbeat a daemon does ~96
    // syncs per day, so 20/week still cleanly separates daemons from humans.
    minSyncs7d: envNum("DAEMON_MIN_SYNCS_7D", 20),
    // A daemon user silent longer than this is reported in the `stale` sample.
    staleHours: envNum("DAEMON_SILENT_HOURS", 2),
    // Cap on the per-user sample returned (the counts are always exact).
    sampleSize: envNum("DAEMON_SAMPLE_SIZE", 25),
  };
}

/** One active user's recent sync shape (last sync + 7-day cadence + build). */
export interface DaemonSyncRow {
  githubLogin: string;
  lastSyncedAt: Date;
  syncs7d: number;
  lastBuild: string | null;
}

export interface StaleDaemon {
  githubLogin: string;
  silentHours: number;
  syncs7d: number;
  lastBuild: string | null;
}

export interface StaleDaemonReport {
  /** Daemon-like users considered (≥ minSyncs7d in the last 7 days). */
  daemonUsers: number;
  /** Daemon users whose last sync is older than 2h / 12h / 24h. */
  silent2h: number;
  silent12h: number;
  silent24h: number;
  /** The silent (≥ staleHours) cohort, worst-first, capped at sampleSize. */
  stale: StaleDaemon[];
  thresholds: { minSyncs7d: number; staleHours: number };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Reduce per-user sync rows to a stale-daemon report. Pure: `now` and all
 * thresholds are injected so the same input always yields the same output.
 */
export function findStaleDaemons(
  rows: DaemonSyncRow[],
  now: number,
  opts: Partial<ReturnType<typeof staleDaemonThresholds>> = {},
): StaleDaemonReport {
  const { minSyncs7d, staleHours, sampleSize } = { ...staleDaemonThresholds(), ...opts };

  const daemons = rows
    .filter((r) => r.syncs7d >= minSyncs7d)
    .map((r) => ({ ...r, silentHours: (now - r.lastSyncedAt.getTime()) / 3_600_000 }));

  const silentAtLeast = (h: number) => daemons.filter((d) => d.silentHours >= h).length;

  const stale = daemons
    .filter((d) => d.silentHours >= staleHours)
    .sort((a, b) => b.silentHours - a.silentHours)
    .slice(0, sampleSize)
    .map((d) => ({
      githubLogin: d.githubLogin,
      silentHours: round1(d.silentHours),
      syncs7d: d.syncs7d,
      lastBuild: d.lastBuild,
    }));

  return {
    daemonUsers: daemons.length,
    silent2h: silentAtLeast(2),
    silent12h: silentAtLeast(12),
    silent24h: silentAtLeast(24),
    stale,
    thresholds: { minSyncs7d, staleHours },
  };
}
