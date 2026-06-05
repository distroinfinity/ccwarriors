import { InstallBlock } from "./InstallBlock";
import type { WebOrg } from "../orgs";

export function Hero({ org }: { org?: WebOrg | null }) {
  return (
    <div className="hero">
      <h1>
        Token burn rate, <span className="o">ranked.</span>
      </h1>
      <p>{org ? org.tagline : "See who's burning the most tokens across their AI coding tools."}</p>
      <InstallBlock />
    </div>
  );
}
