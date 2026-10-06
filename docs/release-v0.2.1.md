# Release v0.2.1

The checklist and evidence record for releasing `v0.2.1` and upgrading the home server
(`pang-dev`) from the `v0.2.0` tag. It carries the privacy fixes of epic 2's entries 14 to 18 to
a real host and proves CAP-16's release and upgrade path for them. Procedures come from
[install.md](install.md) section 11 and `deploy/pangolin`; this page changes none of them. It is
[release-v0.2.0.md](release-v0.2.0.md) carried over: the schema 8 to 11 real-data check and the
format-1 restore are dropped (done at v0.2.0, and no migration lies between the tags), and the
manual backup is now a gate.

Who does what: the human tags, pushes, backs up and upgrades, and pastes the output. The agent
prepared this page, ran the pre-flight checks below and fills the record from pasted output. The
agent pushes no tag, takes no backup, runs no `pangolin upgrade` and touches no server. No field
counts as filled without pasted output or a run URL.

## Release notes

GitHub generates the full notes from the merged changes; these are the hand-written lines.

`v0.2.1` is the privacy remediation of epic 2. It changes behaviour only; there is no schema
change (schema stays 11 of 11, migrations end at `0010`) and no new setting.

- A hidden name stays hidden from everyone but the person who hid it, whatever happens to the
  account's privacy or owners afterwards. Only a person can remove themselves from an account's
  owners, and only an owner can hide a transaction's name.
- Audit history is true. A partner's write on a hidden row records the real description and
  payee, and the partner still sees the placeholder when reading the audit. The redaction
  helpers fail closed on JSON they cannot parse.
- A hidden transaction's fingerprint and external id are no longer shown to the partner.
- Switching an account to public is refused while it carries owner-scoped payees, tags or
  activities, and the refusal names the account's owners. Rows recorded while the account was
  private stay owner-only after it goes public.
- Switching an account to private is refused while any split's beneficiary is someone other than
  its sole owner.
- A split on a public account no longer accepts an owner-scoped activity, and a partner cannot
  delete a transfer group that reaches into the other's private account. Deleting one side of a
  transfer unlinks the other side.
- Backup drill and verification summaries, as stored, returned by `GET /api/system/backup` and
  audited, now name the failed check and the short snapshot id, with no account IDs, row counts, sums or
  balances. The operator paths (`pangolin restore`, `check-upgrade`) keep their detailed
  messages. The backup code can no longer build a format-2 manifest without an explicit date
  (developer-facing).
- A `propertyId` on a split is refused until properties exist.
- The read rule and the two-world privacy suite are wider: every account-scoped table's schema
  import, raw SQL naming `account`, `transaction` or `audit_log`, hidden names, a partner's own
  writes on hidden rows, owner changes, privacy switches and a failed backup drill.

Not fixed in this release:

- The backup digest (`manifestSha256`) and snapshot id sit in unscoped `backup_snapshot` audit
  rows, so a partner can see that the other's private data changed.
- A soft-deleted payee keeps its name and logo on its transactions (I4, accepted as decided in
  story 2.5).
- Rows written before this release are not rewritten (there is no migration). The v0.2.0 record
  shows pang-dev had no ledger accounts, so no stored drill summary carries account figures.

The version is the tag. `package.json` stays `0.0.0` and there is no CHANGELOG file.

## Rules

- Release only a commit whose CI is green and which descends from `v0.2.0`. The page is committed
  to `develop` first; CI must be green on that tip and the tag goes on that tip (decision,
  2026-10-06). The page and the plan file are already committed on the local `develop`; the
  human pushes it. The tag goes on the explicit hash recorded in step 1 (`TAG_COMMIT`). If
  `develop` moves after that, the human decides whether to tag the new tip (then its CI must be
  green) or `TAG_COMMIT`, and records the decision.
- The release run (`release.yml`: `ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`)
  must be green on the tag before the upgrade.
- The manual `sudo pangolin backup` comes first and its snapshot ID is recorded before the upgrade
  starts. Without it the upgrade does not run.
