---
title: Profile Experience
description: The profile and story component trees, cards, and sponsor UI.
---

# Profile Experience

## ProfilePage (`src/components/Profile/ProfilePage.tsx`)

Composes panels off one `/profile/:login` response — each panel renders only when its data block exists (card doctrine: a missing block means "no data", never fabricated zeros):

- `RhythmPanel` — daily-cost heatmap + streaks.
- `EfficiencyPanel` — cache-read grade, model mix, tokens/day.
- `GithubPanel` — the verified public footprint.
- `HabitsPanel`, `InsightCards` (deck with owner-pinned cards first, `pinnedCards` ≤4), `ArchetypeCard` — craft score, pillars, tier; provisional badge below the percentile population floor.
- `OwnerControls` — rendered only for the owner: the insights unlock ("GO ALL-IN" → `POST /insights/consent`), the public/private visibility toggle, a "what's stored" disclosure, and a two-step armed purge of deep data. Consent changes call `refetch` so the page updates without a reload.

`StoryPage.tsx` (`/:login/story`) has three states: locked (no consent / not public), generating (poll with a stalled notice), and ready (renders the `StoryDoc` — narrative, what-you-built, decision patterns, strengths, growth areas, archetypes, cryptic prompt).

## Cards and scenes

`YourCard` / `EnlistCard` render the collectible warrior card; scene art comes from `CardScene.tsx` (`SceneDefs` SVG defs), scene keys from the server (`users.cardScene`, default `fujiNight`, registry in `apps/server/src/lib/scenes.ts`). The card carries the "Copy README badge" action — the snippet points at `/badge/:login.svg` and links to the profile with `?ref=badge`.

Share links use the `/u/:login` form so crawler unfurls hit the OG rewrite (see [App Shell](app-shell-and-live-data.md)).

## Sponsor UI (`src/components/Sponsor/`)

`Sponsor.tsx` hosts three tabs: Razorpay (`AmountGrid` over `sponsorTiers.ts` — Wood $4, Stone $8, Iron $16, Gold $32, Diamond $64, Netherite $256, custom $1–1000, default Iron; `RazorpayButton` runs the order/checkout/verify flow), crypto (`CryptoPanel` — a chain hides when its `VITE_EVM_ADDRESS`/`VITE_SOL_ADDRESS` is unset, the tab hides when both are), and `SponsorsWall` (merges `GET /sponsors` with the static GitHub-Sponsors SVG).

## Keep in sync by hand

`HowItWorks.tsx` is prose about the pipeline (tool list, intervals, privacy claims). It has no data dependency on the server, so nothing breaks when it drifts — it just lies. When you change ingest behavior, the daemon's timing, or the tool registry, update it and the public docs together.
