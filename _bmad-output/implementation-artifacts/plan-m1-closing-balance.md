---
title: 'M1 report: ledger balance per account'
type: 'feature'
ticket: ''
created: '2026-10-21'
baseline_revision: '647f183317958aab6cab0a5e5581aa8dff7742b8'
status: done
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: [quick]
review_loop_iteration: 0
context:
  - '{project-root}/docs/m1-gate.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The M1 report proves statement coverage and internal consistency but never shows an account's balance, so the human cannot compare the ledger with the bank, which is what "reconciles to the bank" means.

**Approach:** For each account with a snapshot dated before its first covered date, print the ledger balance as of its newest covered date (the existing `balanceAsOf`: latest snapshot on or before the date plus later transactions), e.g. `ledger balance $3292.29 on 2026-10-15`. With no such snapshot the sum would start from 0, so print nothing. Update the report type, the CLI printer, tests and docs/m1-gate.md.

</frozen-after-approval>

## Implementation Notes

Small and cohesive, so one-shot: `M1AccountReport.ledgerBalance` is computed in `accountReport` through an injected `balanceOn` function, which `m1GateReport` backs with `repos.balanceSnapshots.balanceAsOf`.

## Review Triage Log

- Ledger balance printed for a snapshot the report rejects (opening contradicts the first batch's derived opening) -- verdict: medium -- patched: gated on `openingBefore(...)`, test added.
- `balanceAsOf` counts pending and manual rows, so it can differ from the bank (docs) -- verdict: low -- patched: documented under the ledger-balance paragraph.
- Evidence table lacks a ledger/bank column -- verdict: low -- patched by pointing to Findings per account in the doc.
- Printed line order, over-long doc line, untested viewer wiring, `newest < from` and multi-snapshot cases -- verdict: low/false -- rejected: consistent with the printer and covered end to end by the CLI test.
