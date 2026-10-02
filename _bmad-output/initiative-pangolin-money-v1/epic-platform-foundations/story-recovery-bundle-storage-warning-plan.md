---
title: 'Recovery bundle storage warning'
type: 'feature'
ticket: '17'
created: '2026-10-03'
status: 'built'
baseline_revision: 'cf073271a712c77328ff937a35f187befe458c22'
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

**Problem:** AD-27 says `pangolin status` warns until the recovery bundle's safe storage is confirmed. Nothing does this (retro R4), so a household can lose the only copy of the app key, auth secret and restic password without being told.

**Approach:** Each bundle `install.sh` writes gets an id, recorded in `.env` as `PANGOLIN_RECOVERY_BUNDLE_ID` and printed in the bundle. The server warns `recovery-bundle-unconfirmed` in `/healthz`, `pangolin status` and the web status page while that id has not been confirmed. `pangolin confirm-bundle` records the confirmation for the current id and audits it. A new bundle gets a new id, so the warning comes back.

## Boundaries & Constraints

**Always:** The warning is only a warning: `ok` and the exit code of `status` never change because of it. Confirm runs through the admin socket and is audited as `cli:confirm-bundle`, with `write()` in one transaction. The bundle's secrets never reach the server or the database. Only the id does.

**Never:** Change which secrets are generated, or when a bundle is written (first install, regenerated secret, `--bundle`). Do not mount `/root` or the bundle into the container. Do not add a web control to confirm.

**Decisions (human, 2026-10-03):** the command is `pangolin confirm-bundle`; an existing install with no id gets one on its next `install.sh` re-run and then warns (`pangolin upgrade` does not add one); the web warning is on the status page only, with no banner elsewhere. The plan is kept whole although it is above the token target.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh install | bundle written, id A in `.env`, nothing confirmed | `/healthz` `{"ok":true,"warnings":["recovery-bundle-unconfirmed"]}`; status and page show the warning | No error |
| Confirmed | `confirm-bundle` ran for A | no warning anywhere; audit row `cli:confirm-bundle` holds A | No error |
| Re-run, no new bundle | `.env` keeps A | still confirmed | No error |
| New bundle | `--bundle` or regenerated secret: id B | warning is back until confirmed again | No error |
| No id set | dev, CI, `PANGOLIN_RECOVERY_BUNDLE_ID` unset | no warning; `confirm-bundle` refuses | exit 1, "no recovery bundle id is set" |
| Confirm twice | A already confirmed | succeeds, says it was already confirmed; no second audit row | No error |
| Restore of an older snapshot | the snapshot's confirmation is for an older id or missing | warns again until confirmed | No error (fails safe) |
| Existing install upgraded | `.env` has no id, re-run of `install.sh` | id added without writing a bundle, so the warning shows | No error |

</frozen-after-approval>

## Code Map

