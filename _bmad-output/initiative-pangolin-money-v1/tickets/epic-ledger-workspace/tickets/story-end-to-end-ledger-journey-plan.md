---
title: 'End-to-end ledger journey'
type: 'feature'
ticket: 10
created: '2026-10-16'
status: done
baseline_revision: '5a423288b494c06cc528bfcd1a9383db671e81af'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 12 Done-when 2 requires an end-to-end test on the seeded ledger at `/transactions` validating URL filtering, transaction sheet opening, splitting into two splits summing to the parent, tagging, and setting split beneficiary.

**Approach:** Add a dedicated Playwright test to `e2e/ledger.spec.ts` that navigates to `/transactions` with URL filter parameters, opens a seeded transaction in `TransactionSheet`, splits it into two splits summing to the parent, tags a split, sets a split beneficiary, and verifies both UI and API state before restoring the transaction.

</frozen-after-approval>

## Implementation Notes

- Added `end-to-end ledger journey: filter through URL, split transaction, tag split, and set beneficiary (Done-when 2)` test to `e2e/ledger.spec.ts`.
- Extended `ApiTransaction` interface with optional `accountId?: string`.
- Test flow:
  1. Signs in as person-a (Alex) and loads identity from `/api/identity/me`.
  2. Resolves a shared account and a single-split expense transaction.
  3. Navigates to `/transactions?account=...&from=...&to=...&type=out` validating URL filtering.
  4. Opens the transaction in `TransactionSheet`.
  5. Splits it into two splits summing to the parent amount and saves with explicit response synchronization.
  6. Dynamically picks a tag from the split's scoped combobox listbox and attaches it.
  7. Sets the split beneficiary to Alex and awaits the `PATCH` response.
  8. Verifies via `/api/ledger/transactions/:id` that both splits, sums, beneficiary, and tag are correctly saved.
  9. Restores the transaction to a single split and verifies teardown completes cleanly.
- Review findings: patched `/api/identity/me` endpoint, dynamic tag selection, scoped listbox locator, explicit response waits for split and beneficiary writes, and teardown verification.

## Plan Change Log

## Review Triage Log

Pass 1 (quick). Counts: high 1 patched, medium 4 patched, low 0, false 0, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `e2e/ledger.spec.ts`: Endpoint `/api/auth/me` does not exist on server | high | patch | Replaced with `GET /api/identity/me` per `apps/server/src/http/app.ts:306` and `apps/web/src/api.ts:130`. |
| `e2e/ledger.spec.ts`: Hardcoded seed tag name `"Holiday"` violates test suite rules | medium | patch | Dynamically extracted tag name from first option in split's tag combobox listbox. |
| `e2e/ledger.spec.ts`: Unscoped `page.getByRole("listbox")` locator | medium | patch | Scoped listbox to `split2Group.getByRole("listbox", { name: "Add a tag" })`. |
| `e2e/ledger.spec.ts`: Race condition between beneficiary selection and API verification | medium | patch | Awaited `PATCH /api/ledger/transactions/:id/splits/:splitId` response before querying API. |
| `e2e/ledger.spec.ts`: Race condition and unverified teardown on transaction restoration | medium | patch | Awaited `PUT /api/ledger/transactions/:id/splits` response, verified `split2Group` removal, and asserted API transaction splits length reset to 1. |

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: clean with no TypeScript errors
- `pnpm lint` -- expected: clean with no Biome errors
- `node scripts/check-boundaries.ts` -- expected: clean with no boundary errors
