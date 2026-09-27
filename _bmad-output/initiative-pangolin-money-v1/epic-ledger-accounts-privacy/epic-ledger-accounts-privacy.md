---
type: epic
title: "Ledger, accounts and privacy"
parent: initiative-pangolin-money-v1
covers: [CAP-3, CAP-18, CAP-14]
after: []
assignee: ""
risk: high
---

# Ledger, accounts and privacy

## Description

Institutions, accounts, ownership shares, transactions, splits, tags, payees and transfer groups exist behind one privacy path. A partner can browse, filter, split and tag transactions, and never sees the other's private accounts or hidden names. Milestone M1.

## Outcome

Both of us can work in one shared ledger that respects per-person privacy. The cross-user privacy tests are the signal.

## Done when

1. Tests that try cross-user reads of private accounts and hidden names fail through the API, search, export and audit log, and hidden names lift after 12 months.
2. In an end-to-end test, the seeded ledger is filtered through URL parameters. A transaction is split into two splits that sum to the parent, it is tagged, and the split carries a beneficiary.
3. No query reads `account` or `transaction` except through `visibleAccounts()`/`redact()`. A lint or test rule enforces this.
4. The transaction list stays responsive at 50,000 seeded rows.
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

The ledger and classification tables in data-model.md, except import_*, rule and suggestion, together with the transaction list UI. CAP-14 part: the beneficiary on each split and the payer from the account owner. Contribution apportionment belongs to epic-spending-insight. Not import (epic-import-dedupe-transfers).

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-3, CAP-14, CAP-18
- data model — _bmad-output/specs/spec-pangolin-money/data-model.md, sections Conventions, Tables, Privacy enforcement

## Notes

- Open question: architecture spine (bmad-architecture, pending) must settle the visibleAccounts()/redact() contract before inception; cite its section in References once written.
