---
title: 'Re-run takes its files from the pinned image'
type: 'bugfix'
ticket: '9'
created: '2026-10-03'
status: 'built'
baseline_revision: 'ed3d69aea47eeb3b3293abf5ae5ae95f8c4aa0e6'
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

**Problem:** A re-run of `install.sh` from a checkout (or the `--build` clone) copies its own `compose.yaml` and `pangolin` command over the ones a later `pangolin upgrade` installed from the new image, while `.env` keeps that image's digest, so the files no longer match the image that runs (spike 11.2, seam S11e).

**Approach:** When `.env` pins the image by digest (only `pangolin upgrade` writes one) and this run does not replace the image (no `--image`, no `--build`), take `compose.yaml` and the `pangolin` command from that image's `/app/deploy`, as a lone script already does. Everything else still comes from the checkout. If the image cannot be read, warn and use the checkout's files.

</frozen-after-approval>

## Implementation Notes

A new step and two file sources in `deploy/install.sh` plus tests: built on the oneshot route.

- `deploy/install.sh`: new `take_pinned_files` after `locate_support`; when the settled `IMAGE` contains `@sha256:`, `ARG_IMAGE` is empty, `BUILD=0` and Docker is in use, it copies the image's `/app/deploy` to `$WORK/pinned` and sets `PINNED`. `write_files` takes `compose.yaml`, and the `pangolin` command when the image has one, from `PINNED`; everything else from the checkout. A failing `docker create` or a missing `/app/deploy` warns and keeps the checkout's files. A lone script already takes everything from the image and is skipped.
- `deploy/install.test.ts`: S11e turned on (plus the message); a tag-pinned re-run and a `--no-docker` digest-pinned re-run keep the checkout's files.
- `docs/install.md`: "Re-running".

## Review Triage Log

Quick review: high 0, medium 1, low 3, false 0.

- medium, patched: the guard checked `--no-docker` but not `--root` staging, so a staged re-run could call the host's real Docker; it now uses `run_stack`, as the neighbouring steps do.
- low, patched: the fallback test ran with `--no-docker` and so never reached the warning or the digest check; it now uses the Docker stub, with a failing `docker create`, and checks the warning and that a tag-pinned run makes no `create`.
- low, patched: one warning covered every `docker cp` failure as "has no /app/deploy"; a failed copy and a missing `compose.yaml` now say so separately, and `docker cp`'s own error is no longer hidden.
- low, patched: a test title promised a warning it did not check (split into two tests).
