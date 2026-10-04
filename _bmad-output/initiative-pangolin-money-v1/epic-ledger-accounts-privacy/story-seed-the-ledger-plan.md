---
title: 'Seed the ledger'
type: 'feature'
ticket: '8'
created: '2026-10-04'
status: 'built'
baseline_revision: '6fa4f2690aff22323cf1b99ccb84190fef66854f'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The seed makes three accounts and a few transactions with no institutions, balances, classification, splits, tags, payees, hidden names or transfers, so nothing exercises the ledger the epic built and the e2e harness cannot see a realistic ledger per partner.

**Approach:** Extend the seed with modules for institutions, accounts, snapshots, classification and a few hundred transactions, committed through the use cases and loaded by the existing admin `seed` command, which refuses a database that already holds ledger rows.

## Boundaries & Constraints

**Always:** Deterministic: fixed seed `pangolin-v1`, fixed today `2026-07-15`, one rng stream per module, byte-identical output. About 300 to 600 transactions over the 12 months before today, built from merchant and bill templates. Institutions, and accounts of every cash type (transaction, savings, offset, credit_card, home_loan): a shared joint account with a 50/50 split, one with unequal shares (6000/4000), and one private account per partner. Balance snapshots, tags and payees (some scoped to a private origin account), transactions with payees, categories by group and name, multi-split transactions with beneficiaries and tags, some shared-account names hidden, and a manual transfer group whose counterpart sits in a partner's private account. Events are committed through the use cases (`createInstitution`, `createAccount`, `recordBalanceSnapshot`, payee and tag use cases, `createTransaction`, `setSplits`, `setSplitField`, `setSplitTags`, `hideTransactionName`, `createTransferGroup`) as the system, with the audit actor `cli:seed` as the provenance (AD-15). `parseSeed` validates every new event type up front. The `seed` command still refuses when any account or transaction exists, and a second load fails with `Conflict`. The seed emits expectations (counts, per-viewer visible counts, hidden keys, transfer keys) that tests assert against. Only the five cash account types appear. The demo path loads the extended seed and stays byte-identical across runs. `e2e/ledger.spec.ts` derives its expectations instead of hard-coding descriptions.

**Decisions:** "Source seed" is the audit actor `cli:seed`; seeded fields are written with source `user` and no migration adds a `seed` source. Hide-name and transfer-group events are applied with a person viewer built for the mapped owner. `createTransaction` gains an optional `payeeId`. The whole seed is applied in one transaction, so it either fully loads or not at all (this settles the deferred atomicity item). The `seed` command is gated behind a config flag so it is a dev and e2e tool only; CI and the e2e harness set the flag.

**Never:** No non-cash account types, no 50,000-row profile (epic-ledger-workspace), no import data, no change to the privacy path or use-case rules, no new migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh load | Both partners signed up, empty ledger | Seed applies: institutions, accounts, snapshots, classification, transactions | No error expected |
| Second load | Ledger already has accounts or transactions | Nothing written | Conflict |
| Per-viewer view | Each partner lists transactions | Shared accounts plus own private only; counts match the seed's expectations | No error expected |
| Hidden name | Shared-account name hidden by one partner | Other partner sees "Hidden until <date>"; hider sees the name | No error expected |
| Transfer | Transfer group with a private counterpart | Other partner sees "Transfer from/to <owner>", no counterpart ids | No error expected |
| Splits | Multi-split seeded transactions | Splits sum to the parent, `remainingCents` 0 | No error expected |
| Determinism | Two runs of the generator | Identical JSON | No error expected |
| Bad seed | A new event with a bad reference | Rejected before the first write | Validation |
| Demo | Demo mode loads the seed | Starts read-only with the data | No error expected |

</frozen-after-approval>

## Code Map

