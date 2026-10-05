# Release v0.2.0

The checklist and evidence record for releasing `v0.2.0` and upgrading the home server
(`pang-dev`, accepted as the home server on 2026-10-02) from `v0.1.2`. It proves epic 2's
Done-when items 4 and 5 on a real host. Procedures come from [install.md](install.md) section 11
and `deploy/pangolin`; this page changes none of them. The shape follows
[m0-gate-rehearsal.md](m0-gate-rehearsal.md).

Who does what: the human tags, pushes, backs up and upgrades, and pastes the output. The agent
prepared this page, ran the pre-flight checks below and fills the record from pasted output. The
agent pushes no tag, runs no `pangolin upgrade` and touches no server. No field counts as filled
without pasted output or a run URL.

## Release notes

GitHub generates the full notes from the merged changes; these are the hand-written lines.

`v0.2.0` is the first release with epic 2, the ledger core and its privacy:

- Ledger accounts, transactions and splits, with the privacy path: a private account's rows are
  read only through the ledger read rule, and the lint plugin enforces it.
- Schema 8 to 11: migrations 0008 (ledger accounts), 0009 (classification schema) and 0010
  (split provenance). 0009 and 0010 rebuild `split`, `transaction` and `review_item`; existing
  transactions get `fingerprint = id` and `fingerprint_version = 0`.
- Backup manifest format 2: per-account row counts, sums and `balanceAsOf`. Format-1 backups
  still restore.
- The admin seed command is gated by `PANGOLIN_ENABLE_SEED`, off by default. Leave it off on the
  home server.
- The web stack: React 19, TanStack Router, Query and Table, Tailwind, built with Vite.
- Responses from `/api` carry `Cache-Control: no-store`.

The version is the tag. `package.json` stays `0.0.0` and there is no CHANGELOG file.

## Rules

