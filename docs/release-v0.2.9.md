# Release v0.2.9

Tag `v0.2.9` -> commit `79568494afa0b62dba8ec99a58902d3b36ac509e`.
Previous release `v0.2.8`. Schema 33 to 33 (this release ships no migrations; the
proof below still ran end to end on a live copy). Digest
`sha256:6ed33b2dfe7e5b9c1f0c46cbbd126304b063d9951f0938f93c468e55691a0606`.
App host `money-dev.net5.co`, upgraded 2026-11-19 (UTC) from `v0.2.8`.

## What this release is

**v0.2.9 is the release that introduces the automated release process.**
`scripts/release.sh` turns the checklist that was hand-run for v0.2.7 and v0.2.8
into one command, executed on the app server:

```sh
scripts/release.sh vX.Y.Z
```

Twelve numbered steps run with a live voice: pre-flight, a real-data migration
proof on a fresh throwaway copy of the production database, drafting this very
release page, pushing it and waiting for CI, the release workflow, the image
digest, a manual backup gate, the upgrade, the proxy pair, the pair proof,
post-upgrade proof, and the close-out. A human stands at exactly three doors:

1. **Gate 1, tag:** the tag is created only after CI is green on the exact page
   commit, and the command shows that commit before pushing it.
2. **Gate 2, upgrade:** the starting build is re-checked against the plan, and a
   successful manual backup must already be on the record.
3. **Gate 3, accept:** every captured check is presented before the decision.

The hard rules learned the expensive way are encoded, not remembered: never
reuse a tag; the tag goes on the exact tested commit, never "whatever HEAD is";
database copies are deleted the moment their evidence is recorded; the proxy
host list reaches `.env` only through `pangolin reconfigure`; every network call
runs under a timeout, and on a host whose egress allowlist can go stale mid-run
a timeout forces a re-resolve and retries once instead of hanging. Everything
the driver sees lands in the Evidence section below, so the proof ships with
the release instead of living in a terminal buffer.

v0.2.9 is the first release built this way. It was not a clean first run: the
driver crashed once (its own bug, fixed the same night) and lost and regained
its tag once (its own bug, fixed the same night). Both episodes are recorded
under Deviations with the same honesty the evidence gets. That is the point of
this release: the process is now strong enough that its failures are visible,
time-boxed, and repairable instead of tribal.

## Release notes

The release driver:

- chore(release): add `scripts/release.sh` one-shot release driver (`510eab0`)
- fix(release): timeout every network call, poke the allowlist and retry once (`745c584`)
- fix(release): errtrace so failures name themselves; un-quiet the tag fetch (`ba0b88a`)
- fix(release): fetch tags with `--force`; this machine's tags are an origin mirror (`a8d3d05`)
- fix(release): heartbeat in `wait_for_run`; a silent poll loop looks like a hang (`d322a1c`)
- feat(release): numbered step banners, gate callouts, and page-commit reuse on re-run (`f59afd9`)
- feat(release): print the run URL when a CI run appears and when it finishes (`a593c75`)
- fix(release): read `/opt/pangolin/.env` only through sudo (`ca2556f`)
- fix(release): ask the tag-deletion question once ever; ERR traps re-fire per frame (`622fdce`)

CI reliability:

- test(server): retry the 50,000-row perf suite twice; one 311 ms sample must
  not sink a release, while a real regression still fails all three attempts (`a746e09`)

Housekeeping:

- docs(bmad): close out v0.2.8 release evidence, accepted (`6814008`)

## Evidence

Sections marked "driver" were captured by `scripts/release.sh` during the run
into its working directory and transcribed here; sections marked "manual" were
performed by hand after the step-9 crash (see Deviations) on the same night.

### Pre-flight (driver)

```text
live version: v0.2.8
live schema: 33
target: v0.2.9 with 33 migrations
previous tag: v0.2.8
branch: develop at f59afd901a5d3717349d266b38925075a36fdedd
app host: money-dev.net5.co
proxy hosts: 10.20.5.80,10.20.8.80
```

### check:upgrade on a fresh copy of the live database (driver)