- The upgrade is `sudo pangolin upgrade v0.2.1` on a host that reports `v0.2.0`, never a develop
  build. If `pangolin status` before the upgrade shows anything else, stop and record it.
- Schema stays 11 of 11. Any other schema number after the upgrade rejects the release.
- Any step whose output differs from the expected output is recorded as **failed**, the upgrade
  stops there, and the release is not accepted.
- A failed tag is deleted on the remote and locally before the next attempt (step 12). A
  published tag is never reused.
- Each human change to the plan or this checklist is logged in the plan's Plan Change Log
  (`_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/story-release-v0-2-1-and-deploy-plan.md`).
- Only the human accepts the release.

## Pre-flight (agent, 2026-10-06)

The agent checked the base commit `84a66994371dcb4f7d4f99c4e5287a93b8a1a825` (the tip of
`develop` before this page). The tag goes on the commit that adds this page, so the CI result for
that commit is recorded in the evidence record once it exists (step 1).

1. **CI on the base: not green.** The run (`gh run view 37393717950`), push on `develop`,
   `headSha` `84a66994371dcb4f7d4f99c4e5287a93b8a1a825`: conclusion `failure`. `Secret scan`
   passed; `Lint, types, tests, STRICT` failed on 6 tests that timed out at 5000 ms
   (`apps/server/src/demo.test.ts` 1, `apps/server/src/admin/seed.test.ts` 5) while 97 of 99
   test files passed, so `Container and end-to-end` was skipped. The same two files pass on the
   agent's host (2 files, 43 tests, 26 s), so this looks like runner load, not a regression, but
   it is a failed gate and the agent has not re-run it. The base is therefore not releasable
   as it stands: the tag commit (this page's commit) needs its own green run, and the release
   run's `ci` job runs the same tests. Recent history shows the same job failing and passing on
   `develop` (`3ed41f1`, `fc36bf7` failed; `82ce95d`, `bfd0abb` passed). Re-running, or raising
   those tests' timeouts, is the human's call: this plan allows no code change.
2. **`v0.2.0` is an ancestor:** `git merge-base --is-ancestor v0.2.0 origin/develop` exits 0.
3. **`develop` has not moved:** `git fetch origin`, then `git rev-parse origin/develop` is
   `84a66994371dcb4f7d4f99c4e5287a93b8a1a825`.
4. **No migration between the tags:** `git diff --stat v0.2.0 HEAD -- packages/db/migrations` is
   empty; the last migration is `0010_split_provenance.sql`. `package.json` is unchanged too.
5. **No new setting, deploy or workflow change:** `git diff --exit-code v0.2.0 HEAD -- deploy
   .github docs/install.md apps/server/src/config.ts package.json pnpm-lock.yaml` exits 0.
6. **Release machinery tests:** `pnpm exec vitest run deploy/release-workflow.test.ts
   deploy/release-scripts.test.ts`: 2 files, 35 tests, all passed.
7. **`pnpm lint`:** exit clean of errors; 8 warnings, none in this page (the page is Markdown and
   nothing else changes).
8. **`pnpm check:upgrade` on a v0.2.0 database: not run by the agent.** The agent's host has no
   Docker, so `.github/scripts/previous-db.sh` could not boot the `v0.2.0` image, and no
   database was fabricated. CI's `migrate-previous` job does this on the tag (`v0.2.0` is the
   previous release) and is the gate. With no migration between the tags it should print
   `migrated 11 -> 11`.

## Checklist

Shell variables (set them in your session):

```sh
TAG=v0.2.1
REPO=ghcr.io/sbwilson/pangolin
```

| # | Who | Step |
| --- | --- | --- |
| 1 | Human, agent | Push `develop` (the page is already committed locally) and confirm CI is green on that exact tip. |
| 2 | Human | Confirm pang-dev reports `v0.2.0`. |
| 3 | Human | Take a manual backup on pang-dev and record the snapshot ID. **Gate.** |
| 4 | Human | Tag the step 1 commit and push the tag. |
| 5 | Human, agent watches | Watch the release run's five jobs. |
| 6 | Human | Record the signed image digest. |
| 7 | Human | Upgrade pang-dev. |
| 8 | Human | Read `/healthz`. |
| 9 | Human | Read `pangolin status`. |
| 10 | Human, agent | Take the first backup after the upgrade and read its manifest. |
| 11 | Human, agent | Fill the record and accept or reject the release. |
| 12 | Human | If a gate or the upgrade failed: delete the tag before retrying. |

