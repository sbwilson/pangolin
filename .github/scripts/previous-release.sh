#!/bin/sh
# Usage: previous-release.sh <tag>
# Prints the release tag (strictly vX.Y.Z: pre-release tags such as v1.2.0-rc1 are never picked)
# just below <tag> in version order, or nothing when there is none. <tag> may itself be a
# pre-release (v1.3.0-rc1 sorts below v1.3.0), so a release candidate migrates from the last
# release too. Exits 1 when <tag> is not one of the repository's v*.*.* tags.
# Run from inside the repository, with every tag fetched (release.yml: migrate-previous).
set -eu

[ $# -eq 1 ] || { echo "Usage: previous-release.sh <tag>" >&2; exit 2; }
current=$1
found=false
prev=""
# versionsort.suffix=- sorts a pre-release below its release.
for tag in $(git -c versionsort.suffix=- tag -l 'v*.*.*' --sort=-v:refname); do
  if [ "$found" = true ]; then
    if printf '%s\n' "$tag" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
      prev=$tag
      break
    fi
    continue
  fi
  if [ "$tag" = "$current" ]; then found=true; fi
done
if [ "$found" != true ]; then
  echo "::error::Tag $current is not in the repository's v*.*.* tags" >&2
  exit 1
fi
if [ -n "$prev" ]; then echo "$prev"; fi