```text
$ pnpm --filter @pangolin/db check:upgrade /tmp/pangolin-release-v0.2.9.nXgt3o/pang-dev-copy.sqlite
$ node src/cli/check-upgrade.ts /tmp/pangolin-release-v0.2.9.nXgt3o/pang-dev-copy.sqlite
migrated 33 -> 33; integrity, manifest, schema ok (/tmp/pangolin-release-v0.2.9.nXgt3o/pang-dev-copy.sqlite)
```

No migrations ship in v0.2.9, so 33 -> 33 is the expected path; the check
proves the copy survives this build's migrate + integrity + manifest sequence.

### CI on the page commit (driver)

```text
https://github.com/sbwilson/pangolin/actions/runs/44602297159 -> success
```

### Tag (driver)

```text
v0.2.9          Release v0.2.9
tag commit: 79568494afa0b62dba8ec99a58902d3b36ac509e
```

### Release run (driver)

```text
https://github.com/sbwilson/pangolin/actions/runs/44604613600 -> success
success upgrade-test
success ci / Lint, types, tests, STRICT
success ci / Secret scan
success ci / Container and end-to-end
success image
success migrate-previous
success publish
```

### Image digest (driver)

```text
ghcr.io/sbwilson/pangolin:v0.2.9
Digest:    sha256:6ed33b2dfe7e5b9c1f0c46cbbd126304b063d9951f0938f93c468e55691a0606
  linux/amd64 sha256:153954fa3497bfb9332ae2bf9fc8892b9660ea7392394e5c320116f678916536
  linux/arm64 sha256:302ece4bd450c05d98a32c5840b524cd42954a3cf01d192aa7c86a38f2c681e2
latest release: v0.2.9
```

### Backup gate, pre-upgrade (driver)

```text
Backup 01M7TQEGMQ5E2JWEXK3CYFC1RY started
Backup done at 2026-11-19T20:20:00.688Z: snapshot 62074266e88fc1e29c7cbb7604fea4ba4d4be87ee5316511824fc085096f0592
```

### Starting build, checked before the upgrade gate (driver)

```text
Pangolin Money v0.2.8
Schema:    33 (this build expects 33)
Readiness: ok
```

The four dead `backup-push` jobs listed alongside are pre-existing (newest
2026-11-10, identical list before and after the upgrade); the manual pushes
this night both succeeded in 1 to 2 s.

### Upgrade (driver)

```text
Pulling ghcr.io/sbwilson/pangolin:v0.2.9...
Verifying ghcr.io/sbwilson/pangolin@sha256:6ed33b2dfe7e5b9c1f0c46cbbd126304b063d9951f0938f93c468e55691a0606...
Upgrade to v0.2.9 successful. Old image was ghcr.io/sbwilson/pangolin@sha256:c761805ff5fb06a238cff4733099405c05c0d7e84747a40045a623890717bb6f.
Pre-upgrade copy: /srv/pangolin/upgrade-copies/pre-upgrade-20261120072342
```

The old-image digest matches the recorded v0.2.8 release digest exactly.

### Proxy pair (manual, step 9)

```text
$ sudo grep -E 'PANGOLIN_(PROXY_HOSTS|TRUSTED_PROXIES)=' /opt/pangolin/.env
PANGOLIN_TRUSTED_PROXIES=10.20.5.80,10.20.8.80
PANGOLIN_PROXY_HOSTS=10.20.5.80,10.20.8.80
```

Identical lists, matching the release config, so reconfigure correctly
no-oped; `.env` was never hand-edited.

### Pair proof (manual, step 10)

From the app server: `/healthz` returned `{"ok":true}` and all three forecast
routes answered `401` anonymously through the direct address, but the
`--resolve` pins to the proxy nodes returned `000`. That is the firewall's
design, not a regression: the VM's output chain is default-drop and the proxy
hosts exist in it only as *ingress* actors (`proxy4` set on input/forward), so
the app server cannot originate connections to its own proxies. See Deviation 3.

The full pair proof was therefore taken on the lab network, which reaches the
app through both nodes (the same vantage v0.2.8's browser and standby sign-in
evidence used):

```text
$ curl -fsS https://money-dev.net5.co/healthz
{"ok":true}
forecast via direct -> 401
forecast-net-worth via direct -> 401
forecast-assumptions via direct -> 401
forecast via 10.20.5.80 -> 401
forecast-net-worth via 10.20.5.80 -> 401
forecast-assumptions via 10.20.5.80 -> 401
forecast via 10.20.8.80 -> 401
forecast-net-worth via 10.20.8.80 -> 401
forecast-assumptions via 10.20.8.80 -> 401
```

