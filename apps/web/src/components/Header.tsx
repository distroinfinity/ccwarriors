import { useEffect, useState } from "react";
import { ClawdLogo } from "./ClawdLogo";
import { PixelGlyph } from "./PixelGlyph";
import { TickerValue } from "./TickerValue";
import { formatUsd } from "../util";
import { Sk } from "./Skeleton";
import type { WebOrg } from "../orgs";

// Theme is resolved before first paint by the inline script in index.html
// (saved pref > device theme > light); this just toggles + persists it.
function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-theme") === "dark",
  );
  // Follow live OS theme changes, but only while the user has no saved pref.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem("theme")) return;
      } catch {
        /* ignore */
      }
      document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      setDark(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(next);
  };
  return (
    <button className="toggle" title="Toggle theme" onClick={toggle}>
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
        <ThemeToggle />
      </div>
    </header>
  );
}
