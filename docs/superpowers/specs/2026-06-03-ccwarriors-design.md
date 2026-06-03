# CCWarriors — Design Spec

**Date:** 2026-06-03
**Status:** Draft for review
**Domain:** ccwarriors.xyz
**Display name:** Claude Warriors (wordmark `CCWARRIORS`)

## 1. Overview

CCWarriors is a live, social leaderboard of Claude Code spend. Developers run one
command in their terminal, sign in with GitHub, and their estimated Claude Code
cost (computed by the existing `ccusage` tool) is published to a public ranking.
Each warrior gets a collectible, shareable card (one of fifteen muted, anime-nature
scenes) showing their rank, tier, and burn. The board updates in real time as
people sync, with rows sliding as ranks change.

The vibe: developer/AI-native, premium, restrained. Dark and light themes, sharp
corners, clean typography, with the pixel Clawd mascot (armed as a warrior) as the
one playful signature. Explicitly **not** crypto-coded.

## 2. Goals & non-goals

**Goals**
- One-command, near-one-click enlistment from the terminal.
- A live leaderboard (30-day and all-time) that visibly updates.
- A beautiful, shareable collectible card to drive organic X sharing.
- Everything TypeScript.

**Non-goals**
- We do not recompute cost ourselves — `ccusage` is the trusted source.
- No bulletproof anti-cheat (fun project; light deterrents only).
- No always-on heavyweight streaming daemon (a lightweight opt-in scheduled sync
  is enough; ccusage numbers move slowly).
- No paid X API usage (sign-in is GitHub; X is only a share target).

## 3. Core user flows

### 3.1 Enlist (CLI)
1. User runs `npx claude-warriors`.
2. CLI opens the browser to a GitHub OAuth page; user authorizes.
3. Backend issues a CLI token; CLI captures it on a localhost loopback redirect and
   stores it in `~/.claude-warriors/config.json`.
4. CLI runs `ccusage` under the hood to read 30-day and all-time cost, then
   `POST /ingest` with the token.
5. CLI prints the user's rank and a link to `ccwarriors.xyz/u/<github_login>`.
6. CLI offers (opt-in) to install a lightweight scheduled sync (launchd on macOS,
   cron on Linux, Scheduled Task on Windows) that re-runs every few hours.

### 3.2 View the leaderboard (web)
- Single page. First fold: headline ("Token burn rate, ranked."), one-line
  subheading, and the `$ npx claude-warriors` command with a Copy button.
- Below: the live leaderboard (toggle 30 Days / All Time) on the left, and the
  signed-in user's card on the right.
- Top community stats (warriors enlisted, total burned) count up on load.
- A broadcast marquee scrolls recent events ("X burned $Y this month", new tiers,
  rank overtakes, card pulls).

### 3.3 Share (web)
- The user's card has Share on X and Download buttons.
- `/u/:login` is a permalink whose OpenGraph image is the rendered card PNG, so the
  link unfurls richly on X. Share on X opens an `x.com/intent/tweet` prefill.

## 4. Architecture

```
 CLI (npx claude-warriors)
   │  runs ccusage → {cost30d, costAllTime}
   │  GitHub OAuth (loopback) → CLI token
   ▼
 POST /ingest ───────────────► Backend (Railway, Hono + ws)
                                  │  validate token, persist snapshot (Postgres)
                                  │  update in-memory top-N (30d + all-time)
                                  │  debounce ~1s
                                  ▼
                          WebSocket broadcast ──► all browsers (live reorder)

 Browser (Vite + React) ── GET /u/:login, /og/:login.png (card PNG via resvg)
```

Three deployable units, one repo (monorepo: `packages/cli`, `apps/server`,
`apps/web`).

## 5. Tech stack

- **Language:** TypeScript everywhere.
- **CLI:** Node, `commander` + `@clack/prompts`, spawns/imports `ccusage`,
  loopback OAuth via a short-lived local HTTP server, config in `~/.claude-warriors/`.
- **Backend:** Hono (HTTP) + `ws` (WebSocket) on Railway; Postgres (Railway Postgres)
  via `drizzle-orm`; card rasterization via `@resvg/resvg-js`.
