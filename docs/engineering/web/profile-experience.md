---
title: Profile Experience
description: The profile and story component trees, cards, and sponsor UI.
---

# Profile Experience

## ProfilePage (`src/components/Profile/ProfilePage.tsx`)

Renders in a fixed order: `ArchetypeCard` → `ByTheNumbers` → `InsightCards` → `RhythmPanel` → `StoryCloser` → `OwnerControls`. The insight deck only exists once insights are unlocked; the page derives `hasStory` from whether the deck contains a `story` card.

**Progressive loading (`useProfile.ts` owns the types).** The page fires two fetches in parallel: `useProfile` → `/profile/:login` (the cheap `CoreProfile`: identity, rank, cost, rhythm, efficiency, github, owner) and `useProfileInsights` → `/profile/:login/insights` (the expensive deep block: craft/pillars/cards/depth/economics/stack). Both hooks are stale-while-revalidate keyed on `login` (a `refreshKey` bump on consent toggles refetches without a skeleton flash); the insights hook self-gates and surfaces an explicit `error` state (kept distinct from a real `no_consent` so the masthead shows a Retry, not an endless pending poll). `ProfilePage` composes `Profile = CoreProfile & { insights }` and passes a **nullable** profile plus `insightsLoading`/`insightsError` to the sections.

**One continuous skeleton.** There is no full-page skeleton swap. Each section renders its own in-place skeleton when its data is absent — `ArchetypeCard` shows a masthead/identity skeleton until core lands and an archetype-region skeleton until insights land; `ByTheNumbers`/`RhythmPanel` skeleton until core; `InsightCards` until insights. The skeletons are sized to the real rendered dimensions (avatar 54, masthead region ~192, the reserved Share/Download action row 43, by-the-numbers group rows 106/137, deck cards 160, rhythm heatmap+stats) so the stencil holds its shape and only the data populates — no layout shift. The masthead identity, GitHub group, and rhythm paint from core; archetype/craft, the deep By-the-Numbers groups, and the card deck stream in behind their skeletons.

## ArchetypeCard (`ArchetypeCard.tsx`) — the masthead

The editorial header. When the server sent a numeric `craftScore` + `pillars`, it renders `CraftScoreHero`: a verdict line (the story `tagline`, else archetype + growth edge), the big `CRAFT` figure with forge tier, top-signal pillar, and trust badges, a strength-signature sparkbar, and a collapsible "full score breakdown" (pillar bars + provenance line + the `CraftExplainer`). Pillar metadata (`PILLAR_INFO`) carries weight and `kind` (`outcome` vs `behavioral`) and a plain-language tip per pillar.

Badge logic lives here: `EarlyReadBadge` (provisional and `sampleSessions < 10`), `CalibratedBadge` (`!scoresArePercentiles` and `sampleSessions >= 10`), VERIFIED/UNVERIFIED (`trustTier === 1`), and a GITHUB badge (`githubVerified`). Without a craft score it falls back to the legacy archetype + `AxisBars` hero.

Locked states: `LockedPanel` shows the owner the binary consent choice (STAY PRIVATE / GO ALL-IN), where GO ALL-IN posts `{consent:true, consentVersion:2}` to `/insights/consent`. `reason: "forging"` (consented, no data yet) and an owner who has consented both render `PendingPanel`, which polls every 6s and swaps the card in live. `DISCLOSURE_LIST`/`DEEP_UPLOADS` is the canonical "what deep mode uploads" list — reused verbatim as both the ask and the receipt so the promise and proof can't drift. The card exports to PNG (`html-to-image`, `data-noexport` strips interactive chrome) and shares to X with the short `/:login?ref=x_share` profile URL.

## ByTheNumbers (`ByTheNumbers.tsx`)

Replaced the old four side panels (EfficiencyPanel, GithubPanel, HabitsPanel — all deleted). One `<section>` with four `Group`s, each with a headline stat set and a collapsible "more":

- **Outcomes** — `economics.costPerSurvivingLoc`, `efficiency.grade`; more: `commitsPer100Usd`, cache-read %, model mix.
- **Sessions** — `depth.sessions` + window, `planModeSessionsPct`; more: total hours, avg/longest session (longest clamped at 10080 min = 7d), subagent spawns + peak parallel, and max concurrent only when the server has that optional extra.
- **GitHub** (titled "GitHub · verified" when stats exist) — stars, merged PRs; a persistent profile-link anchor; more: repos contributed to, longest streak, languages, since-year.
- **Builds with** — top language + primary model from `stack`; more: per-language share bars.

A `Group` renders if it has any headline stat or a persistent anchor; the whole panel returns null if every group is empty. `fmtUsd` keeps sub-cent precision for per-surviving-line costs (where `formatUsd`'s 2 decimals would collapse to `$0.00`).

## StoryPage / StoryCloser

`StoryCloser.tsx` is the profile's invite into the story ("Who is `<login>` behind the tools?"), rendered only when a story card exists. `StoryPage.tsx` (`/:login/story`) fetches `/profile/:login/story` and renders the `StoryDoc`: masthead (`FIELD REPORT · N SESSIONS · LAST N DAYS · date`), tagline lede, "The developer behind the tools" (narrative), "How you think with AI" (decision patterns + AI-archetype stamps), Strengths / Growth edges, "The arc", "In your own words" (cryptic prompt), "Lately working on" (`whatYouBuilt`). Its `StoryDoc` interface is a hand-kept mirror of the server type — keep in sync when the server's changes.

## Cards and scenes

`YourCard` / `EnlistCard` render the collectible card; scene art is `CardScene.tsx` (`SceneDefs`), scene keys from the server (`users.cardScene`, default `fujiNight`, `apps/server/src/lib/scenes.ts`). The homepage card shares the site root with `?ref=x_share`; profile and deck cards share short `/:login?ref=x_share` links. Only legacy `/u/:login` links currently hit the crawler OG rewrite (see [App Shell](app-shell-and-live-data.md)).

## Sponsor UI (`src/components/Sponsor/`)

`Sponsor.tsx` hosts Razorpay (`AmountGrid` over `sponsorTiers.ts` — Wood $4 → Netherite $256, custom $1–1000, default Iron; `RazorpayButton` runs order/checkout/verify), crypto (`CryptoPanel` — a chain hides when its `VITE_EVM_ADDRESS`/`VITE_SOL_ADDRESS` is unset, the tab hides when both are), and `SponsorsWall`.

## Keep in sync by hand

`HowItWorks.tsx` and the `StoryDoc` interface in `StoryPage.tsx` have no compile-time link to the server — nothing breaks when they drift, they just go stale. Update them alongside the server when the pipeline, the tool registry, or the story shape changes.