- `tools/seed/src/{world.ts,run.ts,rng.ts}`, `modules/{people-and-household,accounts}.ts`, `modules/index.ts` -- `SeedEvent` union, `applyEvent`, `assertGloballyConsistent`; add `institutions-and-accounts`, `classification`, `ledger-transactions`, `transfers-and-privacy` modules and world types (institution, tag, payee, transaction keys).
- `apps/server/src/admin/seed.ts` -- `EVENT_SCHEMAS` (person, household, account.created, transaction.created today), `parseSeed`, `applyParsed`, `linkSeed`; add `institution.created`, `balance.recorded`, `payee.created`, `tag.created`, an extended `transaction.created` (key, payee, notes, splits), hide and transfer events.
- `apps/server/src/admin/commands.ts`, `cli.ts` -- the `seed` command; `demo.ts`, `scripts/demo-seed.ts`, `build.ts` -- demo path writes `dist/demo-seed.json`.
- `packages/app/src/ledger/create-transaction.ts` -- no payee today (`payeeId: null`); see open question 3.
- `e2e/ledger.spec.ts` -- hard-codes "Joint:" / "Person A/B private:" descriptions and "Seeded 3 accounts"; rewrite to derive expectations and assert the second load is refused.
- Tests: `tools/seed` module and `run.test.ts`, `rng.test.ts`, `serialize.test.ts`; `apps/server/src/admin/seed.test.ts`, `demo.test.ts`, `cli.test.ts`, `commands.test.ts` (account counts, prefixes, event counts).

## Tasks & Acceptance

**Execution:**
- [ ] seed modules, world types and expectations, with determinism and consistency tests
- [ ] loader events and `parseSeed` rejections, `applyParsed` handlers through the use cases
- [ ] integration tests: counts, split sums, hidden names, transfer label, per-viewer visibility, second load refused, demo loads
- [ ] rewrite `e2e/ledger.spec.ts` for both partners and the refused second load
- [ ] update every existing test that counts accounts or events

**Acceptance Criteria:**
- Given a fresh household, when the seed command runs, then each partner sees the shared accounts plus their own private ones and the e2e harness lists the seeded ledger as both.
- Given a loaded ledger, when the seed command runs again, then it is refused.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 4 medium and low test patches; 10 deferred; 7 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | The `PANGOLIN_ENABLE_SEED` gate has no test from env var through `startServer` to the admin command; hard-coding `true` in `server.ts` would ship the dev-only seed on production (verification-gap, pre-verified). |
| low | patch | No test that the partner cannot see the other's owner-only tags and payees (generator expectations unconsumed). |
| low | patch | The 12-month hide test asserts only the year; the new `KEYED` cross-module key-clash cases in `assertGloballyConsistent` are untested. |
| medium | defer | `parseSeed` does not check duplicate payee, tag, account or institution names, duplicate snapshots, owner shares or the private-account `shared` beneficiary up front; the use cases reject them mid-apply and the atomic load rolls back with an unnamed error. |
| medium | defer | `e2e/ledger.spec.ts` regenerates the seed with `tools/seed/src/cli.ts` while the server loads its own built `dist/demo-seed.json`; nothing compares the two. |
| low | defer | Weak e2e leak check (skips descriptions that also appear in a visible account), UI asserts only row counts, hidden names and labels via the API only. |
| low | defer | Seed ignores a real clock earlier than the seed's fixed today; the hide horizon and "Hidden until" label drift with the real clock when seeded onto a live stack. |
| low | defer | Loan repayment's two sides are not linked as a transfer; duplicated validation between `world.ts` and `checkReferences`; ambiguous row lookup by date, amount and description in tests. |
| low | defer | A disabled `seed` throws `Validation`; the env var is documented only in the README e2e section and a compose comment. |
| false | reject | Hidden names and transfers audited under the person's actor, not `cli:seed`: the frozen decision runs them as the owner. |
| false | reject | `PANGOLIN_ENABLE_SEED` blank value throws at startup: `PANGOLIN_DEMO` has the same shape and compose defaults it to false. |
| false | reject | e2e `beforeAll` re-run conflicts on retry: Playwright `retries` is 0. |
| false | reject | Plan file stale, "open question" wording, missing matrix row for disabled seed. |

## Design Notes

Seeds are applied as the system, but hiding names and transfers need the account owner as the actor; see the open questions. The generator stays parameter-free here; the 50,000-row profile in epic-ledger-workspace can add a row count later.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2; the `backup.test.ts` restic timeout may now be fixed)
- `pnpm check:strict` -- expected: green
- the local CI-order e2e run (auth, health, ledger, recovery-bundle, recovery, routing) -- expected: all pass

