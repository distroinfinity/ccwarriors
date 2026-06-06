import { useMemo, useState } from "react";
import { useLeaderboard } from "./useLeaderboard";
import { useOrgBoard } from "./useOrgBoard";
import { useMe } from "./useMe";
import { detectOrg } from "./orgs";
import { Marquee } from "./components/Marquee";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Leaderboard } from "./components/Leaderboard";
import { YourCard, EnlistCard } from "./components/YourCard";
import { CardSkeleton } from "./components/Skeleton";
import { SceneDefs } from "./components/CardScene";
import { PixelHeart } from "./components/PixelHeart";
import { PixelGlyph } from "./components/PixelGlyph";
import { HowItWorks } from "./components/HowItWorks";
import { Legal } from "./components/Legal";
import { Sponsor } from "./components/Sponsor/Sponsor";
import type { Entry } from "./types";

// Extra routes, no router: /how and /legal render in the same shell.
// /legal is built but hidden until the Razorpay international activation
// needs it (issue #8) — flip HIDE_LEGAL to false to bring it back.
const HIDE_LEGAL = true;
const path = window.location.pathname.replace(/\/+$/, "");
const isHow = path === "/how";
const isLegal = !HIDE_LEGAL && path === "/legal";
if (isHow) document.title = "How it works · CCWarriors";
if (isLegal) document.title = "Legal · CCWarriors";

// Org co-brand (ns.ccwarriors.xyz / ?org=ns): applied before first paint so
// the page doesn't flash the default accent. Theme itself is resolved by the
// inline script in index.html (saved pref > device theme > light).
const ORG = detectOrg();
if (ORG) {
  document.documentElement.setAttribute("data-org", ORG.slug);
  if (!isHow && !isLegal) document.title = ORG.title;
}

type Board = "30d" | "allTime";
type Verified = "1" | "notmember" | "failed";

// Discord verify outcome (?verified=1|notmember|failed) — read once at module
// scope (StrictMode double-invokes state initializers, and stripping the URL
// param is a side effect that must run exactly once).
const VERIFIED_PARAM: Verified | null = (() => {
  try {
    const url = new URL(window.location.href);
    const v = url.searchParams.get("verified");
    if (!v) return null;
    url.searchParams.delete("verified");
    window.history.replaceState({}, "", url.toString());
    return v === "1" || v === "notmember" || v === "failed" ? v : null;
  } catch {
    return null;
  }
})();

