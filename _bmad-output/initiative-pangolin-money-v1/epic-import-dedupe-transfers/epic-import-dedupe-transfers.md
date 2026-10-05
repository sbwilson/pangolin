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

Every v1 format except PDF goes through one idempotent pipeline: parse, normalise, dedupe, match payee, apply rules, match transfers, reconcile, and review. The formats are CommBank OFX/CSV/QIF, ubank CSV, Up CSV, the FY2025 multi-bank profile and a generic CSV mapper. Unreadable CSV, OFX and QIF rows are set aside for fixing while good rows commit, a file can be handed to the partner, and Needs review shows every review-item kind. M1 carries the most risk, because every later report depends on this epic. Milestone M1.

## Outcome

Our real history since 1 July 2024 is in the ledger and reconciles to the bank. This is the M1 gate.

## Done when

1. Twelve months of our real data are imported with no unexplained balance gaps. (M1 gate)
2. Each format imports its committed anonymised sample. Re-importing the same file, or an overlapping range, adds zero rows. A CSV, OFX or QIF file with unreadable rows commits its good rows and sets the rest aside with row number and reason. Fixing a set-aside row commits it through the same batch.
3. Two identical same-day coffees stay two transactions. A unique opposite amount within ±3 days is auto-linked as a transfer, and an ambiguous one goes to review. Categorisation uses the rule, then the payee default; anything else lands in the review inbox, and accepting a correction offers a new rule.
4. Needs review shows every registered kind with its actions, and an end-to-end test clears an item on the seeded ledger. The partner-pending count changes only with shared-visible items. Identity notices are review items and keep "Revoke the link". The inbox routes join epic-ledger-accounts-privacy's server-side privacy suite.
5. A file handed to the partner raises a hand-off item only she can see. She imports it into her private account, and the sender's responses are byte-identical to before (AD-5).
6. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

packages/importers and the import, payee-matching, rules and transfer stages in domain. CAP-1 part: every format except PDF. CAP-2 part: rules, payee default and review inbox; LLM suggestions belong to epic-llm-categorisation-pdf. CMC Invest confirmations belong to epic-investments-super (spine AD-10). Also attachment storage (moved from epic-llm-categorisation-pdf; hand-off files first, AD-21), `import_handoff`, the Import popover, batch undo, the Needs review UI with the partner-pending count, and moving identity notices from `/api/identity/notices` to review-item kinds. It also takes over from epic-ledger-workspace (its entries 2 and 4): wiring the Needs review chip on `/transactions` to data, the target of the summary line's "N need review" link, the Import button beside the Transactions search, moving account freshness from the newest `posted_on` to `import_batch`, import provenance on accounts, and the stale row's Import shortcut. PDF statements stay all-or-nothing (epic-llm-categorisation-pdf). Owns touch point NetBank history export (a person does it).

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-1, CAP-2
- pipeline — _bmad-output/specs/spec-pangolin-money/import-pipeline.md, including section Hand-off to the partner
- categories — _bmad-output/specs/spec-pangolin-money/categorisation.md, section Default categories
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-5, AD-10, AD-12, AD-15, AD-17, AD-19, AD-20, AD-21, AD-22, AD-23
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Needs review item kinds, State Patterns (Import), Interaction Primitives (Import popover), Flow 4
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-import-popover.html, key-needs-review.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, section E-6

## Notes

- Unknown: pre-FY2026 CommBank history must be exported from NetBank before the M1 gate; a person does it.
- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Handoff (2026-10-04, epic 2 inception): the review inbox UI and promoting AD-18-scoped payees, aliases, tags and activities to shared are this epic's; epic-ledger-accounts-privacy builds the tables, scope and visibility only.
- Handoff (2026-10-05, epic 2 retro): promoting scoped payees, tags and activities to shared must satisfy epic-ledger-accounts-privacy entry 15's setPrivacy(public) guard, which refuses while an account carries owner-scoped references.
- Handoff (2026-10-05, epic 2 retro): dedupe must not read fingerprints through a person viewer's projection; epic-ledger-accounts-privacy entry 14 projects fingerprint and externalId to NULL while a row's name is hidden.
- Decision (2026-10-05, D5): partial import for CSV, OFX and QIF only; PDF stays all-or-nothing. Set-aside rows can be read by the LLM (`row_interpret`), which epic-llm-categorisation-pdf adds.
- Decision (2026-10-05): import for the partner is a hand-off, never direct; the sender never learns the account or batch she chose (AD-5).
- Decision (2026-10-05): attachment storage moves here from epic-llm-categorisation-pdf (AD-21); identity notices migrate to review items when the inbox UI ships (AD-17).
- Decision (2026-10-05, validation): takes over from epic-ledger-workspace entries 2 and 4 the Needs review chip wiring, the summary line's "N need review" link target, the Import button beside the Transactions search, account freshness from `import_batch` (replacing the newest `posted_on`), import provenance and the stale row's Import shortcut.
- Waits on epic-ledger-accounts-privacy because: the pipeline writes its account, transaction, split and transfer_group tables through visibleAccounts()/redact().
- Waits on epic-app-shell-settings-theming because: the Import button and Needs review live in its shell, and the identity notices leave its Settings page.
