---
type: epic
title: "Budgets and recurring bills"
parent: initiative-pangolin-money-v1
covers: [CAP-4, CAP-5]
after: []
assignee: ""
risk: medium
---

# Budgets and recurring bills

## Description

Shared and personal budgets per category or group, on a fortnight or month cycle anchored to each payday, with spent, pace, projected and optional rollover. Recurring bills are detected from payee, interval and amount, confirmed with one click, and alerted when missed or up more than 10%. Milestone M3.

## Outcome

Each of us can see whether this fortnight is on track, and bill rises are spotted early.

## Done when

1. For a seeded budget, spent, pace and projected match a hand calculation. Rollover carries correctly into the next period.
2. Personal budgets follow each person's payday anchor. Shared budgets use the household anchor and count shared splits, whoever paid.
3. A synthetic series of at least 3 occurrences is detected and one-click confirmed. A missed payment and an 11% rise each raise an alert.
4. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

Budgets and recurring_series, with their UI. Owns the period and payday-anchor helpers that goals, forecasting and tax reuse, per the spine. Not goals and not forecasting.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-4, CAP-5
- budgets — _bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md, sections Budgets and Recurring bills

## Notes

- Open question: architecture spine (bmad-architecture, pending) must settle the period, payday-anchor and FY helpers and the job table/runner contract before inception; cite its section in References once written.