- **Frontend:** Vite + React + TypeScript + Tailwind CSS + `motion` (Framer Motion);
  Magic UI / Aceternity components copied in (marquee, number ticker, border-beam).
- **Hosting:** All on Railway (the user's paid plan). Web can be a Railway static
  service or served by the backend.

## 6. Data model (Postgres)

```
users
  id              uuid pk
  github_id       text unique
  github_login    text            -- permalink + display
  avatar_url      text            -- GitHub DP
  x_handle        text null       -- optional, for share card
  cli_token_hash  text            -- authenticates ingestion
  card_scene      text            -- assigned scene key (see §11)
  cost_30d        numeric         -- current denormalized values for fast reads
  cost_all_time   numeric
  tier            text            -- derived, cached
  last_synced_at  timestamptz
  created_at      timestamptz

snapshots          -- append-only history (trends + light audit)
  id              uuid pk
  user_id         uuid fk
  cost_30d        numeric
  cost_all_time   numeric
  ccusage_version text
  captured_at     timestamptz
```

## 7. CLI design

- **Command:** `npx claude-warriors` (default = enlist + sync). Subcommands:
  `sync` (re-push), `whoami`, `logout`, `sync --install` / `--uninstall` (scheduled job).
- **ccusage integration:** Bundle `ccusage` as a dependency. Read the 30-day window
  via its daily breakdown filtered to the trailing 30 days, and the all-time total.
  Extract `totalCost`. We never compute cost ourselves. If the programmatic API is
  unavailable, spawn `npx ccusage --json` and parse.
- **Auth (loopback OAuth):** CLI starts a local server on a random port, opens
  `ccwarriors.xyz/cli/auth?port=...`, user signs in with GitHub, backend redirects to
  `http://127.0.0.1:<port>/callback?token=...`. CLI stores the token.
- **Scheduled sync (opt-in):** launchd plist (macOS), cron entry (Linux), Scheduled
  Task (Windows). Default cadence every 6 hours. Clearly disclosed; easy to remove.
- **Privacy:** Only aggregate cost numbers + GitHub identity are sent. No code, no
  prompts, no per-project data.

## 8. Backend design

- **`POST /ingest`** — auth by CLI token (hash compare). Upsert user, append
  snapshot, recompute tier, update in-memory leaderboards, schedule a debounced
  broadcast. Rate-limited (≈1 accepted update / few minutes per user). Sanity cap
  flags/hides absurd values.
- **GitHub OAuth** — `/cli/auth` (loopback flow for CLI) and `/auth/github` (web
  sign-in to highlight your row + show your card). Implemented directly (no NextAuth).
- **WebSocket** — backend holds the sorted top-N (≈100) for both boards in memory.
  On change, debounce ~1s and broadcast the current top-N + community totals. On
  connect, send a full snapshot; thereafter send updates.
- **Card image** — `GET /og/:login.png` composes the user's card as a single SVG
  (assigned scene + embedded base64 avatar + text), rasterized to PNG with
  `@resvg/resvg-js`. Cached and invalidated on sync. Used for OG unfurls + download.
- **Permalink data** — `GET /u/:login` (SSR or static + meta) with OG tags pointing
  at `/og/:login.png`.

## 9. Live leaderboard + motion

- **Transport:** WebSocket push (no client polling of the DB).
- **Reorder animation:** Each row is `<motion.div layout key={userId}>`. New socket
  order → React state update → Framer Motion `layout` animates each row sliding to
  its new position (FLIP). `<AnimatePresence>` animates entrants/leavers.
- **Value animation:** `$` amounts animate via a number ticker on change; the orange
  ▲ delta flashes on a climb.
- **Performance:** Animate only the visible top ~20–30 rows; debounce broadcasts;
  stable `userId` keys.

## 10. Frontend design

- **Pages:** `/` (leaderboard + your card + enlist), `/u/:login` (a warrior's card
  permalink, shareable).
- **Components:** Header (logo, community number-tickers, theme toggle), broadcast
  Marquee, Hero (headline + subheading + copyable install command), Leaderboard
  (segmented 30d/all-time toggle, animated rows with rank, grayscale avatar, handle,
  tier, sparkline trend, $ + delta), CollectibleCard, Share/Download actions.
- **Theming:** Light (default) and dark, via CSS variables / `data-theme`. The
  collectible card is always dark in both themes (premium object).
- **Borrowed effects:** Marquee, Number Ticker, Border Beam (subtle), faint Retro
  Grid background. Restrained — no tilt/holo/flashy motion on the card.

## 11. Collectible card system

- **Set:** "Series 01 · Way of the Quiet Warrior" — 15 muted, desaturated
  anime-nature scenes spanning different hours (night, dawn, dusk, overcast): misty
  Fuji (night + dawn), the great wave, bonsai, cherry blossoms, temple/pagoda, lone
  monk on a misty path, torii in water, cranes over the moon, plus koi pond, pine
  cliff, waterfall, lantern path, snowy gate, full-moon reeds.
- **Art tech:** Scenes are hand-built **SVG** (lightweight, crisp, theme-stable) —
  no AI image generation required at runtime. (Optional future upgrade: pre-generate
  richer raster art per scene.)
- **Assignment:** A scene is assigned at enlistment and stored on the user.
  **Higher tiers pull from a rarer scene pool** (Diamond/Netherite get prestige
  scenes); lower tiers pull from the common pool. Re-rolls not allowed (your scene
  is your identity). The card's serial reflects scene rarity (`No. NNN/15`).
- **Composition (always):** CCWARRIORS logo + wordmark (top-left), rank (top-right),
  the scene with the user's **GitHub DP as the centered hero portrait** (bronze
  ring, lightly desaturated), name + @handle, tier, the burn number (30D) + all-time,
  `ccwarriors.xyz`, serial.
