import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, formatUsd } from "../../lib/brand";
import { ClawdAssemble } from "../../lib/Clawd";
import { EmberField, Flash, Grain, GridFloor, Vignette } from "../../lib/fx";
import { PROFILE } from "../../lib/profileData";

// Scene 2 — identity. The editorial masthead builds: avatar pops, the name
// springs in, the field-report kicker and rank line settle. "This is you."
export const Masthead: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardIn = interpolate(frame, [0, 22], [0.965, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  // scale punch on the drop, then a slow push-in
  const punch = interpolate(frame, [0, 8], [1.04, 1], { easing: Easing.out(Easing.cubic), extrapolateRight: "clamp" });
  const drift = interpolate(frame, [0, 240], [1, 1.028]) * punch;
  const kicker = interpolate(frame, [8, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const avatar = spring({ frame: frame - 12, fps, config: { damping: 14, mass: 0.6 } });
  const name = spring({ frame: frame - 18, fps, config: { damping: 16, mass: 0.7 } });
  const rank = interpolate(frame, [34, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const chromeIn = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const rankBits = [
    PROFILE.rank ? `rank #${PROFILE.rank}` : "unranked",
    PROFILE.sinceYear ? `since ${PROFILE.sinceYear}` : null,
    PROFILE.allTimeUsd > 0 ? `${formatUsd(PROFILE.allTimeUsd)} all-time` : null,
  ].filter(Boolean).join("  ·  ");

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GridFloor speed={0.55} />
      <EmberField count={34} intensity={0.8} />

      {/* page chrome — legion stats, echoing the live header */}
      <div style={{ position: "absolute", top: 46, left: 64, fontFamily: FONT.pixel, fontSize: 28, letterSpacing: "0.08em", color: C.muted, opacity: chromeIn }}>
        ccwarriors
      </div>
      <div style={{ position: "absolute", top: 50, right: 64, display: "flex", gap: 34, fontFamily: FONT.mono, fontSize: 17, letterSpacing: "0.04em", color: C.muted, opacity: chromeIn }}>
        <span><b style={{ color: C.ink }}>{PROFILE.warriors}</b> WARRIORS</span>
        <span><b style={{ color: C.ink }}>{formatUsd(PROFILE.burned30d)}</b> BURNED · 30D</span>
      </div>

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: `scale(${drift})` }}>
        <div
          style={{
            position: "relative",
            width: 1180,
            padding: "58px 66px",
            borderRadius: 18,
            background: "linear-gradient(180deg,#17171a,#121215)",
            border: `1px solid ${C.line}`,
            boxShadow: "0 1px 0 rgba(255,255,255,.04) inset, 0 30px 70px rgba(0,0,0,.5)",
            transform: `scale(${cardIn})`,
          }}
        >
          {/* Clawd mark, top-right corner of the card (fully assembled) */}
          <div style={{ position: "absolute", top: 40, right: 54, opacity: kicker }}>
            <ClawdAssemble startFrame={-60} width={132} />
          </div>

          <div style={{ fontFamily: FONT.mono, fontSize: 21, letterSpacing: "0.2em", color: C.bronze, opacity: kicker }}>
            FIELD REPORT · CCWARRIORS
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 26 }}>
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 6,
                border: `1px solid ${C.line}`,
                overflow: "hidden",
                background: "#23211d",
                opacity: avatar,
                transform: `scale(${0.6 + avatar * 0.4})`,
                flex: "none",
              }}
            >
              {PROFILE.avatar && <Img src={staticFile(PROFILE.avatar)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div
              style={{
                fontFamily: FONT.pixel,
                fontSize: 132,
                lineHeight: 1,
                letterSpacing: "0.03em",
                color: C.ink,
                opacity: name,
                transform: `translateY(${(1 - name) * 26}px)`,
              }}
            >
              {PROFILE.login}
            </div>
          </div>

          <div style={{ marginTop: 22, fontFamily: FONT.mono, fontSize: 25, color: C.muted, opacity: rank }}>
            {rankBits}
          </div>
        </div>
      </AbsoluteFill>

      <Vignette strength={0.5} />
      <Grain opacity={0.05} />
      {/* DROP1 lands with the cut into this scene */}
      <Flash at={0} peak={0.92} />
    </AbsoluteFill>
  );
};
