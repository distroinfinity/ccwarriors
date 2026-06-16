import React from "react";
import { Img, spring, staticFile, useVideoConfig } from "remotion";
import { C, FONT, formatUsd, sparkBars, tierLabel } from "./brand";
import { Warrior } from "./data";

export const ROW_H = 84;
export const ROW_GAP = 10;

/**
 * One leaderboard row used by the Board scene.
 * `hot` puts the row in its ember state (the live-burn highlight);
 * `value`/`delta` override the displayed amount and show the rank-up badge.
 */
export const Row: React.FC<{
  e: Warrior;
  rank: number;
  enter: number;
  frame: number;
  top3?: boolean;
  hot?: boolean;
  value?: number;
  delta?: number;
  flyIn3d?: boolean;
}> = ({ e, rank, enter, frame, top3 = rank <= 3, hot = false, value, delta, flyIn3d = false }) => {
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - enter, fps, config: { damping: 16, mass: 0.6 } });
  if (s < 0.01) return null;
  const drift = frame > enter + 12 ? (frame - enter - 12) * 0.11 * (1 / rank) : 0;
  const amount = value ?? e.cost30d + drift;
  const bars = sparkBars(e.id);
  const accent = hot ? C.ember : C.or;
  const enter3d = flyIn3d
    ? `rotateX(${(1 - s) * 38}deg) translateZ(${(1 - s) * -180}px) `
    : "";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "70px 64px 1fr 220px 190px 240px",
        alignItems: "center",
        height: ROW_H,
        padding: "0 30px",
        background: hot
          ? `linear-gradient(90deg, ${C.ember}33, ${C.panel} 60%)`
          : top3
            ? `linear-gradient(90deg, ${C.or}1c, ${C.panel} 55%)`
            : C.panel,
        border: `1px solid ${hot ? `${C.ember}99` : top3 ? `${C.or}55` : C.line}`,
        borderTop: `1px solid ${hot ? `${C.ember}cc` : "rgba(255,255,255,.14)"}`,
        opacity: s,
        transform: `${enter3d}translateY(${(1 - s) * 46}px) scale(${0.97 + s * 0.03 + (hot ? 0.015 : 0)})`,
        transformStyle: "preserve-3d",
        filter: `blur(${(1 - s) * 5}px)`,
        boxShadow: hot
          ? `0 26px 60px rgba(0,0,0,.65), 0 0 56px ${C.ember}44`
          : top3
            ? `0 22px 50px rgba(0,0,0,.6), 0 0 36px ${C.or}26`
            : `0 14px 34px rgba(0,0,0,.5)`,
      }}
    >
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 26,
          fontWeight: 700,
          color: hot || top3 ? accent : C.muted,
        }}
      >
        {rank}
      </div>
      <div>
        {e.avatar ? (
          <Img
            src={staticFile(e.avatar)}
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              border: `1px solid ${hot ? C.ember : C.line}`,
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: "#33363b",
              color: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT.mono,
            }}
          >
            {e.login[0]?.toUpperCase()}
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: FONT.body,
          fontSize: 25,
          fontWeight: 600,
          color: C.ink,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        {e.login}
        {delta !== undefined && delta > 0 && (
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: 17,
              fontWeight: 700,
              color: C.up,
              background: "rgba(63,185,122,.14)",
              border: "1px solid rgba(63,185,122,.4)",
              padding: "2px 10px",
            }}
          >
            ▲{delta}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: `Geist, 'Apple Symbols', 'Segoe UI Symbol', sans-serif`,
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: C.bronze,
        }}
      >
        {tierLabel(e.tier)}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 30 }}>
        {bars.map((b, i) => {
          const bs = spring({ frame: frame - enter - 6 - i * 1.5, fps, config: { damping: 14 } });
          return (
            <div
              key={i}
              style={{
                width: 9,
                height: Math.max(3, (b / 8) * 30 * bs),
                background: i === bars.length - 1 ? accent : "#454a51",
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          fontFamily: FONT.mono,
          fontVariantNumeric: "tabular-nums",
          fontSize: 26,
          fontWeight: 700,
          color: hot ? C.ember : C.ink,
          textAlign: "right",
          textShadow: hot ? `0 0 22px ${C.ember}66` : "none",
        }}
      >
        {formatUsd(amount)}
      </div>
    </div>
  );
};
