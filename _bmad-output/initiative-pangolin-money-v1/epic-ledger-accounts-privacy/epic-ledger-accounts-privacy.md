---
type: epic
title: "Ledger core and privacy"
parent: initiative-pangolin-money-v1
covers: [CAP-3, CAP-18, CAP-14, CAP-16]
after: []
assignee: ""
risk: high
---

# Ledger core and privacy

## Description

Institutions, accounts, ownership shares, transactions, splits, tags, payees and transfer groups exist behind one privacy path, with the server modules and API that read and change them. A partner never sees the other's private accounts or hidden names through any API. The web workspace on top (list, editing, search, export, performance) is epic-ledger-workspace. Milestone M1, with that epic.

## Outcome

Both of us can work in one shared ledger that respects per-person privacy. The cross-user privacy tests are the signal.

## Done when

1. Tests that try cross-user reads of private accounts and hidden names fail through every API route and review items: partner B's responses are byte-identical when only partner A's private data changes, a private account's IDs are NotFound to the partner for reads and writes, and hidden names lift after 12 months.
2. No query reads `account` or `transaction` except through `visibleAccounts()`/`visibleTxn()`, and responses pass through `redact()`. A lint or test rule enforces this.
3. Through the API, the seeded ledger can be listed per viewer, a transaction split into splits that sum to the parent, a split tagged and given a beneficiary, a shared-account name hidden, and a manual transfer group made.
4. The backup manifest carries per-account transaction counts, amount sums and balanceAsOf (spine AD-19), and a format-1 backup still restores.
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

The ledger and classification tables in data-model.md, except import_*, rule and suggestion, with the accounts, classify and ledger modules, their API, the privacy path and the seed. The web workspace, search, export, the audit-log API and the 50,000-row performance work are epic-ledger-workspace. CAP-14 part: the beneficiary on each split and the payer from the account owner. Contribution apportionment belongs to epic-spending-insight. Not import (epic-import-dedupe-transfers).

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-3, CAP-14, CAP-18, CAP-16
- data model — _bmad-output/specs/spec-pangolin-money/data-model.md, sections Conventions, Tables, Privacy enforcement
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-3, AD-4, AD-5, AD-7, AD-10, AD-15, AD-17, AD-18, AD-19, AD-20, AD-22, AD-26
- categories — _bmad-output/specs/spec-pangolin-money/categorisation.md, the default categories

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Handoff (2026-09-27): this epic adds per-account balance sums (balanceAsOf, spine AD-19) to the backup manifest that epic-platform-foundations entry 10 builds.
- Decision (2026-10-04): inception split epic 2 into this epic (server core and privacy) and epic-ledger-workspace (web workspace, search, export, audit API, performance). Epics 3 and 9 need only this one.
- Decision (2026-10-04): e2e seeding through the admin `seed` command, which links the seed's two people to the signed-up logins (entry 1); a separate 50,000-row perf profile in epic-ledger-workspace.
- Decision (2026-10-04): hiding a transaction's name applies only to transactions in shared accounts: any owner may hide it, for at most 12 months from hiding; re-hiding restarts the clock, still capped at 12 months; notes stay visible. Private accounts are invisible to the partner, permanently.
- Decision (2026-10-04): basic category CRUD and the default categories here; payees, aliases, tags and activities with AD-18 scope here, promotion to shared in epic-import-dedupe-transfers; manual transfer groups and "Transfer from <owner>" here; the review inbox UI in epic-import-dedupe-transfers (this epic composes visibleAccounts into review items); `activity` and `tax_category` tables now, `property_id` nullable without a foreign key until epic-loans-property (corrected 2026-10-05: CAP-11 property moved there from epic-tax-activities-property).
- Decision (2026-10-04): the split editor's remaining amount comes from the server; manifest format 2 with per-account balances for cash account types, format 1 still readable.
- Decision (2026-10-04): tracer bullet is entry 1 (one account's transactions seen per viewer, through db, app, API, a minimal page, the seed and e2e). After it, entry 3 (privacy core) is the least certain. Entries 4 and 5 run in parallel after 3.
- Decision (2026-10-05): the retrospective (rejected) adds remediation entries 14–19 from its action items 1–2; the epic is re-retro'd after 19, before it is marked done.
- Decision (2026-10-05, ownership takeover): a hidden name stays hidden from everyone but the person who hid it whatever the account's privacy or owners, so a hiding outlives a switch to private and only the hider sees the name until it expires; only a person can remove themselves from an account's owners (entry 15; AD-4 and data-model Hidden transactions amended).
- Decision (2026-10-05): no new refactor sweep for entries 14–19; the retro's deferrals A2–A8, I8 and P10 go to the next sweep, epic-ledger-workspace entry 9.
- Decision (2026-10-05): entries 14 → 15 → 16 run in sequence because they share visibleTxn, the memory mirror and the ledger use cases; 17 runs in parallel after 9; 18 closes over all four.
- Decision (2026-10-05): P2 (fingerprint and externalId of a hidden row) is fixed now in entry 14 rather than waiting for epic-import-dedupe-transfers.
- Decision (2026-10-05, user, 80): audit rows recorded while an account was private keep owner-only scope after it goes public, so pre-flip scoped payee, tag and activity ids stay owner-only (entry 15).
- Decision (2026-10-05, user, 81): when one side of a transfer is deleted and the survivor sits in the partner's private account, clearing the survivor's group link is allowed as invariant upkeep, audited with owner-only scope (entry 16, I3).
- Decision (2026-10-05, user, 82): AD-19 is amended to allow the backup manifest's system-level balance read; manifest.ts stays on the read-rule allow-list (entry 18, retro A13).
- Decision (2026-10-05, user, 83): check-upgrade may use the UTC date for the manifest's balanceDate (entry 17, I7).
- Decision (2026-10-05): P9 (whether hiding a name also hides split memo and tags, or warns) is deferred to Simon's spec reconciliation (retro action item 7); entries 14–19 do not wait on it.
- Note (2026-10-05): Entry 17 fixes future drill summaries only; the home server's v0.2.0 manifest has an empty accounts section because it holds no ledger rows (docs/release-v0.2.0.md:301), so no stored drill summary can carry account figures; no scrub needed.
- Decision (2026-10-05): CAP-16 added to this epic's covers (retro action item 5, A12); entries 9, 12, 17 and 19 cover it.
