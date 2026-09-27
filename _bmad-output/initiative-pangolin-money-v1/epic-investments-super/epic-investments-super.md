---
type: epic
title: "Investments and super"
parent: initiative-pangolin-money-v1
covers: [CAP-9, CAP-10, CAP-1]
after: []
assignee: ""
risk: high
---

# Investments and super

## Description

ETF events, including CMC imports and manual Betashares entry, with FIFO or identified lots, AMIT cost-base adjustments, CGT discount flags, and XIRR and time-weighted return. Daily prices come from Yahoo, then the issuer NAV, then manual entry. Super balances are units × daily unit price per option. Contributions are tracked against per-FY concessional caps with carry-forward, and SG is checked against each payday (Payday Super). Milestone M4.

## Outcome

Our investments and super sit beside our cash, valued daily, and their tax numbers are correct.

## Done when

1. A seeded buy, sell, DRP and adjustment sequence gives cost bases and a gain on sale that match a hand calculation. The 50% discount applies only to lots held more than 12 months.
2. A seeded statement and unit-price history reproduces the fund balance within rounding. The balance is labelled an estimate until the next statement.
3. The cap tracker flags a seeded over-cap contribution. A seeded missed SG payment is flagged after its payday.
4. Price fetches send only ticker codes. A stale price shows its age and can be overridden. All fetchers pass against the mock price server in CI.
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

The Invest and Super tables, packages/connectors, and the investment and super views. Cap amounts live in a per-FY config table, not in code. Owns touch points Yahoo Finance, issuer NAV pages and the QSuper and Aware unit-price pages. CAP-1 part: CMC Invest confirmations, through an investment_event target it adds to the import pipeline (spine AD-10). Not Betashares statement parsing (a spec non-goal).

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-9, CAP-10
- investments — _bmad-output/specs/spec-pangolin-money/investments-super-tax.md, sections ETFs and Super
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-8, AD-10, AD-11, AD-13, AD-19, AD-20, AD-25

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
