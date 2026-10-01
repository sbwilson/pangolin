---
epic: epic-platform-foundations
date: 2026-10-02
verdict: accepted-with-open-items
criteria: declared
headless: false
---

# Retrospective: epic 1, Platform foundations

## Epic summary

- **Tickets:** all 14 are `done` (1.1 to 1.14); `pending_tickets` is empty and none is left at `built`. Entry 14 (backup monitoring) was added during the epic after 1.12, split from 1.10; 1.12 (refactor sweep) and 1.13 (M0 gate rehearsal, human-in-the-loop) closed the epic.
- **Range:** the plans' `baseline_revision`s order the builds 1.1, 1.2, 1.3, 1.7, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11, 1.12, 1.14, 1.13, but most baselines sit one or two commits apart, because each build's commits land after the next plan is written. Per-plan ranges are therefore not usable as attribution. The whole epic was measured as one range, `af96d17..HEAD`: 78 commits, 0 merges, 345 files (churn in `/tmp/retro-evidence.json`, from `git_evidence.py`). This is a narrowed scope.
- **Evidence available:** epic file with Done when, initiative requirements (CAP-15, CAP-16), the spec folder and architecture spine, 14 plans with triage logs, `deferred-work.md`, the M0 rehearsal record (`docs/m0-gate-rehearsal.md`) with VM output, CI run 36792497800 for `v0.1.0`.
- **Evidence missing:** session logs for tickets 1.1 to 1.11 and 1.13 (only the transcript of the 1.12, 1.14 and 1.13 sessions was available); process-lesson analysis is narrowed to that. No previous retrospective exists (first epic).
- **Analysis method:** three read-only passes (size and structure; spec reconciliation; cross-ticket seams) plus spot checks by the parent against source (listed in Findings). `bmad-review` was not run on the epic's whole diff; the seams pass stands in for it, on a narrowed scope.

## Findings

Dispositions: fix now / defer / accept. "Verified" means re-read at source by the parent.

### Seams between tickets (code-reading; nothing was executed)

| # | Finding | Source | Disposition |
| --- | --- | --- | --- |
| S1 | A failed pre-upgrade DB copy is ignored (`cp ... || true`); if the health check then fails, the rollback runs `rm -f /data/pangolin.sqlite*` and restores from an empty copy: the live database is deleted. Verified. | `deploy/pangolin:123-125,168-169` (1.11) | **Fix now** |
| S2 | The pre-upgrade copy is made with default permissions under `/opt/pangolin` (0755) on the system disk, unencrypted, two kept indefinitely. Verified (mkdir default). | `deploy/pangolin:121-127`, `deploy/install.sh:696` (1.8, 1.11) | **Fix now** |
| S3 | `.env.bak`, `compose.yaml.bak`, `pangolin.bak` are never removed after a successful upgrade; an interrupted next upgrade restores the old ones over a good install. Verified (the only removal is a `mv` on rollback). | `deploy/pangolin:108-112,129-133,170-172` (1.11) | **Fix now** |
| S4 | `pangolin restore` swaps in the whole database, which brings back the snapshot's sessions, passkeys, TOTP, recovery codes and used re-enrolment links; after a reset-user it can re-enable credentials the reset removed. Nothing records the roll-back for the household. Verified (`afterSwap` only migrates, cancels jobs, records the snapshot). | `apps/server/src/admin/restore.ts:79-117` (1.6, 1.9, 1.10) | **Fix now** (decision needed on the remedy) |
| S5 | `job.dead` review items are never resolved; dead job rows stay forever; a stale backup raises no review item (only a status warning), unlike backup-verification items which auto-resolve. Verified (no `resolveReviewItem` call for `job.dead`). | `packages/app/src/jobs/lifecycle.ts:136-138`, `packages/app/src/system/backups.ts:487` (1.4, 1.14) | Defer (already listed: no resolve path) and add the stale-item question |
| S6 | `uninstall.sh` keeps the data by default but deletes `/opt/pangolin/secrets`; a re-install regenerates the secrets over kept data, silently breaking TOTP and the restic repo. | `deploy/uninstall.sh`, `deploy/install.sh:745-751` (1.8, uninstall) | **Fix now** (warn, or keep the secrets) |
| S7 | The recovery bundle notice is missed if the first install run dies after secret generation; a bundle written before backups were configured lacks `RESTIC_REPOSITORY` and is not rewritten unless `--bundle` is passed. | `deploy/install.sh:780-800` (1.8) | Defer |
| S8 | The DNS resolver IPs are frozen in `.env`; if they change, every allowlist lookup fails, an empty ruleset is saved and all egress (backups, GHCR) is blocked; `--dns` does not fix it. | `deploy/install.sh:547`, `deploy/firewall/render.sh` (1.8) | Defer (hardening story) |
| S9 | A stale `RequiresMountsFor` docker drop-in can block Docker at boot after `--data-root` changes; changing it starts an empty database without warning. | `deploy/install.sh:1154-1158` (1.8) | Defer |
| S10 | `pangolin status` after a restore prints the restore time as "last at", while staleness is judged on `takenAt`. | `apps/server/src/cli.ts`, `packages/app/src/system/backups.ts` (1.9, 1.14) | Defer (suspected, not reproduced) |
| S11 | Suspected, not verified: lockout is check-then-act across the scrypt hash; the drill's synchronous `integrity_check` may stall lease renewal on a large database; `stop_grace_period` equals the runner's 10 s stop; the upgrade rollback discards writes made during the health wait; `install.sh` re-run overwrites `compose.yaml` and the CLI that `pangolin upgrade` installed; `--backup-server ""` cannot disable backups. | see the seams report; recorded for a follow-up check | Defer, each needs a check first |