### 1. Push `develop` and confirm CI

The page and the plan file are already committed on the local `develop`. The human pushes it,
then confirms CI is green on that exact tip:

```sh
git fetch origin && git checkout develop
git status -sb                                  # develop ahead of origin/develop only by the agent's commit(s)
git push origin develop
TAG_COMMIT=$(git rev-parse HEAD); echo "$TAG_COMMIT"
git log -1 --format='%H %s'
git merge-base --is-ancestor v0.2.0 "$TAG_COMMIT" && echo ancestor-ok
gh run list --branch develop --event push --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId,headSha,status,conclusion,url
```

Expected: the run's `headSha` equals `$TAG_COMMIT`, its `conclusion` is `success` (`Lint, types,
tests, STRICT`, `Secret scan`, `Container and end-to-end`), and `ancestor-ok` prints. Record the
tag commit hash in the evidence record. The base commit's own run failed on test timeouts (see
Pre-flight 1), so a failure here is possible: if it is the same 5000 ms timeouts and the job
passes on one re-run (`gh run rerun <run-id> --failed`), record both runs; if it is anything
else, stop. Wait for the run to finish; do not tag on a run in progress.

### 2. Confirm the starting build

On pang-dev:

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.0`, `Schema: 11 (this build expects 11)`, `Readiness: ok`. Paste
it. Anything else (a develop build, another tag): stop and record it. Do not upgrade.

### 3. Manual backup (gate)

On pang-dev:

```sh
sudo pangolin backup
```

Expected: exit 0 and a snapshot ID. Paste the output and record the ID. With no ID, stop: the
upgrade does not run. The pre-upgrade copy and the automatic rollback are the recovery; this
backup is the second one. v0.2.0's record notes that its manual backup was skipped; this one is
not optional.

### 4. Tag and push

Tag the explicit commit from step 1, not whatever `HEAD` is:

```sh
TAG_COMMIT=<hash from step 1>
git fetch origin
git rev-parse origin/develop                    # must equal $TAG_COMMIT, else stop (see Rules)
git merge-base --is-ancestor v0.2.0 "$TAG_COMMIT" && echo ancestor-ok
git tag -a "$TAG" -m "Release $TAG" "$TAG_COMMIT"
git push origin "$TAG"
```

If `origin/develop` differs from `$TAG_COMMIT` and the human has not decided (Rules), stop.
The tag format is `v*.*.*`. The agent never pushes it.

### 5. Watch the release run

```sh
gh run list --workflow Release --branch "$TAG" --limit 5 --json databaseId,url,conclusion,headSha
gh run view <run-id> --json conclusion,headSha,jobs --jq '{conclusion, headSha, jobs: [.jobs[] | {name, conclusion}]}'
```

Use only a run whose `headSha` equals `$TAG_COMMIT`. Expected: `conclusion` `success` with
`ci`, `image`, `upgrade-test`, `migrate-previous` and `publish` all `success`, and the GitHub
release exists with `latest` moved to `v0.2.1` (`gh release list --limit 1`).

If only `ci` failed, and on the known 5000 ms timeouts (Pre-flight 1), allow one
`gh run rerun <run-id> --failed` on the same tag, record both runs, and do not delete the tag.
Any other failure, or a second `ci` failure, means there is no release and no tagged image: go
to step 12. Do not upgrade.

### 6. Image digest

```sh
docker buildx imagetools inspect "$REPO:$TAG" | grep -m1 Digest
```

### 7. Upgrade

On pang-dev, only after steps 2, 3, 5 and 6 are recorded. No migration runs this time, so the
60 second default health wait would do; v0.2.0 used 180 and it costs nothing, so keep it.
`PANGOLIN_UPGRADE_TIMEOUT` is a positive whole number of seconds (polled every 3 seconds,
rounded up to a multiple of 3).

