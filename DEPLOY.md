# CCWarriors — Deploy & Setup Guide

Architecture in production:

```
ccwarriors.xyz        →  Vercel   (frontend, apps/web — also serves /install.sh + /cli.js)
api.ccwarriors.xyz    →  Railway  (backend, apps/server) + Railway Postgres
CLI                   →  curl -fsSL https://api.ccwarriors.xyz/install.sh | bash   (no npm)
```

Production has **no seed/dummy data** — the board fills up as real people run the
CLI. Seeding/simulation is local-only (the `SEED_DEMO` / `SIMULATE` flags).

---

## 0. What YOU need to set up (accounts & secrets)

- A **GitHub OAuth App** (Client ID + Secret) — for login + the CLI.
- A **Railway** account (you have a paid plan) — backend + Postgres.
- A **Vercel** account — frontend (it also serves the CLI installer; no npm needed).
- DNS access for **ccwarriors.xyz**.

---

## 1. Create the GitHub OAuth App

Open: **https://github.com/settings/applications/new**

Fill in (production app):
- **Application name:** `CCWarriors`
- **Homepage URL:** `https://ccwarriors.xyz`
- **Authorization callback URL:** `https://api.ccwarriors.xyz/cli/callback`

Click **Register application**, then:
- Copy the **Client ID**.
- Click **Generate a new client secret**, copy the **secret** (shown once).
- **Logo:** upload `assets/logo-dark-512.png` (the armed Clawd) as the application logo.

> Your Client ID/Secret are already in the gitignored `apps/server/.env` for local
> use — paste the SAME two values into Railway in step 2. (The secret was shared
> in chat; rotate it from the OAuth app page if that ever concerns you.)

> A classic OAuth App allows only ONE callback URL. To also test login locally,
> create a **second** OAuth App with callback `http://localhost:8787/cli/callback`
> and use its credentials in your local `.env`. (Or just test login in prod.)

You'll paste `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` into Railway in step 2.

---

## 2. Backend on Railway (apps/server + Postgres)

1. **New Project → Deploy from GitHub repo** → pick `distroinfinity/ccwarriors`.
2. **Add a database:** New → **Database → PostgreSQL**. This exposes `DATABASE_URL`.
3. Open the **service** (the app, not the DB) → **Settings**:
   - **Build Command:** `pnpm install && pnpm --filter server build`
   - **Start Command:** `pnpm --filter server start`
   - (Railway uses the `packageManager` field in the root `package.json` to pick pnpm.)
4. **Variables** (service → Variables) — add:
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the Postgres service) |
   | `CORS_ORIGIN` | `https://ccwarriors.xyz` |
   | `PUBLIC_BASE_URL` | `https://api.ccwarriors.xyz` |
   | `WEB_BASE_URL` | `https://ccwarriors.xyz` |
   | `GITHUB_CLIENT_ID` | *(from step 1)* |
   | `GITHUB_CLIENT_SECRET` | *(from step 1)* |
   - **Do NOT set** `SEED_DEMO` or `SIMULATE` (they must stay off in prod).
   - **Do NOT set** `PORT` — Railway provides it automatically.
5. **Run the database migration once** (creates the `users` / `snapshots` tables).
   Easiest: set a **Pre-Deploy Command** in Settings:
   `pnpm --filter server db:migrate`
   …or run it locally against the prod DB one time:
   ```bash
   DATABASE_URL="<railway postgres url>" pnpm --filter server db:migrate
   ```
6. **Custom domain:** service → **Settings → Networking → Custom Domain** →
   add `api.ccwarriors.xyz`. Railway shows a **CNAME target** — add it in DNS (step 4).
   Railway provisions TLS automatically.

Verify after deploy: `https://api.ccwarriors.xyz/health` → `{"status":"ok"}`.

---

## 3. Frontend on Vercel (apps/web)

1. **Add New → Project** → import `distroinfinity/ccwarriors`.
2. **Configure:**
   - **Root Directory:** `apps/web`
   - **Framework Preset:** `Vite`
   - **Build Command:** `pnpm build`  (Output Directory: `dist`)
   - **Install Command:** leave default (`pnpm install`); Vercel detects the
     pnpm workspace at the repo root.
3. **Environment Variables:**
   - `VITE_WS_URL` = `wss://api.ccwarriors.xyz`
4. **Deploy.**
5. **Custom domain:** Project → **Settings → Domains** → add `ccwarriors.xyz`
   (and `www.ccwarriors.xyz`). Follow Vercel's DNS instructions (step 4).

---

## 4. DNS (at your domain/registrar for ccwarriors.xyz)

