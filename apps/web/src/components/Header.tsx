import { useEffect, useState } from "react";
import { ClawdLogo } from "./ClawdLogo";
import { useTickerTween } from "../useTween";
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
  const c = useTickerTween(count, { durationMs: 1100 });
  const burned = useTickerTween(totalBurned, { durationMs: 2500 });
  return (
    <header>
      <a className="brand" href="/" aria-label="CCWarriors home">
        <ClawdLogo />
      </a>
      <div className="right">
        <div className="hstats">
          <div>
            <div className={"v mono" + (c.flashing ? " up" : "")}>
              <span className="dot" />
              {loading ? <Sk w={40} h={16} /> : <span>{Math.round(c.value).toLocaleString("en-US")}</span>}
            </div>
            <div className="l">warriors</div>
          </div>
          <div>
            <div className={"v mono" + (burned.flashing ? " up" : "")}>
              {loading ? <Sk w={64} h={16} /> : <>{formatUsd(burned.value)}</>}
            </div>
            <div className="l">burned · 30d</div>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