- `deploy/install.sh:780-804` `write_bundle` -- when it writes a bundle, set a new id (UTC `YYYYMMDDTHHMMSSZ` plus 4 random hex characters) with `env_replace`/`env_add` (line ~807) and print `Bundle id: <id>` in the header. In `write_env` or right after it: when `.env` has no id, `env_add` one. Check that the `.env` change takes effect at `start_stack`, i.e. the container is recreated.
- `deploy/install.sh:1288-1296` `summary` -- after the bundle path, tell the user to run `pangolin confirm-bundle` once it is stored.
- `apps/server/src/config.ts:19` `envSchema` -- add `PANGOLIN_RECOVERY_BUNDLE_ID: z.string().regex(...).optional()`.
- `packages/db/migrations/0007_*.sql` plus `packages/db/src/schema/` and drizzle `meta` -- a singleton table `recovery_bundle` (`id = 1` CHECK, `bundle_id`, `confirmed_at`), following `household_settings` in `0001_person_settings_audit.sql`.
- `packages/app/src/system/` -- a new `recovery-bundle.ts`: a `confirmRecoveryBundle(ctx, {bundleId})` use case (`write()`, audit entity `recovery_bundle`) and a `recoveryBundleConfirmed(uow, bundleId)` read. Add a repo to the UoW (SQLite and `memory-uow.ts`). Model it on `household-settings.ts:56-79`.
- `packages/app/src/system/readiness.ts:10,47,76` -- add `"recovery-bundle-unconfirmed"` to `ReadinessWarning` and `bundleUnconfirmed?: boolean` to `readinessInput`. Warnings never add to `failing`.
- `apps/server/src/http/app.ts:84,360-399` -- `HealthzDeps` gains `bundleId`. Compute `bundleUnconfirmed` like `backupStale` (try/catch; a failed read counts as unconfirmed). Add `GET /api/system/recovery-bundle` (`{confirmed, bundleId?}`, `no-store`) next to the routes at lines 178-194.
- `apps/server/src/admin/commands.ts:32,57,120,161,194` -- add `confirm-bundle` to `ADMIN_COMMANDS`, `AdminDeps.bundleId`, `StatusResult` warning, `statusCommand` passes it to `readiness()`. Model the command on `resetUserCommand` and `context(deps, command)`.
- `apps/server/src/cli.ts:56,116-150,486-532` -- usage, allowlist and dispatch for `confirm-bundle` (it takes no arguments). `printStatus` prints `Warning:   recovery bundle not confirmed stored safely (run pangolin confirm-bundle)`.
- `apps/server/src/main.ts` / `server.ts` -- wire `config.PANGOLIN_RECOVERY_BUNDLE_ID` into the admin and healthz deps.
- `apps/web/src/App.tsx:75-95`, `api.ts:54` -- a `RecoveryBundle` component like `LastBackup`, rendering a `role="alert"` warning.
- `deploy/pangolin` -- the generic `exec`/`run` path should already pass `confirm-bundle` through. Check that, and keep `-T`.
- `docs/install.md:155,174,228-240,303` -- explain the id, the confirm step in §7, and the command in §9.
- Do not change: `restore.ts`, the restore flow, `backups.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db` -- migration 0007 and schema for `recovery_bundle`
- [x] `packages/app/src/system/recovery-bundle.ts` (+ UoW repos, readiness) -- use case, read, warning
- [x] `apps/server` -- config, healthz, `/api/system/recovery-bundle`, admin command, CLI, wiring
- [x] `apps/web` -- the status page warning
- [x] `deploy/install.sh` -- id per bundle, id added when missing, summary hint
- [x] `docs/install.md` -- bundle id and the confirm command
- [x] tests -- every matrix row: `readiness.test.ts`, `recovery-bundle.test.ts` (real SQLite), `app.test.ts` (healthz body and the API route), `cli.test.ts` (status line, exit 0, confirm output), `socket.test.ts` (audit actor `cli:confirm-bundle`, exactly one row), `api.test.ts`/component test, `deploy/install.test.ts` (new id with `--bundle`, same id on a plain re-run, id added when missing, the id in the bundle)

**Acceptance Criteria:**
- Given an unconfirmed id, when `/healthz` is requested, then the status is 200 with `ok: true`, and `pangolin status` exits 0.
- Given any state, when the suites run, then no test shows readiness failing because of the bundle.
- Given CI's install and e2e jobs, when they run, then they pass (the e2e health spec still sees "healthy").

## Implementation Notes