| Record | Name | Points to |
|--------|------|-----------|
| `A` (or per Vercel) | `@` (apex) | Vercel apex IP `76.76.21.21` *(use whatever Vercel's Domains page shows)* |
| `CNAME` | `www` | `cname.vercel-dns.com` |
| `CNAME` | `api` | *(the CNAME target Railway shows for `api.ccwarriors.xyz`)* |

Wait for propagation + TLS issuance (minutes to an hour). Then:
- `https://ccwarriors.xyz` → the app
- `https://api.ccwarriors.xyz/health` → `{"status":"ok"}`

---

## 5. CLI distribution — no npm, it ships with the site

The CLI is a **zero-dependency single-file Node bundle**. The web app's build
(`apps/web` `prebuild` script) bundles `packages/cli` and copies it to
`public/cli.js`; `public/install.sh` is the installer. **Every Vercel deploy is
automatically a CLI release** — there is no separate publish step, no npm, no
version ceremony.

Users install + enlist with one command:
```bash
curl -fsSL https://api.ccwarriors.xyz/install.sh | bash
```
What it does: checks Node 20+, downloads `cli.js` to `~/.ccwarriors/`, installs
a `ccwarriors` command (symlinked into `~/.local/bin`), then immediately runs
the first sync — GitHub login opens in the browser, `ccusage` totals are read,
and the user lands on the board. After that, re-syncing is just `ccwarriors`.

Useful flags/env: `CCWARRIORS_NO_RUN=1` (install without auto-running),
`CCWARRIORS_BASE` (download from a different host — used for local testing).

---

## 6. Local development

Two terminals from the repo root:

```bash
# 1) backend — in-memory DB + 15 seeded warriors + live simulation, on :8787
pnpm --filter server dev

# 2) frontend — Vite on :5173, talks to ws://localhost:8787
pnpm --filter web dev
```

Open http://localhost:5173.

To test the **real CLI flow locally**, you need a local OAuth app (callback
`http://localhost:8787/cli/callback`) and a backend started with those creds:
```bash
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy PUBLIC_BASE_URL=http://localhost:8787 \
  pnpm --filter server dev
# then, in another terminal:
CCWARRIORS_API=http://localhost:8787 CCWARRIORS_WEB=http://localhost:5173 \
  node packages/cli/dist/cli.js     # (after: pnpm --filter claude-warriors build)
```

---

## 7. Production go-live checklist

- [ ] GitHub OAuth App created; Client ID + Secret in Railway.
- [ ] Railway: Postgres added, `DATABASE_URL` wired, migration run, env vars set, `SEED_DEMO`/`SIMULATE` NOT set.
- [ ] `https://api.ccwarriors.xyz/health` returns ok; `api` CNAME + TLS live.
- [ ] Vercel: `VITE_WS_URL=wss://api.ccwarriors.xyz`; `ccwarriors.xyz` domain + TLS live.
- [ ] `curl -fsSL https://api.ccwarriors.xyz/install.sh | bash` installs + enlists end-to-end (login → ccusage → on the board).
- [ ] Smoke test: run the CLI yourself, confirm you appear on the live board at `ccwarriors.xyz`.

---

## Environment variables reference

**Backend (`apps/server`)** — see `apps/server/.env.example`:
`PORT` (Railway-provided), `DATABASE_URL` (Postgres in prod; unset → PGlite locally),
`SEED_DEMO`/`SIMULATE` (local only), `CORS_ORIGIN`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `PUBLIC_BASE_URL`, `WEB_BASE_URL`,
`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (donations; `/donate/*` disabled when unset —
use `rzp_live_*` keys in Railway, `rzp_test_*` locally).

**Frontend (`apps/web`)** — see `apps/web/.env.example`: `VITE_WS_URL`,
`VITE_EVM_ADDRESS` (crypto donation tab; hides when unset — set in Vercel).

**GitHub repo secrets**: `SPONSORKIT_GITHUB_TOKEN` — classic PAT with `read:user` +
`read:org`, used by `.github/workflows/sponsors.yml` to regenerate the sponsor wall
weekly once the GitHub Sponsors profile is live.

**CLI (`packages/cli`)**: `CCWARRIORS_API` (default `https://api.ccwarriors.xyz`),
`CCWARRIORS_WEB` (default `https://ccwarriors.xyz`).

---

## Known follow-ups (not blocking go-live)

- **Web session login** to highlight *your own* row / show *your* card to a
  signed-in browser visitor. The CLI login + ingest path is complete; the
  in-browser "sign in with GitHub" session is not wired yet (the dossier card
  currently shows a demo/representative warrior).
- **Server-rendered card PNG** for rich X link unfurls (`/og/:login.png`). The
  in-app card is rendered client-side and works; the shareable image endpoint
  is pending.

Ping me to build either of these.
