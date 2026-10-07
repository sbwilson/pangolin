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
  disposition: partly fixed (story 2.11, a4d38bc): CHECK parity for status, posted_on, kind, match_kind, source and matched_by (and the account type, owner share and balance snapshot date), `check()` ahead of reference checks, and the parity cases; the split and flag CHECKs were already mirrored
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-and-classification-schema-plan.md`
  summary: Revisit fingerprint v1 for the import epic: normalise descriptions, cross-check the hand-rolled SHA-256 against node:crypto, and decide how v0 (id) fingerprints from pre-0009 rows dedupe.
  evidence: legacy rows carry fingerprint = id, version 0; v1 hashes the raw description (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-and-classification-schema-plan.md`
  summary: Tighten the 0009 schema: date-order and format CHECKs, case-insensitive name uniqueness, balance_snapshot uniqueness, indexes on new foreign keys, and `payeeId` redaction on shared transactions that reference a scoped payee (entry 3).
  evidence: no such constraints exist in 0009 and visibleTxn returns payeeId as stored (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-and-classification-schema-plan.md`
  summary: Stop exporting `@pangolin/app/testing/memory-uow` publicly; keep parity tests beside the memory unit of work or in a testing package.
  evidence: packages/app/package.json now exports test-only code (review pass 1, low).
  disposition: fixed (story 2.11, 6d45715): the export is gone; the parity tests moved beside the memory unit of work and the boundary check allows `packages/app` test files to import `packages/db`
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-privacy-core-hidden-names-redact-and-the-read-rule-plan.md`
  summary: Make audit scope fail closed: audit rows for account-scoped entities with `account_id` NULL are visible to everyone, so every later ledger and accounts use cases (hiding, delete, owner change) must set `accountId`, or the audit repo should refuse such rows.
  evidence: `visibleAudit` treats NULL `account_id` as visible; only createAccount and createTransaction are tested to set it (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-privacy-core-hidden-names-redact-and-the-read-rule-plan.md`
  summary: Decide what a soft-deleted account's audit rows and review items do for its owner (they vanish today), and widen the read rule to raw SQL and `require`, put the biome restriction group in one place, and cover `split` and `payee`.
  evidence: `visibleAccounts` excludes deleted accounts; read-rule.test.ts matches import specifiers only (review pass 1, low).
  disposition: partly fixed (story 2.11, 014ee77 and f38e748): the biome read-rule group is stated once, as a plugin; the rest stays open
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-privacy-core-hidden-names-redact-and-the-read-rule-plan.md`
  summary: Bound the audit and transaction reads (limit or keyset), add indexes on `audit_log.account_id` and `transaction.transfer_group_id`, scrub other entities' audit JSON, and unify memory/SQL helpers with an audit parity scenario.
  evidence: listVisible reads have no limit, subqueries run per row, the audit scrub removes two keys (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-accounts-module-plan.md`
  summary: Close the accounts memory-mirror gaps: soft-deleted account in `balanceAsOf`, `replaceOwners` validation and owner order, and same-day snapshot tie-break plus soft-deleted transactions in the SQLite-versus-memory parity scenario.
  evidence: memory-uow.ts `balanceAsOf`, `replaceOwners` and `owners` differ from the SQLite repos and the parity test covers neither (review pass 1, low).
  disposition: fixed (story 2.11, a4d38bc and 6d45715): soft-deleted account in `balanceAsOf`, `replaceOwners` validation and owner order, same-day snapshot tie-break and soft-deleted transactions are in the parity scenarios
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-accounts-module-plan.md`
  summary: Harden account inputs: reject empty owner lists in `replaceOwners`, make `poolOf` fail with a typed error per row instead of 500ing `listAccounts`, skip no-op writes and their audit rows, and validate future dates, duplicate same-day snapshots and the db `balanceAsOf` date with the real date parser before the manifest reuses it.
  evidence: set-privacy.ts, update-account.ts, pool.ts and packages/db/src/balance.ts (review pass 1, low).
  disposition: partly fixed (story 2.11, bc64d1a): `poolOf` fails with a typed `Conflict`; the other hardening stays open
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-accounts-module-plan.md`
  summary: Tidy the accounts API: type the route-to-use-case calls instead of `never`, add a body size limit, bound and batch the list reads, and decide on institution deletion and snapshot correction routes.
  evidence: apps/server/src/http/app.ts `objectBody`, `listAccounts` N+1 owners query (review pass 1, low).
  disposition: partly fixed (story 2.11, 0a21509): route-to-use-case calls are typed instead of `never`; body limit, list bounds and the institution and snapshot decisions stay open
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-workspace/story-web-stack-router-with-url-search-params-table-and-virtual-li-plan.md`
  summary: Complete the shadcn theme tokens (destructive, card, popover, secondary, sidebar) and the icon library dependency before the first story that adds a component using them; remove the `button:not([class])` base-style hack.
  evidence: styles.css defines a subset of shadcn tokens and components.json names lucide without `lucide-react` installed (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-workspace/story-web-stack-router-with-url-search-params-table-and-virtual-li-plan.md`
  summary: Extract the RootLayout gate precedence into a pure `selectGate(me, pathname)` with node unit tests, normalise trailing slashes on /setup and /recover, and memoise the session context; decide whether unknown paths should redirect or show Home.
  evidence: RootLayout.tsx compares exact pathnames in an if-chain and only e2e covers the gates (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-classify-module-plan.md`
  summary: Decide cross-scope cascades: deleting a shared payee soft-deletes the owner's scoped aliases, and deleting a category clears scoped payees' defaults, both without the owner seeing it.
  evidence: softDeleteForPayee and clearDefaultCategory ignore scope (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-classify-module-plan.md`
  summary: Give soft-deleted categories, tags and activities a read path by id so transaction and report views can still show their names, and decide whether deleting a tag or activity referenced by splits is allowed.
  evidence: classify repos `find`/`list` are live-only; deleteTag and deleteActivity have no in-use rule (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-classify-module-plan.md`
  summary: Harden classify inputs: linear-time or safe-regex alias matching, case-insensitive names, no-op updates skipping audit, name uniqueness by (scope, name) query with UNIQUE mapped to Conflict, typed error in `scopeFor`, defaults seeding inside the seed transaction, and the tax-category labels and RENTAL code from a source.
  evidence: payees.ts requirePatternValid, scope.ts, admin/seed.ts, defaults.ts (review pass 1, low).
  disposition: partly fixed (story 2.11, bc64d1a): `scopeFor` fails with a typed `Conflict`; the rest stays open
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-classify-module-plan.md`
  summary: Tidy classify routes and test parity: nest aliases under a distinct prefix, one no-store middleware for /api/classify, GET by id for groups, categories and tax categories, memory-mirror payee update order and activity date CHECK, HTTP tests for partner by-id on aliases and activities.
  evidence: apps/server/src/http/app.ts classify block and memory-uow.ts (review pass 1, low).
  disposition: partly fixed (story 2.11, 0a21509, 6b5a70c and a4d38bc): one no-store middleware for `/api/*`, memory-mirror payee update order, HTTP tests for partner by-id on aliases and activities. The activity date-order check has no SQLite CHECK to mirror (it lives in the use case; a CHECK would be a migration), so it stays open with the aliases prefix and GET-by-id items
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-transactions-plan.md`
  summary: Register the transaction needs_review listener explicitly from a composition root (and assert it at startup) instead of by side-effect import, before the import epic raises `transaction:` review items.
  evidence: ledger/needs-review.ts registers on import from create-transaction.ts and update-transaction.ts (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-transactions-plan.md`
  summary: Decide how deleting one leg of a transfer group behaves (refuse, delete both, or orphan) when story 2.7 adds transfer groups.
  evidence: deleteTransaction ignores transferGroupId (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-transactions-plan.md`
  summary: Tidy ledger writes: idempotency or a warning for accidental double POST of a manual line, a splits snapshot in the create audit row, delete audit read back from the row, shared field schemas for create and update, and a signal when needs_review syncs a deleted or missing row.
  evidence: create-transaction.ts, update-transaction.ts, delete-transaction.ts, ledger/needs-review.ts (review pass 1, low).
  disposition: partly fixed (story 2.11, 88f0c6c): create and update share the description, date and notes field schemas; the other items stay open
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-splits-provenance-beneficiary-and-tags-plan.md`
  summary: Fire the split-field listeners (suggestion closing) from `setSplits` edits too, and decide whether a lower-ranked source writing a deleted or invalid target returns `applied: false` before validating the target.
  evidence: set-split-field.ts runs listeners only for `setSplitField`; set-splits.ts changes classified fields without them (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-splits-provenance-beneficiary-and-tags-plan.md`
  summary: Tighten split writes: keep non-sum Validation errors free of `remainingCents`, bound amounts so sums stay safe integers, compare splits field by field, reset a private-account split's stored beneficiary to the owner when it differs, mirror the SQLite id-collision error in memory, and put tag ids in create, update and delete audit snapshots.
  evidence: set-splits.ts `fail`, `sameSplit`, `resolve`; memory-uow.ts `replaceSplits` (review pass 1, low).
  disposition: partly fixed (story 2.11, a4d38bc): the memory unit of work mirrors SQLite's split id-collision error; the other items stay open
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-splits-provenance-beneficiary-and-tags-plan.md`
  summary: Give `tags.attach` a viewer check or remove it with the unused `TagRepo.detach`, use `objectBody` for the split PATCH route instead of `as never`, and return `remainingCents` once from the replace route.
  evidence: classify-repos.ts `attach`/`detach`, apps/server/src/http/app.ts split routes (review pass 1, low).
  disposition: fixed (story 2.11, 64bc96b and 0a21509): `TagRepo.attach` and `detach` are removed from the port and both adapters, the split PATCH route uses the typed body helper, and the replace route returns `remainingCents` once, inside `transaction`
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-hidden-names-and-transfer-groups-plan.md`
  summary: A partner can delete a transfer group whose other member sits in the owner's private account, clearing that private row's link.
  evidence: `deleteTransferGroup` clears every member including ones the viewer cannot see, by plan; whether the private owner alone should be allowed is unsettled.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-ledger-hidden-names-and-transfer-groups-plan.md`
  summary: hideTransactionName does not check the viewer is an owner of the shared account.
  evidence: It only requires the transaction be visible and the account non-private; harmless with two household members, wrong if a non-owner can see a public account.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-seed-the-ledger-plan.md`
  summary: Move the remaining seed checks into `parseSeed` so a bad seed fails up front with a named error: duplicate payee, tag, account and institution names, duplicate balance snapshots, account owner shares and the private-account beneficiary rule.
  evidence: checkReferences covers references, keys, dates, sums and owner-only use; the rest fails mid-apply and rolls back unnamed (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-seed-the-ledger-plan.md`
  summary: Make the e2e ledger spec compare the seed it regenerates with the server's `dist/demo-seed.json` (hash or read), strengthen its leak check to keys, and assert hidden names, labels and balances in the UI.
  evidence: e2e/ledger.spec.ts runs tools/seed/src/cli.ts locally while the server loads its built file (review pass 1, medium).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-seed-the-ledger-plan.md`
  summary: Tidy the seed: warn or reject when the real clock is before the seed's fixed today, link the loan repayment's two sides as a transfer, share one validator between `world.ts` and `checkReferences`, and document `PANGOLIN_ENABLE_SEED` in an env reference.
  evidence: seed.ts applyEvents clock use, transfers-and-privacy module, config.ts (review pass 1, low).
  disposition: partly fixed (story 2.11, feb3571): `world.ts` and `checkReferences` share one reference validator (`@pangolin/shared/seed`, re-exported by `@pangolin/app`) and `PANGOLIN_ENABLE_SEED` is documented in the README; the clock warning and the loan transfer stay open
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-server-side-privacy-suite-plan.md`
  summary: Strengthen the privacy suite later: aim A's account-scoped review items at the notice dismiss route, run hidden-name checks beside A's private delta and at a time-of-day boundary, replay system and identity GETs in the two-world comparison, replace raw SQL login and account-delete setup with use cases once an account-delete use case exists, and drop the `as never` casts.
  evidence: apps/server/src/privacy/privacy-harness.ts and privacy.test.ts (review pass 1, low).
  disposition: partly fixed (story 2.11, 6b5a70c): the `as never` casts in the privacy harness and tests are gone; the rest stays open
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-refactor-sweep-plan.md`
  summary: Keep `SeedKnown` incrementally in the seed generator instead of rebuilding it per event, and drop its unused `grouped`/`hidden` flags or move the rules that use them into the shared validator.
  evidence: tools/seed/src/world.ts `applyEvent` calls `knownOf(world)` per event; packages/shared/src/seed-references.ts (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-refactor-sweep-plan.md`
  summary: Close the remaining memory-mirror parity gaps: per-row CHECK, UNIQUE and FK ordering in `insert`/`replaceSplits`, non-integer `shareBp`, account insert id reuse, and date and currency formats.
  evidence: packages/app/src/testing/memory-uow.ts runs checks across the whole list where SQLite runs them per row (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-refactor-sweep-plan.md`
  summary: Declare the `packages/app` test dependency on `@pangolin/db` where it is used (not through the root) once the pnpm task cycle has another answer, extend `testOnly` to other test file names, and remove the remaining `as never` in `seed.test.ts`, `demo.test.ts` and app use-case tests; reword the `objectBody` finding as "one typed cast, Zod is the check".
  evidence: root package.json devDependencies, scripts/check-boundaries.ts `testOnly`, apps/server/src/http/app.ts (review pass 1, low).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-true-audit-history-and-hidden-row-projection-plan.md`
  summary: Audit snapshots record split tagIds only from the writer's scope (tagsOf → listForSplits(viewer)), so a partner's write omits the other person's scoped tags from the history.
  evidence: transaction-view.ts tagsOf uses the viewer's scope; a full fix records every tag in the snapshot and filters by scope when the audit is read (story 2.14 review #5).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-true-audit-history-and-hidden-row-projection-plan.md`
  summary: After an early unhide, audit rows whose snapshots carry the old nameHiddenUntil keep showing the placeholder to the partner until the original date.
  evidence: auditHiddenUntil takes the max of the live row and the snapshot JSON dates (privacy.ts); product decision whether history should follow the live unhide (story 2.14 review #6).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-account-ownership-and-privacy-switches-plan.md`
  summary: Once people can be deactivated, a deactivated co-owner cannot remove themself from an account, and only-remove-yourself (2.15) has no exception for them.
  evidence: updateAccount refuses removing anyone but the viewer; requireKnownPeople accepts active people only. Simon chose no exception at 2.15 (2026-10-05); the epic that adds deactivation decides.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-account-ownership-and-privacy-switches-plan.md`
  summary: A person can keep a co-owner on an account but cut their share to 1 bp, which only-remove-yourself does not cover.
  evidence: requireOnlySelfRemoved checks membership only; shares accept any value from 1 upward. The account stays joint, so it cannot go private; whether a co-owner's stake needs protecting is a product decision (2.15 review #3).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-account-ownership-and-privacy-switches-plan.md`
  summary: Spine and spec do not yet say AD-7 refuses a partner beneficiary as well as shared, or that setPrivacy(public) is the one update of audit_log rows (person_id only).
  evidence: 2.15 review #5; spec reconciliation for AD-7, AD-1/AD-11 audit wording.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-account-ownership-and-privacy-switches-plan.md`
  summary: The audit rescope on setPrivacy(public) leaves no trace and nothing at the database level limits audit_log updates to setting person_id from NULL.
  evidence: 2.15 review #6; options are a trigger allowing only person_id NULL to a value, or a stamped-row count in the set_privacy audit row.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-account-ownership-and-privacy-switches-plan.md`
  summary: setPrivacy(public)'s refusal names owners via person.listActive, falling back to a raw id for an inactive owner, and tells the user to remove items that may be soft-deleted and unpickable.
  evidence: 2.15 review #7 and #9; joins the deactivation deferral and epic 3 promotion / epic 12 accounts screen copy.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-account-ownership-and-privacy-switches-plan.md`
  summary: The public-switch refusal attributes every scoped item to the account owner, though the system viewer can put another person's scoped item on a private account.
  evidence: 2.15 review #14; only reachable through the system viewer (retro P10, deferred).
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-account-ownership-and-privacy-switches-plan.md`
  summary: A person can add themself (or a third person) as an owner of any public account they can see, since updateAccount only refuses removing others.
  evidence: 2.15 review pass 2 #10; predates 2.15 (public accounts are visible to both partners); a product rule on who may add owners is needed.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-account-ownership-and-privacy-switches-plan.md`
  summary: The server privacy harness has no takeover scenario (hide, leave, private, public) for its two-world checks.
  evidence: 2.15 review pass 2 #15; routed to epic 2 entry 18, which adds owner-change and privacy-switch worlds.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-cross-partner-split-and-transfer-guards-plan.md`
  summary: A soft-deleted transaction that still carries a `transfer_group_id` from before story 2.16 blocks deleting its group or its survivor's deletion (foreign key), because `members` and `upkeepMembers` read live rows only; no backfill unlinks survivors already stuck in a dead group.
  evidence: 2.16 review #2 and #3; released data holds no ledger rows (epic note), so only dev databases can have them; a fix is a one-off migration or a repo method that clears links by group id.

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-backup-manifest-privacy-plan.md`
  summary: Validate `balanceDate` (real calendar date, and before any file is removed) in `writeSnapshot`/`buildManifest`.
  evidence: The check is a `YYYY-MM-DD` regex inside `buildManifest`, run after `writeSnapshot` has removed `outDir` and copied the database, and `2026-13-45` passes it. Pre-existing; no current caller can pass a bad date.

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-widen-the-read-rule-and-privacy-suite-plan.md`
  summary: The backup manifest digest (`manifestSha256`, which hashes the whole database including private rows) and the restic snapshot id reach the partner in unscoped `backup_snapshot` audit rows, so partner B can see that A's private data changed.
  evidence: The 2.18 failed-drill world shows the digest differs between two worlds that differ only in A's private account; the drill comparison masks it as `<digest>`. Not invertible, but a byte difference B can read; a fix scopes or redacts `backup_snapshot` audit rows for a person viewer, or leaves the digest out of the audit `after`.
  disposition: closed by story 2.21 (the digest, counts and success-drill figures are dropped and the stored rows scrubbed); the restic snapshot id stays readable by decision of 2026-10-06, so people can choose which backup to restore

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-release-v0-2-1-and-deploy-plan.md`
  summary: `apps/server/src/admin/seed.test.ts` (5 tests) and `apps/server/src/demo.test.ts` (1) time out at 5000 ms on the CI runner, so `Lint, types, tests, STRICT` fails intermittently on `develop` and the release run's `ci` job can fail the same way.
  evidence: CI run 37393717950 on 84a6699 failed on those six timeouts (97 of 99 files passed); `develop` runs alternate red and green (3ed41f1, fc36bf7, 84a6699 red; 82ce95d, bfd0abb green) with no code cause; the files pass locally in 26 s. A fix raises the per-test timeout or speeds the seed fixture.

- source_plan: none
  summary: Applying the demo seed costs about 1.4 s per call locally (732 events), roughly half of it Drizzle query building (`entity.is`) and SQLite `prepare` with no statement reuse, and seed-dependent tests each re-apply it.
  evidence: CPU profile of `applySeed` (3 runs, 1.35 to 1.44 s each): `entity.js is` 1242 ms and better-sqlite3 `prepare` 1029 ms of 5083 ms total. On CI (2 vCPU, beside `deploy/install.test.ts`, which alone runs 130 to 220 s) the same tests take 4 to 6 s. The 30 s default timeout stops the failures; caching prepared statements in the repositories, or seeding once per file and copying with `serialize()`, would cut the cost itself.

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-leaving-the-household-deletes-the-leaver-s-private-data-plan.md`
  summary: Rows deleted by `leaveHousehold` stay readable in SQLite free pages and the WAL because `PRAGMA secure_delete` is off.
  evidence: `grep secure_delete` over `packages/db/src/open.ts` and `apps/server/src` finds nothing; a hard delete leaves the content in freed pages until they are reused or the file is vacuumed. A database-wide setting, not this change's, and the plan accepts only older backups as a residual.

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-leaving-the-household-deletes-the-leaver-s-private-data-plan.md`
  summary: Unverified (would be medium): the survivor of a transfer in a shared account carries an unscoped audit row when the leaver's private side is deleted, and the paired worlds link only private accounts.
  evidence: `leave-household.ts` `deleteAccountRows` audits a survivor with `survivorScopeOf`, as decision 81's delete path does, and the partner already reads `Transfer from <leaver>` on it. Add a private-to-shared transfer to the leave scenario's flavour one and compare the partner's audit bytes to settle it.

- source_plan: `_bmad-output/implementation-artifacts/plan-q1-one-closed-state.md`
  summary: Unverified (would be medium once the review inbox exists): a closing-balance item that a person resolves by hand is raised again at the next nightly `closing-balance-sync` run while the account stays closed with a balance.
  evidence: `raiseReviewItem` is idempotent only among open items for a dedupe key (`system/review-items.ts`), and `syncClosingBalances` calls `syncClosingBalance` for every closed account each night. No screen resolves an item yet. Settle it with the inbox: suppress while the balance is unchanged, or accept the nightly reminder.

- source_plan: `_bmad-output/implementation-artifacts/plan-q1-one-closed-state.md`
  summary: No test seeds an open closing-balance item on an account with a future `closedOn` and runs the job to see it resolved with "the closed date has not come".
  evidence: Only data raised under the pre-fix rule can be in that state; the resolve branch is covered through `updateAccount` (accounts.test.ts "moves the closed date into the future"). Add a case with a pre-seeded item to the "one closed state" describe block if such data ever exists.

- source_plan: `_bmad-output/implementation-artifacts/plan-epic2-retro-fix-now.md`
  summary: The future-closed message from `closeAccount` says "change that date with updateAccount", naming a use case where the lock's message speaks in user terms.
  evidence: `close-account.ts` (the "closes on" branch); the text is the plan's wording. Have the account screens (epic-ledger-workspace) map the structured Conflict to their own copy, or reword the API message then.

- source_plan: none
  summary: Wire the CSP nonce for the popover, the sheet and the toast, with an e2e check that opening each raises no violation (split from ticket 12.2).
  evidence: Ticket 12.2 owns it, but it does not depend on the transaction list; split from the list goal by Simon on 2026-10-07 at the build's scope check.

- source_plan: none
  summary: Add the nav badge that counts the viewer's uncategorised rows on the sidebar's Transactions item, showing a check at zero (split from ticket 12.2).
  evidence: Ticket 12.2 owns it ([ASSUMPTION] that it counts uncategorised rows); it needs a per-viewer count read and a sidebar change and can ship apart from the list. Split by Simon on 2026-10-07 at the build's scope check.

- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-ledger-workspace/story-transaction-list-url-filters-keyset-paging-virtualised-plan.md`
  summary: The transactions page has no web unit tests (`groupByDate`, `withChanges`, `activeChip`, the page jump), no loading cue while a page loads, stale rows beside an error alert, a today fixed at mount, and chips that can disagree with a URL that sets both `uncategorised` and `transfers`.
  evidence: Review pass 1 of ticket 12.2; the web vitest runs in node with no DOM setup, so the page logic is covered only by e2e. None corrupts data. Add a component-test setup when the page next changes (entries 3, 4 or 12).
