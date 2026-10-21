# Release v0.2.4

The checklist and evidence record for releasing `v0.2.4` and upgrading the home server
(`pang-dev`) from the `v0.2.3` tag. It carries epic 3 (Import, dedupe and transfer matching) to
a real host: the import pipeline, payee and rule classification, transfer matching, encrypted
hand-offs, batch undo, the Needs review inbox, the Import popover and the M1 gate tooling. It
advances the database schema from 15 to 21 (migrations 0015 to 0020). Procedures come from
[install.md](install.md) section 11 and `deploy/pangolin`; this page changes none of them. It follows
[release-v0.2.3.md](release-v0.2.3.md), including a pre-tagging real-data dry run of the new
migrations and the manual backup gate.

Who does what: the human provides a read-only copy of `pang-dev`'s database for the dry run, tags,
pushes, backs up and upgrades, and pastes the output. The agent prepared this page, ran the
pre-flight checks below and fills the record from pasted output. The agent pushes no tag, takes
no backup, runs no `pangolin upgrade` and touches no server. No field counts as filled without
pasted output or a run URL. The M1 gate itself ([m1-gate.md](m1-gate.md)) is a separate sign-off the
human runs after this upgrade.

## Release notes

GitHub generates the full notes from the merged changes; these are the hand-written lines.

`v0.2.4` ships the import and review experience (epic 3). It advances the database schema from 15
to 21 (migrations 0015 to 0020).

### Import
- **Import popover:** header Import button, drop zone, account picker with "For <partner>", bank
  export tips, and a live result summary linking to Needs review. Formats: CommBank, ubank, Up and
  FY2025 CSV, OFX, QIF.
- **Pipeline:** idempotent dedupe with occurrence counts, set-aside rows for unreadable lines, payee
  aliases and a deterministic rule engine, transfer matching and probable-duplicate flagging.
- **Hand-off to the partner:** the file is stored encrypted (AES-GCM) and waits in the partner's
  Needs review; the sender sees only its status.
- **Batch undo and account freshness:** an importer can undo a batch (use case only, no button yet);
  the Accounts list shows when and from what each account was last imported.

### Needs review
- **`/review` inbox:** a card for every review kind with its actions, a live nav badge, and a partner
  count of shared items. Identity notices moved here from the old banner.

### Gate tooling
- **Reconcile and opening balances:** each import checks the statement's running balances, records
  the derived opening as a snapshot, and `pangolin m1-report` / `pangolin opening-balance` support the M1 gate.

### Not fixed in this release
- PDF statements, the Import button beside Transactions search, undo and credit-limit UI (see
  `deferred-work.md`).

The version is the tag. `package.json` stays `0.0.0` and there is no CHANGELOG file.

## Rules

- Release only a commit whose CI is green and which descends from `v0.2.3`. The page, plan file and
  the e2e fix are committed to `develop` first; CI must be green on that tip and the tag goes
  on that tip. The tag goes on the explicit hash recorded in step 1 (`TAG_COMMIT`). If `develop`
  moves after that, the human decides whether to tag the new tip (whose CI must also be green) or
  `TAG_COMMIT`, and records the decision.
- A dry run of `pnpm check:upgrade` must be performed against a read-only copy of `pang-dev`'s real
  database before tagging (step 2), verifying schema migrations 15 -> 21.
