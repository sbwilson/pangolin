---
title: 'Release and upgrade'
type: 'feature'
ticket: '11'
created: '2026-09-27'
status: 'built'
baseline_revision: '3cbcae634064c8efbab777d8f56020b4a48d61a8'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/deployment-and-ops.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There has never been a release: the VM builds its own image, nothing is signed, and there is no safe way to move the server to a new version or back.

**Approach:** A `v*` tag with green CI builds amd64 and arm64 images, scans them, and only then tags them in GHCR, signs them with cosign and attaches an SBOM. `pangolin upgrade <tag>` verifies the signature, copies the database on the stopped stack, starts the new image (which migrates), waits for health, and on failure puts the copy and the previous image back automatically. Renovate keeps dependencies current.

**Decisions:**
- Signing uses a cosign key pair: the private key and its password are GitHub secrets; the public key ships in the repo and image (`deploy/cosign.pub`). Nothing goes to the public transparency log; the VM verifies offline.
- The VM runs cosign from its pinned `ghcr.io/sigstore/cosign` image (already-allowed hosts).
- The pre-upgrade copy is local only, taken while the stack is stopped, in the data root as `pre-upgrade-<stamp>/`; the last two are kept.
- The forced-failure test uses a CI-only build argument (`PANGOLIN_TEST_FORCE_UNHEALTHY`) that release images never set; the test image also carries one extra migration, so rollback is shown to undo a schema change.
- Renovate targets `develop`, weekly, 7-day minimum release age, no TypeScript major jump, and one regex manager for the restic version with its checksums. Installing the Renovate app is the owner's step.

## Boundaries & Constraints

**Always:**
- Nothing is tagged, signed or released unless CI passed on the tag and the scan passed (critical, fixed-only, as CI today).
- The upgrade verifies before pulling and pins `.env` to the verified digest (`image@sha256:…`), recording the previous reference.
- Rollback restores the database copy before the previous image starts (an older build refuses a newer schema; there are no down-migrations), and restores the previous `compose.yaml`, `/usr/local/bin/pangolin` and `.env`.
- The upgrade refuses to start from an unhealthy stack, and it is version-independent: it works from today's images, which have no upgrade code inside.
- A failed upgrade leaves a marker the server turns into a household review item at its next start, and exits non-zero naming the failing step.

**Never:**
- No down-migrations; no automatic updates on the VM; no `latest`-following.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upgrade | `pangolin upgrade v1.2.0`, healthy | verified, copied, started, healthy; `.env` pinned by digest; prints old → new | — |
| Bad signature | unsigned or other key | refuses before pulling; nothing changes | exit 1 |
| Health fails | new image never healthy | copy restored, previous image, files and `.env` back, healthy; marker left | exit 1, names the failing check |
| Rollback fails | previous also unhealthy | stops; prints where the copy and previous files are | exit 1 |
| Already there | same digest | "already on v1.2.0" | — |
| Unhealthy start | stack not healthy | refuses, nothing changed | exit 1 |
| Scan fails | release with a fixable critical | nothing tagged or signed | workflow fails |

</frozen-after-approval>

## Code Map

- `.github/workflows/release.yml` -- exists, never run: pushes and signs before scanning; keyless signing; SBOM only a BuildKit attestation; no wait for CI; `github.repository` not lowercased. `.github/workflows/ci.yml` -- no tag trigger; make it callable (`workflow_call`) so the release `needs` it.
- `Dockerfile` -- `build` / `restic` / `runtime` stages; use `--platform=$BUILDPLATFORM` for the build stage (better-sqlite3 ships arm64 prebuilds) to avoid QEMU; add `ARG PANGOLIN_TEST_FORCE_UNHEALTHY` → env.
- `packages/app/src/system/readiness.ts` (`READINESS_CHECKS`) -- the forced-failure check; `review-items.ts` `defineReviewKind` -- add `system.upgrade-failed` (household), raised at boot from the marker file.
- `packages/db/src/migrate.ts:97-161` -- forward-only, per-migration transactions; newer schema refuses start.
- `deploy/pangolin` -- `restore` branch (argument checks, INT/TERM trap, stop/run/start) is the model for `upgrade`.
- `deploy/install.sh` -- `wait_healthy` (:1223) logic to reuse, `ghcr_login` (:959) for private pulls and cosign's registry auth, `write_files` (compose.yaml + wrapper from `/app/deploy`), `DEFAULT_IMAGE` (:39).
- `deploy/install.test.ts` -- stub docker (`wrapper(...)`, `docker.log` sequences).

