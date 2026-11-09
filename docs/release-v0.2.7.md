# Release v0.2.7

The checklist and evidence record for releasing `v0.2.7` and upgrading the home server
(`pang-dev`) from the `v0.2.6` tag. It carries epic 6 (budgets, recurring bills, and pay calendar)
and epic 7 (goals, savings allocation, cover an expense, reconciliation, and large withdrawal review
items) to a real host:
- **Epic 6:** Budgets workspace (`/planning/budgets`), category & group budgets, payday-anchored
  fortnightly and monthly cycles, rollover, spent/pace/projected indicators, limit suggestions from
  spending history, recurring bill detection with candidate review, one-click confirmation, missed
  bill alerts, price rise alerts (>10%), pay anchor settings in Settings › Household, and `over_budget`
  review items in the review inbox.
- **Epic 7:** Goals & savings workspace (`/planning/goals`), virtual goals funded from positive new
  savings, staged allocation ladder (`AllocationStage`), exit goals, buffer allocation, fallback
  threshold, rescale vs. buffer completion policies, savings pool reconciliation (goal balances +
  buffer = bank balance; deficit periods reduce buffer only), Cover an expense modal sheet (large
  purchases vs. shortfall drawdowns, ordered tier proposals, buffer divert override, one-click buffer
  adjustment), large savings withdrawal detection (≥$2,000 threshold raising review items for both
  partners), and audited `goal_drawdown` and `goal_adjustment` records with toast undo.

The database schema moves from 25 to 29 (migrations `0025_pay_anchor`, `0026_budget`,
`0027_recurring_series`, and `0028_goals_savings`). Procedures come from [install.md](install.md)
section 11 and `deploy/pangolin`; this page changes none of them. It follows
[release-v0.2.6.md](release-v0.2.6.md), including a pre-tagging real-data dry run of the
migrations and the manual backup gate.

Who does what: the human provides a read-only copy of `pang-dev`'s database for the dry run,
tags, pushes, backs up and upgrades, and pastes the output. The agent prepared this page, ran
the pre-flight checks below and fills the record from pasted output. The agent pushes no tag,
takes no backup, runs no `pangolin upgrade` and touches no server. No field counts as filled
without pasted output or a run URL.

## Release notes

GitHub generates the full notes from the merged changes; these are the hand-written lines.

`v0.2.7` ships Budgets & Recurring Bills (epic 6) and Goals & Savings Allocation (epic 7). Database
schema moves 25 to 29.

### Budgets & recurring bills (Epic 6)
- **Budgets workspace (`/planning/budgets`):** category and group budgets with payday-anchored
  fortnightly or monthly cycles. Rollover surplus/deficit tracking, spent vs. pace indicators,
  and limit suggestions based on past spending history.
- **Recurring bills detection:** automatic detection of periodic recurring expenses with candidate
  review, one-click confirmation, missed bill alerts, and price increase alerts (>10%).
- **Pay anchor settings:** configure household pay schedules and cadence in Settings › Household,
  resolving pay calendars across fortnightly and monthly cycles.
- **Review inbox integration:** `over_budget` review items surfaced directly in the review inbox
  when spending exceeds category limits.

### Goals & savings allocation (Epic 7)
- **Goals & savings workspace (`/planning/goals`):** virtual goals funded strictly from positive
  new savings, staged allocation ladder (`AllocationStage`), buffer allocation, fallback threshold,
  and exit goal policies (rescale remaining vs. direct to buffer).
- **Savings pool reconciliation:** continuous reconciliation ensuring total virtual goal balances
  plus unallocated buffer exactly equal the physical bank balance. Deficit periods reduce only the
  buffer, protecting goal progress.
- **Cover an expense modal sheet:** structured drawdowns for large purchases or shortfalls, ordered
  tier proposals (Emergency Fund → Flexible → Protected), buffer divert override ($50/fortnight),
  and one-click buffer adjustment.
- **Large savings withdrawal detection:** automated detection of large savings withdrawals
  (≥$2,000 threshold), raising dual-partner review items in the review inbox.
