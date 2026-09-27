---
title: 'Release and upgrade'
type: 'feature'
ticket: '11'
created: '2026-09-27'
status: 'draft'
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

**Approach:** A tagged release builds amd64 and arm64 images, scans them, and only then pushes them to GHCR, signs them with cosign and publishes an SBOM. `pangolin upgrade <tag>` verifies the signature, takes a pre-upgrade snapshot on the stopped stack, starts the new image (which migrates), waits for `/healthz`, and on failure restores the snapshot and the previous image automatically. Renovate keeps dependencies current.

## Boundaries & Constraints

**Always:**
- The release publishes nothing unless CI is green on the tag and the scan passes (critical, fixed-only, as CI today): build → scan → push → sign → attest SBOM → GitHub release.
- The upgrade verifies the signature before pulling, and `.env` pins the verified image by digest (`image@sha256:…`); the previous reference is kept for rollback.
- Rollback restores the pre-upgrade snapshot before the previous image starts (the old build refuses a newer schema; there are no down-migrations).
- The upgrade refreshes `compose.yaml` and `/usr/local/bin/pangolin` from the new image, and puts the previous ones back on rollback.
- A failed upgrade raises a household review item and exits non-zero with the reason.

**Never:**
- No down-migrations; no rollback that starts an old image on a migrated database.
- No upgrade of a stack that is not healthy to begin with.
- No `latest`-following automatic updates on the server.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upgrade | `pangolin upgrade v1.2.0`, healthy stack | verified, snapshot, started, healthy; `.env` pinned by digest; prints old → new | — |
| Bad signature | unsigned or foreign-signed image | refuses before pulling; nothing changes | exit 1 |
| Health fails | new image never healthy | snapshot restored, previous image and files back, healthy again; review item | exit 1, names the failing check |
| Rollback fails | previous image also unhealthy | stops, prints where the snapshot and previous files are | exit 1 |
| Already on tag | same digest | "already on v1.2.0", nothing done | — |
| Release, scan fails | critical fixed vulnerability | nothing pushed or signed | workflow fails |

</frozen-after-approval>

## Code Map

- `.github/workflows/release.yml` -- exists since the first commit, never run (no tags): pushes, signs, *then* scans; uses `github.repository` unlowercased; SBOM only as a BuildKit attestation; no wait for CI. `.github/workflows/ci.yml` -- no tag trigger.
- `Dockerfile` -- stages `build` / `restic` (per-`TARGETARCH` checksums) / `runtime`; arm64 build runs under QEMU (better-sqlite3 ships arm64 prebuilds; the build stage can use `--platform=$BUILDPLATFORM`).
- `packages/db/src/migrate.ts:97-161` -- forward-only, one transaction per migration; a newer database makes the server refuse to start.
- `apps/server/src/backup/{snapshot,restore}.ts` -- `takeSnapshot({dbFile,outDir})` (no restic), `verifyFetched`, `swapIn`/`undo`; `apps/server/src/admin/restore.ts` `afterSwap` migrates/cancels/records (not wanted for rollback). A local snapshot/restore variant goes beside it.
- `deploy/pangolin` -- `restore` branch (argument checks, INT/TERM trap, stop → one-off run → start) is the model for `upgrade`.
- `deploy/install.sh` -- `wait_healthy` (:1223), `ghcr_login` (:959), `locate_support`/`write_files` (compose.yaml and wrapper from `/app/deploy`), `DEFAULT_IMAGE` (:39).
- `deploy/allowlist.conf.default` -- has `ghcr.io`, `pkg-containers.githubusercontent.com`; no sigstore hosts.
- `packages/app/src/system/review-items.ts` -- `defineReviewKind`; no `upgrade` kind yet.
- `deploy/install.test.ts` -- stub docker (`wrapper(...)`, `docker.log` sequences) for the upgrade tests.

## Open Questions

1. **Signing.** (a) A cosign key pair: the private key is a GitHub secret, the public key ships in the repo and image; the VM verifies offline, with no new firewall hosts and nothing about the private repo in a public log. (b) Keyless (what release.yml does now): no key to guard, but each release is recorded in the public Rekor log naming the repo and workflow, and the VM must reach sigstore hosts (`tuf-repo-cdn.sigstore.dev`, `rekor.sigstore.dev`). *Recommend (a).*
2. **cosign on the VM.** (a) Run the pinned `ghcr.io/sigstore/cosign` image (already-allowed hosts). (b) Install a pinned, checksum-checked binary from GitHub. *Recommend (a).*
3. **Pre-upgrade snapshot.** (a) Local only, `VACUUM INTO` on the stopped stack under the lock, kept in `/data/pre-upgrade-<stamp>/` (the last two kept). (b) Also push it with restic. *Recommend (a)*; nightly backups already cover off-site.
4. **Forcing the health check to fail in the test.** (a) A build argument only CI sets (`PANGOLIN_TEST_FORCE_UNHEALTHY`), baked into a test image; release images never have it. (b) A CI-only image with an extra migration that fails. *Recommend (a)*, plus a real migration in the test image so rollback is shown to undo a schema change.
5. **Renovate.** It needs the Renovate GitHub app installed on the repo (your step). Target `develop` (there is no `main`), weekly, 7-day minimum release age, no TypeScript major jump, a regex manager for the restic version and checksums. Agree?
6. **Scope.** About 1,900 plan tokens with three pieces. (a) Keep all three. (b) Split Renovate into its own small story. *Recommend (a)*: Renovate is one config file.

## Tasks & Acceptance

**Execution:** (filled in after the questions are answered)

**Acceptance Criteria:**
- Given a `v*` tag with green CI, when the release runs, then signed amd64 and arm64 images and an SBOM are in GHCR and the scan ran before the push.
- Given the VM on release A, when `pangolin upgrade B` runs, then it verifies, snapshots, migrates and reports healthy on B, with `.env` pinned to B's digest.
- Given an image whose health check is forced to fail, when upgrading to it, then the VM is back on the previous image and snapshot, healthy, and a review item says the upgrade failed.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: pass, including upgrade wrapper tests
- CI -- expected: an upgrade and a forced-failure rollback between two locally built images pass
