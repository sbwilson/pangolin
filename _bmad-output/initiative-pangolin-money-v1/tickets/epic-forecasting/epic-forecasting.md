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

A cash-flow projection 3–12 months ahead for each account, built from pay cycles, confirmed bills and budgeted discretionary spend, with a low-balance warning against each account's editable threshold. A net-worth projection with editable assumptions for savings rate, returns, mortgage amortisation with offset, and super contributions. Milestone M3.

## Outcome

We see trouble coming before it arrives; the low-balance warning firing on the expected date in a seeded scenario is the signal.

## Done when

1. A seeded scenario of pay cycles, bills and budgets gives a cash-flow projection whose low-balance warning fires on the expected date.
2. Net-worth assumptions (low, mid and high returns, savings rate, mortgage with offset, and super) are editable, and the projection redraws from them. Each transaction account has an editable low-balance threshold. Mortgage amortisation uses `domain/amortise`, shared with epic-loans-property.
3. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

Projection services and their views, the per-account low-balance threshold, and `domain/amortise` (built here first; epic-loans-property extends it for the loan schedule). Monte Carlo bands are a spec non-goal.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-8
- forecasting — _bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md, section Forecasting
- architecture — _bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-11, AD-12, AD-14, AD-19, AD-23, AD-25, and Capability → Architecture Map (CAP-20, `domain/amortise`)
- ux — _bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Component Patterns (Planning), Flow 7
- mockups — _bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-forecast.html
- change — _bmad-output/v6-archive/planning-artifacts/sprint-change-proposal-2026-10-05.md, section E-9

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Decision (2026-10-05, G3): this epic no longer carries the M3 gate; it moves to epic-home-buying-planner, the last M3 epic.
- Waits on epic-budgets-bills because: budgets and confirmed recurring series feed the projection.
- Waits on epic-goals-savings because: the savings definition and goal allocations.
- Waits on epic-spending-insight because: the net-worth projection starts from its net worth queries.
- Decision (2026-11-10, inception): the tracer bullet is entry 1 — seeded cash-flow warning end to end through domain, query, API, and chart; the model is completed in entry 2.
- Decision (2026-11-10, inception): projection model — pay deposits from PayCalendar, confirmed series dated on their cycles, discretionary budget limits pro-rated within each pay cycle at a daily rate, goal allocations drawn from the pay deposit account; categories covered by a confirmed series are left out of discretionary spend (AD-25).
- Decision (2026-11-10, inception): low-balance threshold defaults to 0 per transaction account, editable and stored on the account; mockup values are seed data.
- Decision (2026-11-10, inception): the low-balance warning is the chart warning line and page caption only; no review-item kind (AD-17's kind list does not include it).
- Decision (2026-11-10, inception): forecast assumptions are person-scoped rows per AD-22; horizons follow the UX assumptions — cash flow 3/6/12 months (default 3), net worth 1/2/5/10 years (default 2).
- Decision (2026-11-10, inception): deferred scope — Monte Carlo bands remain the spec non-goal; extra-repayment depth beyond domain/amortise basics waits on epic-loans-property.
