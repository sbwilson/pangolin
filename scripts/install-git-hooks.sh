#!/bin/sh
# Points this clone's git at the tracked hooks in .githooks (core.hooksPath).
#
# core.hooksPath is per-clone config that `git clone` does not carry, so this runs
# from `pnpm install` (the root `prepare` script) and from the Claude Code
# SessionStart hook. Idempotent. A no-op outside a git work tree (Docker builds,
# tarball installs), so it never breaks an install. The `prepare` script also
# skips when this file is absent: the Docker build installs before copying scripts/.
set -eu

command -v git >/dev/null 2>&1 || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -d "$root/.githooks" ] || exit 0

chmod +x "$root"/.githooks/* 2>/dev/null || true

if [ "$(git -C "$root" config --local --get core.hooksPath 2>/dev/null || true)" != ".githooks" ]; then
  git -C "$root" config --local core.hooksPath .githooks
  echo "git hooks: core.hooksPath set to .githooks"
fi
