---
title: 'Release hygiene'
type: 'chore'
ticket: '18'
created: '2026-10-03'
status: 'built'
baseline_revision: '3b3718f70db2ffd2df6e1cd02f04660cf5580fba'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `release.yml` pushes the version and `latest` tags before the image is signed. `upgrade-test` gates nothing, so a failed sign or a failed upgrade test still leaves a tagged release (retro R5). Nothing migrates a database made by the previous release, which the spine and the ops spec require (retro R3).

**Approach:** Split publishing out of `image`: build, scan, sign and attest by digest first, then a final job tags the image and creates the GitHub release only after `image`, `upgrade-test` and a new previous-release migration job all succeed. The new job boots the previous release's image to create a database, then migrates it with the current migrations and checks it with the backup snapshot checks: integrity, manifest and schema.

## Boundaries & Constraints

**Always:**
- No tag (`:vX.Y.Z`, `:vX.Y`, `:latest`) and no GitHub release unless signing, the SBOM attestation, `upgrade-test` and the migration job all succeeded.
- Sign and attest the digest exactly as today: same key and flags.
- The migration check uses the existing `migrate`, `writeSnapshot` and `verifySnapshot`.

**Never:**
- Change the upgrade test's own scenario, the cosign key handling, the build platforms or `deploy/pangolin`.
- Add down-migrations.
- Push anything from `ci.yml`.

**Decisions (human, 2026-10-03):** the previous-release migration runs at release only, not on every push. The previous release's database is the one its image creates on first boot, with no seeded household. The plan is kept whole although it is above the token target.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Good release | every job green | tags pushed from the signed digest, then the GitHub release | No error |
| Sign fails | no key, or `cosign sign` fails | no tag, no release | job fails |
| Upgrade test fails | `upgrade-test` red | no tag, no release; the digest stays untagged | publish job skipped |
| Previous DB migrates | previous tag's image boots, its DB migrates, checks pass | job green; prints the from and to schema versions | No error |
| Migration or check fails | `MigrationError`, or integrity, manifest or schema fails | job red, no tag | names the failing check |
| First release | no earlier `v*.*.*` tag | migration job passes with a notice that there is nothing to migrate | No error |
| Previous image missing | an earlier tag exists but its GHCR image cannot be pulled | job red | names the tag |

</frozen-after-approval>

## Code Map

- `.github/workflows/release.yml:12-82` `image` job:
  - Keep checkout, login, build by digest (L28, output `steps.build.outputs.digest`), scan (L38), key check (L53), sign (L59), SBOM (L64) and attest (L70).
  - Move "Tag the image" (L44) and the gh-release step (L76) to a new `publish` job with `needs: [image, upgrade-test, migrate-previous]`, `contents: write` and `packages: write`.
  - Expose `digest` and `repo` as job outputs. The L33 comment then becomes true.
- `.github/workflows/release.yml:85-184` `upgrade-test`: unchanged apart from being a `needs` of `publish`.
- New `release.yml` job `migrate-previous` (`needs: ci`, `packages: read`, checkout with `fetch-depth: 0`):
  - Find the previous tag: `git tag -l 'v*.*.*' --sort=-v:refname`, the first one below `github.ref_name`.
  - Pull `ghcr.io/<repo>:<prev>`, run it with a temporary data dir on `/data` (read-only root and tmpfs as in `deploy/compose.yaml`), wait for `/healthz`, stop it.
  - `sudo chown` the DB to the runner, then run the new script.
- `packages/db/src/cli/check-upgrade.ts` (new, modelled on `check-strict.ts`): given a DB path, run `migrate` with `defaultInvariants` (`foreign_key_check` and STRICT included), then `writeSnapshot` into a temp dir and `verifySnapshot` against `loadMigrations(packageMigrationsDir)`.
  - Print `migrated <from> -> <to>; integrity, manifest, schema ok`.
  - Exit 1 naming the failing check.
  - Add `"check:upgrade"` to `packages/db/package.json` and the root `package.json`.
- `packages/db/src/manifest.ts:215,294` `verifySnapshot`, `writeSnapshot`; `migrate.ts:141` `migrate`: reuse them, do not change them.
- `packages/db/src/cli/check-upgrade.test.ts` (new): a DB migrated only to an earlier prefix of the migrations upgrades and passes; a corrupt file and a DB newer than the build both fail with exit 1.
- `.github/release-order.test.ts` or `deploy/release-workflow.test.ts` (new): parse `release.yml` with `yaml` (add it as a root devDependency) and assert:
  - "Tag the image" and the gh-release step are only in `publish`;
  - `publish.needs` covers `image`, `upgrade-test` and `migrate-previous`;
  - in `image`, sign and attest come after build and scan;
  - no other job runs `imagetools create` or `docker push` of a tag.