- Id format: `YYYYMMDDTHHMMSSZ-xxxx` (a hyphen before the 4 hex characters), checked by `RECOVERY_BUNDLE_ID_PATTERN` in `app` and by the config schema. An empty `PANGOLIN_RECOVERY_BUNDLE_ID` counts as unset; a malformed one fails startup like any bad setting.
- `bundleId` lives on `ApiDeps` (so `AppDeps` and `/healthz` see it), not `HealthzDeps`: `/api/system/recovery-bundle` is built by `createApi`, which only gets `ApiDeps`. Demo mode never passes it.
- With no id, `recoveryBundleStatus` answers `{ confirmed: true }` (nothing to confirm), so the page shows nothing. A failed read in `/healthz` counts as unconfirmed only when an id is set.
- The "no id" refusal is in the use case (`confirmRecoveryBundle` with no `bundleId` throws `Validation` with `NO_RECOVERY_BUNDLE_ID`), so the socket and CLI share the message.
- `recovery_bundle` has no row until the first confirmation; `set` upserts row 1. The real-SQLite test is `packages/db/src/recovery-bundle.test.ts` (an `app` test cannot import `db`).
- install.sh: `write_env` adds an id when `.env` has none (and sets `NEW_BUNDLE_ID`, which makes the summary say to confirm the existing bundle); `write_bundle` then replaces it with a fresh id (never equal to the previous one) whenever it writes a bundle. `start_stack` runs `compose up -d --force-recreate`, so the container picks the new `.env` value up.
- `deploy/pangolin` needed no code change (the generic `exec -T` path passes `confirm-bundle`); only its usage comment.
- Matrix audit (orchestrator): the status page's warning had no test. Added `e2e/recovery-bundle.spec.ts`, gated on `E2E_BUNDLE_ID`; CI's stack now sets `PANGOLIN_RECOVERY_BUNDLE_ID` (`.github/workflows/ci.yml`, passed through the root `compose.yaml`). It only runs in CI. `/healthz` checks in CI test the status code, so the warning does not affect them.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 2, low 7, false 4, rejected low 5, deferred 0.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | An empty `PANGOLIN_RECOVERY_BUNDLE_ID=` line in `.env` is never filled: `write_env` uses `env_has` (key only), so no warning ever, and `confirm-bundle`'s "re-run install.sh" advice does not help. Same fix: a fresh install no longer adds a throwaway id and a misleading "Added:" line. |
| medium | patch (done) | Verification gap: nothing showed the page and `/healthz` drop the warning after a real `confirm-bundle`. Extended the e2e spec with `E2E_CONFIRM_BUNDLE_COMMAND` in CI. |
| low | patch (done) | `write_bundle` moved the bundle into place before writing its id to `.env`; a failure between them leaves a bundle printing an id the server never sees. Write the id first. |
| low | patch (done) | `install.sh:1308` and `docs/install.md:211` still promised `{"ok":true}` after install. |
| low | patch (done) | CLI warning said `run pangolin confirm-bundle`, the page and docs `sudo pangolin confirm-bundle`. |
| low | patch (done) | Help and docs did not say `confirm-bundle` needs a running stack, or to check the printed id before confirming. |
| low | patch (done) | `memory-uow.ts` read path `recoveryBundle.get` skipped `check()`. |
| low | patch (done) | `loadConfig` parsing of the id (empty, whitespace, trim, malformed) untested. |
| low | patch (done) | The demo-mode guard (`demo ||`) is untested with an id set. |
| false | rejected | `status` "crashes" on a failed bundle read: `statusCommand` already reads `jobCounts`, `deadJobs` and `backupStatus` unguarded, so a failing read fails it either way. |
| false | rejected | Upgrade-only installs never warn: the human's decision of 2026-10-03. |
| false | rejected | `confirm-bundle` takes no id argument: the intent says it confirms the current id; the docs now say to check it. |
| false | rejected | The production chain (install.sh, `.env`, compose, server) is never run: `deploy/compose.yaml` has `env_file: .env` and `start_stack` force-recreates; each link is tested on its own. |
| low | rejected | The API route 500s and the page hides the warning on a database read error: the whole app is down then; fixing it adds branches. |
| low | rejected | A malformed hand-edited id stops startup: the same as every other setting; install.sh never writes one. |
| low | rejected | The confirmed id is the boot-time id, not `.env`: install.sh always recreates the container. |
| low | rejected | The command list is repeated in `cli.ts`: the existing pattern for every command. |
| low | rejected | A test asserts the summary's exact line break: cosmetic. |

## Design Notes

The id is in `.env` because the container cannot see `/root` and the bundle has to stay out of the server. The id is a value the household can match against the printed bundle, not a secret. The confirmation lives in the database so it is audited. A restore can roll it back, which only brings the warning back, so it fails safe.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: pass (`deploy/*.test.ts` need GNU `sed` on macOS)
- `shellcheck deploy/install.sh deploy/pangolin` -- expected: clean
