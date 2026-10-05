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

Cash flow becomes the landing page (`/cash-flow`; `/` redirects there). Historical cash flow as a Sankey, P&L by group or category, spending over any period, and current net worth, all summed from visible splits; a net-worth page with trend; Biggest little leaks; and a 'My share / Everything I can see' toggle under an always-visible apportioned share line. Each person's share of shared spending is apportioned by contribution, or 50/50 as a setting. Milestone M2.

## Outcome

We can see where our money went without a spreadsheet; report totals matching hand sums is the signal.

## Done when

1. On the seeded household, the totals in the Sankey, the P&L and any-period spending equal a hand sum of splits for the chosen period.
2. Net worth shows each person everything they can see, including their own private accounts and never the other partner's. Shared figures (shared-beneficiary spending, contribution) are identical for both partners.
3. Contribution apportionment produces the documented percentages from seeded transfers and shared expenses. The 50/50 setting overrides it.
4. `/cash-flow` is the landing page and `/` redirects to it; the net-worth page shows a trend; Biggest little leaks renders on the seeded household; and the 'My share / Everything I can see' toggle sits under the always-visible apportioned share line.
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

Reports and charts (ECharts) over splits. CAP-14 part: contribution and apportionment; the beneficiary field belongs to epic-ledger-accounts-privacy. Adds the 50/50 attribution control to the empty Settings › Household section that epic-app-shell-settings-theming builds. Not forecasting (epic-forecasting), and not partner settlement (v1.1). Epic-home-buying-planner (15) adds the Home buying glimpse to Cash flow, and epic-loans-property (14) adds loans and properties to the net-worth page.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-14, CAP-17
- shared spending — _bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md, section Shared spending and who paid
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-3, AD-4, AD-7, AD-11, AD-13, AD-19, AD-23, and Consistency Conventions (Routes)
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Information Architecture, Component Patterns (Shell & reports), State Patterns (Reports), Flow 9
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-cash-flow.html, key-cash-flow-phone.html, key-net-worth.html, key-spending.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, section E-7

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Decision (2026-10-05, correct course after UX): Cash flow is the landing page and this epic switches the `/` redirect from `/transactions` to `/cash-flow`; net worth gets its own page with trend, plus Biggest little leaks and the share toggle.
- Waits on epic-import-dedupe-transfers because: reports need categorised splits imported from real statements.
- Waits on epic-app-shell-settings-theming because: it owns the `/` landing redirect this epic switches.
- Decision (2026-10-05, user): epic-app-shell-settings-theming builds an empty Settings › Household section; this epic adds its 50/50 attribution control.