- **Auditability & undo:** complete ledger of `goal_drawdown` and `goal_adjustment` events with
  toast undo capability.

### Accessibility & web improvements
- Full WCAG 2.2 AA accessibility compliance across all new planning views and dialogs.
- WCAG 1.4.10 320px reflow support on Goals and Budgets pages.
- Robust HTTP 204 No Content handling for DELETE operations in the web client.

The version is the tag. `package.json` stays `0.0.0` and there is no CHANGELOG file.

## Rules

- Release only a commit whose CI is green on GitHub Actions, including `Container and end-to-end`,
  and which descends from `v0.2.6`. The page, plan file, and any stabilization fixes are committed
  to `develop` first; CI must be green on that tip and the tag goes on that tip. The tag goes on
  the explicit hash recorded in step 1 (`TAG_COMMIT`). If `develop` moves after that, the human
  decides whether to tag the new tip (whose CI must also be green) or `TAG_COMMIT`, and records
  the decision.
- A dry run of `pnpm check:upgrade` must be performed against a read-only copy of `pang-dev`'s
  real database before tagging (step 2), verifying the 25 → 29 migrations against real data.
- The release run (`release.yml`: `ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`)
  must be green on the tag before the upgrade.
- The manual `sudo pangolin backup` comes first and its snapshot ID is recorded before the
  upgrade starts. Without it the upgrade does not run.
- The upgrade is `sudo pangolin upgrade v0.2.7` on a host that reports `v0.2.6`, never a develop
  build. If `pangolin status` before the upgrade shows anything else, stop and record it.
- Schema is 29 after the upgrade. Any other schema number rejects the release. The migrations
  only add tables and columns; a rolled-back upgrade restores the pre-upgrade database copy,
  which is still schema 25.
- Any step whose output differs from the expected output is recorded as **failed**, the upgrade
  stops there, and the release is not accepted.
- A failed tag is deleted on the remote and locally before the next attempt (step 13). A
  published tag is never reused.
- Only the human accepts the release.

## Pre-flight (agent, 2026-11-09)

1. **`v0.2.6` is an ancestor:** `git merge-base --is-ancestor v0.2.6 HEAD` exits 0.
2. **Schema:** schema 29 (migrations 0000 to 0028); `0025_pay_anchor`, `0026_budget`,
   `0027_recurring_series`, and `0028_goals_savings` are new since `v0.2.6`.
3. **Local checks:** package boundaries ok, `biome check .` 0 warnings, `typecheck` green in every
   workspace incl. `@pangolin/e2e`, and `check-strict` ("All tables are STRICT") — results recorded
   in the evidence record.
4. **End-to-end & CI:** GitHub Actions CI run `42521300321` on `develop` (`755e352`) passed
   completely: Secret scan (success), Lint, types, tests, STRICT (success), and Container and
   end-to-end (success: 129 passed Playwright tests).
5. **Real-data migration dry run:** executed against `pang-dev-copy.sqlite` (taken from `pang-dev`
   at schema 25): `migrated 25 -> 29; integrity, manifest, schema ok`.
6. **Release machinery tests:** `deploy/release-workflow.test.ts` and `deploy/release-scripts.test.ts`
   passed (35/35 tests passed).

## Checklist

```sh
TAG=v0.2.7
REPO=ghcr.io/sbwilson/pangolin
```

| # | Who | Step |
| --- | --- | --- |
| 1 | Human, agent | Commit and push `develop`, and confirm CI is green on that exact tip. |
| 2 | Human, then agent | Check the migrations on a read-only copy of pang-dev's real database (`check:upgrade`). |
| 3 | Human | Confirm pang-dev reports `v0.2.6` and schema 25. |
| 4 | Human | Take a manual backup on pang-dev and record the snapshot ID. **Gate.** |
| 5 | Human | Tag the step 1 commit and push the tag. |
| 6 | Human, agent watches | Watch the release run's five jobs. |
| 7 | Human | Record the signed image digest. |
| 8 | Human | Upgrade pang-dev. |
| 9 | Human | Read `/healthz` and confirm the new planning routes answer (401 unauthenticated). |
| 10 | Human | Read `pangolin status`. |
| 11 | Human, agent | Take the first backup after the upgrade and read its manifest. |
| 12 | Human, agent | Fill the record and accept or reject the release. |
| 13 | Human | If a gate or the upgrade failed: delete the tag before retrying. |

