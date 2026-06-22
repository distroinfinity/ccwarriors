---
title: Auth, Orgs, Badges, and Sponsors
description: GitHub OAuth, CLI tokens, Discord org verification, badge/OG rendering, Razorpay donations.
---

# Auth, Orgs, Badges, and Sponsors

## GitHub OAuth and the two credentials

One OAuth callback (`/cli/callback`, `routes/auth.ts`) serves both flows, discriminated by state:

- **CLI flow:** `ccwarriors login` starts a loopback HTTP server on a random `127.0.0.1` port and opens `GET /cli/auth?port=<port>&ref=<channel>`. After GitHub authorizes, the callback redirects to `http://127.0.0.1:<port>/callback?token=<plaintext>&login=<login>`. The token is a fresh random hex string (`lib/token.ts`); only its sha256 lands in `users.cli_token_hash`, and **every login rotates it**.
- **Web flow:** `GET /auth/web?org=&ref=` → same callback → signed `ccw_session` cookie (HMAC-SHA256 JWT over `{login, avatarUrl, githubId}`, keyed by the GitHub client secret — `lib/session.ts`), then redirect back to the web (or the org subdomain when `?org=` was set). `GET /me` reads the cookie; `GET /logout` clears it.

At web login the server also persists the user's GitHub access token (`read:user` scope only) for background public-stats reads — blast radius of a leak is rate-limit theft, not data access (`db/schema.ts`). Nulled on a 401.

Classic GitHub OAuth apps allow exactly **one** callback URL, which is why local OAuth testing needs a second app pointed at `http://localhost:8787/cli/callback` (see [Deployment](../operations/deployment-and-environment.md)).

## Orgs (`lib/orgs.ts`, `routes/orgs.ts`)

Orgs live in a code registry, not the DB — `ns: { slug: "ns", name: "Network School", guildEnv: "NS_GUILD_ID" }` (`lib/orgs.ts:14`); only **membership** is data. Verification is one Discord OAuth round-trip:

1. `GET /orgs/:slug/verify/start` (needs a GitHub session) → Discord authorize with `identify guilds` scope; state is a signed JWT `{slug, githubId, nonce}` with a 10-minute expiry.
2. `GET /discord/callback` → check the user's guild list contains the org's guild id (from the env var named by `guildEnv`) → insert `org_members` (unique on user+org) → redirect to the org board.

No bot and no org-admin setup. Org boards are the same leaderboard filtered to members — `GET /leaderboard?org=ns` adds org-scoped `tools` + `byTool` so polling org pages get chip data the global WS would otherwise carry. The org surface mounts only when `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and the GitHub session secret are available; membership succeeds only when the org's `guildEnv` var (for example `NS_GUILD_ID`) resolves to a Discord guild id.

## Badges and OG unfurls

- `GET /badge/:login.svg` (`routes/badge.ts`) renders a self-measuring SVG (`⚔ CCWarriors · login | #rank · tier · $spend 30d`). Unknown **or flagged** logins render the generic `⚔ CCWarriors | enlist →` instead of erroring — GitHub's camo proxy caches responses, and a quarantine must not break READMEs. `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
- `GET /og/u/:login` (`routes/og.ts`) exists because the SPA can't serve meta tags to crawlers. `vercel.json` rewrites `/u/:login` requests from bot user agents (Twitterbot, facebookexternalhit, Slackbot, LinkedInBot, Discordbot, WhatsApp, TelegramBot) to this endpoint; it returns OG/Twitter meta (archetype in the title only if insights are public) plus a meta-refresh redirect for any human. 5m cache + 1h stale-while-revalidate. Note the rewrite covers **only** the legacy `/u/:login` path. The current profile/deck X share buttons emit short `/<login>?ref=x_share` URLs, so rich unfurls require manually using `/u/<login>` or changing the product rewrite/share target.

## Donations (`routes/donate.ts`)

Razorpay checkout, INR-denominated, displayed in USD:

1. `GET /donate/rate` — live USD→INR (`lib/fx.ts`; tests inject a fixed rate via the `usdInr` dep in `createApp`).
2. `POST /donate/order` (`{usd}` 1–1000, 5 orders/min/IP) — converts to whole rupees, creates the Razorpay order, inserts a `donations` row with `status: "created"`.
3. Client completes Razorpay checkout; `POST /donate/verify` checks the signature and flips the row to `paid` (optionally with a display name).
4. `POST /donate/webhook` — `payment.captured` safety net for tabs closed before verify; mounted only when `RAZORPAY_WEBHOOK_SECRET` is set.

`GET /sponsors` returns the most recent paid donations (ETag'd, 30s cache) for the sponsor wall; the frontend merges it with the static GitHub-Sponsors SVG. Tier names/amounts live client-side in `apps/web/src/sponsorTiers.ts` (Wood $4 → Netherite $256, custom $1–1000).

## Admin quarantine

`POST /admin/flag` / `POST /admin/unflag` (`routes/admin.ts`) — `{githubLogin, reason?}` with the `x-admin-token` header. Mounted with DB deps, but every call compares the header against `ADMIN_TOKEN`; missing or wrong token returns 401. This is the human-review half of the [plausibility gates](ingest-pipeline.md).
