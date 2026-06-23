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

## Profile teaser (`ProfileLaunch`)

A second ~40s composition announcing the **profile page** — the personal
counterpart to the leaderboard. It re-uses one warrior's **real profile data**
(default `distroinfinity`, snapshotted from `/profile/<login>`) and the same
brand/fx/Clawd/grade language, scored with its own re-timed EDM track. It's a
teaser: it shows the masthead, the Craft Score, and the breadth of stats without
explaining any single one (each stat gets its own future video).

```bash
cd tools/video
pnpm fetch-data                   # also needed: ProfileLaunch's bundle imports the leaderboard scenes
pnpm fetch-profile                # snapshot one profile → data/profile.json + avatar
                                  #   pnpm fetch-profile <login> for anyone else
pnpm sfx                          # shared sound-design stems
pnpm music:profile                # synthesize the profile track → public/sfx/track-profile.wav
pnpm studio                       # preview the ProfileLaunch composition
pnpm render:profile               # → out/profile-raw.mp4
```

Finishing pass — the "finished release" color grade + loudness + faststart:

```bash
ffmpeg -y -i out/profile-raw.mp4 \
  -vf "eq=contrast=1.08:saturation=1.10:gamma=1.01:brightness=0.005,curves=r='0/0.015 0.5/0.53 1/1':b='0/0 0.5/0.47 1/0.96',unsharp=5:5:0.40:5:5:0.0,format=yuv420p" \
  -c:v libx264 -crf 15 -preset slow \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k \
  -movflags +faststart out/ccwarriors-profile-final.mp4
```

| Scene (`src/scenes/profile/`) | Beat |
|---|---|
| `ColdOpenP` | terminal pivots off the board: "the board ranks your burn." → "but who are you?" |
| `Masthead` | editorial identity card: avatar, name, rank · since · all-time (DROP1) |
| `CraftScore` | the headline number counts up · tier · top signal · pillar bars (DROP2 hero) |
| `DepthFlurry` | three beats whoosh past — By the Numbers, the Rhythm heatmap, the story deck |
| `CTAProfile` | Clawd assembles · "More than a rank." · ccwarriors.xyz/<login> |

Cuts are bar-aligned (cold 0–4s · masthead 4–12s · craft 12–24s · flurry 24–32s
· CTA 32–40s) so the drops land on the masthead and the Craft reveal. The grade
is applied in two places: a `GradeOverlay` layer in Remotion (warm lift, cool
roll-off, center bloom) plus the ffmpeg curve/contrast pass above.

## "The New Signal" (`Signal`)

A ~56s **editorial digital-paper / typewriter** film announcing the profile page —
light mode, **flat DOM** (no 3D), code used *minimally*. Built beat-by-beat as one
typeset document; real `distroinfinity` data; a **female voiceover** (OpenAI
`gpt-4o-mini-tts`, voice `coral`) placed as **per-beat segments** that sync to the
cuts and **duck** a modern electronic bed.

```bash
cd tools/video
pnpm fetch-data            # leaderboard snapshot (the live-board beat)
pnpm fetch-profile         # distroinfinity profile snapshot + avatar
pnpm vo coral              # voiceover segments (OpenAI; needs OPENAI_API_KEY in env or apps/server/.env)
pnpm vo:enhance            # VO clarity pass (presence EQ + compression + 48kHz)
pnpm sfx:signal            # subtle typewriter key-click + strike SFX
pnpm music:signal          # modern electronic bed
pnpm studio                # preview the Signal composition
pnpm render:signal         # landscape → out/signal-raw.mp4  (4K, --scale=2, audio baked in)
pnpm render:signal:vertical# 9:16 reels → out/signal-vertical-raw.mp4 (1080×1920)
```

The audio (`SignalScore.tsx`) is shared by both compositions: the female VO
segments duck the music, plus sparse typewriter clicks during typing and a swipe
on each cross-out. The 9:16 cut reuses the same beats — layout adapts via
`useVertical()` — so it stays perfectly in sync with the landscape master.

Finishing (light grade + loudness + faststart):

```bash
ffmpeg -y -i out/signal-raw.mp4 \
  -vf "eq=contrast=1.05:saturation=1.07,unsharp=5:5:0.30:5:5:0.0,format=yuv420p" \
  -c:v libx264 -crf 16 -preset medium \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k \
  -movflags +faststart out/ccwarriors-signal-final.mp4
```

| Beat (`src/signal/beats/`) | Content |
|---|---|
| `ColdOpenBeat` | `résumé / stars / years` typed then struck out (the only "code-ish" moment besides the next) |
| `HeroDataBeat` | one syntax-highlighted `const distroinfinity = {…}` block — the single signature code beat |
| `SignalEmphasisBeat` | `$0.01` per surviving line, big and accessible |
| `LeaderboardBeat` | live board, real burners, $ amounts ticking |
| `ProfileRevealBeat` | the real profile page first-fold (masthead · Craft · By the Numbers) |
| `CTABeat` | tagline + `ccwarriors.xyz` |

Shared engine in `src/signal/doc/` (`Line`, `DocFrame`, `Paper`, `BigStat`); audio in
`src/signal/SignalScore.tsx` (per-beat VO + ducked bed + typewriter SFX). Run the same
grade pass on both raws → **`ccwarriors-signal-final.mp4`** (3840×2160) and
**`ccwarriors-signal-vertical.mp4`** (1080×1920), both ~56s · H.264/AAC · −14 LUFS.
Tunables: beat timing in `Signal.tsx`, duck/SFX in `SignalScore.tsx`, script/voice in
`scripts/vo.mjs`.

## Runway (optional)

`scripts/runway-gen.mjs` generates cinematic b-roll via the Runway dev API
(reads `RUNWAY_API_KEY` from `apps/server/.env`, credit-capped). The current cut
uses none of it, but the tool is kept for future cinematic inserts; output lands
in the gitignored `public/runway/`.
