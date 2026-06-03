import { InstallBlock } from "./InstallBlock";

export function Hero() {
  return (
    <div className="hero">
      <h1>
        Token burn rate, <span className="o">ranked.</span>
      </h1>
      <p>See who's burning the most Claude Code tokens.</p>
      <InstallBlock />
    </div>
  );
}
