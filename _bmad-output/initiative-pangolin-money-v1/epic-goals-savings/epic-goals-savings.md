---
type: epic
title: "Goals and savings allocation"
parent: initiative-pangolin-money-v1
covers: [CAP-6, CAP-7]
after: []
assignee: ""
risk: high
---

# Goals and savings allocation

## Description

Virtual goals funded from positive new savings through staged, ordered allocation rules. A stage exits when its goal is funded, a completed goal's share is rescaled, and the emergency fund falls back below its threshold. Each pool is reconciled so that goal balances + buffer = savings-account balance. A deficit draws down only the buffer (option A). Milestone M3.

## Outcome

We know how much of our savings is earmarked for each goal, and the books never silently disagree with the bank.

## Done when

1. A seeded multi-period savings history produces goal_allocation rows that match the active stage's shares. Stage exit, rescale and fallback each log a stage change.
2. A deficit period reduces only the buffer, and no goal balance goes down.
3. A seeded over-commitment shows a red shortfall on the goals page and in the review inbox. Any other mismatch offers a one-click adjustment to the buffer.
4. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

goal, goal_rule, goal_allocation and allocation_stage, the goals page, and the reconciliation check after each period close and each import. Savings means balances of savings-flagged accounts; brokerage and super are never savings.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-6, CAP-7
- goals — _bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md, sections Goals and savings allocation, Goal priorities and stages, Reconciling goals with the savings account
- decision — _bmad-output/specs/spec-pangolin-money/decisions.md, section Periods where spend exceeds income

## Notes

- Open question: architecture spine (bmad-architecture, pending) must settle the period, payday-anchor and FY helpers before inception; cite its section in References once written.
