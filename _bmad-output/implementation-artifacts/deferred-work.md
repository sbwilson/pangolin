- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Weekly `restic check` (Sundays 03:30, household time zone) reported through `pangolin status`, the web status page and a review item on failure (shipped in story 1.14).
  evidence: Split from story 1.10 at planning (answer 6b) to keep the backup and verified-restore core within size; times agreed in answer 3.
  disposition: fixed (story 1.14)
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Monthly restore drill (1st of the month, 04:00) into a temporary directory, running the restore checks and showing the result on the status page (shipped in story 1.14).
  evidence: Split from story 1.10 at planning (answer 6b); it reuses 1.10's restore verification.
  disposition: fixed (story 1.14)
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Decrypt a sample attachment with the escrowed app key in restore verification and the clean-host test, once epic 5 builds the attachment store.
  evidence: Answer 2b: no attachment store or app-key crypto exists yet.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Snapshot the attachments with the database (a hardlink copy or a manifest of blobs) so a push hours later cannot miss or mismatch them, and verify them on restore.
  evidence: Review of story 1.10: the push reads /data/attachments at push time; no attachments exist until epic 5, which should settle it with the attachment store.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Stage backups under a fixed path (or pass --parent) so restic finds a parent snapshot and does not re-read every attachment nightly.
  evidence: Review of story 1.10: staging paths differ per job, so restic's parent detection never matches; negligible until attachments exist.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Warn in pangolin status, the status page and readiness when the last good backup is older than about 48 hours (shipped in story 1.14, with the check and drill).
  evidence: Review of story 1.10: only a dead job raises an alert; a schedule that silently stops, or backups switched off, raises nothing.
  disposition: fixed (story 1.14)
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Test the backup handlers' idempotent re-runs (a snapshot already recorded, a push already pushed).
  evidence: Verification-gap review of story 1.10: no handler-level test re-runs after a recorded row; worst case is a duplicate snapshot or stale checksum, not a failed restore.
  disposition: fixed (story 1.12)

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-release-and-upgrade-plan.md`
  summary: Make the upgrade health-check timeout configurable (currently hardcoded at 60s)
  evidence: Long database migrations can exceed 60s causing a false-positive rollback; 60s is reasonable for v1 but should become a configurable option (e.g. PANGOLIN_UPGRADE_TIMEOUT env var or --timeout flag)
  disposition: fixed (see the 1.12 sweep entry below)

## 1.12 sweep (2026-10-01)

Source plan for every entry: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-refactor-sweep-plan.md`. Each epic 1 finding is listed with its disposition.

- disposition: fixed
  summary: Upgrade health-check timeout configurable (`PANGOLIN_UPGRADE_TIMEOUT`, seconds, default 60, validated before anything is stopped).
  evidence: `deploy/pangolin`, tests in `deploy/pangolin.test.ts`, documented in `docs/install.md`. Closes the story-release-and-upgrade entry above.
- disposition: fixed
  summary: System-clock reads in `packages/domain` and `packages/shared` are a lint error (AD-14).
  evidence: `biome.json` override with `tools/lint/no-system-clock.grit` (`Date.now()`, `new Date(...)`, `Temporal.Now.*`; test files excluded). No existing violations.
- disposition: fixed
  summary: Passkey sign-in resets the password-failure count (4 wrong, passkey, 1 wrong is 401, not 429).
  evidence: `apps/server/src/auth/auth.test.ts`, "passkey sign-in and the lockout".
- disposition: fixed
  summary: Backup handlers' idempotent re-runs (a snapshot already recorded, a push already pushed) are tested; no duplicate rows or stale checksum.
  evidence: `apps/server/src/jobs/backup.test.ts`. Closes the story-1.10 verification-gap entry above.
- disposition: fixed
  summary: The spine's Invariants diagram draws `tools/seed` to `shared`.
  evidence: `ARCHITECTURE-SPINE.md`; the stale comment in `scripts/check-boundaries.ts` is updated.
- disposition: closed (already resolved)
  summary: Job handler timeout and abort.
  evidence: `runner.ts` `timeoutMs` and `ctx.signal`, tested at `runner.test.ts:440`.
- disposition: closed (already resolved)
  summary: Runner liveness in readiness (the lease intent).
  evidence: `/healthz` checks runner liveness in `packages/app/src/system/readiness.ts`.
- disposition: still deferred
  summary: Demo recovery-codes step and dead-jobs list render are untested.
  evidence: There is no web component-test harness; pick up with the first web-UI epic.
