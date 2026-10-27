---
type: epic
title: "Tax pack and activities"
parent: initiative-pangolin-money-v1
covers: [CAP-12, CAP-13]
after: []
assignee: ""
risk: medium
---

# Tax pack and activities

## Description

A per-person, per-FY tax pack: deductions by ATO label with work-use percentages, depreciation flags, a WFH hours log, investment income and a capital-gains schedule, and super against caps. It exports as CSV and as a PDF bundle with encrypted receipts. Activities roll up spending and prefill suggestions. The rental schedule reads property net cash from epic-loans-property. Milestone M4.

## Outcome

Each of us hands the accountant a complete FY pack straight from the app. Pack totals matching a hand check is the signal.

## Done when

1. For a seeded FY, the deduction summary, capital-gains schedule and cap comparison match hand-computed totals, exported as CSV and as a PDF bundle.
2. Exported CSV cells that begin with =, +, - or @ are neutralised. The app warns before deleting a receipt less than 5 years after lodgement.
3. A dated activity shows total, by-category, by-person and against-budget rollups. It offers itself as a suggestion for a seeded transaction in its date range.
4. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

Tax reports, receipts (on epic-import-dedupe-transfers' attachment storage), and activities; not the property view (epic-loans-property). The app gives no tax advice and lodges nothing.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-12, CAP-13
- tax — _bmad-output/specs/spec-pangolin-money/investments-super-tax.md, section Tax and activities
- csv export — _bmad-output/specs/spec-pangolin-money/security-and-recovery.md, section Threats and mitigations
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-3, AD-4, AD-13, AD-14, AD-21, AD-22, AD-23, AD-24

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Decision (2026-10-05, D3): CAP-11 and the property view move to epic-loans-property (reverses 2026-09-27); the `split.property_id` handoff moves with it.
- Waits on epic-investments-super because: the pack needs realised capital gains, distributions and contributions.
- Waits on epic-loans-property because: the rental schedule reads property net cash.