export default function App() {
  // Global page rides the WS; org pages poll their REST slice instead.
  const globalBoard = useLeaderboard(!ORG);
  const orgBoard = useOrgBoard(ORG?.slug ?? null);
  const { count, top30d, topAllTime, byTool, tools, totals, connected, hasSnapshot, hasCompleteData } = ORG
    ? orgBoard
    : globalBoard;
  const { me: session, resolved: meResolved } = useMe();
  const [board, setBoard] = useState<Board>("30d");
  // Single-select tool filter (null = All). Lives here so the header/marquee
  // stay pinned to the all-tools view no matter what the board shows.
  const [tool, setTool] = useState<string | null>(null);
  // "Find me" — seq bump tells the Leaderboard to scroll to this login.
  const [locate, setLocate] = useState<{ seq: number; login: string } | null>(null);
  // Discord verify outcome strip — dismissible, shown once per redirect.
  const [verifiedNote, setVerifiedNote] = useState<Verified | null>(VERIFIED_PARAM);

  // Header/Marquee always reflect ALL tools — the filter is a board-only view.
  const entries: Entry[] = board === "30d" ? top30d : topAllTime;
  // Headline total comes from the server (it sums every warrior, not just the
  // top-100 we hold). Old servers don't send totals → fall back to the old
  // client-side reduce over the live window.
  const totalBurned = totals?.burned30d ?? entries.reduce((s, e) => s + e.cost30d, 0);

  // "Your card" — identity claimed via the CLI's personalized link (?u=login),
  // remembered in localStorage. Unknown visitors get the enlist CTA instead.
  const claimed = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("logout")) {
        localStorage.removeItem("ccw_login");
        url.searchParams.delete("logout");
        window.history.replaceState({}, "", url.toString());
        return null;
      }
      const u = url.searchParams.get("u");
      if (u) {
        localStorage.setItem("ccw_login", u);
        url.searchParams.delete("u");
        window.history.replaceState({}, "", url.toString());
        return u;
      }
      return localStorage.getItem("ccw_login");
    } catch {
      return null;
    }
  }, []);
  const identity = session?.login ?? claimed;
  const meIndex = identity ? entries.findIndex((e) => e.githubLogin === identity) : -1;
  const me = meIndex >= 0 ? entries[meIndex] : undefined;
  const meRank = meIndex + 1;
  const identityMayBeBeyondSeed = !!identity && !me && !hasCompleteData;

  // Org verify CTA: signed-in visitors on an org page who aren't verified yet.
  const needsVerify = !!ORG && !!session && !(session.orgs ?? []).includes(ORG.slug);

  const noteCopy: Record<Verified, string> = ORG
    ? {
        "1": `${ORG.name} verified. You're on the board.`,
        notmember: `That Discord account isn't in the ${ORG.name} server.`,
        failed: "Verification didn't complete. Try again.",
      }
    : { "1": "", notmember: "", failed: "" };

  return (
    <>
      <SceneDefs />
      <Marquee entries={entries} count={count} loading={!hasSnapshot} />
      <div className="wrap">
        <Header count={totals?.count ?? count} totalBurned={totalBurned} loading={!hasSnapshot} org={ORG} />
        {ORG && verifiedNote && (
          <div className={"orgnote" + (verifiedNote === "1" ? " ok" : "")} role="status">
            <span>{noteCopy[verifiedNote]}</span>
            <button onClick={() => setVerifiedNote(null)} aria-label="Dismiss">
              <PixelGlyph name="x" size={9} />
            </button>
          </div>
        )}
        <main className="main">
          {isHow ? (
            <HowItWorks />
          ) : isLegal ? (
            <Legal />
          ) : (
            <>
              <Hero org={ORG} />
              <div className="layout">
                <Leaderboard
                  board={board}
                  setBoard={setBoard}
                  entries={entries}
                  byTool={byTool}
                  tools={tools}
                  tool={tool}
                  setTool={setTool}
                  total={count}
                  connected={connected}
                  hasSnapshot={hasSnapshot}
                  hasCompleteData={hasCompleteData}
                  locate={locate}
                  org={ORG}
                />
                {!hasSnapshot || !meResolved || identityMayBeBeyondSeed ? (
                  <CardSkeleton />
                ) : me ? (
                  <YourCard
                    entry={me}
                    rank={meRank}
                    outdatedClient={session?.outdatedClient}
                    underReview={session?.underReview}
                    verifyOrg={needsVerify ? ORG : null}
                    onLocate={() =>
                      setLocate((s) => ({ seq: (s?.seq ?? 0) + 1, login: me.githubLogin }))
                    }
                  />
                ) : (
                  <EnlistCard org={ORG} verifyOrg={needsVerify ? ORG : null} />
                )}
              </div>
            </>
          )}
        </main>
        {!isHow && !isLegal && <Sponsor />}
        <footer>
          <div className="fleft">
            <div className="fbrand">
              CCWARRIORS{ORG ? <span className="fborg"> × {ORG.name.toUpperCase()}</span> : null}
            </div>
            <div className="fcredit">
              Built with <PixelHeart /> by{" "}
              <a href="https://x.com/distroinfinity" target="_blank" rel="noopener">
                Manu
              </a>
            </div>
          </div>
          <nav className="flinks" aria-label="Footer">
            {ORG && <a href="https://ccwarriors.xyz">Global board</a>}
            <a href="/how">How it works</a>
            <a href="https://github.com/distroinfinity/ccwarriors" target="_blank" rel="noopener">
              GitHub
            </a>
            <a href="https://x.com/distroinfinity" target="_blank" rel="noopener">
              X
            </a>
            <a href="mailto:manurajput2911@gmail.com?subject=CCWarriors%20issue">Facing any issues?</a>
            {!HIDE_LEGAL && <a href="/legal">Legal</a>}
          </nav>
        </footer>
      </div>
    </>
  );
}
