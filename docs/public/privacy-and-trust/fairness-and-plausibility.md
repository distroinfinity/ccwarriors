---
title: Fairness and Plausibility
description: Why you can believe the numbers — and why you can't fake them.
---

# Fairness and Plausibility

A leaderboard is only as interesting as it is honest. Three mechanisms keep this one honest.

## 1. The server prices everything

Clients send token counts, never dollars. The server prices every token against a public per-model pricing table (the same source ccusage uses, refreshed daily). The cheapest cheat — just claiming a big number — is structurally impossible: there is no field for it.

Brand-new models the table hasn't caught up with get a conservative mid-tier default price, so inventing exotic model names gains nothing either.

## 2. Implausible numbers get caught

Every sync runs through sanity gates. Current defaults (tunable as real data comes in):

- Spend can't grow faster than about **$500/hour** between syncs.
- No single tool can claim more than about **$3,000 in one day**.
- A tool appearing for the first time can't bring more than about **$15,000** of history with it.
- Days more than 2 days old are settled — they can't grow more than 10% after the fact. Real agent logs are append-only; last week inflating later means the logs were rewritten.
- Token mixes have to look physically real, and you can't claim more than 5 machines.

Deep mode (a hiring-grade credential, so gaming resistance matters most there) adds outcome checks: surviving lines of code can't exceed output tokens, commit volume has to match real spend, and machine-regular session timing — uniform sub-second gaps no human produces — gets caught.

## 3. Cheaters disappear quietly

A sync that trips a gate doesn't return an error. It "succeeds" — and the account silently leaves every board, count, and total until a human reviews it. Probing for the limits teaches you nothing; your profile and card keep rendering, you just stop existing on the boards. Wrongly caught? Reach out — a human can clear the flag in seconds (whales with genuinely huge burn exist, and the limits get tuned for them).

## One honest caveat

Pricing local logs is an estimate of API-equivalent cost — subscription plans, caching, and provider discounts mean nobody's invoice matches it exactly. But it's the **same** estimate, computed the same way, for everyone on the board. That's what makes the ranking fair.
