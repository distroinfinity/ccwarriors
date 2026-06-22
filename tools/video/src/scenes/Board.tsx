import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT, formatUsd } from "../lib/brand";
import { DATA } from "../lib/data";
import { CROSSINGS, HERO, heroValue, WINDOW } from "../lib/hero";
import { Row, ROW_GAP, ROW_H } from "../lib/Row";
import { Camera, EmberField, Grain, GridFloor, Vignette, shake } from "../lib/fx";

const BOARD_W = 1290;
const SLOT = ROW_H + ROW_GAP;
const BOARD_TOP = 150; // marginTop of the board block
const HEADER_H = 72; // header row + gap before first row
const slotY = (slot: number) => slot * SLOT;
// absolute screen-space y of a row's center (before camera transforms)
const rowCenterY = (slot: number) => BOARD_TOP + HEADER_H + slotY(slot) + ROW_H / 2;

/**
 * One continuous shot, 20s: the top 10 cascade in and the camera cranes down
 * the board (groove bars); during the breakdown it settles on distroinfinity,
 * the row simmers, and on DROP2 it ignites and climbs to #3 — the same board,
 * no cut.
 */
export const Board: React.FC = () => {
  const frame = useCurrentFrame();
  const v = heroValue(frame);

  const baseOrder = WINDOW.slice().sort((a, b) => b.cost30d - a.cost30d);
  const heroBaseSlot = baseOrder.findIndex((e) => e.id === HERO.id);
  const passed = CROSSINGS.filter((f) => frame >= f).length;
  const burning = frame >= 348;
  const simmering = frame >= 300;

  // camera: crane down the board, settle on the hero, ride the climb back up
  const heroFocusY = rowCenterY(heroBaseSlot); // ≈ hero row pre-climb
  const tilt = interpolate(frame, [0, 120, 330, 600], [22, 10, 7, 4], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: "clamp",
  });
  const dolly = interpolate(
    frame,
    [30, 150, 230, 320, 360, 530, 600],
    [0, -260, -260, 540 - heroFocusY, 540 - heroFocusY, 540 - rowCenterY(heroBaseSlot - 4) - 40, 540 - rowCenterY(heroBaseSlot - 4) - 40],
    {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  const camScale = interpolate(frame, [0, 150, 250, 340, 540, 600], [1.05, 1.0, 1.0, 1.17, 1.17, 1.13], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateRight: "clamp",
  });

  // overtake shake, decaying after each pass
  let amp = 0;
  for (const f of CROSSINGS) {
    if (frame >= f) amp += 7 * Math.exp(-(frame - f) / 7);
  }
  const sh = shake(frame, amp);

  const total = DATA.totalBurned30d + frame * 0.43 + (v - HERO.cost30d);
  const sheenX = interpolate(frame, [30, 210], [-700, BOARD_W + 700]);
  const burnLineIn = interpolate(frame, [244, 264], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GridFloor speed={0.4} />
      <EmberField count={burning ? 40 : 18} intensity={burning ? 1 : 0.6} />
      <Camera scale={camScale} x={sh.x} y={dolly + sh.y}>
        <AbsoluteFill style={{ alignItems: "center", perspective: 1500 }}>
          <div
            style={{
              width: BOARD_W,
              marginTop: BOARD_TOP,
              transform: `rotateX(${tilt}deg)`,
              transformStyle: "preserve-3d",
              transformOrigin: "50% 20%",
              position: "relative",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                height: HEADER_H - 26,
                marginBottom: 26,
                opacity: interpolate(frame, [0, 16], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
                transform: "translateZ(30px)",
              }}
            >
              <div
                style={{
                  fontFamily: FONT.body,
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: "0.18em",
                  color: C.ink,
                }}
              >
                THE LEADERBOARD
              </div>
              <div
                style={{
                  fontFamily: FONT.mono,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 21,
                  color: C.or,
                  fontWeight: 700,
                }}
              >
                {formatUsd(total)} · 30d
              </div>
            </div>
            <div
              style={{
                position: "relative",
                height: WINDOW.length * SLOT,
                transformStyle: "preserve-3d",
              }}
            >
              {WINDOW.map((e, i) => {
                const isHero = e.id === HERO.id;
                let y: number;
                let rank: number;
                if (isHero) {
                  let climbed = 0;
                  for (const f of CROSSINGS) {
                    climbed += interpolate(frame, [f - 6, f + 8], [0, 1], {
                      easing: Easing.inOut(Easing.cubic),
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    });
                  }
                  y = slotY(heroBaseSlot) - climbed * SLOT;
                  rank = 1 + heroBaseSlot - passed;
                } else {
                  const aboveAsc = WINDOW.filter(
                    (x) => x.id !== HERO.id && x.cost30d > HERO.cost30d
                  )
                    .sort((a, b) => a.cost30d - b.cost30d)
                    .slice(0, CROSSINGS.length);
                  const crossIdx = aboveAsc.findIndex((x) => x.id === e.id);
                  const myCross = crossIdx >= 0 ? CROSSINGS[crossIdx] : undefined;
                  const baseSlot = baseOrder.findIndex((x) => x.id === e.id);
                  y =
                    myCross === undefined
                      ? slotY(baseSlot)
                      : interpolate(frame, [myCross - 6, myCross + 10], [slotY(baseSlot), slotY(baseSlot + 1)], {
                          easing: Easing.inOut(Easing.cubic),
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                        });
                  rank = 1 + baseSlot + (myCross !== undefined && frame >= myCross ? 1 : 0);
                }
                return (
                  <div
                    key={e.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${y}px) translateZ(${isHero && burning ? 34 : rank <= 3 && !burning ? 26 : 0}px)`,
                      zIndex: isHero ? 5 : 1,
                      transformStyle: "preserve-3d",
                    }}
                  >
                    <Row
                      e={e}
                      rank={rank}
                      enter={10 + i * 5}
                      frame={frame}
                      top3={rank <= 3 && !isHero}
                      hot={isHero && (burning || simmering)}
                      value={isHero ? v : undefined}
                      delta={isHero && passed > 0 ? passed : undefined}
                      flyIn3d
                    />
                  </div>
                );
              })}
            </div>
            {/* specular sweep across the plane during the reveal */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(115deg, transparent 0%, rgba(255,255,255,.07) 46%, rgba(255,255,255,.12) 50%, rgba(255,255,255,.07) 54%, transparent 100%)`,
                backgroundSize: "600px 100%",
                backgroundRepeat: "no-repeat",
                backgroundPosition: `${sheenX}px 0`,
                pointerEvents: "none",
                mixBlendMode: "screen",
              }}
            />
          </div>
        </AbsoluteFill>
      </Camera>
      {/* HUD: brand anchor + the live-burn narrative line (fixed, no camera) */}
      <div
        style={{
          position: "absolute",
          top: 44,
          left: 60,
          fontFamily: FONT.pixel,
          fontSize: 26,
          letterSpacing: "0.08em",
          color: C.muted,
          opacity: 0.9,
        }}
      >
        ccwarriors
      </div>
      <div
        style={{
          position: "absolute",
          top: 48,
          right: 60,
          display: "flex",
          alignItems: "center",
          gap: 9,
          fontFamily: FONT.mono,
          fontSize: 15,
          letterSpacing: "0.2em",
          color: C.muted,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: C.or,
            boxShadow: `0 0 ${6 + Math.sin(frame / 6) * 4}px ${C.or}`,
          }}
        />
        LIVE
      </div>
      <div
        style={{
          position: "absolute",
          top: 88,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: burnLineIn,
          transform: `translateY(${(1 - burnLineIn) * -14}px)`,
        }}
      >
        {/* live-event toast, floating above the board */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontFamily: FONT.mono,
            fontSize: 20,
            color: C.muted,
            background: "rgba(13,13,15,.92)",
            border: `1px solid ${C.ember}66`,
            boxShadow: `0 14px 44px rgba(0,0,0,.6), 0 0 30px ${C.ember}22`,
            padding: "12px 26px",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: C.ember,
              boxShadow: `0 0 ${8 + Math.sin(frame / 4) * 5}px ${C.ember}`,
            }}
          />
          <span style={{ color: C.ink, fontWeight: 700 }}>{HERO.login}</span> is burning tokens
          right now
        </div>
      </div>
      <Vignette />
      <Grain />
    </AbsoluteFill>
  );
};