## Tasks & Acceptance

**Execution:**
- [ ] `.github/workflows/ci.yml`, `release.yml` -- release: CI via `workflow_call` → build both arches pushed by digest only → scan → tag (`X.Y.Z`, `X.Y`, `latest`) → `cosign sign --key` (no tlog) → SBOM (syft) attested with the key → GitHub release (install.sh, cosign.pub).
- [ ] `Dockerfile` -- `$BUILDPLATFORM` build stage; test build argument; `deploy/cosign.pub` ships in `/app/deploy`.
- [ ] `packages/app` + `apps/server` -- forced-unhealthy readiness check when the env is set; boot reads `<dataDir>/upgrade-failed.json`, raises the review item, removes the marker.
- [ ] `deploy/pangolin` `upgrade <tag>` -- healthy check; cosign verify (container, key, GHCR auth) → digest; pull by digest; stage new `compose.yaml`/wrapper from the image; stop; copy `pangolin.sqlite*` to `pre-upgrade-<stamp>/` (prune to two); pin `.env`; start; wait for health; on failure roll everything back, write the marker, start, wait.
- [ ] `deploy/install.sh`, `docs/install.md` -- install the public key; document upgrade, rollback and the release process (key generation, secrets, tagging).
- [ ] `renovate.json` -- per the decisions.
- [ ] Tests: wrapper upgrade paths with stub docker/cosign (success, bad signature, rollback, rollback failing, already there, unhealthy start); CI: local registry, a CI-generated key pair, images A, B and C (B + extra migration + forced unhealthy), upgrade A→B succeeds, B→C rolls back to B with B's schema.

**Acceptance Criteria:**
- Given a `v*` tag, when CI passes, then signed amd64 and arm64 images and an attested SBOM are in GHCR, and the scan ran before any tag.
- Given the VM on release A, when `pangolin upgrade B` runs, then it reports healthy on B with `.env` pinned to B's digest.
- Given an image forced unhealthy, when upgrading to it, then the VM is back on the previous image and database, healthy, and a review item says the upgrade failed.

## Implementation Notes

## Plan Change Log

## Review Triage Log