- Release only a commit whose CI is green. The candidate is `develop` at
  `93a3f19a7b0d42b9b1208af7e2753d65f057f204` (CI run #80). If `develop` moves, the human decides
  whether to tag the new tip (then its CI must be green) or the candidate.
- The release run (`release.yml`: `ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`)
  must be green on the tag before the upgrade.
- Any step whose output differs from the expected output is recorded as **failed**, the upgrade
  stops there, and the release is not accepted.
- A failed tag is deleted on the remote and locally before the next attempt (step 13).
- Only the human accepts the release.

## Pre-flight (agent, 2026-10-05)

1. **CI on the candidate:** run #80 (`gh run view 37231136568`), push on `develop`,
   `headSha` `93a3f19a7b0d42b9b1208af7e2753d65f057f204`: conclusion `success`; jobs `Lint, types,
   tests, STRICT`, `Secret scan`, `Container and end-to-end` all green.
2. **`develop` has not moved:** `git fetch origin develop`, then `git rev-parse origin/develop`
   is `93a3f19a7b0d42b9b1208af7e2753d65f057f204`.
3. **Release machinery tests:** `pnpm exec vitest run deploy/release-workflow.test.ts
   deploy/release-scripts.test.ts`: 2 files, 35 tests, all passed.
4. **`pnpm check:upgrade` on a v0.1.2 database: not run on a real one.** The agent's host has no
   Docker, so `.github/scripts/previous-db.sh` (which pulls `ghcr.io/sbwilson/pangolin:v0.1.2`
   and boots it) could not run, and no real v0.1.2 database was available. No database was
   fabricated as a stand-in for it. **Substitute only:** a database built from migrations
   0000 to 0007 only (the v0.1.2 migration set, schema 8) with the repo's own `migrate`, plus
   hand-inserted rows (2 persons, 5 audit rows, 1 job, 1 review item; the settings row comes from
   migration 0001). `pnpm check:upgrade` on it printed `migrated 8 -> 11; integrity, manifest,
   schema ok`. This proves the migrations 0008 to 0010 apply to a schema-8 database with a few
   rows. It is not a v0.1.2 first-boot database and not pang-dev's data, and it has no
   transactions, so it does not exercise the 0009 and 0010 rebuilds on real rows. Step 2 below
   (pang-dev's real copy) is the check that does.

## Checklist

Shell variables (set them in your session):

```sh
TAG=v0.2.0
REPO=ghcr.io/sbwilson/pangolin
```

| # | Who | Step |
| --- | --- | --- |
| 1 | Human | Confirm the candidate is still the tip. |
| 2 | Human, then agent | Check the migrations on a copy of pang-dev's real database. |
| 3 | Human | Take a manual backup on pang-dev. |
| 4 | Human | Tag the release commit and push the tag. |
| 5 | Human, agent watches | Watch the release run's five jobs. |
| 6 | Human | Record the signed image digest. |
| 7 | Human | Upgrade pang-dev. |
| 8 | Human | Read `/healthz`. |
| 9 | Human | Read `pangolin status`. |
| 10 | Human | Take the first backup after the upgrade and read its manifest. |
| 11 | Human | Restore a format-1 backup to a scratch location. |
| 12 | Human, agent | Fill the record and accept or reject the release. |
| 13 | Human | If a gate or the upgrade failed: delete the tag before retrying. |

### 1. Confirm the candidate

On the machine with the checkout:

```sh
git fetch origin && git rev-parse origin/develop
```

Expected: `93a3f19a7b0d42b9b1208af7e2753d65f057f204`. If it differs, see Rules.

### 2. Real-data migration check (before tagging)

Human, on pang-dev, take a read-only copy of the live database without stopping the stack
(SQLite's online backup keeps it consistent; the live file is only read):

```sh
sudo sqlite3 -readonly /srv/pangolin/pangolin.sqlite ".backup '/tmp/pang-dev-copy.sqlite'"
sudo chown "$USER" /tmp/pang-dev-copy.sqlite
```

(If `/srv/pangolin/pangolin.sqlite` is not the path, use the file in `<data root>`; `sqlite3`
may need `sudo apt install sqlite3`. This reads the live file and writes only `/tmp`.) Copy it
to the machine with the checkout, then the agent or human runs, on the copy only:

```sh
pnpm check:upgrade /path/to/pang-dev-copy.sqlite
```

Expected: `migrated 8 -> 11; integrity, manifest, schema ok`. It migrates the copy in place, so
never point it at the live file. Delete the copy afterwards: it holds household data.

### 3. Manual backup

On pang-dev:

```sh
sudo pangolin backup
```

Expected: exit 0 and a snapshot ID. The pre-upgrade copy and the automatic rollback are the
recovery; this backup is the second one.

### 4. Tag and push

From a clean checkout of `develop` at the candidate:

```sh
git fetch origin && git checkout develop && git pull --ff-only
git log -1 --format='%H %s'
git tag -a "$TAG" -m "Release $TAG"
git push origin "$TAG"
```

The tag format is `v*.*.*`. The agent never pushes it.

### 5. Watch the release run

```sh
gh run list --workflow Release --limit 1 --json url,conclusion,headSha
gh run view <run-id> --json conclusion,jobs --jq '{conclusion, jobs: [.jobs[] | {name, conclusion}]}'
```

Expected: `conclusion` `success` with `ci`, `image`, `upgrade-test`, `migrate-previous` and
`publish` all `success`, and the GitHub release exists with `latest` moved. If any job fails,
there is no release and no tagged image: go to step 13. Do not upgrade.

### 6. Image digest

```sh
docker buildx imagetools inspect "$REPO:$TAG" | grep -m1 Digest
```

### 7. Upgrade

On pang-dev. The default health wait is 60 seconds. Migrations 0009 and 0010 copy whole tables,
so on a large database raise it: `PANGOLIN_UPGRADE_TIMEOUT` is a positive whole number of
seconds, polled every 3 seconds (rounded up to a multiple of 3). Take `180` unless the database
is small.

```sh
sudo PANGOLIN_UPGRADE_TIMEOUT=180 pangolin upgrade "$TAG"
```

Expected: the signature is verified, the pre-upgrade copy is made in
`/srv/pangolin/upgrade-copies/pre-upgrade-<time>/`, the schema is migrated 8 to 11, the stack
is healthy. Paste the whole output.

### 8. Healthz

```sh
curl https://<app host>/healthz
```

Expected: `{"ok":true}`.

### 9. Status

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.0`, `Schema: 11 (this build expects 11)`, `Readiness: ok`.

### 10. First backup after the upgrade

```sh
sudo pangolin backup
sudo pangolin status
```

Then show that the manifest is format 2 with per-account counts, sums and `balanceAsOf`
(see "Reading a manifest" below). Expected: `format` 2 and an entry per account. If
the household has no accounts yet, record that and `accounts` as empty; that still shows format 2.

### 11. Format-1 restore to a scratch location

`pangolin restore` swaps into the live database (it moves the replaced one to
`/srv/pangolin/pre-restore-<time>/`), so it is not a scratch restore. For a scratch restore use
restic directly, as root, with the stack left running. The repository URL is
`PANGOLIN_BACKUP_REPOSITORY` in `/opt/pangolin/.env` and the password is
`/opt/pangolin/secrets/restic-password` (a restore only reads; the repository is append-only):

```sh
set -a; . /opt/pangolin/.env; set +a      # for PANGOLIN_BACKUP_REPOSITORY
export RESTIC_REPOSITORY="$PANGOLIN_BACKUP_REPOSITORY"
export RESTIC_PASSWORD_FILE=/opt/pangolin/secrets/restic-password
restic snapshots                          # pick a snapshot taken before the upgrade
mkdir -m 0700 /root/scratch-restore
restic restore <snapshot-id> --target /root/scratch-restore
```

Check what it holds: `cat <dir>/manifest.json | head -c 400` shows `"format": 1`, and
`sqlite3 -readonly <dir>/pangolin.sqlite 'PRAGMA integrity_check'` prints `ok`. To also prove the
current build reads it, copy that restored directory off the host and run
`pnpm check:upgrade <dir>/pangolin.sqlite` on the copy. Then delete `/root/scratch-restore`: it
holds household data. (If restic needs a different invocation for this setup, say so in the
record; this procedure is not in install.md and is the human's call. The in-place alternative,
`sudo pangolin restore <old snapshot id>`, rolls the live household back and must not be used
unless that is intended.)

### 12. Fill the record

Fill every field below from pasted output, then accept or reject.

### 13. If it failed: delete the tag before retrying

```sh
git push --delete origin "$TAG" && git tag -d "$TAG"
```

Fix the cause on `develop`, wait for CI, and push a new tag (for example `v0.2.1`; do not reuse a
published tag). A failed tag has no image, so the next release's `migrate-previous` would fail to
pull it.

## Reading a manifest

The manifest travels with the snapshot as `manifest.json` (`format`, per-table counts and
checksums, and for format 2 an `accounts` section). On pang-dev, after step 10, restore the new
snapshot as in step 11 into another scratch directory and read it there, or read the backup
verification the server records (`pangolin status` shows the last backup). Paste the `format`
line and the accounts section with names and amounts only as far as you are comfortable; they
are your household's figures.

## Rollback

- A failed upgrade rolls back by itself: previous image, `.env` and database copy, a
  `system.upgrade-failed` review item in the inbox, and the database the new server used kept in
  `/srv/pangolin/upgrade-copies/rolled-back-<time>/`. Paste the message.
- If the rollback cannot keep that copy, it stops before restoring, starts the previous stack
  on the live (possibly migrated) database and names the pre-upgrade copy for a manual restore
  (install.md section 11).
- After a successful upgrade that you then reject: the pre-upgrade copy in
  `/srv/pangolin/upgrade-copies/pre-upgrade-<time>/` and the manual backup from step 3 are the
  recovery. Restoring either discards everything written since the upgrade.
- The last two pre-upgrade copies are kept; keep these until the release is accepted.

## Evidence record

Every field is empty until the human pastes the output. Pre-flight rows are filled by the agent.

| Field | Value |
| --- | --- |
| **Pre-flight** | |
| Candidate commit | `93a3f19a7b0d42b9b1208af7e2753d65f057f204` |
| CI on the candidate | Run #80, https://github.com/sbwilson/pangolin/actions/runs/37231136568: success (Lint, types, tests, STRICT; Secret scan; Container and end-to-end), checked 2026-10-05 |
| `origin/develop` at pre-flight | `93a3f19a7b0d42b9b1208af7e2753d65f057f204` (unchanged), 2026-10-05 |
| Release machinery tests | `deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts`: 2 files, 35 tests passed, 2026-10-05 |
| `check:upgrade` on a v0.1.2 database | Not run: no Docker on the agent's host, so `previous-db.sh` could not make one (CI's `migrate-previous` does this on the tag) |
| `check:upgrade` on a local substitute | SUBSTITUTE, not a v0.1.2 database: migrations 0000 to 0007 plus 2 persons, 5 audit rows, 1 job, 1 review item; output `migrated 8 -> 11; integrity, manifest, schema ok`, 2026-10-05 |
| **Human, before the tag** | |
| `check:upgrade` on pang-dev's copy (step 2) | `migrated 11 -> 11; integrity, manifest, schema ok`, run on the Mac against a read-only copy of pang-dev's database, 2026-10-05. The copy was already at schema 11: pang-dev ran a local build of `develop` (`4df1f99`, `PANGOLIN_IMAGE=pangolin:local`), not the v0.1.2 release, so the 8 to 11 rebuilds had already been applied to these rows by that build |
| Manual backup snapshot ID (step 3) | Not recorded. `pangolin status` right after the upgrade still listed the last backup as the scheduled one, `1c69b789366f8841af07dffcca5cdcae384e2cbfa769c5fcfa3b76dae482fdcb` (2026-10-04T15:30Z), so no manual backup was taken before the upgrade. The recovery points were that scheduled backup and the automatic pre-upgrade copy `/srv/pangolin/upgrade-copies/pre-upgrade-20261005171624`. A further backup after the upgrade, `ef37df27228ec11bb08acc73e91440848217a95705b36c79de443e712c40837c` (2026-10-05T06:39:30Z), is not step 3 |
| **Release** | |
| Tag and commit (step 4) | `v0.2.0` (annotated) on `e0d24d297e2f934a4ad29a3aaade771b3b192098`: the tip of `story-2-12-release-and-deploy`, i.e. the candidate `93a3f19` plus this document and the plan. `git diff 93a3f19 e0d24d2` is those two files only, so there is no code difference. The commit is not yet on `develop` or any remote branch |
| Release run URL (step 5) | https://github.com/sbwilson/pangolin/actions/runs/37269540771: success |
| `ci` job | success (Lint, types, tests, STRICT; Secret scan; Container and end-to-end) |
| `image` job | success |
| `upgrade-test` job | success |
| `migrate-previous` job | success |
| `publish` job; GitHub release and `latest` moved | `publish` success; GitHub release `v0.2.0` exists with `cosign.pub`, `install.sh`, `uninstall.sh` attached; `latest` not independently checked |
| Signed image digest (step 6) | `sha256:60af95ac20ca02282425a97e74887e58c1682c69a005aac64ef4e788b0655cb1` (`docker buildx imagetools inspect ghcr.io/sbwilson/pangolin:v0.2.0`; the same digest `pangolin upgrade` pinned and verified) |
| **Upgrade on pang-dev** | |
| Date and `PANGOLIN_UPGRADE_TIMEOUT` used | 2026-10-05, `PANGOLIN_UPGRADE_TIMEOUT=180` |
| `pangolin upgrade` output (step 7) | `Pulling ghcr.io/sbwilson/pangolin:v0.2.0...`, `Verifying ghcr.io/sbwilson/pangolin@sha256:60af95ac…cb1...`, stack stopped and started, `Upgrade to v0.2.0 successful. Old image was pangolin:local.` Pre-upgrade copy: `/srv/pangolin/upgrade-copies/pre-upgrade-20261005171624` (root, 0700) |
| `/healthz` (step 8) | `{"ok":true,"warnings":["recovery-bundle-unconfirmed"]}` (the warning pre-dates the upgrade; `sudo pangolin confirm-bundle` clears it) |
| `pangolin status` showing the tag and schema 11 of 11 (step 9) | `Pangolin Money v0.2.0`, `Schema: 11 (this build expects 11)`, `Readiness: ok`; 1 dead job (`backup-push`, 2026-10-02, pre-existing) |
| **After the upgrade** | |
| First backup: snapshot ID (step 10) | `8351365c14d32fcb66e8282b3618105214370679d544f4ad930ec2b388b4b4d1`, 2026-10-05T06:18:09Z, `pangolin backup` by `v0.2.0` |
| First backup: manifest `format` | `"format": 2`, `schemaVersion` 11, migrations through `0010_split_provenance` (read with `restic dump` from the repository) |
| First backup: per-account counts, sums, `balanceAsOf` | The manifest ends with `"balanceDate": "2026-10-05"`, `"accounts": []`, `"takenAt": "2026-10-05T06:18:06.984Z"` (5343 bytes). The section exists and is empty because pang-dev has no ledger accounts (`account`: 0 rows, `transaction`: 0 rows); `category` 65, `category_group` 13 and `tax_category` 8 rows are the seeded defaults. No real per-account entry has been seen on a host; the db tests cover it |
| Format-1 restore to a scratch location: snapshot, `"format": 1`, integrity result (step 11) | Snapshot `1c69b789366f8841af07dffcca5cdcae384e2cbfa769c5fcfa3b76dae482fdcb` (2026-10-04, written by build `4df1f99`), `restic restore` to `/root/scratch-restore`: `"format": 1`, schema 11, `PRAGMA integrity_check` `ok`. This proves the old backup is intact and restorable; `v0.2.0`'s reading of a format-1 manifest by `pangolin restore` is covered by the db-level tests only, not exercised on the host |
| Scratch directory deleted | Yes: `ls /root/scratch-restore` reports no such file or directory, 2026-10-05 |
| **Decision** | |
| Outcome (accepted / failed) and reason | Accepted. The release run is green on the tag, pang-dev runs v0.2.0 healthy on the verified digest, the first backup after the upgrade is manifest format 2 and an old format-1 backup restores intact. Not seen on a real host: a per-account manifest entry (pang-dev has no ledger accounts) and `pangolin restore` reading a format-1 manifest on the new build; both are covered by the db tests. No manual backup preceded the upgrade; the scheduled backup and the automatic pre-upgrade copy were the recovery points. |
| Accepted by the human (name, date) | Simon Wilson, 2026-10-05 |