- disposition: still deferred
  summary: Fixed restic staging path (so restic finds a parent snapshot).
  evidence: Already recorded above; negligible until attachments exist in epic 5.
- disposition: still deferred
  summary: Retention of finished jobs.
  evidence: A feature, not a fix; raise in a retention story.
- disposition: still deferred
  summary: Attachment snapshotting and sample decrypt.
  evidence: Already recorded above for epic 5. The weekly `restic check`, monthly restore drill and stale-backup warning shipped in story 1.14.

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backup-monitoring-plan.md`
  summary: Test the web status page's rendering of the stale warning and of failed or passed check and drill results (story 1.14).
  evidence: Verification-gap review of 1.14: only the empty state is covered (e2e/jobs.spec.ts); needs the web component harness or a seeded e2e, which no story has built yet.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backup-monitoring-plan.md`
  summary: Warn when the weekly check or monthly drill is overdue (for example 8 and 35 days), and guard the drill against low disk headroom on the data volume.
  evidence: Review of 1.14: a silently stopped check or drill keeps showing its last result; the drill restores the full snapshot onto the data volume with no free-space check. Both matter more once attachments exist (epic 5).

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/epic-platform-foundations-retrospective.md`
  summary: The Caddy and Tailscale proxy modes of install.sh (the spec's three proxy modes; only NPM is built and the others print "not yet supported").
  evidence: Human decision 2026-10-02 (epic 1 retrospective, open question 3): deferred to the next version because the NPM mode covers the human's workflow.

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-restore-asks-about-credentials-plan.md`
  summary: Test `pangolin restore --keep-credentials` across a real schema difference between the snapshot and the replaced database.
  evidence: Every test builds both databases from the same migrations, so `sharedColumns` (the column intersection) is untested; it matters when a migration next changes an auth table.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-restore-asks-about-credentials-plan.md`
  summary: Check that the web review inbox renders the new `system.restored` household item.
  evidence: The diff raises the item and tests assert the row, but nothing shows it reaches the household-facing inbox (unverified).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-restore-asks-about-credentials-plan.md`
  summary: Test the real terminal prompt (`askOnTerminal`) and the wrapper's no-flag TTY path of `pangolin restore`.
  evidence: Every test injects `ask`/`interactive` or runs without a TTY, so readline close/SIGINT handling and the `-T`-less `compose run` are never executed.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-restore-asks-about-credentials-plan.md`
  summary: Add failure-injection tests for the keep-credentials carry (a throw after the swap, an unopenable replaced database).
  evidence: Only the generic afterSwap failure is tested; nothing proves a failed carry undoes the swap and leaves the previous files untouched.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-release-hygiene-plan.md`
  summary: `publish` always moves `latest` and `vX.Y`, so a patch release on an older line, or two tags pushed close together, can move them backwards; add a release concurrency group and move `latest` only for the highest `vX.Y.Z` tag.
  evidence: pre-existing in release.yml's tag step (it always tagged latest); found in the story 1.18 review.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-release-hygiene-plan.md`
  summary: Reconcile `deployment-and-ops.md` (CI/CD) and the spine's Migrations row, which say the previous-release migration runs on every push, with the human decision of 2026-10-03 to run it only at release.
  evidence: story 1.18 intent-alignment review; the spec text and release.yml now disagree.
  disposition: fixed (spec reconciliation, 2026-10-03)
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/story-dns-drift-recovery-plan.md`
  summary: Test install.sh printing render.sh's journal lines when pangolin-allowlist.service fails on a real (non-`--root`) install.
  evidence: the install tests all run under `--root`, which skips that branch; it needs systemctl and journalctl stubs (story 11.4 review).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/story-dns-drift-recovery-plan.md`
  summary: Alert the operator when the allowlist timer keeps refusing (an OnFailure hook, a status file or a `pangolin status` warning), so a stale ruleset does not persist silently.
  evidence: story 11.4 makes an all-unresolved render refuse and keep the last good ruleset; a failed oneshot unit is visible only in systemctl and the journal.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F2) Turning backups off while DNS is stale dies with the generic "the firewall did not reload": the removal's reload should be `apply_allowlist_now early` so install_firewall shows render.sh's reason.
  evidence: deploy/install.sh write_allowlist calls apply_allowlist_now without early; install_firewall alone surfaces render.sh's refusal (retro F2).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F4) A bundle written in the same run as --backup-server "" (with --bundle or a pending mark) omits RESTIC_REPOSITORY; write the old repository, marked as holding past backups.
  evidence: deploy/install.sh write_bundle prints RESTIC_REPOSITORY only from BACKUP, empty when BACKUP_OFF=1 (retro F4).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F5) After --data-root moves, uninstall knows only the new root and can delete the secrets the old root's database still needs; record the previous data root for uninstall to check.
  evidence: deploy/uninstall.sh reads PANGOLIN_DATA_ROOT only; install.sh leaves the database in the old root with a warning (retro F5).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F9) A re-run on a digest-pinned install replaces a newer checkout's pangolin CLI with the pinned image's older one, losing CLI fixes until the next upgrade; take only compose.yaml from the image, or warn when the pinned CLI is older.
  evidence: deploy/install.sh write_files installs ${PINNED}/pangolin when present (story 11.9; retro F9).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F10) Changing the backup server from A to B leaves A's allowlist entry; remove the old entry on any change, not only when backups are turned off.
  evidence: deploy/install.sh write_allowlist removes the old entry only when BACKUP_OFF=1 (retro F10).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F11) After --backup-server "", every later re-run warns "no backup server set"; treat a present but empty PANGOLIN_BACKUP_REPOSITORY as a deliberate off.
  evidence: deploy/install.sh settings warns whenever BACKUP is empty (retro F11).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F12) With the LUKS data disk not mounted on a rebuilt host and the secrets missing, install.sh sees no database and generates new secrets; refuse when the data root is expected to be a mount point and is not.
  evidence: check_secrets_for_database looks only for pangolin.sqlite (deploy/install.sh; retro F12).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F14) Small edge cases: a rollback with no pangolin.sqlite* leaves an empty kept directory yet names it; a CIDR in PANGOLIN_DNS_SERVERS makes the live nft add element batch fail; the "backups are off" wording keys on --no-docker rather than run_stack under --root.
  evidence: deploy/pangolin rollback keep step; render.sh live DNS widening; install.sh write_env message (retro F14).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F15) detect_dns in install.sh has no test and drifts from render.sh's host_resolvers (a non-IP nameserver kills a first install without --dns; it reads the real resolv.conf under --root); read the files through path and test it against host_resolvers on the same fixtures.
  evidence: install.sh:345-356 and 490-492 vs render.sh:192-208 (retro F15).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F16) Add a round-trip test of .bundle-pending across install, uninstall --keep-data and reinstall.
  evidence: uninstall.test.ts writes the name as a literal; install.test.ts's reinstall test makes no mark (retro F16).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F17) Execute release.yml's latest/prerelease output computation in a test (or move it into release-tags.sh).
  evidence: release-workflow.test.ts checks only the wiring (retro F17).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F18) Compare stop_grace_period with the job runner's exported default stop timeout instead of a literal 10 s.
  evidence: install.test.ts:2069-2076 vs runner.ts:141 (retro F18).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: (F19) Load install.sh --dns resolvers into the live firewall before apt-get update and the image pull.
  evidence: install.sh main runs install_packages and obtain_image before install_firewall (retro F19).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/story-retrospective-fixes-bundle-on-reinstall-firewall-reload-orde-plan.md`
  summary: install.sh's earlier firewall reloads (allow_package_mirrors, allow_build_hosts) still run the previous release's render.sh; install the new render.sh before them.
  evidence: story 11.11 moved only write_files' render.sh copy ahead of write_allowlist (review pass 1).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md`
  summary: Run the hardening epic's resolver-change check on a real host: change pang-dev's DNS resolver, wait for one pangolin-allowlist timer run, and confirm outbound access (registry-1.docker.io/v2/ answers 401), exercising story 11.4's live DNS widening against real nftables.
  evidence: deferred by the user on 2026-10-04 (epic 11 Done when 6); never run outside stubbed tests.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-tracer-bullet-one-account-s-transactions-seen-per-viewer-plan.md`
  summary: Make the `seed` command atomic: validate every event with the use-case input schemas before the first write, so a bad seed leaves no partial ledger.
  evidence: `parseSeed` types `postedOn` as a string and leaves share and currency rules to the use cases, which run per event after earlier events commit (review pass 1, medium, dev-only tool).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-tracer-bullet-one-account-s-transactions-seen-per-viewer-plan.md`
  summary: Decide whether the `seed` admin command should be refused on real (non-dev) installs.
  evidence: it is registered for every non-demo server and guards only on two signed-up partners and an empty ledger (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-tracer-bullet-one-account-s-transactions-seen-per-viewer-plan.md`
  summary: Add `AND account.deleted_at IS NULL` to `visibleTxn`'s account subquery and test soft-deleted accounts, and back the private-account one-owner rule and `split.beneficiary` with database constraints.
  evidence: `packages/db/src/privacy.ts` visibleTxn omits deleted accounts and migration 0008 enforces the owner and beneficiary rules only in use cases (review pass 1, low; entry 3 privacy core).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-tracer-bullet-one-account-s-transactions-seen-per-viewer-plan.md`
  summary: Paginate `GET /api/ledger/transactions`, show account name, private marker and account currency on the list page, and add a `visibleAudit` path for audit rows carrying private payloads.
  evidence: `listVisible` loads every visible transaction, the page hard-codes AUD, and audit rows store private account names and descriptions (review pass 1, low; epic-ledger-workspace).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-and-classification-schema-plan.md`
  summary: Scope and viewer checks for classification writes: `softDelete` and `tag.attach` on payee, payee_alias, tag, activity take no viewer, so entries 4 and 5 use cases must `find(viewer, id)` first, or the repos should take the viewer.
  evidence: classify-repos.ts write methods apply no `visibleScope` and the memory mirror copies the gap (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-and-classification-schema-plan.md`
  summary: Make the memory unit of work enforce the SQLite CHECKs (status, posted_on, kind, match_kind, source, matched_by, flags) and call `check()` before reference checks, with parity cases for them.
  evidence: classification-repos.test.ts parity covers only the matrix rows (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-and-classification-schema-plan.md`
  summary: Revisit fingerprint v1 for the import epic: normalise descriptions, cross-check the hand-rolled SHA-256 against node:crypto, and decide how v0 (id) fingerprints from pre-0009 rows dedupe.
  evidence: legacy rows carry fingerprint = id, version 0; v1 hashes the raw description (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-and-classification-schema-plan.md`
  summary: Tighten the 0009 schema: date-order and format CHECKs, case-insensitive name uniqueness, balance_snapshot uniqueness, indexes on new foreign keys, and `payeeId` redaction on shared transactions that reference a scoped payee (entry 3).
  evidence: no such constraints exist in 0009 and visibleTxn returns payeeId as stored (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-and-classification-schema-plan.md`
  summary: Stop exporting `@pangolin/app/testing/memory-uow` publicly; keep parity tests beside the memory unit of work or in a testing package.
  evidence: packages/app/package.json now exports test-only code (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-privacy-core-hidden-names-redact-and-the-read-rule-plan.md`
  summary: Make audit scope fail closed: audit rows for account-scoped entities with `account_id` NULL are visible to everyone, so every later ledger and accounts use cases (hiding, delete, owner change) must set `accountId`, or the audit repo should refuse such rows.
  evidence: `visibleAudit` treats NULL `account_id` as visible; only createAccount and createTransaction are tested to set it (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-privacy-core-hidden-names-redact-and-the-read-rule-plan.md`
  summary: Decide what a soft-deleted account's audit rows and review items do for its owner (they vanish today), and widen the read rule to raw SQL and `require`, put the biome restriction group in one place, and cover `split` and `payee`.
  evidence: `visibleAccounts` excludes deleted accounts; read-rule.test.ts matches import specifiers only (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-privacy-core-hidden-names-redact-and-the-read-rule-plan.md`
  summary: Bound the audit and transaction reads (limit or keyset), add indexes on `audit_log.account_id` and `transaction.transfer_group_id`, scrub other entities' audit JSON, and unify memory/SQL helpers with an audit parity scenario.
  evidence: listVisible reads have no limit, subqueries run per row, the audit scrub removes two keys (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-accounts-module-plan.md`
  summary: Close the accounts memory-mirror gaps: soft-deleted account in `balanceAsOf`, `replaceOwners` validation and owner order, and same-day snapshot tie-break plus soft-deleted transactions in the SQLite-versus-memory parity scenario.
  evidence: memory-uow.ts `balanceAsOf`, `replaceOwners` and `owners` differ from the SQLite repos and the parity test covers neither (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-accounts-module-plan.md`
  summary: Harden account inputs: reject empty owner lists in `replaceOwners`, make `poolOf` fail with a typed error per row instead of 500ing `listAccounts`, skip no-op writes and their audit rows, and validate future dates, duplicate same-day snapshots and the db `balanceAsOf` date with the real date parser before the manifest reuses it.
  evidence: set-privacy.ts, update-account.ts, pool.ts and packages/db/src/balance.ts (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-accounts-module-plan.md`
  summary: Tidy the accounts API: type the route-to-use-case calls instead of `never`, add a body size limit, bound and batch the list reads, and decide on institution deletion and snapshot correction routes.
  evidence: apps/server/src/http/app.ts `objectBody`, `listAccounts` N+1 owners query (review pass 1, low).
