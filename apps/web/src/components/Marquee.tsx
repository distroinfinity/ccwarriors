import type { Entry } from "../types";
import { formatUsd, tierLabel } from "../util";

/** Builds 5-6 ticker items derived from live data. */
function buildItems(entries: Entry[], count: number): string[] {
  if (entries.length === 0) return [`<b>${count}</b> warriors enlisted`];
  const top = entries[0]!;
  const monthTotal = entries.reduce((s, e) => s + e.cost30d, 0);
  const elite =
    entries.find((e) => /diamond|netherite/i.test(e.tier)) ?? entries[Math.min(2, entries.length - 1)]!;
  const second = entries[1];
  const third = entries[2];

  const items = [
    `<b>${top.githubLogin}</b> burned <span class="o">${formatUsd(top.cost30d)}</span> this month`,
    `<b>${elite.githubLogin}</b> reached <span class="o">${elite.tier.toUpperCase()}</span>`,
    `<b>${count}</b> warriors enlisted`,
  ];
  if (second && third) {
    items.push(
      `<b>${third.githubLogin}</b> chasing <b>${second.githubLogin}</b> for <span class="o">#2</span>`,
    );
  }
  items.push(`<span class="o">${formatUsd(monthTotal)}</span> burned this month`);
  if (entries.length > 3) {
    const r = entries[3]!;
    items.push(`<b>${r.githubLogin}</b> pulled <span class="o">${tierLabel(r.tier)}</span>`);
  }
  return items;
}

export function Marquee({ entries, count }: { entries: Entry[]; count: number }) {
  const items = buildItems(entries, count);
  const sep = "&nbsp;&nbsp;·&nbsp;&nbsp;";
  const line = items.join(sep) + sep;
  return (
    <div className="ticker">
      <span className="run" dangerouslySetInnerHTML={{ __html: line + line }} />
    </div>
  );
}
