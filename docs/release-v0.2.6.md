# Release v0.2.6

The checklist and evidence record for releasing `v0.2.6` and upgrading the home server
(`pang-dev`) from the `v0.2.5` tag. It carries epic 5 (LLM categorisation and PDF statement
import) to a real host: the Settings › LLM providers card (encrypted keys, LAN detection and
re-auth guard under AD-6), the categorisation engine with review-inbox suggestions and the
≥90% bulk-accept card, `pangolin categorise` on the admin socket, PDF statement upload with
deterministic balance verification and encrypted-at-rest attachments, the set-aside row
interpretation flow, and merchant logos proxied locally. The database schema moves from 21 to
25 (migrations `0021_llm_provider`, `0022_suggestion`, `0023_import_row_proposal` and
`0024_pdf_batch_attachment`). Procedures come from [install.md](install.md) section 11 and
`deploy/pangolin`; this page changes none of them. It follows
[release-v0.2.5.md](release-v0.2.5.md), including a pre-tagging real-data dry run of the
migrations and the manual backup gate.

Who does what: the human provides a read-only copy of `pang-dev`'s database for the dry run,
tags, pushes, backs up and upgrades, and pastes the output. The agent prepared this page, ran
the pre-flight checks below and fills the record from pasted output. The agent pushes no tag,
takes no backup, runs no `pangolin upgrade` and touches no server. No field counts as filled
without pasted output or a run URL.

## Release notes

GitHub generates the full notes from the merged changes; these are the hand-written lines.

`v0.2.6` ships LLM categorisation and PDF statement import (epic 5). Database schema moves 21
to 25.

### LLM providers
- **Settings › LLM providers card:** add, edit, test and assign providers for categorisation,
  statement parsing and set-aside row reading, with a live request preview.
- **Keys encrypted at rest** under the existing app secret (no new secret or env var); masked
  last-4 display.
- **AD-6 guardrails:** non-local providers need an explicit opt-in, provider writes sit behind
  recent re-authentication, and private-account rows are never sent to a cloud provider.

### Categorisation
- **Categorisation engine:** batched suggestions from the configured provider, with FTS5
  few-shot context from the person's own categorised history.
- **Review inbox:** suggestion cards with confidence, accept or choose-otherwise, and the
  ≥90% bulk-accept card ("N more we're very sure about", Accept all).
- **`pangolin categorise`:** runs the same engine over unclassified visible transactions from
  the admin socket and reports recorded and discarded counts.

### PDF statements
- **PDF upload in the Import popover:** extraction with pdf.js plus deterministic balance
  verification; a one-cent-off statement is refused with the exact gap reported.
- **Encrypted attachments at rest:** HMAC-named files whose bytes are readable only through
  the batch-scoped file route.
- **Visual review:** rows beside the rendered statement page, with correction and Re-check.

### Set-aside rows
- **Row interpretation (`row_interpret`):** a hidden set-aside line gets a provider-written
  interpretation and a proposal the person confirms before anything is categorised.

### Merchant logos
- **Domain extraction and a local logo proxy:** logos are fetched by a privacy-guarded job
  into the data volume; the browser never calls third-party hosts.

### Stability fixes (pre-existing)
- A hygiene sweep rides along with this release: the server bundle now ships the pdf.js worker
  (container PDF uploads failed at runtime without it), `pdf-import.spec` no longer runs twice
  in the e2e suite (a duplicated run whose failure aborted the later projects), and the
  Settings status card mirrors the real job store instead of assuming no jobs ever died —
  together restoring the green `Container and end-to-end` quality gate.

The version is the tag. `package.json` stays `0.0.0` and there is no CHANGELOG file.

## Rules

- Release only a commit whose CI is green on GitHub Actions, including `Container and end-to-end`,
  and which descends from `v0.2.5`. The page, plan file, and any stabilization fixes are committed
  to `develop` first; CI must be green on that tip and the tag goes on that tip. The tag goes on
  the explicit hash recorded in step 1 (`TAG_COMMIT`). If `develop` moves after that, the human
  decides whether to tag the new tip (whose CI must also be green) or `TAG_COMMIT`, and records
  the decision.
- A dry run of `pnpm check:upgrade` must be performed against a read-only copy of `pang-dev`'s
  real database before tagging (step 2), verifying the 21 → 25 migrations against real data.
