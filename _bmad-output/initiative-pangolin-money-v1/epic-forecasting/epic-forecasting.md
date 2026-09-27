---
type: epic
title: "Forecasting"
parent: initiative-pangolin-money-v1
covers: [CAP-8]
after: []
assignee: ""
risk: medium
---

# Forecasting

## Description

A cash-flow projection 3–12 months ahead for each account, built from pay cycles, confirmed bills and budgeted discretionary spend, with a low-balance warning. A net-worth projection with editable assumptions for savings rate, returns, mortgage amortisation with offset, and super contributions. Milestone M3.

## Outcome

We see trouble coming before it arrives. One full budget cycle tracked for both of us is the M3 gate.

## Done when

1. One full budget cycle is tracked for both of us. (M3 gate)
2. A seeded scenario of pay cycles, bills and budgets gives a cash-flow projection whose low-balance warning fires on the expected date.
3. Net-worth assumptions (low, mid and high returns, savings rate, mortgage with offset, and super) are editable, and the projection redraws from them.
4. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

Projection services and their views. Monte Carlo bands are a spec non-goal.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-8
- forecasting — _bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md, section Forecasting

## Notes

- Open question: architecture spine (bmad-architecture, pending) must settle the period, payday-anchor and FY helpers before inception; cite its section in References once written.
