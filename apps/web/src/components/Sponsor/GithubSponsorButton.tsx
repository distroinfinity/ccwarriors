import { GH_SPONSOR, tierAt } from "../../sponsorTiers";

/** Prefilled GitHub Sponsors link. The amount/frequency params are undocumented
 *  but work in the wild; worst case the user lands on the plain sponsor page. */
export function GithubSponsorButton({
  tierIdx,
  frequency,
}: {
  tierIdx: number;
  frequency: "once" | "monthly";
}) {
  const tier = tierAt(tierIdx);
  const freq = frequency === "once" ? "one-time" : "recurring";
  const href = `https://github.com/sponsors/${GH_SPONSOR}?frequency=${freq}&amount=${tier.usd}`;
  return (
    <a className="donate-cta" href={href} target="_blank" rel="noopener">
      Sponsor ${tier.usd}
      {frequency === "monthly" ? "/mo" : ""} on GitHub →
    </a>
  );
}
