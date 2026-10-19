# Release v0.2.3

The checklist and evidence record for releasing `v0.2.3` and upgrading the home server
(`pang-dev`) from the `v0.2.2` tag. It carries epic 13 (App shell, settings and theming)
to a real host, proving CAP-16's release and upgrade path and epic 13 Done-when 5.
Procedures come from [install.md](install.md) section 11 and `deploy/pangolin`; this page
changes none of them. It follows the structure of [release-v0.2.2.md](release-v0.2.2.md),
[release-v0.2.1.md](release-v0.2.1.md) and [release-v0.2.0.md](release-v0.2.0.md), including a
pre-tagging real-data dry-run check of migration 0014 (schema 14 to 15) and the manual
backup gate.

Who does what: the human provides a read-only copy of `pang-dev`'s database for the dry run, tags,
pushes, backs up and upgrades, and pastes the output. The agent prepared this page, ran the
pre-flight checks below and fills the record from pasted output. The agent pushes no tag, takes
no backup, runs no `pangolin upgrade` and touches no server. No field counts as filled without
pasted output or a run URL.

## Release notes

GitHub generates the full notes from the merged changes; these are the hand-written lines.

`v0.2.3` ships the complete Milestone M1 App Shell, Settings, and Theming experience (epic 13).
It advances the database schema from 14 to 15 (migration 0014).

### App Shell & Navigation
- **Responsive app shell:** Collapsible desktop sidebar and mobile bottom tab bar with "More" sheet
  reaching all shipped routes (`/transactions`, `/accounts`, `/settings`).
- **Dedicated `/sign-in` route:** Standardized login entry point; root `/` redirects smoothly to
  `/transactions` for signed-in users.
- **Unified Settings page (`/settings#...`):** Sticky section rail on desktop (`snav`) and scrollable
  chips on mobile navigating between `#appearance`, `#security`, `#devices`, `#partner`, `#household`,
  `#accounts`, and `#status`.
- **System status cards:** Relocated and consolidated from `HomePage` into `SystemStatus` under Settings,
  displaying release version, schema version, readiness, jobs queue status, and backup history.
- **Signed-in devices (`#devices`):** Live session inventory querying Better Auth, parsing user-agent
  attributes into device/browser indicators, tagging "This device", and supporting per-session remote revocation.

### Security & Account Protection
- **Re-authentication dialog (`ReauthDialog`):** Accessible modal ceremony replacing ad-hoc inline
  prompts to guard critical actions (CSV export, partner removal, household departure) via passkey
  or password with TOTP.
- **Passkey & credential management:** Centralized passkey registration and credential overview under
  Settings `#security`.

### Appearance Engine
- **Themes & modes:** Six themes (Clay & Linen, Harbour Morning, Fern Gully, Galah Party, Gelato Bar,
  Black Opal) across Light, Dark, and System modes.
- **Per-person persistence:** Preferences stored in `person_preference` table (schema 15) and synchronized
  across browser contexts with immediate DOM root hydration (`data-theme`, `data-mode`, `data-resolved-mode`).

### Quality & Accessibility
- **WCAG 2.2 AA accessibility harness:** Automated axe-core audit suite integrated into CI across all
  shipped routes and viewport sizes.
- **E2E shell journey test:** End-to-end Playwright tests covering shell navigation, mobile sheets,
  theme switching, settings hash links, session revocation, and re-authentication dialog flow.

### Not fixed in this release:
- Import popover, review inbox UI, and import batch provenance (owned by epic-import-dedupe-transfers).
- Attachment storage and document viewing (owned by epic 5).

The version is the tag. `package.json` stays `0.0.0` and there is no CHANGELOG file.

## Rules

- Release only a commit whose CI is green and which descends from `v0.2.2`. The page, plan file, and
  e2e stabilization are committed to `develop` first; CI must be green on that tip and the tag goes
  on that tip. The tag goes on the explicit hash recorded in step 1 (`TAG_COMMIT`). If `develop`
  moves after that, the human decides whether to tag the new tip (whose CI must also be green) or
  `TAG_COMMIT`, and records the decision.
- A dry run of `pnpm check:upgrade` must be performed against a read-only copy of `pang-dev`'s real
  database before tagging (step 2), verifying schema migration 14 -> 15.
