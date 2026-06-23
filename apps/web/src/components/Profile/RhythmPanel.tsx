import type { Profile } from "../../useProfile";

const WEEKS = 26; // ~6 months of columns

export function RhythmPanel({ profile }: { profile: Profile | null }) {
  // Core not in yet: skeleton in-place so the panel fills progressively.
  if (!profile) {
    return (
      <div className="ppanel rhythm">
        <div className="seclabel">Rhythm</div>
        <div className="sk-block" style={{ height: 70 }} aria-busy="true" />
      </div>
    );
  }
  const { days, currentStreak, longestStreak } = profile.rhythm;
  if (days.length === 0) return null;
  const byDay = new Map(days.map((d) => [d.day, d.cost]));
  const max = Math.max(...days.map((d) => d.cost), 1);

  // Build a GitHub-style grid: columns = weeks, rows = Sun..Sat, ending today.
  const today = new Date();
  const cells: Array<{ day: string; level: number }> = [];
  const start = new Date(today.getTime() - (WEEKS * 7 - 1) * 86_400_000);
  // Align the first column to Sunday.
  start.setDate(start.getDate() - start.getDay());
  for (let t = start.getTime(); t <= today.getTime(); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const cost = byDay.get(day) ?? 0;
    const level = cost <= 0 ? 0 : Math.min(4, 1 + Math.floor((cost / max) * 3.99));
    cells.push({ day, level });
  }

  return (
    <div className="ppanel rhythm">
      <div className="seclabel">Rhythm</div>
      <div className="heatmap" role="img" aria-label="daily usage heatmap">
        {cells.map((c) => (
          <span key={c.day} className={`hm l${c.level}`} title={c.day} />
        ))}
      </div>
      <div className="rhythm-stats mono">
        <span>
          <b>{currentStreak}d</b> current streak
        </span>
        <span>
          <b>{longestStreak}d</b> longest streak
        </span>
        <span>
          <b>{days.filter((d) => d.cost > 0).length}</b> active days tracked
        </span>
      </div>
    </div>
  );
}
