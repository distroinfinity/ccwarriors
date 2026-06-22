---
title: CLI
description: The ccwarriors client — distribution, sync, background daemon, self-update, and deep extraction.
---

# CLI

`packages/cli` builds to a zero-dependency single-file Node bundle. There is no npm package to publish: every web deploy ships the new CLI at `/cli.js`, and installed clients pick it up via self-update. Three pages: [Installer, Auth, and Sync](installer-auth-and-sync.md) covers distribution, the loopback OAuth flow, and what a sync reads and uploads. [Autosync and Self-Update](autosync-and-self-update.md) covers the background daemon and the atomic update/rollback machinery. [Deep Insights Extraction](deep-insights-extraction.md) covers the opt-in session analysis and its consent gating.
