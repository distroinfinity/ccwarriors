import type { ToolInfo } from "../types";
import { ToolGlyph } from "./ToolGlyph";

/**
 * Single-select tool filter — compact icon chips inline with the board tabs.
 * Default is "All" (sum of every tool); clicking a tool re-ranks the board by
 * that tool's 30d cost; clicking it again returns to All. Renders nothing
 * until the server reports ≥2 tools with data (old servers report none), so
 * the UI only appears once filtering means something.
 */
export function FilterChips({
  tools,
  active,
  onSelect,
}: {
  tools: ToolInfo[];
  active: string | null;
  onSelect: (tool: string | null) => void;
}) {
  if (tools.length < 2) return null;
  return (
    <div className="chips" role="tablist" aria-label="Filter by AI tool">
      <button
        role="tab"
        aria-selected={active === null}
        className={"chip chip-all" + (active === null ? " on" : "")}
        title="All tools"
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {tools.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          className={"chip" + (active === t.key ? " on" : "")}
          title={`${t.label} · ${t.count} warrior${t.count === 1 ? "" : "s"}`}
          aria-label={t.label}
          onClick={() => onSelect(active === t.key ? null : t.key)}
        >
          <ToolGlyph tool={t.key} />
        </button>
      ))}
    </div>
  );
}
