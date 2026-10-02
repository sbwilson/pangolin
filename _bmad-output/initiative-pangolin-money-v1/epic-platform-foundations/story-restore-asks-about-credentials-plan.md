---
title: 'Restore asks about credentials'
type: 'bugfix'
ticket: '16'
created: '2026-10-02'
status: done
baseline_revision: 'daad9bd9cdf99cb719415a386f0fc4d0bc1639dc'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/epic-platform-foundations-retrospective.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/security-and-recovery.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `pangolin restore` swaps in the whole database, so the snapshot's sessions, passkeys, TOTP, recovery codes and used re-enrolment links come back. After a `reset-user` a restore can re-enable credentials the reset removed, and nothing tells the household data was rolled back (retro S4).

**Approach:** After the snapshot is verified and before it is swapped in, `restore` asks whether to restore the snapshot's credentials or keep the current ones (carried over from the replaced database; the snapshot's are dropped). `--restore-credentials` and `--keep-credentials` answer without a prompt. The choice is audited and one household review item records the roll-back.

## Boundaries & Constraints

**Always:** Run under the existing data-directory lock and inside `afterSwap`'s write path; audit as `cli:restore`; a failed step undoes the swap as today.

**Never:** Change what a restore swaps in; touch `reset-user` or the re-enrolment flow beyond reusing `clearCredentials`.

**Decisions (human, 2026-10-02; timing amended 2026-10-02 after review):** "Keep" carries the replaced database's credential rows onto the restored one, so nobody re-enrols. The CLI prompts (default: keep current); `deploy/pangolin` drops `-T` for `restore`; with no TTY and no flag it refuses before stopping anything. The question is asked after verification and before the swap, so an interrupt or EOF at the prompt changes nothing; the answer is then applied after the swap. Flags `--restore-credentials` / `--keep-credentials`; review kind `system.restored` (household, dedupe by snapshot ID).

</frozen-after-approval>

## Code Map

