import React from "react";
import { useCurrentFrame } from "remotion";
import { DocFrame } from "../doc/DocFrame";
import { activeIndex, Line, LineSpec, SYN } from "../doc/Line";

// Shots 1–2: the old metrics, typed then struck out, as deprecated lines.
// Type/strike frames are synced to the voiceover segments (résumé≈f100,
// stars≈f200, years≈f268) so each word is struck as it's spoken.
const SPECS: LineSpec[] = [
  { gutter: "01", size: 30, tokens: [{ t: "// how we used to know a developer", c: SYN.comment }], type: 8 },
  { gutter: "02", size: 30, tokens: [{ t: "" }] },
  { gutter: "03", size: 76, tokens: [{ t: "résumé" }], type: 40, strikeAt: 100 },
  { gutter: "04", size: 76, tokens: [{ t: "stars" }], type: 150, strikeAt: 200 },
  { gutter: "05", size: 76, tokens: [{ t: "years" }], type: 238, strikeAt: 268 },
];

export const ColdOpenBeat: React.FC = () => {
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
