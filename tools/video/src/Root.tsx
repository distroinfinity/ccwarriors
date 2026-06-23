import React from "react";
import { AbsoluteFill, Composition, Sequence } from "remotion";
import "./lib/brand";
import { ColdOpen } from "./scenes/ColdOpen";
import { BurnCounter } from "./scenes/BurnCounter";
import { Board } from "./scenes/Board";
import { Flurry } from "./scenes/Flurry";
import { CTA } from "./scenes/CTA";
import { ColdOpenP } from "./scenes/profile/ColdOpenP";
import { Masthead } from "./scenes/profile/Masthead";
import { CraftScore } from "./scenes/profile/CraftScore";
import { DepthFlurry } from "./scenes/profile/DepthFlurry";
import { CTAProfile } from "./scenes/profile/CTAProfile";
import { GradeOverlay } from "./lib/GradeOverlay";
import { Score } from "./lib/Score";
import { Shell } from "./lib/Shell";
import { Signal } from "./signal/Signal";
import { DURATION as SIGNAL_DURATION } from "./signal/timing";

// 120 BPM = 15 frames/beat, 60/bar. Every boundary is a bar line:
// cold 0-4s (intro+build) · DROP1 counter 4-12s · board 12-32s (groove →
// breakdown → build → DROP2 climb, one continuous shot) · flurry 32-36s ·
// CTA 36-43s
export const T = {
  cold: 120,
  counter: 240,
  board: 600,
  flurry: 120,
  cta: 210,
};
export const AT = {
  counter: T.cold,
  board: T.cold + T.counter,
  flurry: T.cold + T.counter + T.board,
  cta: T.cold + T.counter + T.board + T.flurry,
};
const TOTAL = AT.cta + T.cta;
const OV = 8; // crossfade overlap frames

const Launch: React.FC = () => (
  <AbsoluteFill style={{ background: "#0a0a0b" }}>
    {/* cold open ends on a HARD cut — the drop hits with the counter */}
    <Sequence durationInFrames={T.cold}>
      <Shell dur={T.cold} inF={0} outF={0}>
        <ColdOpen />
      </Shell>
    </Sequence>
    <Sequence from={AT.counter} durationInFrames={T.counter + OV}>
      <Shell dur={T.counter + OV} inF={0}>
        <BurnCounter />
      </Shell>
    </Sequence>
    <Sequence from={AT.board} durationInFrames={T.board + OV}>
      <Shell dur={T.board + OV}>
        <Board />
      </Shell>
    </Sequence>
    <Sequence from={AT.flurry} durationInFrames={T.flurry + OV}>
      <Shell dur={T.flurry + OV}>
        <Flurry />
      </Shell>
    </Sequence>
    <Sequence from={AT.cta} durationInFrames={T.cta}>
      <Shell dur={T.cta} outF={0}>
        <CTA />
      </Shell>
    </Sequence>
    <Score />
  </AbsoluteFill>
);

// ── Profile teaser ────────────────────────────────────────────────────────
// 120 BPM, all cuts on bar lines. cold 0-4s · masthead 4-12s (DROP1) ·
// craft 12-24s (DROP2 hero) · flurry 24-32s · CTA 32-40s.
export const PT = { cold: 120, mast: 240, craft: 360, flurry: 240, cta: 240 };
export const PAT = {
  mast: PT.cold,
  craft: PT.cold + PT.mast,
  flurry: PT.cold + PT.mast + PT.craft,
  cta: PT.cold + PT.mast + PT.craft + PT.flurry,
};
const PTOTAL = PAT.cta + PT.cta;

const ProfileLaunch: React.FC = () => (
  <AbsoluteFill style={{ background: "#0a0a0b" }}>
    <Sequence durationInFrames={PT.cold}>
      <Shell dur={PT.cold} inF={0} outF={0}>
        <ColdOpenP />
      </Shell>
    </Sequence>
    {/* masthead hard-cuts in on DROP1 */}
    <Sequence from={PAT.mast} durationInFrames={PT.mast + OV}>
      <Shell dur={PT.mast + OV} inF={0}>
        <Masthead />
      </Shell>
    </Sequence>
    {/* craft hero hard-cuts in on DROP2 */}
    <Sequence from={PAT.craft} durationInFrames={PT.craft + OV}>
      <Shell dur={PT.craft + OV} inF={0}>
        <CraftScore />
      </Shell>
    </Sequence>
    <Sequence from={PAT.flurry} durationInFrames={PT.flurry + OV}>
      <Shell dur={PT.flurry + OV}>
        <DepthFlurry />
      </Shell>
    </Sequence>
    <Sequence from={PAT.cta} durationInFrames={PT.cta}>
      <Shell dur={PT.cta} outF={0}>
        <CTAProfile />
      </Shell>
    </Sequence>
    <GradeOverlay />
    <Score variant="profile" />
  </AbsoluteFill>
);

export const Root: React.FC = () => (
  <>
    <Composition
      id="Launch"
      component={Launch}
      durationInFrames={TOTAL}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="ProfileLaunch"
      component={ProfileLaunch}
      durationInFrames={PTOTAL}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="Signal"
      component={Signal}
      durationInFrames={SIGNAL_DURATION}
      fps={30}
      width={1920}
      height={1080}
    />
    {/* 9:16 reels cut — same beats + audio, layout adapts via useVertical() */}
    <Composition
      id="SignalVertical"
      component={Signal}
      durationInFrames={SIGNAL_DURATION}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
