import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../../lib/brand";
import { EmberField, Grain, GridFloor, Vignette } from "../../lib/fx";
import { Halftone } from "../../lib/Halftone";
import { PROFILE } from "../../lib/profileData";

// Scene 4 — depth as a feeling, not a lecture. Three beats whoosh past so the
// breadth registers without explaining any single stat: the receipts, the
// rhythm, the story deck.
const SEGOFF = "rgba(255,255,255,0.07)";
const HM_OP = [0, 0.3, 0.55, 0.78, 1];
const SOFT = "#c6cad2"; // brighter than muted, for legible body text

const costPerLineStr =
  PROFILE.costPerLine == null ? "—" : PROFILE.costPerLine < 0.01 ? `$${PROFILE.costPerLine}` : `$${PROFILE.costPerLine.toFixed(2)}`;

const Word: React.FC<{ text: string; o: number }> = ({ text, o }) => (
  <div
    style={{
      position: "absolute",
      top: 150,
      width: "100%",
      textAlign: "center",
      fontFamily: FONT.mono,
      fontSize: 30,
      fontWeight: 600,
      letterSpacing: "0.42em",
      textTransform: "uppercase",
      color: C.ember,
      opacity: o,
      transform: `translateY(${(1 - o) * 10}px)`,
    }}
  >
    {text}
  </div>
);

const StatRow: React.FC<{ v: string; l: string; o: number }> = ({ v, l, o }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 14, opacity: o, transform: `translateY(${(1 - o) * 8}px)` }}>
    <b style={{ fontFamily: FONT.mono, fontSize: 34, color: C.ink, minWidth: 128 }}>{v}</b>
    <span style={{ fontSize: 21, color: SOFT }}>{l}</span>
  </div>
);

export const DepthFlurry: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = interpolate(frame, [0, 240], [1.0, 1.04]);

  const win = (inA: number, inB: number, outA: number, outB: number) =>
    interpolate(frame, [inA, inB, outA, outB], [0, 1, 1, 0], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // beat windows (last beat holds open into the CTA cut)
  const oA = win(0, 12, 70, 84);
  const oB = win(76, 90, 150, 164);
  const oC = interpolate(frame, [156, 170], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const stag = (start: number) => interpolate(frame, [start, start + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // ── Beat A: By the numbers ──
  const groups = [
    { label: "OUTCOMES", rows: [{ v: costPerLineStr, l: "per surviving line" }, { v: PROFILE.grade ?? "—", l: "cache efficiency" }] },
    { label: "SESSIONS", rows: [{ v: String(PROFILE.sessions), l: `sessions, ${PROFILE.windowDays}d` }, { v: `${PROFILE.planModePct}%`, l: "in plan mode" }] },
    { label: PROFILE.githubVerified ? "GITHUB · VERIFIED" : "GITHUB", rows: [{ v: `★ ${PROFILE.github?.stars ?? 0}`, l: "stars" }, { v: String(PROFILE.github?.prs ?? 0), l: "public PRs merged" }] },
    { label: "BUILDS WITH", rows: [{ v: PROFILE.stackLangs[0]?.name ?? "—", l: PROFILE.stackLangs.slice(1, 3).map((l) => l.name).join(" · ") || "top language" }] },
  ];

  // ── Beat C: deck cards ──
  const cards = PROFILE.cards.slice(0, 3);

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GridFloor speed={0.9} />
      <EmberField count={26} intensity={0.6} />
      <AbsoluteFill style={{ transform: `scale(${drift})` }}>
        {/* Beat A — the receipts */}
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: oA }}>
          <Word text="your outcomes" o={stag(4)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "46px 120px", width: 1040 }}>
            {groups.map((g, gi) => (
              <div key={g.label}>
                <div style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: "0.14em", color: C.bronze, opacity: stag(10 + gi * 6) }}>{g.label}</div>
                {g.rows.map((r, ri) => (
                  <StatRow key={r.l} v={r.v} l={r.l} o={stag(16 + gi * 6 + ri * 4)} />
                ))}
              </div>
            ))}
          </div>
        </AbsoluteFill>

        {/* Beat B — the rhythm */}
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: oB }}>
          <Word text="your rhythm" o={interpolate(frame, [80, 92], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "grid", gridAutoFlow: "column", gridTemplateRows: `repeat(${PROFILE.rhythm.rows}, 16px)`, gap: 5 }}>
              {PROFILE.rhythm.levels.map((lvl, i) => {
                const reveal = interpolate(frame, [84 + i * 0.22, 92 + i * 0.22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                return (
                  <span
                    key={i}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 2,
                      background: lvl === 0 ? SEGOFF : C.or,
                      opacity: lvl === 0 ? reveal : (HM_OP[lvl] ?? 1) * reveal,
                    }}
                  />
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 40, marginTop: 26, fontFamily: FONT.mono, fontSize: 20, color: C.muted, opacity: interpolate(frame, [120, 134], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              <span><b style={{ color: C.ink }}>{PROFILE.rhythm.current}d</b> current streak</span>
              <span><b style={{ color: C.ink }}>{PROFILE.rhythm.longest}d</b> longest streak</span>
              <span><b style={{ color: C.ink }}>{PROFILE.rhythm.activeDays}</b> active days</span>
            </div>
          </div>
        </AbsoluteFill>

        {/* Beat C — this month's insight cards (stat-forward; no story doorway) */}
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: oC }}>
          <Word text="this month" o={interpolate(frame, [160, 174], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
          <div style={{ display: "flex", gap: 32, alignItems: "stretch" }}>
            {cards.map((card, i) => {
              const s = spring({ frame: frame - (164 + i * 9), fps, config: { damping: 15, mass: 0.7 } });
              return (
                <div
                  key={card.key}
                  style={{
                    position: "relative",
                    width: 376,
                    height: 344,
                    overflow: "hidden",
                    borderRadius: 14,
                    background: "linear-gradient(180deg,#1b1b1f,#141417)",
                    border: `1px solid ${C.line}`,
                    boxShadow: "0 1px 0 rgba(255,255,255,.05) inset, 0 16px 36px rgba(0,0,0,.45)",
                    opacity: s,
                    transform: `translateY(${(1 - s) * 40}px) scale(${0.95 + s * 0.05})`,
                  }}
                >
                  <div style={{ position: "absolute", top: 0, right: 0, width: 130, height: 130, WebkitMaskImage: "radial-gradient(120% 120% at 100% 0%, #000 30%, transparent 72%)", maskImage: "radial-gradient(120% 120% at 100% 0%, #000 30%, transparent 72%)" }}>
                    <Halftone seed={card.key} />
                  </div>
                  <div style={{ padding: "28px 28px", display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
                    <div style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: "0.14em", textTransform: "uppercase", color: SOFT, paddingRight: 60 }}>{card.question}</div>
                    {card.stat && (
                      <span style={{ alignSelf: "flex-start", background: C.or, color: "#0a0a0b", borderRadius: 6, padding: "6px 14px", fontFamily: FONT.mono, fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>{card.stat}</span>
                    )}
                    <div style={{ fontFamily: FONT.mono, fontSize: 28, lineHeight: 1.2, fontWeight: 700, letterSpacing: "-0.02em", color: C.ink }}>{card.headline}</div>
                    <p style={{ fontSize: 19, lineHeight: 1.5, color: SOFT, margin: 0, overflow: "hidden" }}>{card.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
      <Vignette strength={0.42} />
      <Grain opacity={0.045} />
    </AbsoluteFill>
  );
};
