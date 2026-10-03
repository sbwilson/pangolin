---
title: 'Releases only move forward'
type: 'bugfix'
ticket: '6'
created: '2026-10-03'
status: 'built'
baseline_revision: '7078a5d1aaa75be5ca3d208898da2666560a4550'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The release workflow's `publish` job always moves `latest` and `vX.Y` to the tag being released. A patch on an older line (`v1.1.5` after `v1.2.0`) moves `latest` backwards, and two tags pushed close together can publish in either order (deferred from story 1.18).

**Approach:** Release runs share one concurrency group and never cancel each other. A script decides which tags `publish` pushes: always the version tag; `vX.Y` only when the tag is the highest `vX.Y.Z` in its line; `latest` only when it is the highest `vX.Y.Z` of all. A pre-release tag (`v1.3.0-rc1`) pushes only itself.

</frozen-after-approval>

## Implementation Notes

The change is a script, two workflow edits and tests, so it is built on the oneshot route.

- `.github/scripts/release-tags.sh` (new): prints the tags to push for a release tag: always the tag; `vX.Y` when it is the highest strict `vX.Y.Z` in its line; `latest` when it is the highest of all; a pre-release gets only its own tag.
- `.github/workflows/release.yml`: workflow-level `concurrency: { group: release, cancel-in-progress: false }`; `publish` checks out every tag and tags from the script's list. Beyond the plan's wording, the GitHub release's "Latest" badge now follows the same rule (`make_latest`), and a pre-release is marked `prerelease`, since action-gh-release otherwise marks every release Latest.
- Tests: `deploy/release-scripts.test.ts` (newest, older line, older patch in its line, version order, pre-release, errors); `deploy/release-workflow.test.ts` (concurrency, fetch-depth, script use, no hard-coded latest, badge inputs).
- `docs/install.md` §11: the tag rules.

## Review Triage Log

Quick review: high 0, medium 2, low 2, false 0.

- medium, patched: a failing `release-tags.sh` inside `for tag in $(...)` did not fail the step (bash ignores the status of a for-list substitution); the output is now captured first and an empty list fails the step; the workflow test pins it.
- medium, patched (docs and comment): GitHub keeps one waiting run per concurrency group, so a third tag pushed meanwhile cancels the waiting one even with `cancel-in-progress: false`. No setting avoids it; the comment and §11 now say so and that the cancelled tag must be pushed again.
- low, patched (docs): `vX.Y` and `latest` are decided from git tags, so a release published while a higher failed tag still exists does not move them; §11 says to delete failed tags first and how to move them by hand.
- low, patched: the comment claimed tags publish in push order; GitHub does not promise it, and the result does not depend on it.