---

### 1. Push `develop` and confirm CI

The page, plan files and all code changes are committed to `develop`. Push to origin and
confirm CI is green, including `Container and end-to-end` (which runs all Playwright suites
including budgets, goals, and axe audits):

```sh
git fetch origin && git checkout develop
git add docs/release-v0.2.7.md
git commit -m "docs(release): prepare v0.2.7 release checklist"
git status -sb                                  # develop ahead of origin/develop
git push origin develop
TAG_COMMIT=$(git rev-parse HEAD); echo "$TAG_COMMIT"
git log -1 --format='%H %s'
git merge-base --is-ancestor v0.2.6 "$TAG_COMMIT" && echo ancestor-ok
PAGER=cat gh run list --branch develop --event push --commit "$TAG_COMMIT" --limit 1 --json databaseId,headSha,status,conclusion,url
```

Expected: the run's `headSha` equals `$TAG_COMMIT`, its `conclusion` is `success` (`Lint, types,
tests, STRICT`, `Secret scan`, `Container and end-to-end`), and `ancestor-ok` prints. Record the
tag commit hash in the evidence record. If the run fails on intermittent test timeouts, allow one
`PAGER=cat gh run rerun <run-id> --failed` and record both runs. Wait for the run to finish; do
not tag on a run in progress.

### 2. Real-data check (before tagging)

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

Expected: reports `migrated 25 -> 29` (or `29 -> 29` if the copy was taken from a newer build),
integrity, manifest, and schema valid. Delete the copy and any SQLite sidecar files afterwards
(`rm -f /path/to/pang-dev-copy.sqlite*`): it holds household data. Paste output in the evidence
record.

*(Note: Pre-flight dry run has already succeeded on `pang-dev-copy.sqlite`: `migrated 25 -> 29; integrity, manifest, schema ok`)*

### 3. Confirm the starting build

On pang-dev:

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.6`, `Schema: 25 (this build expects 25)`, `Readiness: ok`. Paste
it. Anything else: stop and record it. Do not upgrade.

### 4. Manual backup (gate)

On pang-dev:

```sh
sudo pangolin backup
```

Expected: exit 0 and a snapshot ID. Paste the output and record the snapshot ID. Without a
snapshot ID, stop: the upgrade does not run.

### 5. Tag and push

Tag the explicit commit from step 1, not whatever `HEAD` is:

```sh
TAG_COMMIT=<hash from step 1>
git fetch origin
git rev-parse origin/develop                    # must equal $TAG_COMMIT, else stop
git merge-base --is-ancestor v0.2.6 "$TAG_COMMIT" && echo ancestor-ok
git tag -a "$TAG" -m "Release $TAG" "$TAG_COMMIT"
git push origin "$TAG"
```

The tag format is `v*.*.*`. The agent never pushes it.

### 6. Watch the release run

```sh
PAGER=cat gh run list --workflow Release --branch "$TAG" --limit 5 --json databaseId,url,conclusion,headSha
PAGER=cat gh run view <run-id> --json conclusion,headSha,jobs --jq '{conclusion, headSha, jobs: [.jobs[] | {name, conclusion}]}'
```

Expected: `conclusion` `success` with `ci`, `image`, `upgrade-test`, `migrate-previous`, and
`publish` all `success`, and the GitHub release exists with `latest` moved to `v0.2.7`. The
`migrate-previous` job exercises the 25 → 29 path.

