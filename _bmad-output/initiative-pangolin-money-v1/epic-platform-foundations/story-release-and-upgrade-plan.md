---
title: 'Release and upgrade'
type: 'feature'
ticket: '11'
created: '2026-09-27'
status: 'ready-for-dev'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
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

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: pass, including the upgrade wrapper tests
- `shellcheck -S warning deploy/pangolin deploy/*.sh` -- expected: clean
- CI -- expected: the upgrade and forced-failure rollback steps pass
