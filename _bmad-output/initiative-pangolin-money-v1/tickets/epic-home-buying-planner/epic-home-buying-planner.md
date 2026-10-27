---
type: epic
title: "Home buying planner"
parent: initiative-pangolin-money-v1
covers: [CAP-19]
after: []
assignee: ""
risk: high
---

# Home buying planner

## Description

Together we estimate what we can borrow, what the repayments are and what's left to live on. Borrowing is estimated two ways, simple and a lender-style serviceability estimate with editable defaults, and can include the properties we already own, either used for equity or sold. Up to three scenarios sit side by side, and named plans are saved for both of us, built only from data both of us can see. Milestone M3, and the last epic in it, so it carries the M3 gate. The spec's CAP-19 and its home-buying companion own the detail.

## Outcome

We can sit down together and see what we can afford on our own real numbers, without either of us revealing a private account; CAP-19's hand-checked seed and the M3 gate are the signal.

## Done when

1. One full budget cycle is tracked for both of us, and the home buying planner works on our real data. (M3 gate)
2. Against the seed, borrowing power (simple and lender-style, with the default buffer, living costs, rent, card-limit and DTI assumptions), repayments and the rate-stress row match a hand calculation, including a property used for equity and one sold, across up to three scenarios.
3. A private loan or property never changes a plan's figures for either partner and appears to its owner as "Not in shared plans"; the other partner's planner responses are byte-identical whether or not it exists (AD-28).
4. A reopened plan shows only its saved headline (borrow, repayment, left to live on) beside today's recalculation; every other figure is recomputed from its saved inputs and currently shared data, and an input made private since drops out with "Some inputs are no longer shared".
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

`home_plan` in `planning`, planner maths in `domain/planner` (through `shared.toCents`/`allocate`), the `sharedScope()` read path, and the Planning › Home buying page (`/planning/home-buying`) with its Home buying glimpse on Cash flow. HEM and the CGT estimate rate are `fy_config` keys entered by hand; nothing is fetched. Every figure is an estimate, not a lender's offer or tax advice. Not loans, properties or their ownership (epic-loans-property), not pay anchors (epic-budgets-bills), not the deposit goal (epic-goals-savings). Not the post-v1 extension showing rate pressure on savings and flexible categories.

## References

- parent — _bmad-output/initiative-pangolin-money-v1/initiative-pangolin-money-v1.md
- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-19
- home buying — _bmad-output/specs/spec-pangolin-money/home-buying.md
- data model — _bmad-output/specs/spec-pangolin-money/data-model.md, Tables (Planning `home_plan`)
- milestones — _bmad-output/specs/spec-pangolin-money/deployment-and-ops.md, section Milestones (M3 gate)
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-3, AD-7, AD-11, AD-13, AD-28
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Home Buying Planner, Component Patterns (Planning, Saved plan row), State Patterns (Planning), Flow 1, Flow 3
- design — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md, section Components (Planning)
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-home-buying.html, key-home-buying-phone.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, sections 4.1 Decisions (D4) and E-10

## Notes

- Decision (2026-10-05, D4): `home_plan` stores typed inputs and choices plus a headline snapshot only (borrow, repayment, left to live on); everything else is recomputed from shared-visible data, the one allowed exception to AD-7 (AD-11, AD-28).
- Decision (2026-10-05, G3): the M3 gate moves here from epic-forecasting, the last M3 epic.
- Decision (2026-10-05, after approval): the M3 gate keeps both checks: one full budget cycle tracked for both of us, and the home buying planner works on our real data.
- Waits on epic-loans-property because: existing properties and loans (value, LVR, ownership, terms) feed equity, sell and debt figures.
- Waits on epic-budgets-bills because: take-home income comes from each pay_anchor's gross and net pay.
- Waits on epic-goals-savings because: the deposit comes from the shared deposit goal or the shared savings pool.
