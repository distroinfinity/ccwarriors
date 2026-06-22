---
title: FAQ
description: The questions that actually come up.
---

# FAQ

**I synced twice and nothing changed.**
The server accepts one sync per 10 seconds. The second one was politely ignored; autosync's timing already accounts for this.

**My number doesn't match what ccusage shows locally.**
The server prices tokens from its own daily-refreshed table — that's what makes the board fair. Small differences are normal; brand-new models sit at a conservative default price until the public pricing table catches up, then your total adjusts.

**I code on two machines.**
Install on both with the same GitHub login. Each machine reports under a stable anonymous id and the server **adds them up** — no overwriting, no double counting, and reinstalling keeps the same id.

**Windows?**
`irm https://ccwarriors.xyz/install.ps1 | iex` to install. Background autosync isn't supported on Windows yet — use `ccwarriors watch` or sync manually.

**Why is my org board behind the global board?**
The global board is pushed over a WebSocket (~1s); org boards poll every ~10s. It catches up.

**My row disappeared.**
Your numbers tripped a plausibility gate and you're in human review — your profile and card still work, you're just off the boards. Genuinely a whale? Reach out (GitHub issues or X) and a human clears it quickly. See [Fairness and Plausibility](../privacy-and-trust/fairness-and-plausibility.md).

**My tool shows up as "Other".**
We haven't added it to the named registry yet — but every token still counts in your total. Open an issue and it gets a name and a filter chip.

**Is the CLI on npm?**
No. It's a zero-dependency single file served by the site itself, and it keeps itself updated. `curl` to install, done.

**How do I delete everything?**
`ccwarriors insights off` (purges deep data, if you ever opted in), then the three uninstall lines in [How It Works](../how-it-works.md#how-to-leave).
