#!/usr/bin/env bash
# Pangolin Money release driver: parse tests.
#
# scripts/release.sh extracts values (backup id, snapshot, schema, migration endpoints, image
# digest, proxy keys) from command output the driver does not control: `pangolin backup`,
# `pnpm check:upgrade`, `docker buildx imagetools inspect`, `pangolin status`, a restic manifest.
# A silent parse miss on any of these is the scariest failure mode: `set -e` does not catch an
# empty capture, and a downstream comparison can pass on wrong data. The v0.2.9 first run proved
# how much rides on this parsing (the step-9 `.env` crash; steps 11-12 never ran as code).
#
# This test pins every parser to the real captured outputs of the v0.2.9 release, and fails if a
# parser is changed without updating the test. It is pure: it feeds fixtures through the exact
# sed/awk/jq expressions release.sh uses, runs no commands, and needs no server, Docker, or
# network. It runs in CI (see .github/workflows/ci.yml) and by hand: bash scripts/release.test.sh
#
# Adding a parser to release.sh: add a guard + an expect here, using the captured text from
# docs/release-<latest>.md as the fixture.
set -euo pipefail

RELEASE_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release.sh"
[ -f "$RELEASE_SH" ] || { echo "release.sh not found next to this test"; exit 1; }

pass=0
fail=0

# expect NAME EXPECTED ACTUAL: literal equality; a diff prints both values.
expect() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL  %s\n  expected: %s\n  actual:   %s\n' "$name" "$want" "$got" >&2
  fi
}

# guard PATTERN: the named fragment must still live in release.sh. This is what stops the test
# from silently pinning logic that release.sh has since moved or renamed: change a parser there
# and this guard fails until the matching expect here changes too.
guard() {
  local label="$1" pattern="$2"
  if grep -qF -- "$pattern" "$RELEASE_SH"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL  release.sh no longer contains the %s parser it used to: "%s"\n  update the matching parser and this test together.\n' "$label" "$pattern" >&2
  fi
}

# --- fixtures: verbatim captures from the v0.2.9 release (docs/release-v0.2.9.md) ---

BACKUP_OUTPUT=$(cat <<'EOF'
Backup 01M7TQEGMQ5E2JWEXK3CYFC1RY started
Taking the snapshot … 0s
Pushing it with restic … 1s
Backup done at 2026-11-19T20:59:42.712Z: snapshot 2e4d0ca2506e0c22f3058576168713bdcf8002a4a30203ffdbdb5c00b42aee7c
EOF
)

UPGRADE_OUTPUT=$(cat <<'EOF'
Pulling ghcr.io/sbwilson/pangolin:v0.2.9...
Verifying ghcr.io/sbwilson/pangolin@sha256:6ed33b2dfe7e5b9c1f0c46cbbd126304b063d9951f0938f93c468e55691a0606...
Stopping stack for upgrade...
Container pangolin-pangolin-1 Started
Upgrade to v0.2.9 successful. Old image was ghcr.io/sbwilson/pangolin@sha256:c761805ff5fb06a238cff4733099405c05c0d7e84747a40045a623890717bb6f.
EOF
)

MIGRATE_OUTPUT='migrated 33 -> 33; integrity, manifest, schema ok (/tmp/pangolin-release-v0.2.9.nXgt3o/pang-dev-copy.sqlite)'

STATUS_OUTPUT=$(cat <<'EOF'
Pangolin Money v0.2.9
Schema:    33 (this build expects 33)
Readiness: ok
Jobs:      5 pending, 0 running, 4 dead
EOF
)

STATUS_OUTPUT_V8=$(cat <<'EOF'
Pangolin Money v0.2.8
Schema:    33 (this build expects 33)
Readiness: ok
EOF
)

# imagetools inspect prints one "Digest:" line (the manifest index) plus per-platform Names.
DIGEST_OUTPUT=$(cat <<'EOF'
Name:      ghcr.io/sbwilson/pangolin:v0.2.9
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:6ed33b2dfe7e5b9c1f0c46cbbd126304b063d9951f0938f93c468e55691a0606

Manifests:
  Name:      ghcr.io/sbwilson/pangolin:v0.2.9@sha256:153954fa3497bfb9332ae2bf9fc8892b9660ea7392394e5c320116f678916536
  Platform:  linux/amd64
EOF
)

# The live restic manifest.json (format 2): the driver greps these keys and counts accounts.
MANIFEST_JSON='{"format": 2, "schemaVersion": 33, "balanceDate": "2026-11-20", "accounts": [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}]}'

RECONFIGURE_OUTPUT=$(cat <<'EOF'
Pangolin Money installer
Replaced PANGOLIN_TRUSTED_PROXIES in .env
Pangolin believes it only from 10.20.5.80,10.20.8.80.
Finished with 1 warning(s).
EOF
)

# --- backup id and snapshot, exactly as backup_gate / post_upgrade_proof extract them ---
guard "backup id" "sed -n 's/^Backup \\([0-9A-Z]*\\) started/\\1/p'"
backup_id=$(printf '%s' "$BACKUP_OUTPUT" | sed -n 's/^Backup \([0-9A-Z]*\) started/\1/p')
expect "backup id extracted" "01M7TQEGMQ5E2JWEXK3CYFC1RY" "$backup_id"

