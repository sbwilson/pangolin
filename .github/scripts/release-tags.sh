#!/bin/sh
# Usage: release-tags.sh <tag>
# Prints the image tags the release workflow's publish job pushes for <tag>, one per line, so
# releases only move forward: always <tag> itself; vX.Y only when <tag> is the highest vX.Y.Z
# in its line; latest only when it is the highest vX.Y.Z of all. A pre-release (v1.3.0-rc1)
# gets only its own tag. Exits 1 when <tag> is not one of the repository's v*.*.* tags.
# Run from inside the repository, with every tag fetched (release.yml: publish).
set -eu

[ $# -eq 1 ] || { echo "Usage: release-tags.sh <tag>" >&2; exit 2; }
current=$1
git tag -l 'v*.*.*' | grep -qxF "$current" || {
  echo "::error::Tag $current is not in the repository's v*.*.* tags" >&2
  exit 1
}
echo "$current"
# A pre-release moves nothing else.
printf '%s\n' "$current" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$' || exit 0

# The highest strict vX.Y.Z among the tags matching $1 (a git pattern).
highest() {
  git tag -l "$1" --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1
}
line=${current%.*}
if [ "$(highest "$line.*")" = "$current" ]; then echo "$line"; fi
if [ "$(highest 'v*.*.*')" = "$current" ]; then echo latest; fi
