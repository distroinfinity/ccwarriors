import type { Entry } from "../types";
import { formatUsd, tierLabel } from "../util";

/** Builds 5-6 ticker items derived from live data. */
function buildItems(entries: Entry[], count: number): string[] {
  if (entries.length === 0) return [`<b>${count}</b> warrior${count === 1 ? "" : "s"} enlisted`];
  const top = entries[0]!;
  const total30d = entries.reduce((s, e) => s + e.cost30d, 0);
  const elite =
    entries.find((e) => /diamond|netherite/i.test(e.tier)) ?? entries[Math.min(2, entries.length - 1)]!;
  const second = entries[1];
  const third = entries[2];

  const items = [
    `<b>${top.githubLogin}</b> burned <span class="o">${formatUsd(top.cost30d)}</span> in the last 30 days`,
    `<b>${elite.githubLogin}</b> reached <span class="o">${elite.tier.toUpperCase()}</span>`,
    `<b>${count}</b> warrior${count === 1 ? "" : "s"} enlisted`,
  ];
  if (second && third) {
    items.push(
      `<b>${third.githubLogin}</b> chasing <b>${second.githubLogin}</b> for <span class="o">#2</span>`,
    );
  }
  items.push(`<span class="o">${formatUsd(total30d)}</span> burned in the last 30 days`);
  if (entries.length > 3) {
    const r = entries[3]!;
    items.push(`<b>${r.githubLogin}</b> pulled <span class="o">${tierLabel(r.tier)}</span>`);
  }
  return items;
}

export function Marquee({
  entries,
  count,
  loading,
}: {
  entries: Entry[];
  count: number;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="ticker">
        <div className="skline">
          <span className="sk" style={{ width: 300, height: 13 }} />
        </div>
      </div>
    );
  }
  // Empty board: a calm static line, no scroll animation.
  if (count === 0 || entries.length === 0) {
    return (
      <div className="ticker">
        <span className="static">
          fresh board&nbsp;&nbsp;·&nbsp;&nbsp;no warriors yet&nbsp;&nbsp;·&nbsp;&nbsp;run the install
          command to claim <span className="o">#1</span>
        </span>
      </div>
    );
  }
  const items = buildItems(entries, count);
  const sep = "&nbsp;&nbsp;·&nbsp;&nbsp;";
  const line = items.join(sep) + sep;
  return (
    <div className="ticker">
      <span className="run" dangerouslySetInnerHTML={{ __html: line + line }} />
    </div>
  );
}