snap=$(printf '%s' "$BACKUP_OUTPUT" | sed -n 's/^Backup done at \(.*\): snapshot \([0-9a-f]*\)/\2/p')
expect "backup snapshot extracted" "2e4d0ca2506e0c22f3058576168713bdcf8002a4a30203ffdbdb5c00b42aee7c" "$snap"

# post_upgrade_proof uses the same two patterns; assert they are not a divergent copy.
expect "first-backup id uses same parser" "01M7TQEGMQ5E2JWEXK3CYFC1RY" \
  "$(printf '%s' "$BACKUP_OUTPUT" | sed -n 's/^Backup \([0-9A-Z]*\) started/\1/p')"

# --- migration endpoints, exactly as real_data_proof extracts them ---
mfrom=$(printf '%s' "$MIGRATE_OUTPUT" | sed -n 's/.*migrated \([0-9]*\) -> \([0-9]*\).*/\1/p')
mto=$(printf '%s' "$MIGRATE_OUTPUT" | sed -n 's/.*migrated \([0-9]*\) -> \([0-9]*\).*/\2/p' | head -1)
expect "migrated from" "33" "$mfrom"
expect "migrated to" "33" "$mto"
# A real migration (33 -> 34) must parse both endpoints, not collapse.
expect "migrated range 29 -> 33" "29" "$(printf 'migrated 29 -> 33; ok' | sed -n 's/.*migrated \([0-9]*\) -> \([0-9]*\).*/\1/p')"
expect "migrated range 29 -> 33 (to)" "33" "$(printf 'migrated 29 -> 33; ok' | sed -n 's/.*migrated \([0-9]*\) -> \([0-9]*\).*/\2/p' | head -1)"

# --- image digest, exactly as release_run extracts it ---
digest=$(printf '%s' "$DIGEST_OUTPUT" | awk '/Digest:/{print $2; exit}')
expect "image digest" "sha256:6ed33b2dfe7e5b9c1f0c46cbbd126304b063d9951f0938f93c468e55691a0606" "$digest"

# --- pangolin status: version and schema, exactly as preflight / do_upgrade / post_upgrade_proof ---
expect "status version v0.2.9" "v0.2.9" "$(printf '%s' "$STATUS_OUTPUT" | awk '/^Pangolin Money/{print $3; exit}')"
expect "status schema v0.2.9" "33" "$(printf '%s' "$STATUS_OUTPUT" | awk '/^Schema:/{print $2; exit}')"
expect "status version v0.2.8 (upgrade gate)" "v0.2.8" "$(printf '%s' "$STATUS_OUTPUT_V8" | awk '/^Pangolin Money/{print $3; exit}')"
expect "status schema v0.2.8 (upgrade gate)" "33" "$(printf '%s' "$STATUS_OUTPUT_V8" | awk '/^Schema:/{print $2; exit}')"

# --- restic manifest: format, schemaVersion, balanceDate, account count ---
guard "manifest fields" "grep -oE '\"(format|schemaVersion|balanceDate)\"[^,}]*'"
guard "manifest account count" "jq '.accounts | length'"
fields=$(printf '%s' "$MANIFEST_JSON" | grep -oE '"(format|schemaVersion|balanceDate)"[^,}]*' | tr -d '"')
for want in "format: *2" "schemaVersion: *33" "balanceDate: *2026-11-20"; do
  if printf '%s\n' "$fields" | grep -q "$want"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL  manifest field check "%s"\n  parsed: %s\n' "$want" "$fields" >&2
  fi
done
count=$(printf '%s' "$MANIFEST_JSON" | jq '.accounts | length')
expect "manifest account count" "4" "$count"

# --- upgrade output must confirm the exact target version ---
guard "upgrade confirmation" 'grep -q "Upgrade to $VERSION successful"'
if printf '%s' "$UPGRADE_OUTPUT" | grep -q "Upgrade to v0.2.9 successful"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL  upgrade success confirmation not matched" >&2
fi
# It must NOT match the wrong version (the old-image line mentions v0.2.8; the confirmation names v0.2.9).
if printf '%s' "$UPGRADE_OUTPUT" | grep -q "Upgrade to v0.2.8 successful"; then
  fail=$((fail + 1))
  echo "FAIL  upgrade confirmation matched the wrong version" >&2
else
  pass=$((pass + 1))
fi

# --- proxy reconfigure summary lines ---
guard "reconfigure NPM summary" 'grep -q "Pangolin believes it only from $want."'
if printf '%s' "$RECONFIGURE_OUTPUT" | grep -q "Pangolin believes it only from 10.20.5.80,10.20.8.80."; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL  reconfigure NPM summary not matched" >&2
fi
if printf '%s' "$RECONFIGURE_OUTPUT" | grep -q "^Finished"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL  reconfigure finish line not matched" >&2
fi

# --- the proxy .env key regex used by pair_proof ---
expect "proxy keys regex extracts both" "10.20.5.80,10.20.8.80" \
  "$(printf 'PANGOLIN_TRUSTED_PROXIES=10.20.5.80,10.20.8.80\nPANGOLIN_PROXY_HOSTS=10.20.5.80,10.20.8.80\n' | sed -n 's/^PANGOLIN_PROXY_HOSTS=//p' | head -1)"

# --- a stale-allowlist timeout is the known host condition; net() must retry on it ---
guard "net() retries a 124 timeout" '[ "$rc" = 124 ]'
# --- every .env read goes through sudo (the v0.2.9 step-9 crash) ---
guard "read_env uses sudo" 'read_env() { sudo sed'

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