- The release run (`release.yml`: `ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`)
  must be green on the tag before the upgrade.
- The manual `sudo pangolin backup` comes first and its snapshot ID is recorded before the
  upgrade starts. Without it the upgrade does not run.
- The upgrade is `sudo pangolin upgrade v0.2.6` on a host that reports `v0.2.5`, never a develop
  build. If `pangolin status` before the upgrade shows anything else, stop and record it.
- Schema is 25 after the upgrade. Any other schema number rejects the release. The migrations
  only add tables and columns; a rolled-back upgrade restores the pre-upgrade database copy,
  which is still schema 21.
- Any step whose output differs from the expected output is recorded as **failed**, the upgrade
  stops there, and the release is not accepted.
- A failed tag is deleted on the remote and locally before the next attempt (step 13). A
  published tag is never reused.
- Each human change to the plan or this checklist is logged in the plan's Plan Change Log
  (`_bmad-output/initiative-pangolin-money-v1/tickets/epic-llm-categorisation-pdf/tickets/story-milestone-m2-gate-verification-end-to-end-journey-and-releas-plan.md`).
- Only the human accepts the release.

## Pre-flight (agent, 2026-10-29)

1. **`v0.2.5` is an ancestor:** `git merge-base --is-ancestor v0.2.5 HEAD` exits 0.
2. **Schema:** schema 25 (migrations 0000 to 0024); `0021_llm_provider`, `0022_suggestion`,
   `0023_import_row_proposal` and `0024_pdf_batch_attachment` are new since `v0.2.5`.
3. **Local checks:** `node scripts/check-boundaries.ts`, `pnpm lint` (0 warnings, package
   boundaries ok), `pnpm typecheck`, `pnpm check:strict` (all tables STRICT) and `pnpm test`
   (full workspace suite) — results recorded in the evidence record.
4. **End-to-end:** the full `pnpm e2e` run (auth → chromium → reports → accounts → axe) with
   `E2E_SETUP_LINK_COMMAND`, `E2E_SEED_COMMAND`, `E2E_CATEGORISE_COMMAND` and
   `E2E_LLM_BASE_URL=http://127.0.0.1:4111`. The agent ran it against the README host flow
   (no container runtime on this machine): the built server on `PANGOLIN_DATA_DIR` with the
   admin socket and `PANGOLIN_ENABLE_SEED=true`, plus the host `mock-llm`; CI runs the same
   suite against the docker stack with `COMPOSE_PROFILES=backup,llm` and the compose-network
   `E2E_*` values. Result recorded in the evidence record. It
   includes the new `e2e/categorise.spec.ts` journey (import → `pangolin categorise` →
   bulk-accept → badge clears) and the new `axe.spec.ts` audits of `/settings#llm-providers`
   (row and add form) and the Import popover with a PDF chosen, in light and dark. The
   recorded green run used the host flow, where the mock at `127.0.0.1` is classified local;
   CI's `http://mock-llm:4111` classifies as cloud, so the cloud classification path first
   executes at the tag's CI run.
