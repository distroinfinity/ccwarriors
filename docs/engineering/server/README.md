---
title: Server
description: The Hono API — ingest, pricing, plausibility, profiles, stories, orgs, badges, sponsors.
---

# Server

`apps/server` owns every number on the board: clients send raw token counts and the server prices, validates, ranks, and broadcasts them. [Ingest Pipeline](ingest-pipeline.md) is the core read — payload shapes, pricing, delta math, and the plausibility gates. [Profile and Story Pipeline](profile-and-story-pipeline.md) covers everything a profile page aggregates, including Craft Score and LLM story generation. [Auth, Orgs, Badges, and Sponsors](auth-orgs-badges-and-sponsors.md) covers the remaining route groups.
