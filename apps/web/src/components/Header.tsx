import { useEffect, useState } from "react";
import { ClawdLogo } from "./ClawdLogo";
import { useTween } from "../useTween";

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

export function Header({ count, totalBurned }: { count: number; totalBurned: number }) {
  const c = useTween(count);
  const burned = useTween(totalBurned);
  return (
    <header>
      <div className="brand">
        <ClawdLogo />
        <div className="nm">CCWARRIORS</div>
      </div>
      <div className="right">
        <div className="hstats">
          <div>
            <div className="v mono">
              <span className="dot" />
              <span>{Math.round(c).toLocaleString("en-US")}</span>
            </div>
            <div className="l">warriors</div>
          </div>
          <div>
            <div className="v mono">${Math.round(burned).toLocaleString("en-US")}</div>
            <div className="l">total burned</div>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