5. **CI stabilization:** CI on the base commit (`40813822415`, tip `754d7c5`) failed in
   `Container and end-to-end` on two pre-existing specs (red since epic 5 merged).
   - `pdf-import.spec` — the server bundle loads the pdf.js worker from `./pdf.worker.mjs`
     beside `main.js`, which the build never shipped ("Cannot find module
     '/app/dist/pdf.worker.mjs'"). `apps/server/scripts/build.ts` now copies the worker from
     the same `pdfjs-dist` copy the extractor resolves into `dist/` (and the image ships
     `dist/` whole).
   - `settings.spec` — the status card asserted "No jobs need attention", but the seeded
     ledger enqueues `logo-fetch` jobs whose favicons do not resolve inside the CI container,
     and the job kind's frozen one-ever retry policy lets them die (AD-8 fail-closed). The
     spec now reads `/api/system/jobs` and asserts the card mirrors the store: the empty line
     when nothing is dead, every dead kind listed when something is.
   Two more defects surfaced once the spec got past the worker error, and are fixed here:
   - `playwright.config.ts` never added `pdf-import.spec.ts` to the `chromium` project's
     `testIgnore` when the spec moved to the `accounts` project, so it ran twice and a failure
     in it aborted `reports`, `accounts` and `axe` — the CI log shows it failing under
     `[chromium]`. It now runs only in `accounts`, as its comment always intended.
   - `createAccount` in `pdf-import.spec`/`categorise.spec` read `.id` from `POST /api/accounts`
     (the response wraps the account: `{ account: { id } }`), so every later request carried
     `accountId: undefined` and answered 400 `Validation`. And the "Row 2" card assertion matched
     both the row header and the "Save row 2" button; it is anchored to the header now.
6. **Release machinery tests:** `deploy/release-workflow.test.ts` and
   `deploy/release-scripts.test.ts` passed as part of the workspace suite.
7. **Socket ceiling (was: known limitation):** an idle admin-socket connection is still closed
   after 10 s, but a consumed request now runs under a separate command ceiling of 10 minutes,
   and the `pangolin categorise` client waits past it — so a slow real-cloud run reports through
   the CLI instead of being severed. The earlier 10 s severing (and the accepted-limitation note
   it earned) is fixed in this change.

## Checklist

```sh
TAG=v0.2.6
REPO=ghcr.io/sbwilson/pangolin
```

| # | Who | Step |
| --- | --- | --- |
| 1 | Human, agent | Commit and push `develop`, and confirm CI is green on that exact tip. |
| 2 | Human, then agent | Check the migrations on a read-only copy of pang-dev's real database (`check:upgrade`). |
| 3 | Human | Confirm pang-dev reports `v0.2.5` and schema 21. |
| 4 | Human | Take a manual backup on pang-dev and record the snapshot ID. **Gate.** |
| 5 | Human | Tag the step 1 commit and push the tag. |
| 6 | Human, agent watches | Watch the release run's five jobs. |
| 7 | Human | Record the signed image digest. |
| 8 | Human | Upgrade pang-dev. |
| 9 | Human | Read `/healthz` and confirm the new LLM routes answer (401 unauthenticated). |
| 10 | Human | Read `pangolin status`. |
| 11 | Human, agent | Take the first backup after the upgrade and read its manifest. |
| 12 | Human, agent | Fill the record and accept or reject the release. |
| 13 | Human | If a gate or the upgrade failed: delete the tag before retrying. |

---

### 1. Push `develop` and confirm CI

The page, plan file and this milestone's code are committed to `develop`. Push to origin and
confirm CI is green, including `Container and end-to-end` (which now runs
`e2e/categorise.spec.ts` and the extended axe audits against the `llm` compose profile):

```sh
git fetch origin && git checkout develop
git add docs/release-v0.2.6.md \
  _bmad-output/initiative-pangolin-money-v1/tickets/epic-llm-categorisation-pdf/tickets/
git commit -m "docs(release): prepare v0.2.6 release checklist"
git status -sb                                  # develop ahead of origin/develop
git push origin develop
TAG_COMMIT=$(git rev-parse HEAD); echo "$TAG_COMMIT"
git log -1 --format='%H %s'
git merge-base --is-ancestor v0.2.5 "$TAG_COMMIT" && echo ancestor-ok
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

Expected: reports `migrated 21 -> 25` (or `25 -> 25` if the copy was taken from a newer build),
integrity, manifest, and schema valid. Delete the copy and any SQLite sidecar files afterwards
(`rm -f /path/to/pang-dev-copy.sqlite*`): it holds household data. Paste output in the evidence
record.

### 3. Confirm the starting build

On pang-dev:

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.5`, `Schema: 21 (this build expects 21)`, `Readiness: ok`. Paste
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
git merge-base --is-ancestor v0.2.5 "$TAG_COMMIT" && echo ancestor-ok
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
`publish` all `success`, and the GitHub release exists with `latest` moved to `v0.2.6`. The
`migrate-previous` job exercises the 21 → 25 path.

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

Run `sudo pangolin status` immediately before upgrading to confirm `v0.2.5`:

```sh
TAG=v0.2.6
sudo pangolin status
sudo PANGOLIN_UPGRADE_TIMEOUT=180 pangolin upgrade "$TAG"
```

Expected: signature verified, image digest matches step 7, pre-upgrade copy created in
`/srv/pangolin/upgrade-copies/pre-upgrade-<time>/`, schema 21 migrated to 25, and the stack
reports healthy. Paste the complete output.

### 9. Healthz and new routes

```sh
curl https://<app host>/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://<app host>/api/llm/settings
```

Expected: `/healthz` returns `{"ok":true…}` and `/api/llm/settings` answers `401` unauthenticated
(the epic 5 routes are wired and guarded). Optionally, in a browser, Settings shows the LLM
providers card and `/review` renders. Paste the output.

### 10. Status

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.6`, `Schema: 25 (this build expects 25)`, `Readiness: ok`.

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

Expected: `format` 2, `schemaVersion` 25 and current `balanceDate`. Paste format line,
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
  `system.upgrade-failed` review item. The database the server used (schema 25) is saved in
  `/srv/pangolin/upgrade-copies/rolled-back-<time>/` and the live database reverts to the
  pre-upgrade copy (schema 21).
- If manual recovery is needed, the pre-upgrade copy in
  `/srv/pangolin/upgrade-copies/pre-upgrade-<time>/` and the manual backup from step 4 provide
  full recovery points.

---

## Evidence record

Every field is empty until the human pastes the output. Pre-flight rows are filled by the agent.

| Field | Value |
| --- | --- |
| **Pre-flight** | |
| Base commit (tip of `develop` before this page) | `754d7c541e40ee63368c7c7cafa613b89f07507e` |
| CI on the base commit | Run `40813822415` (failed `Container and end-to-end`: `pdf-import` missing `pdf.worker.mjs` in the image, `settings.spec` dead `logo-fetch` jobs from the seed; stabilized in this change) |
| `v0.2.5` is an ancestor | `git merge-base --is-ancestor v0.2.5 HEAD` exit 0, 2026-10-29 |
| Migrations between tags | `0021_llm_provider`, `0022_suggestion`, `0023_import_row_proposal`, `0024_pdf_batch_attachment` (schema 21 → 25) |
| Local checks (boundaries, lint, typecheck, STRICT) | 2026-10-29: boundaries ok; `biome check .` 677 files, 0 warnings; `pnpm typecheck` green in every workspace incl. `@pangolin/e2e`; `check-strict` "All tables are STRICT" |
| Workspace unit suite (`pnpm test`) | 2026-10-29: 187 files, 2730 passed, 1 expected fail, 1 skipped (after applying the review patches P1–P6: +1 socket command-ceiling test, +1 CLI honest-output test, +2 net AD-6 skip tests) |
| Full e2e run (`auth`→`chromium`→`reports`→`accounts`→`axe`, `llm` profile) | 2026-10-29: `pnpm e2e` exit 0 — 117 passed, 2 skipped (the two backup-profile specs), 0 failed; re-run on a fresh stack after applying review patches P1–P6 (the journey asserts the new CLI wording; the socket command ceiling and provider-first selection are on every request of this run; the cloud skip branch itself classifies only under CI's compose hostname). First full execution of `categorise.spec.ts` and of the extended `axe.spec.ts` audits (`/settings#llm-providers` row + add form, Import popover with a PDF chosen, light and dark). This machine has no container runtime, so the run used the README host flow: `node apps/server/dist/main.js` (fresh data dir, admin socket, `PANGOLIN_ENABLE_SEED=true`) with the host `mock-llm` on `127.0.0.1:4111`; the compose stack under CI (`E2E_*` env per `.github/workflows/ci.yml`) is the docker equivalent and runs on the pushed tip |
| Release machinery tests | 2 files, 35 tests passed, 2026-10-29 |
| `check:upgrade` smoke (no real data yet) | 2026-10-29: against a copy of the fresh local schema-25 e2e database: `migrated 25 -> 25; integrity, manifest, schema ok`. The 21 → 25 path against real `pang-dev` data stays the human gate in step 2 |
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
| `/healthz` and `/api/llm/settings` 401 (step 9) | |
| `pangolin status` showing tag and schema 25 of 25 (step 10) | |
| **After the upgrade** | |
| First backup: snapshot ID (step 11) | |
| First backup: manifest `format` and `schemaVersion` | |
| First backup: `balanceDate` and accounts count | |
| **Decision** | |
| Outcome (accepted / failed) and reason | |
| Accepted by the human (name, date) | |
