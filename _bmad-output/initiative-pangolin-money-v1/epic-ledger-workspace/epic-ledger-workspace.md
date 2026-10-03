---
type: epic
title: "Ledger workspace"
parent: initiative-pangolin-money-v1
covers: [CAP-18, CAP-3, CAP-14]
after: []
assignee: ""
risk: high
---

# Ledger workspace

## Description

The web workspace on top of epic-ledger-accounts-privacy's server core: a transaction list with filters in the URL that stays fast at 50,000 rows, editing of splits, tags, beneficiaries and hidden names, account screens, search, CSV export and the audit-log API, all on the same privacy path. Milestone M1, with that epic.

## Outcome

Both of us browse, filter and edit one shared ledger in the browser without ever seeing the other's private accounts or hidden names; the end-to-end ledger journey and the cross-user privacy suite are the signal.

## Done when

1. Tests that try cross-user reads of private accounts and hidden names fail through search, CSV export and the audit-log API, extending epic-ledger-accounts-privacy's server-side privacy suite.
2. In an end-to-end test, the seeded ledger is filtered through URL parameters. A transaction is split into two splits that sum to the parent, it is tagged, and the split carries a beneficiary.
3. The transaction list's first page answers within 300 ms server-side on the 50,000-row profile, and the list is virtualised.
4. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

The web app (router, table, list, editors, account screens), search (FTS5), CSV export, the audit-log read API and the 50,000-row performance work. Not the ledger tables, modules or privacy core (epic-ledger-accounts-privacy). Not the review inbox UI (epic-import-dedupe-transfers). The web never sums money.

## References

- parent — _bmad-output/initiative-pangolin-money-v1/initiative-pangolin-money-v1.md
- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-3, CAP-14, CAP-18
- data model — _bmad-output/specs/spec-pangolin-money/data-model.md, Privacy enforcement
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-3, AD-4, AD-5, AD-9, and Consistency Conventions (Frontend state, API, Tests)
- core — _bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/epic-ledger-accounts-privacy.md, its Notes' decisions

## Notes

- Decision (2026-10-04): split out of epic 2 at its inception; see epic-ledger-accounts-privacy's Notes for the shared decisions.
- Decision (2026-10-04): adopt TanStack Router (URL search params), TanStack Table and Virtual, and Tailwind/shadcn as the opening story; search and CSV export (re-authentication) get an API and a basic UI; the audit log is API-only, with redact() on its before/after JSON; a separate 50,000-row perf profile with a first-page bar of 300 ms server-side.
- Waits on epic-ledger-accounts-privacy because: the list, editors, search, export and audit read its modules, API and privacy path; the end-to-end test needs its seeded ledger.
