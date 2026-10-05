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

Shared and personal budgets per category or group, on a fortnight or month cycle anchored to each payday, with spent, pace, projected and optional rollover; the editor suggests a limit from recent spending, and going over the limit raises a review item. Recurring bills are detected from payee, interval and amount, confirmed with one click, and alerted when missed or up more than 10%. Milestone M3.

## Outcome

Each of us can see whether this fortnight is on track, and bill rises are spotted early.

## Done when

1. For a seeded budget, spent, pace and projected match a hand calculation. Rollover carries correctly into the next period. The editor suggests a limit from the last 6 periods. Overspending raises one over-budget review item per budget per period.
2. Personal budgets follow each person's payday anchor. Shared budgets use the household anchor and count shared splits, whoever paid.
3. A synthetic series of at least 3 occurrences is detected and one-click confirmed. A missed payment and an 11% rise each raise an alert.
4. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

Budgets and recurring_series, with their UI, the limit suggestion and the `over_budget` review-item kind (personal budgets' items scoped per AD-22). Owns pay_anchor, pay-deposit detection and PayCalendar resolution (spine AD-14, AD-25); the calendar and FY maths in shared/period come from epic-platform-foundations. Adds the pay cycles and household pay anchor controls to the empty Settings › Household section that epic-app-shell-settings-theming builds. Not goals and not forecasting.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-4, CAP-5
- budgets — _bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md, sections Budgets and Recurring bills
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-11, AD-14, AD-17, AD-22, AD-23, AD-25
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Component Patterns (Planning), Needs review item kinds, Flow 5
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-budgets.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, section E-9

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Decision (2026-10-05, correct course after UX): the limit suggestion is the mean spent over the last 6 closed periods of that cadence, with no suggestion without history; one over-budget review item per budget per period.
- Waits on epic-import-dedupe-transfers because: budgets count categorised splits and bills are detected from payees.
- Waits on epic-spending-insight because: it lays out the Settings › Household card with the 50/50 attribution control; this epic adds pay cycles and the household pay anchor above it.
- Decision (2026-10-05, user): epic-app-shell-settings-theming builds an empty Settings › Household section; this epic adds its pay cycles and household pay anchor controls.
- Note (2026-10-05, validation): epic-home-buying-planner (15) reads pay_anchor gross and net pay from this epic.