- The release run (`release.yml`: `ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) must
  be green on the tag before the upgrade.
- The manual `sudo pangolin backup` comes first and its snapshot ID is recorded before the upgrade
  starts. Without it the upgrade does not run.
- The upgrade is `sudo pangolin upgrade v0.2.3` on a host that reports `v0.2.2`, never a develop
  build. If `pangolin status` before the upgrade shows anything else, stop and record it.
- Schema migrates from 14 to 15. Any other schema number after the upgrade rejects the release.
- Any step whose output differs from the expected output is recorded as **failed**, the upgrade
  stops there, and the release is not accepted.
- A failed tag is deleted on the remote and locally before the next attempt (step 13). A published tag
  is never reused.
- Each human change to the plan or this checklist is logged in the plan's Plan Change Log
  (`_bmad-output/initiative-pangolin-money-v1/epic-app-shell-settings-theming/story-release-v0-2-3-and-deploy-plan.md`).
- Only the human accepts the release.

## Pre-flight (agent, 2026-10-20)

The agent checked the base commit `3f0f9ecd0152f9c735d60bf455d951d7c8ec2874` (the tip of `develop`
before this release preparation):

1. **CI on base commit:** The push run (`gh run view 39294644496`, commit `3f0f9ec`) failed in
   `Container and end-to-end` at `End-to-end tests (Playwright against the container)` due to two issues in
   `e2e/shell.spec.ts`: SettingsNav bottom-of-page scroll spy clamped active indicator away from `#accounts`,
   and remote session revocation test revoked an unisolated stale session. Both were stabilized in `e2e/shell.spec.ts`.
   The tag commit will receive its own fresh CI run, which must be fully green before tagging.
2. **`v0.2.2` is an ancestor:** `git merge-base --is-ancestor v0.2.2 origin/develop` exits 0.
3. **Release machinery tests:** `pnpm test deploy/release-workflow.test.ts deploy/release-scripts.test.ts`
   passed (2 test files, 35 tests, all green).
4. **Code quality & boundaries:** `biome check .` and `node scripts/check-boundaries.ts` passed (473 files,
   0 errors, 12 warnings, package boundaries ok). All 14 projects/packages typecheck cleanly via `tsc`.
5. **Schema migration:** Migration 0014 (`person_preference`) exists in `packages/db/migrations/`, advancing
   schema version from 14 to 15.

## Checklist

```sh
TAG=v0.2.3
REPO=ghcr.io/sbwilson/pangolin
```

| # | Who | Step |
| --- | --- | --- |
| 1 | Human, agent | Commit and push `develop`, and confirm CI is green on that exact tip. |
| 2 | Human, then agent | Check the migrations on a read-only copy of pang-dev's real database (`check:upgrade`). |
| 3 | Human | Confirm pang-dev reports `v0.2.2` and schema 14. |
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

The page, plan file, and e2e test stabilization are committed on `develop`. Push to origin and confirm
CI is green:

```sh
git fetch origin && git checkout develop
git add docs/release-v0.2.3.md _bmad-output/initiative-pangolin-money-v1/epic-app-shell-settings-theming/story-release-v0-2-3-and-deploy-plan.md e2e/shell.spec.ts
git commit -m "docs(release): prepare v0.2.3 release checklist and stabilize e2e shell tests"
git status -sb                                  # develop ahead of origin/develop
git push origin develop
TAG_COMMIT=$(git rev-parse HEAD); echo "$TAG_COMMIT"
git log -1 --format='%H %s'
git merge-base --is-ancestor v0.2.2 "$TAG_COMMIT" && echo ancestor-ok
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

Expected: `migrated 14 -> 15; integrity, manifest, schema ok`. It migrates the copy in place, so never
point it at the live database. Delete the copy and any SQLite sidecar files afterwards (`rm -f /path/to/pang-dev-copy.sqlite*`):
it holds household data. Paste output in the evidence record.

### 3. Confirm the starting build

On pang-dev:

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.2`, `Schema: 14 (this build expects 14)`, `Readiness: ok`. Paste it.
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
git merge-base --is-ancestor v0.2.2 "$TAG_COMMIT" && echo ancestor-ok
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
all `success`, and the GitHub release exists with `latest` moved to `v0.2.3`.

If only `ci` failed on test timeouts, allow one `PAGER=cat gh run rerun <run-id> --failed` on the same tag
and record both runs. Any other failure means there is no release and no tagged image: go to step 13. Do not upgrade.

### 7. Image digest

```sh
docker buildx imagetools inspect "$REPO:$TAG" | grep -m1 Digest
```

Record the digest.

### 8. Upgrade

On pang-dev, only after steps 2, 3, 4, 6, and 7 are recorded. Because migration 0014 runs during
this upgrade, use `PANGOLIN_UPGRADE_TIMEOUT=180`:

Run `sudo pangolin status` immediately before upgrading to confirm `v0.2.2`:

```sh
sudo pangolin status
sudo PANGOLIN_UPGRADE_TIMEOUT=180 pangolin upgrade "$TAG"
```

Expected: signature verified, image digest matches step 7, pre-upgrade copy created in
`/srv/pangolin/upgrade-copies/pre-upgrade-<time>/`, schema migrated 14 to 15, and the stack reports
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

Expected: `Pangolin Money v0.2.3`, `Schema: 15 (this build expects 15)`, `Readiness: ok`.

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
| Base commit (tip of `develop` before this page) | `3f0f9ecd0152f9c735d60bf455d951d7c8ec2874` |
| CI on the base commit | Run https://github.com/sbwilson/pangolin/actions/runs/39294644496: **failure**, 2026-10-20. `Secret scan` and `Lint, types, tests, STRICT` passed; `Container and end-to-end` failed at `End-to-end tests` (`e2e/shell.spec.ts` SettingsNav bottom scroll spy assertion and remote session revocation isolation). Stabilized in `e2e/shell.spec.ts` |
| `v0.2.2` is an ancestor | `git merge-base --is-ancestor v0.2.2 origin/develop` exit 0, 2026-10-20 |
| `origin/develop` at pre-flight | `3f0f9ecd0152f9c735d60bf455d951d7c8ec2874`, 2026-10-20 |
| Migrations between tags | Migration 0014 (`person_preference`) advances schema 14 to 15 |
| Release machinery tests | `deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts`: 2 files, 35 tests passed, 2026-10-20 |
| Lint and boundaries | `biome check .` (0 errors, 12 warnings), `node scripts/check-boundaries.ts` ok, 2026-10-20 |
| Workspace typechecks | All 14 projects/packages typecheck cleanly via `tsc`, 2026-10-20 |
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
| `pangolin status` showing tag and schema 15 of 15 (step 10) | |
| **After the upgrade** | |
| First backup: snapshot ID (step 11) | |
| First backup: manifest `format` | |
| First backup: `balanceDate` and accounts count | |
| **Decision** | |
| Outcome (accepted / failed) and reason | |
| Accepted by the human (name, date) | |
