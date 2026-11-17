# Release v0.2.8

The checklist and evidence record for releasing `v0.2.8` and upgrading the home server
(`pang-dev`) from the `v0.2.7` tag. It carries epic 8 (forecasting) and the reverse-proxy
host list (deploy 8.13–8.15) to a real host:

- **Epic 8:** the forecasting workspace (`/planning/forecast`), covering cash-flow projection with
  low-balance warnings, net-worth projection with editable person-scoped assumptions, the
  `domain/amortise` mortgage schedule, per-account low-balance lines, the not-enough-data and
  all-clear states, and lazy-loaded charts.
- **Proxy host list:** the installer and firewall take the proxy hosts as a comma-separated
  list (`--proxy-host` / `PANGOLIN_PROXY_HOSTS`, `--npm-host` still accepted), the rendered
  ruleset carries IPv4 and IPv6 proxy sets, re-runs warn when the host's DNS resolvers drift
  from `.env`, and `sudo pangolin reconfigure` re-addresses an installed host without editing
  `.env` by hand. The release doubles as the migration of `pang-dev` onto the homelab's
  active/standby Caddy pair at `10.20.5.80` and `10.20.8.80`.

The database schema moves from 29 to 33 (migrations `0029_account_low_balance_threshold`,
`0030_budget_funding_account`, `0031_forecast_assumption`, and
`0032_forecast_assumption_mortgage_terms`). Procedures come from [install.md](install.md)
section 11 and `deploy/pangolin`; this page changes none of them. It follows
[release-v0.2.7.md](release-v0.2.7.md), including a pre-tagging real-data dry run of the
migrations and the manual backup gate.

Who does what: the human provides a read-only copy of `pang-dev`'s database for the dry run,
tags, pushes, backs up, upgrades, reconfigures the proxy pair, and pastes the output. The
agent prepared this page, ran the pre-flight checks below and fills the record from pasted
output. The agent pushes no tag, takes no backup, runs no `pangolin upgrade`, runs no
`pangolin reconfigure` and touches no server. No field counts as filled without pasted output
or a run URL.

## Release notes

GitHub generates the full notes from the merged changes; these are the hand-written lines.

`v0.2.8` ships Forecasting (epic 8) and the reverse-proxy host list for the installer and
firewall. Database schema moves 29 to 33.

### Forecasting (Epic 8)

- **Cash-flow projection (`/planning/forecast`):** forward projection of the plan's cash flow
  (funding accounts, series-covered exclusions, allocation debits, day 0 exact), with low-balance
  warnings naming where an account runs short. The horizon lives in the URL.
- **Per-account low-balance lines:** an editable low-balance threshold per account (migration
  `0029_account_low_balance_threshold`), with warning lines drawn per account.
- **Net-worth projection (`/planning/forecast?mode=networth`):** segmented control between the
  views, low/mid/high return lines, year horizons, and a headline net-worth figure.
- **Editable assumptions:** person-scoped forecast assumption storage and API (migrations
  `0031_forecast_assumption` and `0032_forecast_assumption_mortgage_terms`), shown as chips with
  inline edit, a changed state, and reset.
- **`domain/amortise`:** mortgage amortisation schedule with offset, powering mortgage terms in
  the net-worth assumptions.
- **Honest states:** a not-enough-data state instead of a fabricated line, and an all-clear
  state when no account dips below its line.
- **Lazy-loaded charts:** echarts splits into its own chunk and mounts only where a chart shows
  (keeping PWA precache files under 2 MiB).
- **End to end:** a forecasting journey with axe audits for `/planning/forecast`.

### Reverse-proxy host list (installer & firewall)

- **A list, not a single host:** `--proxy-host IP[,IP…]` takes the proxy hosts, the only addresses
  that may reach the app port, as a comma-separated list and writes them to `.env` as
  `PANGOLIN_PROXY_HOSTS` and `PANGOLIN_TRUSTED_PROXIES` (the firewall and the app take the same
  list). `--npm-host` is accepted as an alias, and an older `.env`'s
  `PANGOLIN_NPM_HOST` is still read when it has no `PANGOLIN_PROXY_HOSTS`.
