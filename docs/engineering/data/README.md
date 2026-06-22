---
title: Data
description: Persistent schema and the in-memory state derived from it.
---

# Data

Two failure domains, two pages. [Data Models](data-models.md) documents the ten Postgres tables — what each stores, its unique constraints, and which writes touch it. [Stores, Caches, and Derived State](stores-caches-and-derived-state.md) documents everything computed or cached on top of those tables: the in-memory leaderboard store the boards actually read from, the pricing snapshot, HTTP cache layers, and which values are derived at read time versus persisted.