- **Output:** Rendered to PNG server-side (resvg) for OG unfurl + Download; shown
  live in-page for the signed-in user.

## 12. Tiers

Minecraft-material ladder, mapped to all-time (or 30-day, per active board) burn.
Thresholds are placeholders to be tuned with real data:

| Tier | Burn (USD) |
|------|------------|
| Stone | 0–100 |
| Iron | 100–500 |
| Gold | 500–2,000 |
| Diamond | 2,000–6,000 |
| Netherite | 6,000+ |

## 13. Branding & design language

- **Mascot:** Clawd (the official Claude Code pixel mascot) rendered faithfully
  (flat orange, hollow negative-space eyes, four legs, two side nubs) and armed —
  sword in the right nub, spark shield in the left. This is the logo. On cards he
  appears only as the small logo mark; the scene's hero is the user's DP.
- **Color:** Orange is the only chromatic accent on the site (light: `#C2683E`,
  dark: `#CC785C`); bronze for secondary accent. Cards use a muted, desaturated
  palette; the only warm note is the small orange Clawd logo.
- **Type:** Geist (UI/body), Geist Mono (all numbers, tabular). No pixel font in
  text — the pixel character lives only in the mascot. Readable and simple.
- **Copy voice:** short, human, developer-native. No hyphens/dashes. No crypto
  framing. Footer signature: `Built with ❤(pixel) by Manu` linking to
  https://x.com/distroinfinity (underlined).

## 14. Anti-cheat / trust

Trust with light deterrents: per-user ingest rate limiting, a sanity cap that
flags/hides implausible values, and retained `snapshots` history (with
`ccusage_version`) so an audit is possible. Accepted that a determined faker can
cheat — it is a bragging board, not money.

## 15. Deployment

- Railway services: `server` (Hono + ws), `web` (static Vite build or served by
  server), Railway Postgres. Environment: GitHub OAuth client id/secret, DB url,
  base URL. The CLI is published to npm.

## 16. Open items (tunable later)

- Exact tier thresholds (set after observing real data).
- Final scene lineup for the 15 (6 prototyped; 9 more to design).
- Scheduled-sync cadence default (proposed 6h).
- Common vs rare scene split across tiers.

## 17. Out of scope (future)

- Teams/orgs leaderboards, per-model breakdowns, historical charts, badges/achievements,
  AI-generated raster card art, anti-cheat verification by re-computation.