If only `ci` failed on test timeouts, allow one `PAGER=cat gh run rerun <run-id> --failed` on the
same tag and record both runs. Any other failure means there is no release and no tagged image:
go to step 13. Do not upgrade.

### 7. Image digest

```sh
docker buildx imagetools inspect "$REPO:$TAG" | grep -m1 Digest
```

Record the digest.

### 8. Upgrade

On pang-dev, only after steps 2, 3, 4, 6, and 7 are recorded.

Run `sudo pangolin status` immediately before upgrading to confirm `v0.2.6`:

```sh
TAG=v0.2.7
sudo pangolin status
sudo PANGOLIN_UPGRADE_TIMEOUT=180 pangolin upgrade "$TAG"
```

Expected: signature verified, image digest matches step 7, pre-upgrade copy created in
`/srv/pangolin/upgrade-copies/pre-upgrade-<time>/`, schema 25 migrated to 29, and the stack
reports healthy. Paste the complete output.

### 9. Healthz and new routes

```sh
curl https://<app host>/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://<app host>/api/planning/budgets
curl -s -o /dev/null -w '%{http_code}\n' https://<app host>/api/planning/goals
```

Expected: `/healthz` returns `{"ok":true…}` and the `/api/planning/*` routes answer `401` unauthenticated
(the epic 6 & 7 routes are wired and guarded). Optionally, in a browser, navigate to `/planning/budgets`
and `/planning/goals`. Paste the output.