Run `sudo pangolin status` again immediately before upgrading and require `Pangolin Money
v0.2.0`, `Schema: 11 (this build expects 11)` and `Readiness: ok`. Anything else: stop.

```sh
sudo pangolin status
sudo PANGOLIN_UPGRADE_TIMEOUT=180 pangolin upgrade "$TAG"
```

Expected: the signature is verified, the image digest `pangolin upgrade` verifies equals the
one recorded in step 6 (stop if not), the pre-upgrade copy is made in
`/srv/pangolin/upgrade-copies/pre-upgrade-<time>/`, the schema stays 11 of 11, the stack is
healthy. Paste the whole output.

### 8. Healthz

```sh
curl https://<app host>/healthz
```

Expected: `{"ok":true…}`. The `recovery-bundle-unconfirmed` warning that rode along at v0.2.0
may still be there; it pre-dates this release (`sudo pangolin confirm-bundle` clears it).

### 9. Status

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.1`, `Schema: 11 (this build expects 11)`, `Readiness: ok`.
Anything else rejects the release.

### 10. First backup after the upgrade

```sh
sudo pangolin backup
sudo pangolin status
```

Then read the manifest (see "Reading a manifest" below). Expected: `format` 2 and a current
`balanceDate` (the household's today). If the household still has no ledger accounts, the
`accounts` section is empty; record that. Anything else: investigate before accepting.

### 11. Fill the record

Fill every field below from pasted output, then accept or reject.

### 12. If it failed: delete the tag before retrying

```sh
git push --delete origin "$TAG" && git tag -d "$TAG"
```

Fix the cause on `develop` and wait for CI. Before retagging under the same name, both of these
must fail (the tag was never published):

```sh
gh release view "$TAG"
docker buildx imagetools inspect "$REPO:$TAG"
```

If either exists, the tag counts as published and is never reused: release the next patch
(`v0.2.2`) instead. Otherwise push a new tag as in step 4. The deleted tag matters because a
tag left behind by a failed run has no image, so the next release's `migrate-previous` would
fail to pull it. If the upgrade itself failed or was rejected after a green release, record the
automatic rollback message, keep the pre-upgrade copy and the manual backup from step 3, and
decide the next release with the plan.

## Reading a manifest

The manifest travels with the snapshot as `manifest.json` (`format`, per-table counts and
checksums, and for format 2 an `accounts` section and `balanceDate`). The v0.2.0 record read it
with `restic dump` from the repository. On pang-dev, as root, with the stack left running (the
repository is append-only and a read changes nothing):

```sh
set -a; . /opt/pangolin/.env; set +a      # for PANGOLIN_BACKUP_REPOSITORY
export RESTIC_REPOSITORY="$PANGOLIN_BACKUP_REPOSITORY"
export RESTIC_PASSWORD_FILE=/opt/pangolin/secrets/restic-password
restic dump <snapshot-id> /data/backup/staging/<backup-id>/manifest.json | head -c 400     # the format line
```

Then read the whole `accounts` section on the host (for example with `jq .accounts` on the
dumped file), not a fixed number of bytes: its length depends on the household.

(`<snapshot-id>` is the restic snapshot ID `pangolin backup` prints; `<backup-id>` is the backup's own
ID, the `01M…` value on the "Backup … started" line. The path inside the snapshot is
`/data/backup/staging/<backup-id>/manifest.json`, as read on pang-dev on 2026-10-06; a bare
`manifest.json` does not exist there. If restic needs a different invocation for this setup, say
so in the record; this is the human's call. `pangolin restore` is not used here: it swaps
into the live database.) This page is committed, so household figures must not go in it: paste
only the `format` line, `balanceDate` and the number of accounts. Keep account names and amounts
out of this page.

## Rollback

- A failed upgrade rolls back by itself: previous image, `.env` and database copy, a
  `system.upgrade-failed` review item in the inbox, and the database the new server used kept in
  `/srv/pangolin/upgrade-copies/rolled-back-<time>/`. Paste the message.
- If the rollback cannot keep that copy, it stops before restoring, starts the previous stack
  on the live database and names the pre-upgrade copy for a manual restore (install.md
  section 11). Because there is no migration this time, the live database is still schema 11.
- After a successful upgrade that you then reject: the pre-upgrade copy in
  `/srv/pangolin/upgrade-copies/pre-upgrade-<time>/` and the manual backup from step 3 are the
  recovery. Restoring either discards everything written since the upgrade, and a rollback to
  `v0.2.0` runs the old privacy behaviour again.
- The last two pre-upgrade copies are kept; keep these until the release is accepted.

## Evidence record

Every field is empty until the human pastes the output. Pre-flight rows are filled by the agent.

| Field | Value |
| --- | --- |
| **Pre-flight** | |
| Base commit (tip of `develop` before this page) | `84a66994371dcb4f7d4f99c4e5287a93b8a1a825` |
| CI on the base commit | Run https://github.com/sbwilson/pangolin/actions/runs/37393717950: **failure**, 2026-10-06. `Secret scan` success; `Lint, types, tests, STRICT` failed, 6 tests timed out at 5000 ms (`demo.test.ts` 1, `admin/seed.test.ts` 5; 97 of 99 files passed); `Container and end-to-end` skipped. The same files pass locally (43 tests). Not re-run by the agent |
| `v0.2.0` is an ancestor | `git merge-base --is-ancestor v0.2.0 origin/develop` exit 0, 2026-10-06 |
| `origin/develop` at pre-flight | `84a66994371dcb4f7d4f99c4e5287a93b8a1a825` (unchanged), 2026-10-06 |
| Migrations between the tags, and no new setting | None: `git diff --stat v0.2.0 HEAD -- packages/db/migrations` empty; last is `0010_split_provenance`; `package.json` unchanged; `git diff --exit-code v0.2.0 HEAD -- deploy .github docs/install.md apps/server/src/config.ts package.json pnpm-lock.yaml` exits 0, 2026-10-06 |
| Release machinery tests | `deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts`: 2 files, 35 tests passed, 2026-10-06 |
| `pnpm lint` | No errors, 8 warnings (none from this page), package boundaries ok, 2026-10-06 |
| `check:upgrade` on a v0.2.0 database | Not run by the agent: no Docker on the agent's host, so `previous-db.sh` could not make one (CI's `migrate-previous` does this on the tag) |
| **Human, before the tag** | |
| Tag commit (step 1): `TAG_COMMIT` hash, subject | `ba762e2d01b49b0a49a522e7115d72e769030eb3` `ci(test): raise the default test and hook timeouts to 30 s` (the tip of `develop`; `origin/develop` unchanged at tag time) |
| CI on the tag commit (step 1): run URL, conclusion | https://github.com/sbwilson/pangolin/actions/runs/37401151635: success (`Secret scan`, `Lint, types, tests, STRICT`, `Container and end-to-end`), `headSha` `ba762e2`, 2026-10-06. The 30 s timeout fix (`ba762e2`) came after the failed base run |
| Starting build (step 2): `pangolin status` output | `Pangolin Money v0.2.0`, `Schema: 11 (this build expects 11)`, `Readiness: ok`, warning `recovery bundle not confirmed stored safely`, 1 dead job (`backup-push`, 2026-10-02, pre-existing), last backup `ffe2bbb7c35218f9668b07061f82799c69b2880f221b7b569cd4f0a3fd47ca29` (2026-10-05T15:30:03Z); pasted by the human, 2026-10-06. Re-read just before the upgrade: same, last backup now the manual one |
| Manual backup snapshot ID (step 3) | `924a330c8c565f02979960eefe1269cb307ba8984b98e7915985e38af70b907f`, backup `01M47MPJVBTP38RCSQJ67EMN1P`, done 2026-10-06T03:39:18.000Z, taken before the upgrade |
| **Release** | |
| Tag and commit (step 4) | `v0.2.1` (annotated tag) on `ba762e2d01b49b0a49a522e7115d72e769030eb3`, set by the human; `git rev-parse v0.2.1^{commit}` gives that hash, 2026-10-06 |
| Release run URL (step 5) | https://github.com/sbwilson/pangolin/actions/runs/37410053125: success, `headSha` `ba762e2` |
| `ci` job | success (`ci / Lint, types, tests, STRICT`, `ci / Secret scan`, `ci / Container and end-to-end`) |
| `image` job | success |
| `upgrade-test` job | success |
| `migrate-previous` job | success |
| `publish` job; GitHub release and `latest` moved | `publish` success; `gh release list` shows `v0.2.1` as `Latest`, published 2026-10-06T03:50:35Z, `v0.2.0` below it |
| Signed image digest (step 6) | `sha256:f684b98ff1964840326ea374b3962e13fa8c1f732135d026d3c615a2e68eb9b3` (`docker buildx imagetools inspect ghcr.io/sbwilson/pangolin:v0.2.1`, run on pang-dev) |
| Re-runs, deleted tags or retags (run URLs, tag names) | None. The base commit's red run 37393717950 was not re-run; the timeout fix and a fresh run on `ba762e2` replaced it |
| **Upgrade on pang-dev** | |
| Date and `PANGOLIN_UPGRADE_TIMEOUT` used | 2026-10-06, `PANGOLIN_UPGRADE_TIMEOUT=180` |
| `pangolin upgrade` output (step 7) | `Pulling ghcr.io/sbwilson/pangolin:v0.2.1...`, `Verifying ghcr.io/sbwilson/pangolin@sha256:f684b98f…b3...`, stack stopped (0.4 s) and started (0.9 s), `Upgrade to v0.2.1 successful. Old image was ghcr.io/sbwilson/pangolin@sha256:60af95ac20ca02282425a97e74887e58c1682c69a005aac64ef4e788b0655cb1.` (the v0.2.0 digest) |
| Pre-upgrade copy path (from step 7 output) | Not in the output. `sudo ls /srv/pangolin/upgrade-copies/` lists `pre-upgrade-20261005171624` (the v0.2.0 upgrade's) and `pre-upgrade-20261006145552` (this upgrade's, 14:55:52 local, 03:55Z) |
| Image digest `pangolin upgrade` verified (step 7) | `sha256:f684b98ff1964840326ea374b3962e13fa8c1f732135d026d3c615a2e68eb9b3`, equal to step 6's |
| `/healthz` (step 8) | `{"ok":true,"warnings":["recovery-bundle-unconfirmed"]}` (the warning pre-dates the release; `sudo pangolin confirm-bundle` clears it), 2026-10-06 |
| `pangolin status` showing the tag and schema 11 of 11 (step 9) | `Pangolin Money v0.2.1`, `Schema: 11 (this build expects 11)`, `Readiness: ok`; same warning, 3 pending jobs, 1 dead job (`backup-push`, 2026-10-02, pre-existing), 2026-10-06 |
| **After the upgrade** | |
| First backup: snapshot ID (step 10) | `ecaa220f85b42bf50cdc6824fe66683f9ef423fa0a5051ab5d5de75efd88b8ba`, backup `01M47NRX5ACDH1DHZ879E270M9`, done 2026-10-06T03:58:02.525Z by `v0.2.1`. The `pangolin status` after it was not pasted; the post-upgrade status (step 9) is recorded above |
| First backup: manifest `format` | `"format": 2`, reported by the human from `restic dump` of the snapshot, 2026-10-06. Path in the snapshot: `/data/backup/staging/01M47NRX5ACDH1DHZ879E270M9/manifest.json` |
| First backup: `balanceDate` and accounts section | `balanceDate` `2026-10-06`; `accounts` has 0 entries (pang-dev has no ledger accounts yet, as at v0.2.0), reported by the human from the step 10 snapshot. A further backup was taken afterwards, `8f7749008d9344dd14f69b8e0bffc446c57dca823311b5f0fe55576bdd6f9416` (backup `01M47PD1HQQBEPDWSZE4CKK20S`, 2026-10-06T04:09:02.270Z); it is not step 10's |
| **Decision** | |
| Outcome (accepted / failed) and reason | |
| Accepted by the human (name, date) | |
