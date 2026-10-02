#!/bin/sh
# Usage: previous-release.sh <tag>
# Prints the release tag (strictly vX.Y.Z: pre-release tags such as v1.2.0-rc1 are skipped) just
# below <tag> in version order, or nothing when <tag> is the first release. Exits 1 when <tag> is
# not one of the repository's vX.Y.Z tags.
# Run from inside the repository, with every tag fetched (release.yml: migrate-previous).
set -eu

[ $# -eq 1 ] || { echo "Usage: previous-release.sh <tag>" >&2; exit 2; }
current=$1
found=false
prev=""
for tag in $(git tag -l 'v*.*.*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true); do
  if [ "$found" = true ]; then
    prev=$tag
    break
  fi
  if [ "$tag" = "$current" ]; then found=true; fi
done
if [ "$found" != true ]; then
  echo "::error::Tag $current is not in the repository's vX.Y.Z tags" >&2
  exit 1
fi
if [ -n "$prev" ]; then echo "$prev"; fi
