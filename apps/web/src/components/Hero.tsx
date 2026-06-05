import { InstallBlock } from "./InstallBlock";
import type { WebOrg } from "../orgs";

export function Hero({ org }: { org?: WebOrg | null }) {
  return (
    <div className="hero">
      <h1>
        Token burn rate, <span className="o">ranked.</span>
        <span className="cursor" aria-hidden="true" />
      </h1>
      <p>{org ? org.tagline : "See who's burning the most tokens across their AI coding tools."}</p>
      <InstallBlock />
      {/* Mobile only (CSS): the install block is hidden there — phones can't curl. */}
      <p className="hero-hint">Enlist from your desktop terminal.</p>
    </div>
  );
}
