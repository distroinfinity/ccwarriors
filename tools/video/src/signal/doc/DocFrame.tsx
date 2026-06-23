import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "../../lib/brand";
import { MUTED, PAPER1, PAPER2 } from "./Line";

// The paper canvas + a centered document column. Landscape keeps the `.md`
// header pinned top-left; portrait (9:16) folds the header in-flow above the
// block and scales the column to fit the narrower frame.
const BLOCK = 1140;
export const COL_LEFT = Math.round((1920 - BLOCK) / 2); // 390 (landscape)

const Header: React.FC<{ o: number; inFlow?: boolean }> = ({ o, inFlow }) =>
  inFlow ? (
    <div style={{ marginBottom: 30, opacity: o }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 22, color: MUTED, letterSpacing: "0.02em" }}>~/the-new-signal.md</div>
      <div style={{ marginTop: 12, width: 340, height: 1, background: "#E4DFD4" }} />
    </div>
  ) : (
    <>
      <div style={{ position: "absolute", top: 108, left: COL_LEFT, fontFamily: FONT.mono, fontSize: 22, color: MUTED, letterSpacing: "0.02em", opacity: o }}>~/the-new-signal.md</div>
      <div style={{ position: "absolute", top: 146, left: COL_LEFT, width: 340, height: 1, background: "#E4DFD4", opacity: o }} />
    </>
  );

export const DocFrame: React.FC<{ children: React.ReactNode; header?: boolean }> = ({ children, header = true }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const headerO = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bg = `radial-gradient(130% 130% at 50% 36%, ${PAPER1}, ${PAPER2})`;
  const scale = vertical ? (width * 0.94) / BLOCK : 1;

  return (
    <AbsoluteFill style={{ background: bg, justifyContent: "center", alignItems: "center" }}>
      {header && !vertical && <Header o={headerO} />}
      <div style={{ width: BLOCK, transform: `scale(${scale})` }}>
        {header && vertical && <Header o={headerO} inFlow />}
        {children}
      </div>
    </AbsoluteFill>
  );
};