- **Proxy sets in the rendered ruleset:** the list splits by family into the `proxy4` (IPv4) and
  `proxy6` (IPv6) nftables sets the input and forward rules match.
- **DNS resolver drift warning:** a re-run without `--dns` compares the VM's current resolvers
  with `PANGOLIN_DNS_SERVERS` and, when they differ or the host has none left, names both sets
  and ends with the `install.sh --dns IP[,IP...]` repair. The firewall warns about the same
  drift on every render (`journalctl -u pangolin-allowlist.service`).
- **`sudo pangolin reconfigure`:** re-addresses an installed host through `--proxy-host`,
  `--admin-network` and `--dns`, with `--force` for the admin-network lockout gate, by extracting
  the installer from the image `.env` pins and running it with `--reconfigure`, so the values
  replace their `.env` entries and the firewall and stack re-apply. Nothing is edited by hand.
- **The homelab migration:** this is how `pang-dev` moves onto the active/standby Caddy pair at
  `10.20.5.80` and `10.20.8.80`, in checklist step 8a, after the upgrade.

### Fixes

- `fix(llm): strip pasted route suffixes in buildEndpointUrl`: pasting a full route (e.g.
  `…/v1/chat/completions`) into an LLM endpoint setting no longer double-extends the URL.

The version is the tag. `package.json` stays `0.0.0` and there is no CHANGELOG file.

## Rules

- Release only a commit whose CI is green on GitHub Actions, including `Container and
  end-to-end`, and which descends from `v0.2.7`. The page and any stabilization fixes are
  committed to `develop` first; CI must be green on that tip and the tag goes on the explicit
  hash recorded in step 1 (`TAG_COMMIT`). If `develop` moves after that, the human decides
  whether to tag the new tip (whose CI must also be green) or `TAG_COMMIT`, and records the
  decision.
