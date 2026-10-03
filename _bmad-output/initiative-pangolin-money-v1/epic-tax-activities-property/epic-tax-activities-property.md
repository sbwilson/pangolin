---
type: epic
title: "Tax pack, activities and property"
parent: initiative-pangolin-money-v1
covers: [CAP-12, CAP-13, CAP-11]
after: []
assignee: ""
risk: medium
---

# Tax pack, activities and property

## Description

A per-person, per-FY tax pack: deductions by ATO label with work-use percentages, depreciation flags, a WFH hours log, investment income and a capital-gains schedule, and super against caps. It exports as CSV and as a PDF bundle with encrypted receipts. Activities roll up spending and prefill suggestions. An investment-property view shows net cash position and gearing. Milestone M4.

## Outcome

Each of us hands the accountant a complete FY pack straight from the app. Pack totals matching a hand check is the signal.

## Done when

1. For a seeded FY, the deduction summary, capital-gains schedule and cap comparison match hand-computed totals, exported as CSV and as a PDF bundle.
2. Exported CSV cells that begin with =, +, - or @ are neutralised. The app warns before deleting a receipt less than 5 years after lodgement.
3. A dated activity shows total, by-category, by-person and against-budget rollups. It offers itself as a suggestion for a seeded transaction in its date range.
4. A seeded property shows the documented net cash position and gearing. It is hidden from the partner when its loan account is private.
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

Tax reports, attachments and receipts, activities, and the property view. The app gives no tax advice and lodges nothing. The mortgage interest/principal split is a spec non-goal.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-11, CAP-12, CAP-13
- tax — _bmad-output/specs/spec-pangolin-money/investments-super-tax.md, sections Investment property and Tax and activities
- csv export — _bmad-output/specs/spec-pangolin-money/security-and-recovery.md, section Threats and mitigations
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-3, AD-4, AD-13, AD-14, AD-21, AD-22, AD-23, AD-24

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Handoff (2026-10-04, epic 2 inception): split.property_id is created nullable with no foreign key by epic-ledger-accounts-privacy; this epic adds the property table and the foreign key.
