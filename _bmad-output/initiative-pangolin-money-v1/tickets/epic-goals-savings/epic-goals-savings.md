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

Virtual goals funded from positive new savings through staged, ordered allocation rules. A stage exits when its goal is funded, a completed goal's share is rescaled, and the emergency fund falls back below its threshold. Each pool is reconciled so that goal balances + buffer = savings-account balance. A deficit draws down only the buffer (option A). A large purchase or a shortfall is covered by an explicit drawdown across goals by kind (Flexible, Protected, emergency fund). Milestone M3.

## Outcome

We know how much of our savings is earmarked for each goal, and the books never silently disagree with the bank.

## Done when

1. A seeded multi-period savings history produces goal_allocation rows that match the active stage's shares. Stage exit, rescale and fallback each log a stage change, and a drawdown that leaves the emergency fund below its threshold reactivates stage 1. A second emergency fund in one pool is rejected.
2. A deficit period reduces only the buffer, and no goal balance goes down except through a confirmed drawdown.
3. A seeded over-commitment shows a shortfall in the warning colour on the goals page and in the review inbox. Cover it proposes Flexible, then emergency fund, then Protected (warned); when the active stage gives the buffer a share, buffer divert is offered as the alternative (D8). Any other mismatch offers a one-click adjustment to the buffer.
4. A seeded shared-savings withdrawal over the threshold raises a Large withdrawal item for both partners. Covering it draws the emergency fund, then the proposed Flexible split, then Protected only after the warning. It writes one audited `goal_adjustment` per goal under one `goal_drawdown`, leaves both partners' personal goals untouched, and Undo restores every balance.
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

goal (kind, emergency fund), goal_rule, goal_allocation, allocation_stage, goal_drawdown and goal_adjustment, the goals page, the Cover an expense sheet, the large-withdrawal threshold and review item, and the reconciliation check after each period close and each import. Savings means balances of savings-flagged accounts; brokerage and super are never savings.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-6, CAP-7
- goals — _bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md, sections Goals and savings allocation, Goal priorities and stages, Reconciling goals with the savings account, Covering an expense
- decision — _bmad-output/specs/spec-pangolin-money/decisions.md, section Periods where spend exceeds income
- data model — _bmad-output/specs/spec-pangolin-money/data-model.md, Tables (Planning `goal`, `goal_rule`, `goal_drawdown`, `goal_adjustment`, `planning_setting`)
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-11, AD-13, AD-14, AD-17, AD-19, AD-22, AD-24, AD-26
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Component Patterns (Planning), Needs review item kinds, State Patterns (Cover an expense), Voice and Tone, Flow 6, Flow 10
- design — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md, section Components (Planning)
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-goals.html, key-cover-expense.html, key-cover-expense-phone.html, key-needs-review.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, sections 4.1 Decisions (D7, D8) and E-9

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Decision (2026-10-05, D7): goals are Flexible or Protected, with at most one emergency fund per pool. Cover an expense draws a large purchase from the emergency fund, then Flexible, then Protected (warned), and a shortfall from Flexible, then the emergency fund, then Protected (warned); confirmed, audited, undoable, one pool only. A Large withdrawal review item detects big savings withdrawals. Replaces D2's push-out.
- Decision (2026-10-05, D8): buffer divert (a time-boxed `goal_rule` override) is kept beside Cover it for a gradual shortfall.
- Decision (2026-10-05, G6 assumptions accepted): threshold ≥ $2,000 per pool, editable; new goals default to Flexible; the Flexible split is proportional to balances; the emergency fund is pre-filled up to its full balance; Cover never draws the buffer; Undo from the toast or goal history while the period is open.
- Assumption: epic grows by about one story for Cover an expense and detection; re-check sizing at inception.
- Waits on epic-platform-foundations because: the shared/period calendar and FY maths.
- Waits on epic-budgets-bills because: pay anchors, pay-deposit detection and PayCalendar.
- Note (2026-10-05, validation): epic-home-buying-planner (15) reads the shared deposit goal from this epic.
