# ccwarriors launch video

The product-release film for [ccwarriors.xyz](https://ccwarriors.xyz) — a ~43s,
1920×1080 cut focused on **token burn** and the **leaderboard**. Built with
[Remotion](https://remotion.dev); brand palette, fonts, tier glyphs, and the
Clawd mascot are ported from `apps/web` so the video matches the product exactly.

The board uses **real production data** (snapshotted from the live API), and the
soundtrack + sound design are **synthesized from scratch** with ffmpeg — no
licensed assets.

## What's in git vs. local

Committed: all source (`src/`), build scripts (`scripts/`), and the brand fonts
(`public/fonts/`). Everything generated is gitignored and rebuilt by the steps
below — the data snapshot, audio, avatars, and the rendered `out/` video.

## Prerequisites

- Node ≥ 20, pnpm (workspace-managed)
- `ffmpeg` on PATH (audio synthesis + final encode)

## Build

```bash
pnpm install                      # from repo root

cd tools/video
pnpm fetch-data                   # snapshot live leaderboard → data/ + public/avatars/
pnpm sfx                          # synthesize sound-design stems → public/sfx/
node scripts/music.mjs            # synthesize the EDM track → public/sfx/track.wav
pnpm studio                       # preview/iterate in Remotion Studio
pnpm render                       # → out/launch-raw.mp4
```

Finishing pass (loudness-normalize + faststart for social):

```bash
ffmpeg -i out/launch-raw.mp4 -c:v copy \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k \
  -movflags +faststart out/ccwarriors-launch-final.mp4
```

Output is 43s · 1920×1080 · 30fps · H.264/AAC · ~15MB — within X and LinkedIn
limits and designed to read fully muted (autoplay).

## Structure

| Scene (`src/scenes/`) | Beat |
|---|---|
| `ColdOpen` | terminal: "how many tokens are you burning?" |
| `BurnCounter` | live total burned · last 30 days (odometer, beat-synced) |
| `Board` | top-10 leaderboard (3D), then the hero row climbs #7→#3 live |
| `Flurry` | warrior count + every supported agent, one line |
| `CTA` | Clawd assembles · "Token burn rate, ranked." · ccwarriors.xyz |

Shared bits live in `src/lib/` (`brand`, `fx`, `Row`, `Clawd`, `Score`, `Shell`,
`hero`). Music timing is 120 BPM (15 frames/beat) so every cut lands on a bar.

## Runway (optional)

`scripts/runway-gen.mjs` generates cinematic b-roll via the Runway dev API
(reads `RUNWAY_API_KEY` from `apps/server/.env`, credit-capped). The current cut
uses none of it, but the tool is kept for future cinematic inserts; output lands
in the gitignored `public/runway/`.
