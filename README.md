<p align="center">
  <img src="assets/og-banner-1200x630.png" alt="CCWarriors — token burn rate, ranked" width="720" />
</p>

# ccwarriors

**Token burn rate, ranked.** A live leaderboard of AI coding spend — [Claude Code](https://claude.ai/code),
Codex, Gemini CLI, Copilot, OpenCode, Amp: 15 agents tracked, plus an **Other** bucket so
anything else [ccusage](https://github.com/ryoppippi/ccusage) can read still counts.
See who's burning the most tokens, claim your rank, flex on the timeline.

**Live:** [ccwarriors.xyz](https://ccwarriors.xyz) · first org board: [ns.ccwarriors.xyz](https://ns.ccwarriors.xyz) (Network School)

## Enlist (one command)

```bash
curl -fsSL https://ccwarriors.xyz/install.sh | bash
```

That's it. GitHub login opens in your browser, your [ccusage](https://github.com/ryoppippi/ccusage)
usage is read locally, priced server-side, and you're on the board. Re-sync anytime with `ccwarriors`.

By default the CLI uploads raw token counts per tool, per day, per model so the
server can price them itself. No code, file contents, file paths, repo names,
commit messages, or SHAs leave your machine. Optional deep-mode profile
insights send extra counts and hashed Git outcomes only after explicit consent;
story unlock adds redacted prompt extracts and transient transcripts.

## README badge

Put your live rank in your GitHub profile README — replace `YOUR_LOGIN`:

```md
[![CCWarriors](https://api.ccwarriors.xyz/badge/YOUR_LOGIN.svg)](https://ccwarriors.xyz/YOUR_LOGIN?ref=badge)
```

Rank, tier, and 30-day burn, refreshed hourly. Or hit **Copy README badge**
on your card at [ccwarriors.xyz](https://ccwarriors.xyz).

## How it works

```
ccwarriors (CLI)                         api.ccwarriors.xyz                ccwarriors.xyz
─────────────────                        ──────────────────               ───────────────
ccusage raw token days ──► POST /ingest  Hono + Postgres                  React + WebSocket
GitHub loopback OAuth                    pricing, ranks, profiles    ──►  live board, profiles,
optional deep insights                   org verify, badges               cards, org boards
```

- **CLI** (`packages/cli`) — zero-dependency single-file Node bundle. GitHub
  loopback OAuth, reads raw usage via `ccusage`, posts to the API, and can run
  autosync plus optional deep profile insights. Distributed by the site itself
  (`/install.sh` + `/cli.js`) — every deploy is a CLI release.
- **API** (`apps/server`) — Hono + `ws` on Railway, Postgres via Drizzle.
  Token-authenticated ingest, server-authoritative pricing, plausibility gates,
  profiles, org verification, badges, sponsor flows, and debounced board broadcasts.
- **Web** (`apps/web`) — Vite + React on Vercel. Light/dark, Framer Motion
  leaderboard, collectible warrior cards, profile pages, story pages, org board
  skins, and pixel Clawd branding (every UI glyph is hand-drawn pixel art).

## Org boards

Communities get their own co-branded board on a subdomain — same warriors,
same data, scoped view. First up: **Network School** at
[ns.ccwarriors.xyz](https://ns.ccwarriors.xyz).

- **Verify with Discord** — members link Discord once; the server checks the
  org's guild and they're on the org board. No bot, no org-admin setup.
- **Still on the global board** — org members keep their global rank and wear
  a small org pill there.
- **One codebase** — an org is a registry entry (slug, accent, theme, guild
  id) + DNS. No forks, every fix ships to every board.

Want one for your org?
[Open an org board request](https://github.com/distroinfinity/ccwarriors/issues/new?template=org-board-request.yml).

## Sponsors

CCWarriors is free and open source — sponsorships keep the servers burning.

<!-- GitHub Sponsors pending KYC — re-add when live (issue #9):
- **[GitHub Sponsors](https://github.com/sponsors/distroinfinity)** — one-time or monthly -->
- **UPI / card** — [ccwarriors.xyz/#sponsor](https://ccwarriors.xyz/#sponsor) (Razorpay)
- **Crypto** — ETH and Solana addresses on [ccwarriors.xyz/#sponsor](https://ccwarriors.xyz/#sponsor)

Tiers run Wood 🪵 → Netherite 🔥, just like the board.

<p align="center">
  <a href="https://ccwarriors.xyz/#sponsor">
    <img src="./sponsors.svg" alt="Sponsors" />
  </a>
</p>

## Local development

```bash
pnpm install

# backend — in-memory Postgres (PGlite) + 15 seeded demo warriors + simulated
# live spend, on :8787 (demo data is local-only, never in production)
pnpm --filter server dev

# frontend — :5173
pnpm --filter web dev
```

Node ≥ 20 and pnpm required. See the
[deployment guide](docs/engineering/operations/deployment-and-environment.md) for
production setup (Railway, Vercel, DNS, GitHub OAuth app) and
`apps/server/.env.example` for configuration.

## Repo layout

```
apps/server     Hono API + WebSocket + Drizzle/Postgres
apps/web        Vite + React leaderboard (serves the CLI installer)
packages/cli    the ccwarriors CLI
scripts/        zero-dep PNG generators (logo, OG banner, favicon)
railway.json    backend deploy config-as-code (build, start, auto-migrate)
vercel.json     frontend deploy config-as-code (build, OG bot rewrites)
docs/public     public-facing product docs (GitBook set)
docs/engineering internal architecture + operations docs (GitBook set)
```

---

Built with ❤️ by [Manu](https://x.com/distroinfinity)
