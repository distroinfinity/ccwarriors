import React from "react";
import { useCurrentFrame } from "remotion";
import { DocFrame } from "../doc/DocFrame";
import { ACCENT, activeIndex, INK, Line, LineSpec, SYN } from "../doc/Line";
import { SIGNAL } from "../../lib/signalData";

// The new signal — distroinfinity revealed as a syntax-highlighted data block
// that types onto the same document. Real numbers; the efficiency line ("cost")
// is the emphasis (accent comment "← the signal").
const v = {
  burn: `"$${SIGNAL.burnUsd.toLocaleString("en-US")}"`,
  shipped: SIGNAL.survivingLoc.toLocaleString("en-US"),
  cost: `"$${SIGNAL.costPerLine}"`,
  craft: String(SIGNAL.craft),
  sessions: SIGNAL.sessions,
  tier: SIGNAL.tierName.toLowerCase(),
};

const SIZE = 34;
const SPECS: LineSpec[] = [
  { gutter: "06", size: SIZE, type: 6, tokens: [{ t: "const ", c: SYN.keyword }, { t: SIGNAL.login, c: INK }, { t: " = {", c: SYN.punc }] },
  { gutter: "07", size: SIZE, type: 30, tokens: [{ t: "  burned:   ", c: SYN.key }, { t: v.burn, c: SYN.string }, { t: ",", c: SYN.punc }, { t: `     // 30 days · ${v.sessions} sessions`, c: SYN.comment }] },
  { gutter: "08", size: SIZE, type: 54, tokens: [{ t: "  shipped:  ", c: SYN.key }, { t: v.shipped, c: SYN.num }, { t: ",", c: SYN.punc }, { t: "   // lines that survived", c: SYN.comment }] },
  { gutter: "09", size: SIZE, type: 78, tokens: [{ t: "  cost:     ", c: SYN.key }, { t: v.cost, c: SYN.string }, { t: ",", c: SYN.punc }, { t: "    // per surviving line  ← the signal", c: ACCENT }] },
  { gutter: "10", size: SIZE, type: 102, tokens: [{ t: "  craft:    ", c: SYN.key }, { t: v.craft, c: SYN.num }, { t: ",", c: SYN.punc }, { t: `        // ${v.tier}`, c: SYN.comment }] },
  { gutter: "11", size: SIZE, type: 124, tokens: [{ t: "}", c: SYN.punc }] },
];

export const HeroDataBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const active = activeIndex(SPECS, frame);
  return (
    <DocFrame>
      {SPECS.map((s, i) => (
        <Line key={i} spec={s} active={i === active} />
      ))}
    </DocFrame>
  );
};
