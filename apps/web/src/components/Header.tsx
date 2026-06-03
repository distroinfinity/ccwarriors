import { useEffect, useState } from "react";
import { ClawdLogo } from "./ClawdLogo";
import { useTween } from "../useTween";
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
  const c = useTween(count);
  const burned = useTween(totalBurned);
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
              {loading ? <Sk w={40} h={16} /> : <span>{Math.round(c).toLocaleString("en-US")}</span>}
            </div>
            <div className="l">warriors</div>
          </div>
          <div>
            <div className="v mono">
              {loading ? <Sk w={64} h={16} /> : <>${Math.round(burned).toLocaleString("en-US")}</>}
            </div>
            <div className="l">total burned</div>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
