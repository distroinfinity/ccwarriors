---
title: Deep Insights and Stories
description: The opt-in tier — what it sends, what it unlocks, and how to leave.
---

# Deep Insights and Stories

Deep mode is **off by default**. Turning it on is one explicit choice — "GO ALL-IN" on your profile, or `ccwarriors insights on` in the terminal — and the CLI prints the full disclosure before anything is sent.

## What it sends

The exact list, shown to you verbatim before you opt in:

- **Per-session counts** — prompts, tool calls, plan-mode turns.
- **Timing summaries** — session length, active hours, gaps.
- **Model names** — which models you ran.
- **Hashed git outcomes** — commits, lines, and tests as salted hashes (the salt never leaves your machine, so no repo is identifiable).
- **Your top prompts** — the short prompts you repeat most, secrets stripped on your machine first.
- **Redacted transcripts** — to write your story page; analyzed once, then deleted.

**Never** your code, file contents, file paths, or repo names. Secrets are stripped locally before anything leaves your machine.

## What it unlocks

- **Craft Score** and the six pillars ([on the masthead](profile-pages.md#the-masthead)).
- **Archetype and axes** — your working-style fingerprint.
- **Outcome economics** — cost per surviving line, commits per $100.
- **Session depth** — plan-mode share, subagent and concurrency stats, session lengths.
- **Builds with** — your stack from real agent edits.
- **The insight deck** and **your story page**.

## Your story

The story page (`ccwarriors.xyz/<login>/story`) is an editorial narrative of how you work, written by an LLM from your redacted transcripts: a one-line identity tagline, the developer behind the tools, how you think with AI, your strengths and growth edges, how you've changed over the window, and a prompt in your own words. It's built from a broad sample of your recent and most substantive sessions — the header states exactly how many ("FIELD REPORT · N SESSIONS · LAST 40 DAYS") — and regenerates at most once a day. The transcripts behind it are deleted right after the narrative is generated; only the finished story is kept.

## Control and exit

- **`ccwarriors insights --dry-run`** builds the exact payload and prints it locally without sending a byte.
- **Public/private toggle** on your profile hides insights without deleting anything.
- **`ccwarriors insights off`** disables deep mode and purges your deep data server-side.

The full per-mode data inventory is in [What Leaves Your Machine](../privacy-and-trust/privacy-model.md).
