import React from "react";
import { AbsoluteFill, Composition, Sequence } from "remotion";
import "./lib/brand";
import { ColdOpen } from "./scenes/ColdOpen";
import { BurnCounter } from "./scenes/BurnCounter";
import { Board } from "./scenes/Board";
import { Flurry } from "./scenes/Flurry";
import { CTA } from "./scenes/CTA";
import { Score } from "./lib/Score";
import { Shell } from "./lib/Shell";

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

export const Root: React.FC = () => (
  <Composition
    id="Launch"
    component={Launch}
    durationInFrames={TOTAL}
    fps={30}
    width={1920}
    height={1080}
  />
);