Checked and found clean (scope: code reading only): restore against job-runner leases, status and staleness as one shared rule, upgrade against readiness and schema version, auth reset paths sharing `clearCredentials`, demo mode read-only paths, firewall rendering atomic with a fail-closed boot fallback.

### Spec to implementation

| # | Finding | Source | Disposition |
| --- | --- | --- | --- |
| R1 | Done when 1 says Debian 12; proven only on Debian 13.7. | `docs/m0-gate-rehearsal.md` item 1; epic Done when 1 | Accepted (human decision 2026-10-01); reconcile the epic and spec wording |
| R2 | Done when 6: attachment decrypt not demonstrated; the CI clean-host step rebuilds a bundle by hand without the app key. | `docs/m0-gate-rehearsal.md` item 6; `.github/workflows/ci.yml` | Accepted until epic 5 (human 2026-10-01) |
| R3 | Done when 7: run on `pang-dev`, accepted as the home server. No test migrates the previous release's database, which the spine and ops spec require. | rehearsal item 7; spine "Migrations"; `deployment-and-ops.md` (CI/CD) | Accepted for the host (human 2026-10-02); **fix now** for the migration test |
| R4 | AD-27: `pangolin status` should warn until safe storage of the recovery bundle is confirmed. Not built, not in `deferred-work.md`. Verified (no match in `cli.ts` or `commands.ts`). | `story-cli-and-admin-socket-plan.md` residual risk | **Fix now** (give it an owner) |
| R5 | `release.yml` tags the image before signing and `upgrade-test` does not gate tagging or signing; a failed sign leaves a tagged, unsigned image (pulls are digest-verified, so it is refused, not unsafe). Verified (step order). | `.github/workflows/release.yml` (1.11) | **Fix now** (minor) |
| R6 | Spec items not built or changed without a recorded owner: Caddy and Tailscale proxy modes; host hardening (SSH keys only, unattended-upgrades, chrony, timezone); WireGuard push ("operator runs the tunnel"); email notification (in-app notice only); outbound allowlist "code checks it" and re-auth to change it; spine "job-runner lease held" (built as runner liveness); two health endpoints plus `/api/system/*` shapes absent from the spine. | spec reconciliation pass | Reconcile the spec, or give each an owner |
| R7 | AD-14 wording in the spine is broader than the lint rule (domain and shared only, non-test); `app` clock sources and `Date.now()` in `cli.ts`, `migrate.ts` and log timestamps are outside it. | `biome.json`, `tools/lint/no-system-clock.grit` | Accepted; narrow the spine wording |
| R8 | Stale text: `tickets.toml` entry 10 still lists the weekly check and drill; `deferred-work.md` still says "story 1.10b" and lists closed items as open; epic Boundaries list only three tables; 1.14's description says "reflected in readiness" but only a warning field was built. | `tickets.toml`, `deferred-work.md`, epic file | Reconcile (tidy only) |

