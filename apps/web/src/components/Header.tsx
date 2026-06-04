import { useEffect, useState } from "react";
import { ClawdLogo } from "./ClawdLogo";
import { TickerValue } from "./TickerValue";
import { formatUsd } from "../util";
import { Sk } from "./Skeleton";

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <button className="toggle" title="Toggle theme" onClick={() => setDark((d) => !d)}>
      {dark ? "☀" : "☾"}
    </button>
  );
}

export function Header({ count, totalBurned, loading }: { count: number; totalBurned: number; loading: boolean }) {
  return (
    <header>
      <a className="brand" href="/" aria-label="CCWarriors home">
        <ClawdLogo />
      </a>
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
