---
title: 'm1-report and opening-balance run as a named person'
type: 'bugfix'
ticket: ''
created: '2026-10-22'
status: 'draft'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/epic-import-dedupe-transfers/epic-import-dedupe-transfers-retrospective.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `pangolin m1-report` and `pangolin opening-balance` run as the system viewer, which sees every account. `m1-report` prints the names, ids, batch ids and ledger balances of a partner's private accounts, and `opening-balance` answers "already has a snapshot dated X" for, and can write a snapshot onto, any account id, including a partner's private one (retro finding F7).

**Approach:** Both commands take a required `--as <name>` and run the existing use cases as that person's viewer, so they see and change only what that person can. The report is per person; the gate is checked once for each.

## Boundaries & Constraints

**Always:**
- `pangolin m1-report --as <name>` and `pangolin opening-balance --as <name> <account-id> <YYYY-MM-DD> <amount>`: the name is a household person's display name, matched case-insensitively among active people. A missing `--as` is a usage error (exit 2); an unknown or ambiguous name exits 1 with a message that names no account and nothing about other people's data.
- The server resolves the name through a new `app` use case (no repository read in the command, per AD-16) and builds a person viewer with `personViewer`; `m1GateReport` and `recordBalanceSnapshot` then run unchanged, so `accounts.list` and `findVisible` do the filtering.
- `opening-balance` on an account the named person cannot see answers exactly what an unknown account id answers (`NotFound`, exit 1): no snapshot date, no existence signal.
- The audit row of an `opening-balance` write carries the named person as actor (the person is the operator); the other admin commands keep `cli:<command>` and the system viewer.
- Totals in `m1-report` count only the accounts that person sees; `docs/m1-gate.md` says to run it once per person.

**Never:**
- No change to `m1GateReport`, `recordBalanceSnapshot` or any use case's logic; no new socket commands; no password or session for `--as` (the operator already has root on the host); no change to `status`, `backup`, `reset-user`, `confirm-bundle` or `seed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Report as Alex | Alex has a private account, Sam has one | Only shared and Alex's accounts; totals over those | n/a |
| Report as Sam | Same ledger | Only shared and Sam's accounts | n/a |
| Missing `--as` | `pangolin m1-report` | Usage error | exit 2 |
| Unknown name | `--as Nobody` | "No active person named Nobody" | exit 1 |
| Ambiguous name | Two people share a display name | Refuses, asks for the exact name | exit 1 |
| Opening on own private account | Alex, Alex's private id | Snapshot recorded, audited with Alex as actor | n/a |
| Opening on the partner's private account | Alex, Sam's private id | Same `NotFound` as an unknown id, nothing written | exit 1 |

</frozen-after-approval>

## Code Map

- `packages/app/src/identity/` (or `system/`) -- new `findActivePersonByName(ctx, name)` use case returning the person's id or `NotFound`/`Conflict`; export from `packages/app/src/index.ts`; test.
- `apps/server/src/admin/commands.ts` -- `m1ReportCommand` and `openingBalanceCommand`: accept `as`, resolve it, run with `personViewer`; update the zod arg schemas and the header comment.
- `apps/server/src/cli.ts` -- `USAGE`, argument parsing for `--as`, usage errors; `printM1Report` header names the person.
- `apps/server/src/cli.test.ts` -- every matrix row with a real database; the opening-balance audit actor test now expects the person.
- `docs/m1-gate.md` -- run once per person; the command forms.
- Reuse, don't change: `m1-report.ts`, `accounts/balance.ts`, `personViewer`.

## Tasks & Acceptance

**Execution:**
- [ ] Name-lookup use case with tests.
- [ ] Both commands take `--as`, run as that person; CLI parsing and usage.
- [ ] CLI tests for every matrix row; docs.

**Acceptance Criteria:**
- Given Alex and Sam each with a private account, when `m1-report --as Alex` runs, then Sam's private account (name, id, batches, balance) appears nowhere in the output.
- Given Sam's private account id, when `opening-balance --as Alex` targets it, then the answer matches an unknown id and nothing is written.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:strict` -- expected: clean.
