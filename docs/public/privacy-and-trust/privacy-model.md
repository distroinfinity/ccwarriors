---
title: What Leaves Your Machine
description: The exact inventory, per consent level.
---

# What Leaves Your Machine

Three levels. Each one is opt-in on top of the last, and the CLI shows you the full disclosure in your terminal before anything new is sent.

## Level 0 — default sync (everyone on the board)

Sent: raw token counts per tool, per day, per model — literally:

```json
{ "claude": [{ "date": "2026-06-04",
               "models": [{ "modelName": "claude-opus-4-8",
                            "inputTokens": 1024, "outputTokens": 512, … }] }] }
```

…plus a machine id (a one-way hash of hostname/user/OS — not reversible, no serial numbers) and your GitHub identity from login.

**Never sent at this level:** dollar figures (the server does the pricing), code, file contents, file names, file paths, repo names, commit messages, commit SHAs, prompts.

## Level 1 — deep mode (`ccwarriors insights on`)

Opting in ("GO ALL-IN") adds, after the full disclosure:

- **Per-session counts and summaries** — prompts, interrupts, tool calls, parallel agents, session timing, model names. Uploaded at most every 6 hours.
- **Hashed git outcomes** — commits, lines added/deleted, test files touched, where the repo and branch are identified only by salted hashes. The salt lives in your config and never uploads — nobody, including us, can reverse which repo is which.
- **Your top prompts** — the short prompts you repeat most, secrets stripped on your machine first.
- **Redacted transcripts** — to write your story page: your prompts (secrets, keys, and emails stripped before upload; redaction errs toward removing too much) and tool-call **names** — never tool inputs, file paths, or commands. Used once to generate the story, then **deleted**; only the finished story is kept.

Still never sent: code, file contents, file paths, branch names, repo names, commit messages, or SHAs.

`ccwarriors insights --dry-run` prints the exact payload locally without sending it. `ccwarriors insights off` turns it off **and deletes your deep data server-side**.

## What the server stores

Your GitHub login and avatar; cost totals, per-tool split, and the daily token counts behind them; a GitHub OAuth token with `read:user` scope (public-profile reads for your GitHub stats panel). Deep mode adds the profile metrics and, once generated, the derived story document (the transcripts behind it are deleted). That's the whole row.

## Telemetry

The installer and CLI send anonymous failure beacons (OS, failing step — no personal data) so we can see fleet breakage. Opt out any time with `CCWARRIORS_TELEMETRY=0`.

## Leaving

[How It Works → How to leave](../how-it-works.md#how-to-leave) has the three commands. Insights visibility can also be flipped to private on your profile without deleting anything.