- All five `release.yml` jobs (`ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) are
  green on the tag before the upgrade starts.
- A dry run of `pnpm check:upgrade` must be performed against a read-only copy of `pang-dev`'s
  real database before tagging (step 2), verifying the 29 → 33 migrations against real data.
- The manual `sudo pangolin backup` comes first and its snapshot ID is recorded before the
  upgrade starts. Without it the upgrade does not run.
- The upgrade is `sudo pangolin upgrade v0.2.8` on a host that reports `v0.2.7` and schema 29,
  never a develop build. If `pangolin status` before the upgrade shows anything else, stop and
  record it.
- Schema is 33 after the upgrade, reporting `Schema: 33 (this build expects 33)`. Any other schema
  number rejects the release. Nothing is dropped on the way up: the four migrations add tables
  and columns, and `0029_account_low_balance_threshold` rebuilds `account` in place to add its
  threshold column, copying every row. A rolled-back upgrade restores the pre-upgrade database
  copy, which is still schema 29.
- The upgrade runs while `.env` still holds the single old proxy address. The two-node list
  goes in only through `sudo pangolin reconfigure --proxy-host 10.20.5.80,10.20.8.80` (step
  8a), after the tag's renderer is on the host, never by hand before it. The rule behind the
  ordering: the `render.sh` installed on `pang-dev` today (`v0.2.7`) dies on a comma-separated
  `PANGOLIN_NPM_HOST` (`deploy/firewall/render.sh:169-171`) and leaves the loaded ruleset
  stale. Editing a list into `.env` beforehand is a failed step, not a shortcut.
- Any step whose output differs from the expected output is recorded as **failed**, the upgrade
  stops there, and the release is not accepted.
- A failed tag is deleted on the remote and locally before the next attempt (step 13). A
  published tag is never reused.
- No field counts as filled without pasted output or a run URL. Only the human accepts the
  release.

## Pre-flight (agent, 2026-11-18)

1. **`v0.2.7` is an ancestor:** `git merge-base --is-ancestor v0.2.7 HEAD` exits 0
   (`ancestor-ok`).
2. **Schema:** schema 33 (migrations 0000 to 0032, `ls packages/db/migrations/*.sql | wc -l`
   → 33); new since `v0.2.7` are `0029_account_low_balance_threshold`,
   `0030_budget_funding_account`, `0031_forecast_assumption`, and
   `0032_forecast_assumption_mortgage_terms`.
3. **Local checks (`9410325`, the code tip under this page; this page adds no code):** `pnpm lint`
   green (package boundaries ok; `biome check .` exits 0 with 0 errors; its 302 warning/info
   diagnostics, mostly `noExplicitAny` and `noNonNullAssertion` in epic 6–8 test files, do not gate
   the check, same as in CI). The two biome format errors 8.13–8.15 introduced
   (`deploy/install.test.ts`, `deploy/pangolin.test.ts`) and the 20 `noNonNullAssertion`s in
   `forecast-seed.test.ts` and `forecast-assumptions-seed.test.ts` were cleared in `7cde9c9`.
   `pnpm typecheck` clean in every workspace incl. `@pangolin/e2e`; `pnpm check:strict` reports "All
   tables are STRICT"; `forecast-seed.test.ts` 6 tests passed.
4. **End-to-end & CI:** GitHub Actions CI run `43745808831` on `develop` at `b59ebae` (the
   pushed tip, before the proxy-pair commits) passed completely: Secret scan (success),
   Lint, types, tests, STRICT (success), and Container and end-to-end (success: 135 passed
   Playwright tests, incl. `forecast.spec.ts`). The proxy-pair commits (`8.13`–`8.15`), the
   lint gate (`7cde9c9`), the 401 guard (`9410325`) and this page ride to origin on the step 1
   push; the CI run on `TAG_COMMIT` there is the one that gates the tag.
5. **Release machinery tests:** `pnpm exec vitest run deploy/release-workflow.test.ts
   deploy/release-scripts.test.ts`: 2 files, 35 tests passed.
6. **Real-data migration dry run:** executed against `pang-dev-copy.sqlite` (real `pang-dev`
   data from 2026-11-09, copied at schema 29, where `schema_migration` count was 29 and max was
   `0028_goals_savings`): `migrated 29 -> 33; integrity, manifest, schema ok`. The dry run
   migrates the copy it is given in place, so re-running it on that file now prints
   `migrated 33 -> 33`; only a fresh copy off `pang-dev` reproduces the 29 → 33 run. The copy and
   its sidecars are deleted once both real-data rows (this one and step 2's) are recorded.

## Checklist

```sh
TAG=v0.2.8
REPO=ghcr.io/sbwilson/pangolin
```

| # | Who | Step |
| --- | --- | --- |
| 1 | Human, agent | Push `develop`, and confirm CI is green on that exact tip. |
| 2 | Human, then agent | Check the migrations on a read-only copy of pang-dev's real database (`check:upgrade`). |
| 3 | Human | Confirm pang-dev reports `v0.2.7` and schema 29. |
| 4 | Human | Take a manual backup on pang-dev and record the snapshot ID. **Gate.** |
| 5 | Human | Tag the step 1 commit and push the tag. |
| 6 | Human, agent watches | Watch the release run's five jobs. |
| 7 | Human | Record the signed image digest. |
| 8 | Human | Upgrade pang-dev. |
| 8a | Human | Apply the proxy pair: `sudo pangolin reconfigure --proxy-host 10.20.5.80,10.20.8.80`. |
| 9 | Human | Read `/healthz`, confirm the three forecast routes answer 401 through each Caddy node, and check `/planning/forecast` signed in. |
| 10 | Human | Read `pangolin status`. |
| 11 | Human, agent | Take the first backup after the upgrade and read its manifest. |
| 12 | Human, agent | Fill the record and accept or reject the release. |
| 13 | Human | If a gate or the upgrade failed: delete the tag before retrying. |

Steps 1–13 keep the v0.2.7 numbering; step 8a is new to this release. `.env` keeps the single
old proxy address until step 8a runs.

---

### 1. Push `develop` and confirm CI

The page is committed to `develop` as `docs(release): prepare v0.2.8 release checklist`, on top
of `9410325` (the 401 guard on the forecast routes), `7cde9c9` (the lint gate) and the
8.13–8.15 proxy-pair commits. On the human's go-ahead, push and confirm CI is green on that
exact tip, including `Container and end-to-end` (which runs all Playwright suites including
`forecast.spec.ts` and the axe audits). Ticket bookkeeping commits (`docs(bmad)`, which change
only `_bmad-output/`) land below the page commit, before it, not above: the tag goes on the page
commit `docs(release): prepare v0.2.8 release checklist` itself, and `TAG_COMMIT` is that hash:

```sh
git fetch origin && git checkout develop
git push origin develop
TAG_COMMIT=$(git rev-parse develop); echo "$TAG_COMMIT"
git log -1 --format='%H %s'    # must print the page commit, else stop
git merge-base --is-ancestor v0.2.7 "$TAG_COMMIT" && echo ancestor-ok
PAGER=cat gh run list --branch develop --event push --commit "$TAG_COMMIT" --limit 1 --json databaseId,headSha,status,conclusion,url
```

Expected: the subject from `git log -1` is `docs(release): prepare v0.2.8 release checklist`;
if `develop`'s tip prints anything else, stop there and do not tag until the page commit is the
tip. The run's `headSha` equals `$TAG_COMMIT`, its `conclusion` is `success` (`Lint, types,
tests, STRICT`, `Secret scan`, `Container and end-to-end`), and `ancestor-ok` prints. Record the
tag commit hash in the evidence record. If the run fails on intermittent test timeouts, allow one
`PAGER=cat gh run rerun <run-id> --failed` and record both runs. Wait for the run to finish; do
not tag on a run in progress.

### 2. Real-data check (before tagging)

The agent's pre-flight dry run has already proved 29 → 33 on the 2026-11-09 copy (Pre-flight 6).
The human now supplies a fresh read-only copy, so the check runs on the database as it is today.

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

Expected: reports `migrated 29 -> 33`, integrity, manifest, and schema valid. Paste output in
the evidence record.

Once both real-data rows (this one and Pre-flight 6) are recorded, delete every copy and its
sidecars, since they hold household data:

```sh
rm -f /path/to/pang-dev-copy.sqlite*
rm -f ~/dev/pangolin/pang-dev-copy.sqlite*    # the pre-flight copy, too
```

### 3. Confirm the starting build

On pang-dev:

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.7`, `Schema: 29 (this build expects 29)`, `Readiness: ok`. Paste
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
git merge-base --is-ancestor v0.2.7 "$TAG_COMMIT" && echo ancestor-ok
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
`publish` all `success`, and the GitHub release exists with `latest` moved to `v0.2.8`. The
`migrate-previous` job exercises the 29 → 33 path.

If only `ci` failed on test timeouts, allow one `PAGER=cat gh run rerun <run-id> --failed` on the
same tag and record both runs. Any other failure means there is no release and no tagged image:
go to step 13. Do not upgrade.

### 7. Image digest

```sh
docker buildx imagetools inspect "$REPO:$TAG" | grep -m1 Digest
```

Record the digest.

### 8. Upgrade

On pang-dev, only after steps 2, 3, 4, 6, and 7 are recorded. `.env` must still hold the single
old proxy address; do not edit it (see Rules).

Run `sudo pangolin status` immediately before upgrading to confirm `v0.2.7`:

```sh
TAG=v0.2.8
sudo pangolin status
sudo PANGOLIN_UPGRADE_TIMEOUT=180 pangolin upgrade "$TAG"
```

Expected: signature verified, image digest matches step 7, pre-upgrade copy created in
`/srv/pangolin/upgrade-copies/pre-upgrade-<time>/`, schema 29 migrated to 33, and the stack
reports healthy. The upgrade replaces `.env`'s image line, `compose.yaml` and the `pangolin`
command itself, so `pangolin reconfigure` exists from here on. Paste the complete output.

### 8a. Apply the proxy pair (new in this release)

Only after step 8 is recorded, and its output shows the upgrade succeeded. The tag's image
carries the host-list `render.sh`; `pangolin reconfigure` extracts the installer from the image
`.env` pins and runs it with `--reconfigure`, which installs the new `render.sh` before it writes
the proxy list to `.env`, so the renderer never meets a list it cannot read:

```sh
sudo pangolin reconfigure --proxy-host 10.20.5.80,10.20.8.80
```

Expected: the installer banner (`Pangolin Money installer`), the run re-applying the firewall and
stack, and the NPM summary line `Pangolin believes it only from 10.20.5.80,10.20.8.80.`, ending
with `Finished.` (no warnings naming the proxy list). `.env` now holds both keys with the
identical list (`PANGOLIN_PROXY_HOSTS=10.20.5.80,10.20.8.80` and
`PANGOLIN_TRUSTED_PROXIES=10.20.5.80,10.20.8.80`), and the app container is recreated with them.
Paste the complete output.

If the run refuses with `the install.sh in <image> predates --reconfigure`, the pinned image is
not `v0.2.8`: check `sudo pangolin status` and record, and do not continue. If the run fails
halfway, the host stays on the single-host ruleset until it is fixed (record it); it is safe to
re-run after fixing the cause, and hand-editing `.env` is not the repair.

Why the order, proven on the development machine 2026-11-18 with a staged `.env` holding
`PANGOLIN_NPM_HOST=10.20.5.80,10.20.8.80`: `render.sh` from `v0.2.7` stops at once with
`render.sh: not an IP address or network: 10.20.5.80,10.20.8.80`, exit 1, leaving whatever
ruleset was loaded in force; this release's `render.sh` reads the same file into
`set proxy4 { … elements = { 10.20.5.80, 10.20.8.80 } }`, used by both the input rule and the
`ct status dnat` forward rule, with an empty `proxy6` twin, exit 0.

### 9. Healthz, forecast routes, and the pair

On pang-dev (or any machine that reaches the app through the proxies):

```sh
curl https://<app host>/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://<app host>/api/planning/forecast
curl -s -o /dev/null -w '%{http_code}\n' https://<app host>/api/planning/forecast-net-worth
curl -s -o /dev/null -w '%{http_code}\n' https://<app host>/api/planning/forecast-assumptions
```

Expected: `/healthz` returns `{"ok":true…}` and all three forecast routes answer `401`
unauthenticated (wired and guarded).

Prove the pair: both addresses in both keys, in the loaded ruleset, and the app reachable
through each Caddy node in turn:

```sh
grep -E 'PANGOLIN_(PROXY_HOSTS|TRUSTED_PROXIES)' /opt/pangolin/.env
sudo nft list set inet pangolin proxy4
curl --resolve <app host>:443:10.20.5.80 -s -o /dev/null -w '%{http_code}\n' https://<app host>/api/planning/forecast
curl --resolve <app host>:443:10.20.8.80 -s -o /dev/null -w '%{http_code}\n' https://<app host>/api/planning/forecast
```

Expected: both `.env` keys hold `10.20.5.80,10.20.8.80` (identical lists), the `proxy4` set
carries both addresses, and each node returns `401`: requests reaching through the standby are
served, so a failover does not black-hole the app.

Signed in, in a browser:

- `/planning/forecast` renders the cash-flow projection, with low-balance warnings where an
  account dips below its line, or the all-clear state.
- `/planning/forecast?mode=networth` shows the headline net worth, the low/mid/high lines, and
  the assumption chips (edit one: the changed state appears; reset it).
- Repeat both through the standby node `10.20.8.80` (point the app hostname at it in the OS
  hosts file, or the lab's equivalent, and remove the entry afterwards). The page loads, and the
  client address survives: Settings › signed-in devices shows the browser's address for a fresh
  sign-in made through the standby, not `10.20.8.80`.

Paste what you see in the browser (screenshots or copied text): the `401` responses alone do not
close the ticket.

### 10. Status

```sh
sudo pangolin status
```

Expected: `Pangolin Money v0.2.8`, `Schema: 33 (this build expects 33)`, `Readiness: ok`.

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

Expected: `format` 2, `schemaVersion` 33 and current `balanceDate`. Paste format line,
`balanceDate`, and account count.

### 12. Fill the record

Fill every field below from pasted output, then accept or reject the release. Once accepted,
confirm both `check:upgrade` copies and all their sidecars are deleted (step 2) and record it.

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
copy and manual backup, and investigate. If step 8a alone failed, the tag itself is fine: record
the failure, leave the host as it is (single-host ruleset), and fix the reconfigure before
retrying it.

---

## Rollback

- If the upgrade fails health checks within the timeout, `pangolin upgrade` automatically rolls
  back to the previous image, `.env` file, and database copy, recording a
  `system.upgrade-failed` review item. The database the server used (schema 33) is saved in
  `/srv/pangolin/upgrade-copies/rolled-back-<time>/` and the live database reverts to the
  pre-upgrade copy (schema 29).
- If manual recovery is needed, the pre-upgrade copy in
  `/srv/pangolin/upgrade-copies/pre-upgrade-<time>/` and the manual backup from step 4 provide
  full recovery points.
- If step 8a fails, the host stays on the single-host ruleset until it is fixed: it is a failed
  migration step, not a failed release. The run installs the new `render.sh` before it writes the
  proxy list to `.env`, so an aborted run cannot leave the pair in `.env` behind the renderer
  that dies on it; re-run the command after fixing the cause. Only if you must go back to one
  proxy address, re-run `sudo pangolin reconfigure --proxy-host <the single old address>`.

---

## Evidence record

Every field is empty until the human pastes the output. Pre-flight rows are filled by the agent.

| Field | Value |
| --- | --- |
| **Pre-flight** | |
| Base commit (tip of `develop` before this page) | `94103259b4ef2c06f22e39c1f236f8a4c00bef03` |
| CI on the pushed develop tip | Run [`43745808831`](https://github.com/sbwilson/pangolin/actions/runs/43745808831) on `b59ebae` (success: Secret scan, Lint/types/tests/STRICT, Container and end-to-end 135 passed). CI on the unpushed tip (8.13–8.15, the lint gate, the 401 guard, this page) comes with the step 1 push and gates the tag |
| `v0.2.7` is an ancestor | `git merge-base --is-ancestor v0.2.7 HEAD` exit 0 (`ancestor-ok`), 2026-11-18 |
| Migrations between tags | `0029_account_low_balance_threshold`, `0030_budget_funding_account`, `0031_forecast_assumption`, `0032_forecast_assumption_mortgage_terms` (schema 29 → 33; 33 `.sql` files) |
| Local checks (boundaries, lint, typecheck, STRICT) | 2026-11-18: boundaries ok; `pnpm lint` green (`biome check .` 0 errors, and the 302 warning/info diagnostics do not gate the check); `typecheck` clean in every workspace incl. `@pangolin/e2e`; `check-strict` "All tables are STRICT" |
| Workspace unit suite (`pnpm test`) | Passed in CI run `43745808831`; re-runs on `TAG_COMMIT` in step 1 |
| Full e2e run (Playwright 135 tests) | Passed in CI run `43745808831` (135 passed, 0 failed; incl. `forecast.spec.ts`) |
| Release machinery tests | `deploy/release-workflow.test.ts` + `deploy/release-scripts.test.ts`: 2 files, 35 tests passed, 2026-11-18 |
| `check:upgrade` dry run (real data, pre-flight) | 2026-11-18: against `pang-dev-copy.sqlite` (2026-11-09 copy, schema 29): `migrated 29 -> 33; integrity, manifest, schema ok (/Users/sim/dev/pangolin/pang-dev-copy.sqlite)` |
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
| `migrate-previous` job (29 → 33) | |
| `publish` job; GitHub release and `latest` moved | |
| Signed image digest (step 7) | |
| Re-runs, deleted tags or retags (run URLs, tag names) | |
| **Upgrade on pang-dev** | |
| Date and `PANGOLIN_UPGRADE_TIMEOUT` used | |
| `pangolin upgrade` output (step 8) | |
| Pre-upgrade copy path (from step 8 output) | |
| Image digest `pangolin upgrade` verified (step 8) | |
| `pangolin reconfigure` output (step 8a) | |
| `.env` proxy keys after reconfigure (step 9) | |
| `nft` `proxy4` set with both addresses (step 9) | |
| `/healthz` ok, three forecast routes `401` through each node (step 9) | |
| Browser: `/planning/forecast` and `?mode=networth`, through each node (step 9) | |
| `pangolin status` showing tag and schema 33 of 33 (step 10) | |
| **After the upgrade** | |
| First backup: snapshot ID (step 11) | |
| First backup: manifest `format` and `schemaVersion` | |
| First backup: `balanceDate` and accounts count | |
| `check:upgrade` copies and sidecars deleted (step 2) | |
| **Decision** | |
| Outcome (accepted / failed) and reason | |
| Accepted by the human (name, date) | |
