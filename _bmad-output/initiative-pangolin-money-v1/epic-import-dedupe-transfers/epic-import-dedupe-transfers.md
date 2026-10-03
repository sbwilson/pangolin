---
type: epic
title: "Import, dedupe and transfer matching"
parent: initiative-pangolin-money-v1
covers: [CAP-1, CAP-2, CAP-18]
after: []
assignee: ""
risk: high
---

# Import, dedupe and transfer matching

## Description

Every v1 format except PDF goes through one idempotent pipeline: parse, normalise, dedupe, match payee, apply rules, match transfers, reconcile, and review. The formats are CommBank OFX/CSV/QIF, ubank CSV, Up CSV, the FY2025 multi-bank profile and a generic CSV mapper. M1 carries the most risk, because every later report depends on this epic. Milestone M1.

## Outcome

Our real history since 1 July 2024 is in the ledger and reconciles to the bank. This is the M1 gate.

## Done when

1. Twelve months of our real data are imported with no unexplained balance gaps. (M1 gate)
2. Each format imports its committed anonymised sample. Re-importing the same file, or an overlapping range, adds zero rows.
3. Two identical same-day coffees stay two transactions. A unique opposite amount within ±3 days is auto-linked as a transfer, and an ambiguous one goes to review.
4. Categorisation uses the rule, then the payee default. Anything else lands in the review inbox, and accepting a correction offers a new rule.
5. An end-to-end test clears a review-inbox item on the seeded ledger; the inbox routes join epic-ledger-accounts-privacy's server-side privacy suite.
6. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

packages/importers and the import, payee-matching, rules and transfer stages in domain. CAP-1 part: every format except PDF. CAP-2 part: rules, payee default and review inbox; LLM suggestions belong to epic-llm-categorisation-pdf. CMC Invest confirmations belong to epic-investments-super (spine AD-10). Owns touch point NetBank history export (a person does it).

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-1, CAP-2
- pipeline — _bmad-output/specs/spec-pangolin-money/import-pipeline.md
- categories — _bmad-output/specs/spec-pangolin-money/categorisation.md, section Default categories
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-10, AD-12, AD-15, AD-17, AD-19, AD-20, AD-23

## Notes

- Unknown: pre-FY2026 CommBank history must be exported from NetBank before the M1 gate; a person does it.
- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Handoff (2026-10-04, epic 2 inception): the review inbox UI and promoting AD-18-scoped payees, aliases, tags and activities to shared are this epic's; epic-ledger-accounts-privacy builds the tables, scope and visibility only.
