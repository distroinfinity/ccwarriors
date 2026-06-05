import { useEffect, useState } from "react";
import { ClawdLogo } from "./ClawdLogo";
import { PixelGlyph } from "./PixelGlyph";
import { TickerValue } from "./TickerValue";
import { formatUsd } from "../util";
import { Sk } from "./Skeleton";
import type { WebOrg } from "../orgs";

function ThemeToggle({ initialDark }: { initialDark: boolean }) {
  const [dark, setDark] = useState(initialDark);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <button className="toggle" title="Toggle theme" onClick={() => setDark((d) => !d)}>
      <PixelGlyph name={dark ? "sun" : "moon"} size={15} />
    </button>
  );
}

export function Header({
  count,
  totalBurned,
  loading,
  org,
}: {
  count: number;
  totalBurned: number;
  loading: boolean;
  /** Org co-brand: Clawd × org wordmark, org-default theme. */
  org?: WebOrg | null;
}) {
  return (
    <header>
      <div className="brand">
        <a href="/" aria-label="CCWarriors home">
          <ClawdLogo />
        </a>
        {org && (
          <span className="orglock">
            <span className="orgx">×</span>
            <a className="orgname" href={org.url} target="_blank" rel="noopener" title={org.url}>
              {org.name}
            </a>
          </span>
        )}
      </div>
      <div className="right">
        <div className="hstats">
          <div>
            <div className="v mono">
              <span className="dot" />
              {loading ? (
                <Sk w={40} h={16} />
              ) : (
                <TickerValue
                  target={count}
                  durationMs={1100}
                  format={(n) => Math.round(n).toLocaleString("en-US")}
                />
              )}
            </div>
            <div className="l">warriors</div>
          </div>
          <div>
            <div className="v mono">
              {loading ? (
                <Sk w={64} h={16} />
              ) : (
                <TickerValue target={totalBurned} durationMs={2500} format={formatUsd} />
              )}
            </div>
            <div className="l">burned · 30d</div>
          </div>
        </div>
        <ThemeToggle initialDark={org?.themeDefault === "dark"} />
      </div>
    </header>
  );
}