- The release run (`release.yml`: `ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) must
  be green on the tag before the upgrade.
- The manual `sudo pangolin backup` comes first and its snapshot ID is recorded before the upgrade
  starts. Without it the upgrade does not run.
- The upgrade is `sudo pangolin upgrade v0.2.4` on a host that reports `v0.2.3`, never a develop
  build. If `pangolin status` before the upgrade shows anything else, stop and record it.
- Schema migrates from 15 to 21. Any other schema number after the upgrade rejects the release. The develop tip must have green CI **including** `Container and end-to-end`, which runs the Import, Needs review and axe specs for the first time on this release.
- Any step whose output differs from the expected output is recorded as **failed**, the upgrade
  stops there, and the release is not accepted.
- A failed tag is deleted on the remote and locally before the next attempt (step 13). A published tag
  is never reused.
- Each human change to the plan or this checklist is logged in the plan's Plan Change Log
  (`_bmad-output/initiative-pangolin-money-v1/epic-import-dedupe-transfers/story-release-v0-2-4-and-deploy-plan.md`).
- Only the human accepts the release.

## Pre-flight (agent, 2026-10-21)

1. **`v0.2.3` is an ancestor:** `git merge-base --is-ancestor v0.2.3 HEAD` exits 0.
2. **Release machinery tests:** `deploy/release-workflow.test.ts` and `deploy/release-scripts.test.ts`
   passed (2 files, 35 tests).
3. **Local checks on `e41b6d4`:** the full `vitest` run (145 files), `pnpm typecheck`, `pnpm lint`
   (0 warnings, package boundaries ok) and `pnpm check:strict` passed on the code tip before the
   e2e fix below.
4. **CI was red from `391d9e4` to `db68f5d`:** `Container and end-to-end` failed in four new specs
   (`import.spec.ts` x3, `review.spec.ts` x1) with `exposeBinding: Function "__pangolinCspViolation"
   has been already registered`: each called `watchCsp` on a context the `test` fixture already
   watches. Fixed in `e41b6d4` by removing the duplicate call. The 62 other specs passed. These
   specs and the new axe entries had never run before, so a first green run is the evidence, not a
   formality.
5. **Schema migrations:** 0015 to 0020 exist in `packages/db/migrations/` with snapshots; schema
   version 21. Migration 0019 ends with a backfill `UPDATE`, which the real-data dry run (step 2) exercises.

## Checklist

```sh
TAG=v0.2.4
REPO=ghcr.io/sbwilson/pangolin
```

| # | Who | Step |
| --- | --- | --- |
| 1 | Human, agent | Commit and push `develop`, and confirm CI is green on that exact tip. |
| 2 | Human, then agent | Check the migrations on a read-only copy of pang-dev's real database (`check:upgrade`). |
| 3 | Human | Confirm pang-dev reports `v0.2.3` and schema 15. |
| 4 | Human | Take a manual backup on pang-dev and record the snapshot ID. **Gate.** |
| 5 | Human | Tag the step 1 commit and push the tag. |
| 6 | Human, agent watches | Watch the release run's five jobs. |
| 7 | Human | Record the signed image digest. |
| 8 | Human | Upgrade pang-dev. |
| 9 | Human | Read `/healthz`. |
| 10 | Human | Read `pangolin status`. |
| 11 | Human, agent | Take the first backup after the upgrade and read its manifest. |
| 12 | Human, agent | Fill the record and accept or reject the release. |
| 13 | Human | If a gate or the upgrade failed: delete the tag before retrying. |

---

### 1. Push `develop` and confirm CI

The page and plan file are committed to `develop` with the e2e fix. Push to origin and confirm CI is
green, including `Container and end-to-end`:

```sh
git fetch origin && git checkout develop
git add docs/release-v0.2.4.md _bmad-output/initiative-pangolin-money-v1/epic-import-dedupe-transfers/story-release-v0-2-4-and-deploy-plan.md
git commit -m "docs(release): prepare v0.2.4 release checklist"
git status -sb                                  # develop ahead of origin/develop
git push origin develop
TAG_COMMIT=$(git rev-parse HEAD); echo "$TAG_COMMIT"
git log -1 --format='%H %s'
git merge-base --is-ancestor v0.2.3 "$TAG_COMMIT" && echo ancestor-ok
PAGER=cat gh run list --branch develop --event push --commit "$TAG_COMMIT" --limit 1 --json databaseId,headSha,status,conclusion,url
```

Expected: the run's `headSha` equals `$TAG_COMMIT`, its `conclusion` is `success` (`Lint, types, tests, STRICT`,
`Secret scan`, `Container and end-to-end`), and `ancestor-ok` prints. Record the tag commit hash in the
evidence record. If the run fails on intermittent test timeouts, allow one `PAGER=cat gh run rerun <run-id> --failed`
and record both runs. Wait for the run to finish; do not tag on a run in progress.

### 2. Real-data migration check (before tagging)

Human, on pang-dev, take a read-only copy of the live database without stopping the stack
(SQLite online backup ensures consistency; the live database is only read):

```sh
sudo sqlite3 -readonly /srv/pangolin/pangolin.sqlite ".backup '/tmp/pang-dev-copy.sqlite'"
sudo chown "$USER" /tmp/pang-dev-copy.sqlite
```

Copy `/tmp/pang-dev-copy.sqlite` to the development machine, then run on the copy only:

```sh
pnpm check:upgrade /path/to/pang-dev-copy.sqlite
```

Expected: `migrated 15 -> 21; integrity, manifest, schema ok`. It migrates the copy in place, so never
point it at the live database. Delete the copy and any SQLite sidecar files afterwards (`rm -f /path/to/pang-dev-copy.sqlite*`):
it holds household data. Paste output in the evidence record.

### 3. Confirm the starting build

On pang-dev:

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.3`, `Schema: 15 (this build expects 15)`, `Readiness: ok`. Paste it.
Anything else: stop and record it. Do not upgrade.

### 4. Manual backup (gate)

On pang-dev:

```sh
sudo pangolin backup
```

Expected: exit 0 and a snapshot ID. Paste the output and record the snapshot ID. Without a snapshot ID,
stop: the upgrade does not run.

### 5. Tag and push

Tag the explicit commit from step 1, not whatever `HEAD` is:

```sh
TAG_COMMIT=<hash from step 1>
git fetch origin
git rev-parse origin/develop                    # must equal $TAG_COMMIT, else stop
git merge-base --is-ancestor v0.2.3 "$TAG_COMMIT" && echo ancestor-ok
git tag -a "$TAG" -m "Release $TAG" "$TAG_COMMIT"
git push origin "$TAG"
```

The tag format is `v*.*.*`. The agent never pushes it.

### 6. Watch the release run

```sh
PAGER=cat gh run list --workflow Release --branch "$TAG" --limit 5 --json databaseId,url,conclusion,headSha
PAGER=cat gh run view <run-id> --json conclusion,headSha,jobs --jq '{conclusion, headSha, jobs: [.jobs[] | {name, conclusion}]}'
```

Expected: `conclusion` `success` with `ci`, `image`, `upgrade-test`, `migrate-previous`, and `publish`
all `success`, and the GitHub release exists with `latest` moved to `v0.2.4`.

If only `ci` failed on test timeouts, allow one `PAGER=cat gh run rerun <run-id> --failed` on the same tag
and record both runs. Any other failure means there is no release and no tagged image: go to step 13. Do not upgrade.

### 7. Image digest

```sh
docker buildx imagetools inspect "$REPO:$TAG" | grep -m1 Digest
```

Record the digest.

### 8. Upgrade

On pang-dev, only after steps 2, 3, 4, 6, and 7 are recorded. Because migrations 0015 to 0020 run during
this upgrade, use `PANGOLIN_UPGRADE_TIMEOUT=180`:

Run `sudo pangolin status` immediately before upgrading to confirm `v0.2.3`:

```sh
sudo pangolin status
sudo PANGOLIN_UPGRADE_TIMEOUT=180 pangolin upgrade "$TAG"
```

Expected: signature verified, image digest matches step 7, pre-upgrade copy created in
`/srv/pangolin/upgrade-copies/pre-upgrade-<time>/`, schema migrated 15 to 21, and the stack reports
healthy. Paste the complete output.

### 9. Healthz

```sh
curl https://<app host>/healthz
```

Expected: `{"ok":true…}`.

### 10. Status

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.4`, `Schema: 21 (this build expects 21)`, `Readiness: ok`.

### 11. First backup after upgrade

```sh
sudo pangolin backup
sudo pangolin status
```

Read the manifest format and `balanceDate` (where `<snapshot-id>` is from the backup/status output, and `<backup-id>` is the staging backup directory from the Step 11 backup output):

```sh
set -a; . /opt/pangolin/.env; set +a
export RESTIC_REPOSITORY="$PANGOLIN_BACKUP_REPOSITORY"
export RESTIC_PASSWORD_FILE=/opt/pangolin/secrets/restic-password
restic dump <snapshot-id> /data/backup/staging/<backup-id>/manifest.json | head -c 400
```

Expected: `format` 2 and current `balanceDate`. Paste format line, `balanceDate`, and account count.

### 12. Fill the record

Fill every field below from pasted output, then accept or reject the release.

### 13. If it failed: delete the tag before retrying

```sh
git push --delete origin "$TAG" && git tag -d "$TAG"
```

Verify the tag was never published:

```sh
PAGER=cat gh release view "$TAG"
docker buildx imagetools inspect "$REPO:$TAG"
```

If the upgrade failed on the server, record the automatic rollback message, keep the pre-upgrade copy
and manual backup, and investigate.

---

---

## Rollback

- If the upgrade fails health checks within the timeout, `pangolin upgrade` automatically rolls back
  to the previous image, `.env` file, and database copy, recording a `system.upgrade-failed` review
  item. The database the server used is saved in `/srv/pangolin/upgrade-copies/rolled-back-<time>/`.
- If manual recovery is needed, the pre-upgrade copy in `/srv/pangolin/upgrade-copies/pre-upgrade-<time>/`
  and the manual backup from step 4 provide full recovery points.

---

## Evidence record

Every field is empty until the human pastes the output. Pre-flight rows are filled by the agent.

| Field | Value |
| --- | --- |
| **Pre-flight** | |
| Base commit (tip of `develop` before this page) | `e41b6d4f10c8098d3c888a1cbaed479cd7bb860b` |
| CI on the base commit | |
| `v0.2.3` is an ancestor | `git merge-base --is-ancestor v0.2.3 HEAD` exit 0, 2026-10-21 |
| Migrations between tags | 0015 to 0020 advance schema 15 to 21 |
| Release machinery tests | 2 files, 35 tests passed, 2026-10-21 |
| **Human, before the tag** | |
| Tag commit (step 1): `TAG_COMMIT` hash, subject | |
| CI on the tag commit (step 1): run URL, conclusion | |
| Real-data check (step 2): `pnpm check:upgrade` output | |
| Starting build (step 3): `pangolin status` output | |
| Manual backup snapshot ID (step 4) | |
| **Release** | |
| Tag and commit (step 5) | |
| Release run URL (step 6) | |
| `ci` job | |
| `image` job | |
| `upgrade-test` job | |
| `migrate-previous` job | |
| `publish` job; GitHub release and `latest` moved | |
| Signed image digest (step 7) | |
| Re-runs, deleted tags or retags (run URLs, tag names) | |
| **Upgrade on pang-dev** | |
| Date and `PANGOLIN_UPGRADE_TIMEOUT` used | |
| `pangolin upgrade` output (step 8) | |
| Pre-upgrade copy path (from step 8 output) | |
| Image digest `pangolin upgrade` verified (step 8) | |
| `/healthz` (step 9) | |
| `pangolin status` showing tag and schema 21 of 21 (step 10) | |
| **After the upgrade** | |
| First backup: snapshot ID (step 11) | |
| First backup: manifest `format` and `schemaVersion` | |
| First backup: `balanceDate` and accounts count | |
| **Decision** | |
| Outcome (accepted / failed) and reason | |
| Accepted by the human (name, date) | |