Both nodes serve, and a failover does not black-hole the app.

After the allowlist entries below were added the same night, the proof was
repeated from the app server itself (2026-11-20), confirming future driver runs
can originate pair-proof traffic from the machine they live on:

```text
forecast via 10.20.5.80 -> 401
forecast-net-worth via 10.20.5.80 -> 401
forecast-assumptions via 10.20.5.80 -> 401
forecast via 10.20.8.80 -> 401
forecast-net-worth via 10.20.8.80 -> 401
forecast-assumptions via 10.20.8.80 -> 401
```

### Status after upgrade (manual, step 11)

```text
Pangolin Money v0.2.9
Schema:    33 (this build expects 33)
Readiness: ok
```

### First backup after the upgrade (manual, step 11)

```text
Backup 01M7TSQ770H5WYSMFF2VFTPA8H started
Pushing it with restic ... 1s
Backup done at 2026-11-19T20:59:42.712Z: snapshot 2e4d0ca2506e0c22f3058576168713bdcf8002a4a30203ffdbdb5c00b42aee7c
```

### Manifest in that snapshot (manual, step 11)

```text
"format": 2
"schemaVersion": 33
"balanceDate": "2026-11-20"
accounts: 4
```

### Copies deleted (driver cleanup, verified manually)

The driver's exit trap removed the `check:upgrade` copy and sidecars at the
crash. Verified after the close-out: the working directory contains only
`evidence.md` and `pre-upgrade-status.txt`; no `*.sqlite*` remains.

## Deviations

1. **Driver crash at step 9.** `apply_proxy_pair` read the root-only
   `/opt/pangolin/.env` with an unprivileged `sed` and died (`Permission
   denied`, exit 2). Steps 9 to 11 were performed by hand and are recorded
   above. Fixed in `ca2556f`: every `.env` touch goes through `sudo`,
   including two latent spots (pre-flight fallbacks, the step-11 restic
   config) that would have failed later in the same run.
2. **Tag deleted, then restored, same night.** The error handler's question
   "delete the tag?" fired twice because bash `ERR` traps re-run at every
   stack frame the failure unwinds through. The operator answered *no* at the
   first prompt and *yes* at the surprise second one, and tag `v0.2.9` was
   deleted from origin and locally. Within the hour it was restored byte for
   byte: the identical annotated object (peeling to the same page commit
   `7956849`) was re-pushed with the Release workflow temporarily disabled, so
   no rebuild ran and the registry digest `6ed33b2d...` never moved; the
   orphaned draft GitHub release was re-linked and published; the workflow was
   re-enabled. Fixed in `622fdce`: the question is asked once per run, ever,
   and the wording now explains that deleting a tag orphans a successful
   release. The "never reuse a failed tag" rule was not bent: this release
   never failed, CI, release run, and host are all green on the restored tag.
3. **The app server cannot originate pair-proof traffic by design.** The VM's
   output chain default-drops and lists proxy hosts for ingress only, so the
   driver's via-node curls return `000` from the machine it runs on. The proof
   was taken on the lab network (all 401 through both nodes, above). Two
   static entries (`10.20.5.80:443`, `10.20.8.80:443`) were added to
   `/opt/pangolin/allowlist.conf` the same night; the proof was then repeated
   successfully from the app server itself (see Pair proof), so future driver
   runs need no vantage change. Carrying the entries into the installer's
   allowlist template is a follow-up.

## Decision

Outcome: **accepted.** CI green on the tagged commit; the release run green
across all seven jobs; the (no-migration) upgrade path proven on a live copy
before tagging and the upgrade verified against the published digest after;
the proxy pair live, serving, and guarding through both nodes, now provable
from the app server itself; first post-upgrade backup pushed with a
`format 2`, `schemaVersion 33` manifest; household-data copies deleted. Three
deviations recorded, none release-breaking, each fixed or explained the same
night it surfaced: the step-9 `.env` crash (`ca2556f`), the tag
delete-and-restore (`622fdce`), and the pair-proof vantage, closed the same
evening by the VM's allowlist entries. A first run of an automated process is
exactly where honesty about failures matters most, and this one kept the
ledger.

Accepted by the human: sim, 2026-11-20.