- `docs/release.md` or the release section of `docs/install.md`, if one exists: describe the new order in one paragraph.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/cli/check-upgrade.ts` + test + package scripts -- migrate and run the snapshot checks
- [x] `.github/workflows/release.yml` -- `publish` job, `migrate-previous` job, digest outputs
- [x] workflow order test (+ `yaml` devDependency) -- the step-order proof the ticket asks for
- [x] docs -- the release order, if a release doc exists

**Acceptance Criteria:**
- Given `release.yml`, when the order test runs, then no step outside `publish` pushes a tag, and `publish` needs every gate.
- Given a database from an earlier schema, when `pnpm check:upgrade <db>` runs, then it migrates and reports integrity, manifest and schema ok.

## Implementation Notes
- Matrix audit (orchestrator): the first-release and missing-previous-image rows had no test. The previous-release steps moved to `.github/scripts/previous-release.sh` and `previous-db.sh`, tested in `deploy/release-scripts.test.ts` with stub docker/curl/sudo, and added to CI's shellcheck step.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 3, low 6, false 5, rejected low 4, deferred 2.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | A release that fails a gate leaves a git tag with no image. The next release picks it as previous and the pull fails every time. The matrix keeps the pull failure red, so the error and the docs now say to delete the failed tag first. |
| medium | patch (done) | Nothing asserted `migrate-previous` does its work: dropping `fetch-depth: 0` or the `check:upgrade` step passes silently with "nothing to migrate". Added a workflow test. |
| medium | patch (done) | `curl` in the health poll had no time limit, so a container that accepts but never answers hangs past `PANGOLIN_PREVIOUS_TIMEOUT`. |
| low | patch (done) | `v*.*.*` matches pre-release tags (`v1.2.0-rc1` sorts above `v1.2.0`). Only strict `vX.Y.Z` tags are used now. |
| low | patch (done) | `PANGOLIN_PREVIOUS_POLL=00` looped forever; `08` failed as octal. Leading zeros are rejected. |
| low | patch (done) | `previous-db.sh` had no cleanup: a mid-run failure left the container running, and a failed `docker stop` skipped the logs. |
| low | patch (done) | The DB path `pangolin.sqlite` was assumed; a missing file now gets its own error. |
| low | patch (done) | `check-upgrade` ignored extra arguments and reported an unopenable file as an integrity failure; the tests accepted either check name. |
| low | patch (done) | Docs step 3 still read as if tagging happened there; untagged digests from failed releases were not mentioned. |
| false | rejected | The previous image will not boot without the compose secrets and settings: the auth secret is created on first boot, the restic password is read only for backups, and the CI root stack boots with neither. |
| false | rejected | No seeded data, and release-only rather than every push: both human decisions of 2026-10-03. |
| false | rejected | The manifest check compares the snapshot with itself: the intent asks for the backup snapshot checks, which show a backup after the upgrade restores cleanly; it is not meant as a before-and-after data comparison. |
| false | rejected | Migrations run from source, not the released image: the image ships the same migration files, and `upgrade-test` boots images on older data. |
| false | rejected | The previous-release lookup takes the git tag, not the published release: covered by the failed-release patch above. |
| low | rejected | `INIT_CWD` left set by an outer pnpm script: unlikely, and the guard adds branches. |
| low | rejected | `pushesTag` flags local `docker tag` and misses `crane`/`skopeo`: no such steps exist; over-strict at worst. |
| low | rejected | The test exempts `upgrade-test` and cosign's `.sig`/`.att` pushes: by design; signatures sit on the digest. |
| low | rejected | Workflow outputs reaching `publish` are only guarded at run time: the guard fails the job loudly. |
| defer | defer | `latest` and `vX.Y` can move backwards for a patch on an older line, or two tags pushed together: the same before this change. |
| defer | defer | The ops spec and spine still say the previous-release migration runs on every push; the human chose release only. Reconcile the spec text. |

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean (apart from warnings that were already there)
- `pnpm test` -- expected: pass, apart from the macOS-only failures (GNU `sed`, `script`)
- `actionlint .github/workflows/release.yml`, if installed -- expected: clean

**Manual checks (if no CLI):**
- The first real tag after this lands: the release run shows `publish` waiting for all three jobs, and `migrate-previous` migrating from the prior tag.
