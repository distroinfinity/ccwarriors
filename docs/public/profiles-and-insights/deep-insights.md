---
title: Deep Insights and Stories
description: The opt-in tier — two consent levels, what each sends, and how to leave.
---

# Deep Insights and Stories

Everything on this page is **off by default**. There are two consent levels, and the CLI prints exactly what each one sends — in plain text, in your terminal — before asking. The web's "GO ALL-IN" unlock goes through the same disclosure.

## Level 1: deep insights (`ccwarriors insights on`)

Sends per-session **counts and summaries** from your local agent sessions: prompts, interrupts, tool calls, parallel agents, timing, model names, and Git outcomes (commits, lines, test files) where repos and branches are identified only by salted hashes that can't be reversed — the salt never leaves your machine. Uploads at most every 6 hours.

What it unlocks: working-style axes and archetype, habit stats, the insight-card deck, and your **Craft Score** — six pillars (Direction, Verification, Autonomy, Yield, Orchestration, Throughput; the verification and yield pillars weigh the most because they're hardest to game) with tiers **Apprentice → Journeyman → Artisan → Mastersmith**.

Not sure? `ccwarriors insights --dry-run` builds the exact payload and prints it locally without sending a byte.

## Level 2: unlock your story

The story page is an LLM-written narrative of how you actually work — what you built, your decision patterns, strengths, growth edges — at `ccwarriors.xyz/<login>/story`.

Writing it requires more than counts, so it's a separate consent: the CLI additionally sends your most-repeated short prompt and **redacted** transcripts (secrets, keys, and emails stripped before upload; tool calls reduced to names only — never inputs, paths, or commands). The server uses them once to generate the story, then **deletes the source material** — only the finished story document is kept. Stories regenerate at most once a day.

## Control and exit

- **Public/private toggle** on your profile — hide insights without deleting anything. Visitors can't distinguish "private" from "never opted in".
- **`ccwarriors insights off`** — disables deep mode and purges your deep data server-side.
- The full data inventory per level: [What Leaves Your Machine](../privacy-and-trust/privacy-model.md).
