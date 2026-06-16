import { Easing } from "remotion";
import { DATA } from "./data";

// The hero moment happens INSIDE the main board scene: the top 10 cascade in,
// the camera settles on distroinfinity (rank 7), and on DROP2 it climbs to #3.
export const WINDOW_START = 0;
export const WINDOW_SIZE = 10;
export const HERO_INDEX = 6; // distroinfinity, rank 7

export const HERO = DATA.entries[HERO_INDEX]!;
export const WINDOW = DATA.entries.slice(WINDOW_START, WINDOW_START + WINDOW_SIZE);

// board-scene local frames (scene = 600f spanning 12s-32s):
// 0-240 board display · 240 breakdown (burning line) · 300-360 simmer ·
// 360 DROP2 climb start · 530 settled at #3
const SIMMER_START = 300;
const CLIMB_START = 360;
const CLIMB_END = 530;
const SIMMER_GAIN = 60;
// just above the current #3 (aster2709) — final rank 3, below the top two
const TARGET_VALUE = Math.max(...WINDOW.slice(2).map((e) => e.cost30d)) + 310;

export function heroValue(frame: number): number {
  if (frame <= SIMMER_START) return HERO.cost30d;
  if (frame <= CLIMB_START) {
    const p = (frame - SIMMER_START) / (CLIMB_START - SIMMER_START);
    return HERO.cost30d + SIMMER_GAIN * Easing.inOut(Easing.quad)(p);
  }
  const p = Math.min(1, (frame - CLIMB_START) / (CLIMB_END - CLIMB_START));
  const base = HERO.cost30d + SIMMER_GAIN;
  return base + (TARGET_VALUE - base) * Easing.inOut(Easing.cubic)(p);
}

// Frames at which the hero passes each competitor above it (ascending order)
export const CROSSINGS: number[] = (() => {
  const above = WINDOW.filter((e) => e.id !== HERO.id && e.cost30d > HERO.cost30d)
    .filter((e) => heroValue(CLIMB_END + 100) > e.cost30d)
    .map((e) => e.cost30d)
    .sort((a, b) => a - b);
  const frames: number[] = [];
  for (const target of above) {
    for (let f = SIMMER_START; f <= CLIMB_END; f++) {
      if (heroValue(f) > target) {
        frames.push(f);
        break;
      }
    }
  }
  return frames;
})();