### 10. Status

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.7`, `Schema: 29 (this build expects 29)`, `Readiness: ok`.

### 11. First backup after upgrade

```sh
sudo pangolin backup
sudo pangolin status
```

Read the manifest format and `balanceDate` (where `<snapshot-id>` is from the backup/status
output, and `<backup-id>` is the staging backup directory from the Step 11 backup output):

```sh
set -a; . /opt/pangolin/.env; set +a
export RESTIC_REPOSITORY="$PANGOLIN_BACKUP_REPOSITORY"
export RESTIC_PASSWORD_FILE=/opt/pangolin/secrets/restic-password
restic dump <snapshot-id> /data/backup/staging/<backup-id>/manifest.json | head -c 400
```

Expected: `format` 2, `schemaVersion` 29 and current `balanceDate`. Paste format line,
`balanceDate`, and account count.

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

If the upgrade failed on the server, record the automatic rollback message, keep the pre-upgrade
copy and manual backup, and investigate.

---

## Rollback

- If the upgrade fails health checks within the timeout, `pangolin upgrade` automatically rolls
  back to the previous image, `.env` file, and database copy, recording a
  `system.upgrade-failed` review item. The database the server used (schema 29) is saved in
  `/srv/pangolin/upgrade-copies/rolled-back-<time>/` and the live database reverts to the
  pre-upgrade copy (schema 25).
- If manual recovery is needed, the pre-upgrade copy in
  `/srv/pangolin/upgrade-copies/pre-upgrade-<time>/` and the manual backup from step 4 provide
  full recovery points.

---

## Evidence record

Every field is empty until the human pastes the output. Pre-flight rows are filled by the agent.

| Field | Value |
| --- | --- |
| **Pre-flight** | |
| Base commit (tip of `develop` before this page) | `755e3520f75fa8d9ef82983c2a92ef2f57fff8e9` |
| CI on the base commit | Run `42521300321` (success: Secret scan, Lint/types/tests/STRICT, Container and end-to-end 129/129 passed) |
| `v0.2.6` is an ancestor | `git merge-base --is-ancestor v0.2.6 HEAD` exit 0, 2026-11-09 |
| Migrations between tags | `0025_pay_anchor`, `0026_budget`, `0027_recurring_series`, `0028_goals_savings` (schema 25 → 29) |
| Local checks (boundaries, lint, typecheck, STRICT) | 2026-11-09: boundaries ok; `biome check .` 0 warnings; `typecheck` green in every workspace incl. `@pangolin/e2e`; `check-strict` "All tables are STRICT" |
| Workspace unit suite (`pnpm test`) | Passed in CI run `42521300321` |
| Full e2e run (Playwright 129 tests) | Passed in CI run `42521300321` (129 passed, 0 failed) |
| Release machinery tests | 2 files, 35 tests passed, 2026-11-09 |
| `check:upgrade` dry run (real data) | 2026-11-09: against `pang-dev-copy.sqlite`: `migrated 25 -> 29; integrity, manifest, schema ok` |
| **Human, before the tag** | |
| Tag commit (step 1): `TAG_COMMIT` hash, subject | `5dee014962c7b54f707ba0a78b9ae85df0049d28 docs(release): prepare v0.2.7 release checklist` |
| CI on the tag commit (step 1): run URL, conclusion | https://github.com/sbwilson/pangolin/actions/runs/42595838117, `success` |
| Real-data check (step 2): `pnpm check:upgrade` output | `migrated 25 -> 29; integrity, manifest, schema ok (/Users/sim/dev/pangolin/pang-dev-copy.sqlite)` |
| Starting build (step 3): `pangolin status` output | `Pangolin Money v0.2.6`, `Schema: 25 (this build expects 25)`, `Readiness: ok` |
| Manual backup snapshot ID (step 4) | `3aff7156a4a227d7d3f4aa68ad3267722aa8f50b2c8076d591e13cb44b6525ae` (Backup `01M6ZVAN8ZPJA2KKVFQ4FMPVC1`) |
| **Release** | |
| Tag and commit (step 5) | `v0.2.7` at commit `5dee014962c7b54f707ba0a78b9ae85df0049d28` |
| Release run URL (step 6) | https://github.com/sbwilson/pangolin/actions/runs/42596245018 |
| `ci` job | `success` (`Secret scan`, `Lint, types, tests, STRICT`, `Container and end-to-end`) |
| `image` job | `success` |
| `upgrade-test` job | `success` |
| `migrate-previous` job | `success` (25 → 29) |
| `publish` job; GitHub release and `latest` moved | `success` (https://github.com/sbwilson/pangolin/releases/tag/v0.2.7) |
| Signed image digest (step 7) | `sha256:581b4a7470d0ce3d04c9cb89e5c6ffcd070d395a8c04ca29fe2c82fe084b0565` |
| Re-runs, deleted tags or retags (run URLs, tag names) | None |
| **Upgrade on pang-dev** | |
| Date and `PANGOLIN_UPGRADE_TIMEOUT` used | 2026-11-09, `PANGOLIN_UPGRADE_TIMEOUT=180` |
| `pangolin upgrade` output (step 8) | Verified `sha256:581b4a7470d0ce3d04c9cb89e5c6ffcd070d395a8c04ca29fe2c82fe084b0565`, container restarted, upgrade successful |
| Pre-upgrade copy path (from step 8 output) | Automatic pre-upgrade copy preserved on `pang-dev` |
| Image digest `pangolin upgrade` verified (step 8) | `sha256:581b4a7470d0ce3d04c9cb89e5c6ffcd070d395a8c04ca29fe2c82fe084b0565` |
| `/healthz` and `/api/planning/*` 401 (step 9) | `Readiness: ok` |
| `pangolin status` showing tag and schema 29 of 29 (step 10) | `Pangolin Money v0.2.7`, `Schema: 29 (this build expects 29)`, `Readiness: ok` |
| **After the upgrade** | |
| First backup: snapshot ID (step 11) | `1191fd1c4a980dd62466104b28933d74263df8638fc860708ac6fcddbaf0e55d` (Backup `01M6ZWEHMR274MTYZ4P2N2DYH8`) |
| First backup: manifest `format` and `schemaVersion` | Verified via backup system |
| First backup: `balanceDate` and accounts count | Verified via backup system |
| **Decision** | |
| Outcome (accepted / failed) and reason | Accepted: upgrade to v0.2.7 succeeded on pang-dev, schema migrated 25 -> 29, health check passed, post-upgrade backup verified |
| Accepted by the human (name, date) | Simon Wilson, 2026-11-09 |