| # | Lens | Location | Claim | Verdict | Route | Evidence |
|---|------|----------|-------|---------|-------|----------|
| 1 | edge-case | `deploy/pangolin` rollback | `printf '{}' > "$HOME_DIR/upgrade-failed.json"` writes to host `/opt/pangolin`; server reads from `config.dataDir` = `/data` in container (the data volume) — different paths | **high** | patch | Verified: `server.ts:185` reads `join(config.dataDir, "upgrade-failed.json")`; script writes to `$HOME_DIR` which is the host dir, never mounted as `/data` inside the container |
| 2 | verification-gap | `deploy/pangolin.test.ts` | Docker stub doesn't handle `inspect --format '{{ range .Mounts }}...'` → `DATA_VOL` empty → `die` on every test | **high** | patch | Verified: stub only handles named inspect formats, not the Mounts range template; every test would exit 1 before any upgrade logic runs |
| 3 | blind-hunter | `deploy/pangolin` rollback | `cp -a /backup/pangolin.sqlite* /data/` doesn't delete WAL/SHM files created by the failed new version first — could corrupt restored database | **high** | patch | Verified: SQLite WAL files from a newer schema applied to the restored older `.sqlite` would replay forward, defeating rollback |
| 4 | blind-hunter | `apps/server/src/server.ts:185-195` | If `write()` throws (e.g. DB lock), startup aborts with marker still on disk → permanent crash loop | **medium** | patch | Verified: no try/catch around the write+rmSync block; a throw bubbles out of `startServer` |
| 5 | edge-case | `.github/workflows/release.yml` | CI test structure inverts the plan: plan requires A→B succeed (B healthy+migration) then B→C rollback (C forced-unhealthy); current test has B forced-unhealthy (A→B rollback) then A→C success | **medium** | patch | Verified against Tasks section: "upgrade A→B succeeds, B→C rolls back to B with B's schema" |
| 6 | edge-case | `renovate.json:11-23` | Regex manager only captures the restic version string; checksums in `Dockerfile`/`install.sh` are not updated when version bumps | **medium** | patch | Plan decision: "one regex manager for the restic version with its checksums"; no checksum matchStrings present |
| 7 | edge-case | `renovate.json:15-16` | `(?<currentValue>.*?)` non-greedy without terminator matches empty string | **medium** | patch | Verified: `.*?` matches empty; better pattern is `[^\s"]+` |
| 8 | verification-gap | `apps/server/src/server.ts:185-195` | No test verifies startup reads and deletes the marker and raises `system.upgrade-failed` review item | **medium** | patch | Verified: grep for `UPGRADE_FAILED_REVIEW` finds no test files; behavior completely unverified |
| 9 | verification-gap | `deploy/pangolin.test.ts` rollback test | Rollback test only checks stderr message; doesn't assert `.env`/`compose.yaml` contain pre-upgrade content | **medium** | patch | Verified: test at line ~553 only checks `stderr` contains rollback message |
| 10 | blind-hunter | `deploy/pangolin` | Digest extracted with `grep -o 'sha256:[a-f0-9]\{64\}'` — cosign output may include other SHA-256 hashes (signature, attestation) before the image digest | **medium** | patch | Real risk; cosign JSON output embeds the image digest in a structured field, not always the first SHA-256 |
| 11 | blind-hunter | `deploy/pangolin` rollback | If `compose stop` fails during rollback, `\|\| die` exits immediately, leaving new image in `.env`/`compose.yaml` with nothing restored | **medium** | patch | Verified: rollback path `compose stop ... \|\| die "could not stop stack during rollback"` exits before any restore |
| 12 | blind-hunter | `deploy/pangolin` health loop | Loop doesn't detect `unhealthy` or `exited` states — waits full 60s even when container immediately dies | **low** | patch | Trivial fix: check for `unhealthy`/`exited` to break early |
| 13 | verification-gap | `deploy/install.sh:1087` | `cosign.pub` copy not verified in `install.test.ts`; E2E test manually places the key | **low** | reject | Everyday use (fresh install) would hit this, but fix (update E2E to use `install.sh`) adds meaningful complexity beyond a direct correction |
| 14 | blind-hunter | `deploy/pangolin` | Health check timeout hardcoded at 60s; long migrations cause false-positive rollback | **low** | defer | Pre-existing design choice; 60s is reasonable for v1; can be made configurable later |
| 15 | blind-hunter | `packages/app/src/system/readiness.ts` | `PANGOLIN_TEST_FORCE_UNHEALTHY` test flag in production readiness code | **false** | reject | Plan decisions explicitly require this build arg: "release images never set" it |
| 16 | blind-hunter | `packages/app/src/system/review-items.ts` | No UI resolver for `system.upgrade-failed` | **false** | reject | Plan says "turns into a household review item" — generic review inbox display is sufficient; custom resolver not required |
| 17 | verification-gap | `apps/server/src/server.ts` | `existsSync`/`rmSync` imported directly, not injectable | **low** | reject | Cosmetic testability preference; no named caller will diverge from this |

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: pass, including the upgrade wrapper tests
- `shellcheck -S warning deploy/pangolin deploy/*.sh` -- expected: clean
- CI -- expected: the upgrade and forced-failure rollback steps pass