### Aggregate views

| # | Finding | Source | Disposition |
| --- | --- | --- | --- |
| A1 | Size: `deploy/install.sh` is 1356 lines and about 70 functions across roughly nine responsibilities; `apps/web/src/App.tsx` holds 11 components and a hand-rolled router while the other views are separate files; `packages/app/src/system/backups.ts` (547) mixes schedule maths, use cases and status; `apps/server/src/http/app.ts` mixes proxy and IP helpers. No file looks pathological. | `wc -l` and churn at HEAD | Defer (candidate refactor items) |
| A2 | Duplication: four independent JSON loggers (`main.ts`, `auth/auth.ts`, `http/errors.ts`, `jobs/runner.ts`); `dailyAt`/`weeklyAt`/`monthlyAt` repeat scaffolding; `memory-uow.ts` re-implements every SQLite repo with no shared parity suite; test helpers (`mkdtempSync`, `newId`, `sequentialIds`, `manualClock`) repeated across about 10 to 15 files. | seams and size pass | Defer |
| A3 | Pattern divergence: mixed `AppError`/`Error` throws (30 against 85); `cli.ts` reads `Date.now()` directly while `app` injects a Clock; `db` repo files mix one-per-file and multi-repo files. | grep counts | Accept as-is, record as convention gaps |
| A4 | Architecture delta clean: `check-boundaries.ts` and biome rules pass, no import cycles in 116 non-test files, `systemViewer(` is only used under `jobs/` and `admin/`. | boundary script, grep | Checked and clean (type-only imports and dynamic imports not checked) |

## Behavior verification

The epic changed runtime behavior, and it was exercised end to end on the dev VM `pang-dev.net5.co` in the M0 rehearsal (record: `docs/m0-gate-rehearsal.md`, `v0.1.0`, digest `sha256:70bf69b5...a120fe`): install from `v0.0.2` and one-time link, `/healthz` through NPM, passkey sign-in (reported, with a signed-in screenshot), backup and verified restore, partner invite, third sign-up refused, recovery code and partner link notices, upgrade to `v0.1.0` with the digest pinned, bad signature refused before the stack was touched, container hardening and ruleset checks, closed port from another host, clean reboot restarting the app and firewall by itself. Not exercised: the automatic rollback on the VM (CI `upgrade-test` only), the 24 h link expiry (CI only), Debian 12, the home server proper, attachments, the seams S1 to S11 (read, not run).

## Previous-retro follow-through

There is no previous retrospective: this is the first epic, so there was nothing to follow through on (a missing file, not "no outstanding items").

## Action items

Proposed, not applied. Owners are the human (Simon) unless noted; remediation goes to the normal dev loop as story-shaped work.

