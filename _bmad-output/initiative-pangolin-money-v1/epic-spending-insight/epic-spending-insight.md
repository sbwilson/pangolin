---
type: epic
title: "Spending and cash-flow insight"
parent: initiative-pangolin-money-v1
covers: [CAP-17, CAP-14]
after: []
assignee: ""
risk: medium
---

# Spending and cash-flow insight

## Description

Historical cash flow as a Sankey, P&L by group or category, spending over any period, and current net worth, all summed from visible splits. Each person's share of shared spending is apportioned by contribution, or 50/50 as a setting. Milestone M2.

## Outcome

We can see where our money went without a spreadsheet; report totals matching hand sums is the signal.

## Done when

1. On the seeded household, the totals in the Sankey, the P&L and any-period spending equal a hand sum of splits for the chosen period.
2. Net worth excludes private accounts from the partner's view and from the shared view, and the owner's view includes them.
3. Contribution apportionment produces the documented percentages from seeded transfers and shared expenses. The 50/50 setting overrides it.
4. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

Reports and charts (ECharts) over splits. CAP-14 part: contribution and apportionment; the beneficiary field belongs to epic-ledger-accounts-privacy. Not forecasting (epic-forecasting), and not partner settlement (v1.1).

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-14, CAP-17
- shared spending — _bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md, section Shared spending and who paid

## Notes

- Open question: architecture spine (bmad-architecture, pending) must settle the visibleAccounts()/redact() contract before inception; cite its section in References once written.