- `apps/server/src/admin/restore.ts` -- `restoreStopped`, `afterSwap` (migrate, cancel jobs, record snapshot as `cli:restore`); add the credential step in the same transaction.
- `apps/server/src/cli.ts:373-465` -- `restoreCli`, `runCli` argument checks (`restore takes one snapshot`), `USAGE`; add flags and the prompt.
- `packages/app/src/identity/re-enrolment.ts:106` -- `clearCredentials(ctx, tx, audit, person, reason, passwordHash)`; reuse for revoke. `reason` is typed `"re-enrolment-link" | "reset-user"`.
- `packages/app/src/identity/reset-user.ts` -- model for link issue (`insertReEnrolmentLink`) and the system-actor check.
- `packages/app/src/system/review-items.ts` -- `defineReviewKind`, `raiseReviewItem`; add `system.restored`.
- `deploy/pangolin:~203-216` -- `restore` runs `compose run ... -T`; drop `-T` and pass `-i` TTY through.
- `apps/server/src/admin/restore.test.ts`, `deploy/pangolin.test.ts` -- existing restore tests to extend.
- `packages/db/migrations/0003_auth_setup_links.sql`, `0004_recovery.sql` -- the credential tables.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/system/review-items.ts` -- add `RESTORED_REVIEW` -- the household roll-back record
- [ ] `apps/server/src/admin/restore.ts` -- in `afterSwap`, for `keep`: ATTACH the pre-restore database and, for logins present in both (same `auth_user.id`), replace the restored rows of the six credential tables (`auth_account`, `auth_passkey`, `auth_session`, `auth_two_factor`, `recovery_code`, `re_enrolment_link`) with the current ones, on shared columns only; a login only in the snapshot gets `clearCredentials`. Then raise the review item and audit the choice
- [ ] `apps/server/src/cli.ts` -- flags, prompt (EOF or three bad answers is a failure, and it asks before the swap), refuse without TTY or flag; update `USAGE`
- [ ] `deploy/pangolin` -- let `restore` prompt: drop `-T` only when no flag is given (a flag must work with no TTY)
- [ ] tests -- each choice, audit entry, review item, flags without prompt

**Acceptance Criteria:**
- Given a snapshot and a later reset-user, when restoring with keep, then the current credentials work and the snapshot's do not; with restore, the snapshot's work.
- Given either choice, then the audit log records it and one household review item exists.
- Given a flag, then no prompt appears; given no TTY and no flag, then restore refuses before stopping anything.

## Implementation Notes

## Plan Change Log

- Loop 1 (review pass 1, `intent_gap`, human approved the change): the prompt ran after `swapIn`, so Ctrl-C or EOF left the snapshot swapped in with its credentials live. Amended the frozen Approach and Decisions: ask after verification, before the swap. Also amended Tasks so the re-derived code covers the medium and low findings in the Triage Log: skip keep when no replaced database exists or a credential table has no shared columns; use `-T` whenever a flag is given; credential rows of an inactive person with a login are cleared or kept like the rest; tests for invalid answers, EOF, a fresh data dir and an older-schema replaced database. Known-bad state avoided: a swapped-in, unmigrated database left by an interrupted prompt. KEEP: `RESTORED_REVIEW` and the `clearCredentials` reason `"restore"`; the six-table carry-over on shared columns with the `two_factor_enabled` flag; the CLI flags, usage errors and no-terminal refusal (exit 2); the wrapper's pre-stop flag validation; the tests for each choice, the audit entry and the review item. The first diff is saved as `story-1-16-pass1.diff` in the temp directory for reference.

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 1, medium 3, low 3, false 4, deferred 2.

| Verdict | Route | Finding and evidence |
|---|---|---|
| high | intent_gap | The prompt runs after the swap (frozen Approach says "after the swap"). Ctrl-C or EOF at the prompt leaves the snapshot swapped in but unmigrated, uncleared and unaudited; the wrapper trap restarts the stack with the snapshot's credentials live, the exact S4 failure. `restore.ts` awaits `deps.credentials()` after `swapIn`; `askStdin` never settles on EOF. |
| medium | patch (moot until loopback) | Keep with no replaced DB file (restore onto a fresh data dir, the disaster-recovery case): `swapIn` moves nothing, `ATTACH` makes an empty file, `cur.auth_user` is missing, keep throws and is undone, so the default prompt answer fails. |
| medium | patch (moot) | Flag given without a TTY (cron, ssh without -t): `compose run` without `-T` fails "not a TTY"; the story requires non-interactive flags to need no prompt. The wrapper test asserts `-T` is never used. |
| medium | patch (moot) | Keep when a credential table is missing in the replaced (older-schema) DB: `sharedColumns` returns no columns and emits `INSERT INTO t () SELECT FROM`. |
| low | patch (moot) | Recovery codes and links of an inactive person with a login are neither kept nor cleared (`listActive`). |
| low | patch (moot) | Tests: no case for invalid prompt answers (re-prompt, three failures); two test names and one comment are wrong; the snapshot-only test lacks the audit assertions. |
| low | patch (moot) | Empty `IN ()` lists when no logins are shared. |
| false | rejected | `DETACH` outside `finally`: `db.close()` in `finally` detaches. |
| false | rejected | Post-snapshot logins dropped on keep: their person rows are not in the restored DB, so there is nothing to attach them to. |
| false | rejected | Credential writes not in one transaction with the other afterSwap writes: any failure undoes the whole swap. |
| false | rejected | Restore mode revives revoked sessions: that is what the household chose, and the prompt says so. |
| defer | defer | Keep across a real schema difference has no test (needs an old-schema fixture). |
| defer | defer | `system.restored` item shown by the web UI is not checked here. |

Pass 2 (loop 1 re-derivation; same four lenses): high 0, medium 1, low 3, false 6, deferred 3.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | `ci.yml` restore steps (lines 204, 251) run with no terminal and no flag, so they now refuse (exit 2). Added `--restore-credentials`. |
| low | patch (done) | Docs showed bare `pangolin restore`; `docs/install.md` and the M0 rehearsal now mention the prompt and flags. |
| low | patch (done) | CLI accepted a repeated flag while the wrapper refuses it; the CLI now refuses it, with a test. |
| low | patch (done) | A test comment contradicted its assertion; reworded. |
| false | rejected | ATTACH read-write: the replaced database was closed cleanly and holds no WAL; a read-only WAL attach needs `-shm` write access. Nothing is written to it. |
| false | rejected | Missing `auth_account` or two-factor column in the replaced DB, differing person ids, a vanished replaced DB, split transactions, prompt timeout or readline reuse, a restore-choice warning, a review item on a fresh dir, dedupe. Each is unreachable or harmless: those tables date from migration 0003, ids are stable within one household, and any failure undoes the whole swap. |
| defer | defer | `askOnTerminal` and the wrapper's no-flag TTY path have no automated test (needs a pty or piped-stdin spawn). |
| defer | defer | No failure-injection test for the credential carry (a throw after the swap must undo it). |
| defer | defer | No test for a replaced database that cannot be opened during keep. |

## Verification

**Commands:**
- `npx vitest run apps/server/src/admin packages/app/src/identity deploy/pangolin.test.ts` -- expected: pass (use a GNU `sed` on macOS)