1. **Make the upgrade copy safe (S1, S2, S3).** In `deploy/pangolin`: refuse to stop the stack unless the pre-upgrade copy is non-empty, create it 0700, and remove the `.bak` files after a successful upgrade. One bug-fix ticket in the dev loop.
2. **Decide the remedy for restore and credentials (S4).** Options: revoke all sessions and passkeys after a restore, or raise a household review item that data was rolled back, or both. Needs the human's decision, then a ticket.
3. **Protect secrets across uninstall and reinstall (S6).** Warn in `uninstall.sh` when keeping data but deleting secrets, or keep the secrets; make `install.sh` refuse to regenerate secrets over an existing database. Dev loop.
4. **Give the AD-27 recovery-bundle warning an owner (R4).** Build it in epic 2, or move it to a small ticket now.
5. **Add the previous-release migration test (R3).** Migrate the previous tag's database in CI at release. Dev loop.
6. **Order the release steps (R5).** Sign before tagging, or gate on `upgrade-test`. Dev loop.
7. **Reconcile the spec and tickets (R1, R6, R7, R8).** Amend Done when 1 and the Debian wording, record Caddy and Tailscale, host hardening, WireGuard, email and the allowlist re-auth as dropped or deferred with owners, narrow the AD-14 wording, fix the spine's health-endpoint text, update `tickets.toml` entry 10 and the stale `deferred-work.md` entries (the 1.10b wording and the closed items). Human applies; not auto-written.
8. **Install hardening ticket (S7, S8, S9).** Bundle notice and rewrite, DNS drift recovery, drop-in clean-up. Defer to a story after epic 2.
9. **Check the suspected seams (S10, S11).** One check ticket: run each suspected case before deciding. Dev loop.
10. **Candidate refactors (A1, A2).** Split `install.sh` and `App.tsx`, share one logger and the test helpers, add a memory-versus-SQLite repo parity suite. Defer to the next sweep.

Process lessons (narrowed to the sessions available):

- A schema-version number hardcoded in `e2e/health.spec.ts` broke CI the first time a migration landed (`b324457`); fixed by deriving it. Lesson: Playwright was never run locally for the story, so run the e2e suite before pushing any migration.
- One CI failure was an unrelated Docker Hub 502 while pulling `restic/rest-server`; a re-run of the failed job fixed it. Lesson: consider a pull retry or mirror in the container job.
- `deploy/*.test.ts` need GNU `sed -i`, so 8 tests fail on macOS: they only pass in CI. Lesson: make the scripts and tests portable, or document a Linux-only test run.
- The repo's commit hook rejects Co-Authored-By trailers, which conflicts with tool-added attribution. Lesson: settle one convention.
- Plans' frozen intent and the triage log made reviews and decisions traceable; the human-in-the-loop rehearsal needed a structured evidence record, which existed only because 1.13 introduced it. Lesson: earlier hitl tickets (1.8, 1.9, 1.10, 1.11) left only commit messages as evidence; give them the same record.
- Deferred findings were useful as the 1.12 sweep's input, but several stayed listed after they closed and some requirements were dropped with no entry (R4, R6). Lesson: reconcile `deferred-work.md` at each epic close, as part of the sweep.

## Acceptance verdict

**Accepted-with-open-items**, criteria **declared** (the epic file's Done when).

- **Evidence for acceptance:** every one of the 14 tickets is finished; Done when 2, 3, 4 and 5 are met in the evidence (CI run 36792497800 and the VM rehearsal); 1, 6 and 7 are met with deviations the human accepted on 2026-10-01 and 2026-10-02 (Debian 13 in place of 12, attachment decrypt deferred to epic 5, `pang-dev` as the home server). The M0 gate is recorded closed in `docs/m0-gate-rehearsal.md`.
- **Why not plain accepted:** open fix-now findings remain: S1 is a data-loss path in the upgrade rollback and S4 is a credential-resurrection path after restore; S1 to S3 and R3 to R5 are worth fixing before the next release. They are tracked as the action items above, not blocking the epic's stated criteria, so the epic is not rejected. A human decision overrides this verdict.

## Open questions

1. **Restore and credentials (S4):** revoke everything after a restore, notify, or both? This changes the behaviour of `pangolin restore`.
2. **AD-27 warning (R4):** build it in epic 2, or now?
3. **Spec drops (R6):** are Caddy and Tailscale modes, host hardening, WireGuard in the install, and email notification still wanted, and if so which epic owns each?
4. **Release hygiene (R5, R3):** should these fixes land before epic 2 starts, or ride with the first epic 2 release?

Could not be resolved by the analyses: whether the suspected seams in S11 are real (nothing was executed).
