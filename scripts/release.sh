#!/usr/bin/env bash
# Pangolin Money release driver: one command, run on the app server, from a green develop to a
# tagged, published, upgraded, and documented release. It replays the v0.2.7/v0.2.8 checklist with
# machines where machines are safe and a human at the three risky doors: tagging, upgrading, and
# accepting. Everything it sees goes into docs/release-<version>.md, so the proof ships with the
# release instead of living in a terminal buffer.
#
# Usage: scripts/release.sh vX.Y.Z [options]        (run in the repo checkout on the app server)
#
#   --dry-run          run every read-only check, draft the page into the work dir, then stop
#   --branch NAME      development branch to release (default: develop)
#   --repo IMAGE       image repository (default: ghcr.io/sbwilson/pangolin)
#   --no-reconfigure   never run pangolin reconfigure, even when the proxy list differs
#   --timeout SECS     PANGOLIN_UPGRADE_TIMEOUT passed to the upgrade (default: 180)
#   --ci-timeout SECS  ceiling for waiting on CI and the release run (default: 2700)
#   --force-proxy      re-run pangolin reconfigure even when .env already matches
#
# Config: scripts/release.conf (or RELEASE_CONF=/path) supplies APP_HOST and PROXY_HOSTS;
# see scripts/release.conf.example. The script refuses to run anywhere that is not the app
# server, and never hand-edits .env: proxy changes go through pangolin reconfigure only.
#
# Hard rules, learned from v0.2.7 and v0.2.8 and not negotiable here:
#   - the tag goes on the exact commit printed after the page commit, never "whatever HEAD is";
#   - never tag while a CI run is in progress; never reuse a failed tag (delete remote and local);
#   - the real-data migration proof runs on a fresh .backup copy before the tag, copies and
#     sidecars are deleted the moment the evidence is recorded (they hold household data);
#   - a manual backup must succeed before the upgrade;
#   - the proxy host list reaches .env only via pangolin reconfigure, after the upgrade, because
#     the previous release's render.sh dies on a comma list;
#   - every network call runs under `timeout`, never to hang: on this host a timeout is usually a
#     CDN address rotating out of the egress allowlist between re-resolves, so one timeout pokes
#     pangolin-allowlist.service and retries once before failing.
set -euo pipefail

VERSION=""
BRANCH="develop"
IMAGE_REPO="ghcr.io/sbwilson/pangolin"
DRY=0
DO_RECONFIGURE=1
FORCE_PROXY=0
UPGRADE_TIMEOUT="${PANGOLIN_UPGRADE_TIMEOUT:-180}"
CI_TIMEOUT=2700
ENV_FILE="/opt/pangolin/.env"
DB_FILE="/srv/pangolin/pangolin.sqlite"
RESTIC_PASSWORD_FILE="/opt/pangolin/secrets/restic-password"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK=""
EVID=""
TAG_PUSHED=0
CLEAN_COPIES=()

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

confirm() {
  local reply
  printf '\n\033[1;32m%s [y/N] \033[0m' "$1"
  read -r reply
  case "$reply" in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}

# net TIMEOUT CMD... runs CMD under a hard timeout instead of trusting it to die. On this host a
# timeout usually means a CDN address rotated out of the egress allowlist between re-resolves
# (github and the docker registries move addresses; render.sh loads what DNS says every 15 min).
# When the allowlist unit exists, one timeout therefore pokes the re-resolver and retries once.
net() {
  local t="$1"
  shift
  local rc
  if timeout "$t" "$@"; then
    return 0
  else
    rc=$?
  fi
  if [ "$rc" = 124 ] && systemctl list-unit-files --no-legend --no-pager 'pangolin-allowlist.service' 2>/dev/null | grep -q .; then
    warn "timed out after ${t}s: $* (stale allowlist?)"
    warn "re-resolving the egress allowlist and retrying once"
    sudo systemctl restart pangolin-allowlist.service
    timeout "$t" "$@"
  else
    return "$rc"
  fi
}

# section NAME adds a captured block to the evidence file; stdin or args are the content.
section() {
  {
    printf '\n### %s\n\n```text\n' "$1"
    shift
    printf '%s\n' "$@"
    printf '```\n'
  } >>"$EVID"
}

# cap NAME CMD... runs CMD, tees combined output to the terminal and the evidence log, fails on
# nonzero exit. The captured text ends up in $CAP.
cap() {
  local name="$1"
  shift
  log "$name: $*"
  if CAP=$(
    "$@" 2>&1
  ); then
    printf '%s\n' "$CAP"
    section "$name" "$CAP"
    return 0
  else
    local rc=$?
    printf '%s\n' "$CAP" >&2
    section "$name (exit $rc)" "$CAP"
    return "$rc"
  fi
}

cleanup() {
  local f
  for f in "${CLEAN_COPIES[@]:-}"; do
    [ -n "$f" ] && rm -f "$f" "$f"-* 2>/dev/null
  done
  [ -n "$SUDO_KEEPALIVE_PID" ] && kill "$SUDO_KEEPALIVE_PID" 2>/dev/null
  return 0
}
SUDO_KEEPALIVE_PID=""
trap cleanup EXIT

on_error() {
  local rc=$?
  printf '\n\033[1;31mrelease failed (exit %s).\033[0m\n' "$rc" >&2
  if [ "$TAG_PUSHED" = 1 ] && [ "$DRY" = 0 ]; then
    echo "The tag $VERSION was already pushed. A failed tag must never be reused." >&2
    if confirm "Delete tag $VERSION from origin and locally so the next attempt starts clean?"; then
      net 120 git push --delete origin "$VERSION" || true
      git tag -d "$VERSION" || true
      echo "Tag deleted. Fix the cause, then re-run; never retag the same name." >&2
    else
      echo "Tag LEFT IN PLACE. Resolve it manually before anything else (step 13)." >&2
    fi
  fi
}
trap on_error ERR

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ---------- arguments ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --branch)
      BRANCH="$2"
      shift
      ;;
    --repo)
      IMAGE_REPO="$2"
      shift
      ;;
    --no-reconfigure) DO_RECONFIGURE=0 ;;
    --force-proxy) FORCE_PROXY=1 ;;
    --timeout)
      UPGRADE_TIMEOUT="$2"
      shift
      ;;
    --ci-timeout)
      CI_TIMEOUT="$2"
      shift
      ;;
    -h | --help) usage 0 ;;
    v[0-9]*) VERSION="$1" ;;
    *) usage 1 ;;
  esac
  shift
done

case "$VERSION" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) die "usage: scripts/release.sh vX.Y.Z [options] (see --help)" ;;
esac

cd "$REPO_DIR"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/pangolin-release-$VERSION.XXXXXX")
EVID="$WORK/evidence.md"
: >"$EVID"

# ---------- config ----------
CONF="${RELEASE_CONF:-$SCRIPT_DIR/release.conf}"
APP_HOST="${APP_HOST:-}"
PROXY_HOSTS="${PROXY_HOSTS:-}"
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF"
fi

# ---------- phase: pre-flight ----------
preflight() {
  log "pre-flight"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found: run this on the app server, not a laptop"
  [ -f "$DB_FILE" ] || die "$DB_FILE not found: is the data disk mounted?"
  local c
  for c in git gh docker sudo sqlite3 curl pnpm node jq grep awk sed timeout; do
    command -v "$c" >/dev/null || die "missing required command: $c"
  done
  net 30 gh auth status >/dev/null 2>&1 || die "gh is not authenticated"
  sudo -v
  (
    while true; do
      sudo -n true
      sleep 50
    done
  ) &
  SUDO_KEEPALIVE_PID=$!

  if [ -d "$VERSION" ] || git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null ||
    net 30 git ls-remote --exit-code --tags origin "$VERSION" >/dev/null 2>&1; then
    die "tag $VERSION already exists locally or on origin: never reuse a tag; bump the version"
  fi
  net 300 git fetch origin --quiet --tags
  [ -z "$(git status --porcelain)" ] || die "working tree is dirty; commit or stash first"
  local here
  here=$(git rev-parse --abbrev-ref HEAD)
  [ "$here" = "$BRANCH" ] || die "on branch $here, expected $BRANCH"
  local local_sha origin_sha
  local_sha=$(git rev-parse "$BRANCH")
  origin_sha=$(git rev-parse "origin/$BRANCH")
  [ "$local_sha" = "$origin_sha" ] || die "$BRANCH diverges from origin ($local_sha vs $origin_sha); reconcile first"

  [ -n "$APP_HOST" ] || APP_HOST=$(sed -n 's/^PANGOLIN_HOSTNAME=//p' "$ENV_FILE" | head -1)
  [ -n "$APP_HOST" ] || die "APP_HOST is unset: set it in $CONF (the public hostname, e.g. money.example.com)"
  [ -n "$PROXY_HOSTS" ] || PROXY_HOSTS=$(sed -n 's/^PANGOLIN_PROXY_HOSTS=//p' "$ENV_FILE" | head -1)
  [ -n "$PROXY_HOSTS" ] || die "PROXY_HOSTS is unset: set it in $CONF (comma-separated NPM addresses)"

  PREV=$(git describe --tags --abbrev=0 "$BRANCH" 2>/dev/null || true)
  [ -n "$PREV" ] || die "no previous tag found on $BRANCH"
  git merge-base --is-ancestor "$PREV" "$BRANCH" || die "$PREV is not an ancestor of $BRANCH"

  MIGRATIONS=$(ls packages/db/migrations/*.sql | wc -l | tr -d ' ')
  LIVE_SCHEMA=$(sudo pangolin status | awk '/^Schema:/{print $2; exit}')
  LIVE_VERSION=$(sudo pangolin status | awk '/^Pangolin Money/{print $3; exit}')
  [ -n "$LIVE_SCHEMA" ] || die "could not read the live schema from pangolin status"
  log "live: $LIVE_VERSION (schema $LIVE_SCHEMA); target: $VERSION (schema $MIGRATIONS, prev tag $PREV)"
  [ "$LIVE_SCHEMA" -le "$MIGRATIONS" ] ||
    die "live schema $LIVE_SCHEMA is ahead of the build's $MIGRATIONS migrations"

  section "Pre-flight" "live version: $LIVE_VERSION" "live schema: $LIVE_SCHEMA" \
    "target: $VERSION with $MIGRATIONS migrations" "previous tag: $PREV" \
    "branch: $BRANCH at $local_sha" "app host: $APP_HOST" "proxy hosts: $PROXY_HOSTS"
}

# ---------- phase: real-data migration proof (before the tag) ----------
real_data_proof() {
  log "real-data migration proof"
  local copy="$WORK/pang-dev-copy.sqlite"
  sudo sqlite3 -readonly "$DB_FILE" ".backup '$copy'"
  sudo chown "$(id -u):$(id -g)" "$copy"
  CLEAN_COPIES+=("$copy")
  cap "check:upgrade (fresh copy of the live database)" pnpm check:upgrade "$copy"
  local from to
  from=$(printf '%s' "$CAP" | sed -n 's/.*migrated \([0-9]*\) -> \([0-9]*\).*/\1/p')
  to=$(printf '%s' "$CAP" | sed -n 's/.*migrated \([0-9]*\) -> \([0-9]*\).*/\2/p' | head -1)
  [ -n "$from" ] && [ -n "$to" ] || die "check:upgrade did not report a migration"
  [ "$from" = "$LIVE_SCHEMA" ] ||
    die "copy migrated from $from but the live schema is $LIVE_SCHEMA: the copy is not fresh"
  [ "$to" = "$MIGRATIONS" ] || die "check:upgrade landed on $to, expected $MIGRATIONS"
  log "migration path proven on real data: $from -> $to"
}

# ---------- phase: draft and commit the page ----------
release_notes() {
  git log --no-merges --pretty=format:'- %s (`%h`)' "$PREV..$BRANCH"
}

draft_page() {
  log "drafting docs/release-$VERSION.md"
  local notes page
  notes=$(release_notes)
  page="# Release $VERSION

Generated by \`scripts/release.sh\` on $(date -u '+%Y-%m-%d %H:%M UTC'). The tag goes on this
page commit; the evidence below is completed by the close-out commit once the release run, the
upgrade, and the after-upgrade backup are recorded.

Previous release: \`$PREV\`. Schema $LIVE_SCHEMA to $MIGRATIONS ($MIGRATIONS migrations).

## Release notes (draft from \`git log $PREV..$BRANCH\`; edit before accepting)

$notes

## Evidence

Pending. This draft is replaced by the close-out run; nothing here is proof yet.
"
  if [ "$DRY" = 1 ]; then
    printf '%s' "$page" >"$WORK/release-$VERSION.md"
    log "dry run: page draft written to $WORK/release-$VERSION.md; stopping before any mutation"
    exit 0
  fi
  printf '%s' "$page" >"docs/release-$VERSION.md"
  git add "docs/release-$VERSION.md"
  git commit -q -m "docs(release): prepare $VERSION release checklist"
  PAGE_SHA=$(git rev-parse HEAD)
  local subject
  subject=$(git log -1 --format='%s')
  [ "$subject" = "docs(release): prepare $VERSION release checklist" ] ||
    die "page commit subject drifted: $subject"
  log "page commit: $PAGE_SHA"
}

# ---------- phase: push, wait for CI, tag ----------
wait_for_run() {
  # wait_for_run <selector-args...>: polls gh run list until the run completes; sets RUN_URL,
  # RUN_CONCLUSION. Selector must yield a single run.
  local deadline=$((SECONDS + CI_TIMEOUT))
  while :; do
    local json line
    json=$(net 60 gh run list --limit 1 --json databaseId,status,conclusion,url "$@" || true)
    line=$(printf '%s' "$json" | jq -r '.[0] | "\(.databaseId) \(.status) \(.conclusion) \(.url)"' 2>/dev/null || true)
    if [ -n "$line" ] && [ "$line" != "null null null null" ]; then
      local id status conclusion
      read -r id status conclusion RUN_URL <<<"$line"
      if [ "$status" = "completed" ]; then
        RUN_CONCLUSION="$conclusion"
        return 0
      fi
    fi
    [ "$SECONDS" -lt "$deadline" ] || die "timed out after ${CI_TIMEOUT}s waiting for a run"
    sleep 20
  done
}

push_tag_and_ci() {
  log "pushing $BRANCH and waiting for CI on $PAGE_SHA"
  net 600 git push origin "$BRANCH"
  wait_for_run --branch "$BRANCH" --event push --commit "$PAGE_SHA"
  section "CI on the page commit" "$RUN_URL -> $RUN_CONCLUSION"
  [ "$RUN_CONCLUSION" = "success" ] ||
    die "CI on the page commit: $RUN_CONCLUSION ($RUN_URL); fix and re-run, the tag was not pushed"
  confirm "CI is green on $PAGE_SHA. Create and push the annotated tag $VERSION?" ||
    die "tagging declined at the gate; the page commit stays on $BRANCH"
  git tag -a "$VERSION" -m "Release $VERSION" "$PAGE_SHA"
  net 300 git push origin "$VERSION"
  TAG_PUSHED=1
  section "Tag" "$(git tag -n99 "$VERSION")" "tag commit: $PAGE_SHA"
}

# ---------- phase: release run, digest, published ----------
release_run() {
  log "waiting for the release run on $VERSION"
  wait_for_run --workflow Release --branch "$VERSION"
  local jobs
  local id
  id=$(net 60 gh run list --workflow Release --branch "$VERSION" --limit 1 --json databaseId | jq -r '.[0].databaseId')
  jobs=$(net 60 gh run view "$id" --json conclusion,jobs --jq '.jobs[] | "\(.conclusion)\t\(.name)"')
  section "Release run $RUN_URL" "conclusion: $RUN_CONCLUSION" "$jobs"
  [ "$RUN_CONCLUSION" = "success" ] || {
    warn "release run failed; step 13 applies: the tag must be deleted before any retry"
    die "release run $RUN_CONCLUSION ($RUN_URL)"
  }
  cap "image digest" net 120 docker buildx imagetools inspect "$IMAGE_REPO:$VERSION"
  DIGEST=$(printf '%s' "$CAP" | awk '/Digest:/{print $2; exit}')
  [ -n "$DIGEST" ] || die "no digest found for $IMAGE_REPO:$VERSION"
  LATEST=$(net 60 gh api "repos/$(git remote get-url origin | sed -E 's#.*(github\.com[:/])##; s#\.git$##')/releases/latest" --jq .tag_name)
  section "Published release" "digest: $DIGEST" "latest release: $LATEST"
  [ "$LATEST" = "$VERSION" ] || warn "GitHub latest is $LATEST, not $VERSION"
}

# ---------- phase: manual backup gate ----------
backup_gate() {
  log "manual backup (gate for the upgrade)"
  cap "sudo pangolin backup (pre-upgrade)" sudo pangolin backup
  BACKUP_ID=$(printf '%s' "$CAP" | sed -n 's/^Backup \([0-9A-Z]*\) started/\1/p')
  SNAP=$(printf '%s' "$CAP" | sed -n 's/^Backup done at \(.*\): snapshot \([0-9a-f]*\)/\2/p')
  [ -n "$SNAP" ] || die "no snapshot id in the backup output; the upgrade gate does not open"
  section "Backup gate (pre-upgrade snapshot)" "backup id: $BACKUP_ID" "snapshot: $SNAP"
  log "backup gate passed: snapshot $SNAP"
}

# ---------- phase: upgrade ----------
do_upgrade() {
  log "checking the starting build before upgrading"
  local status now_version
  status=$(sudo pangolin status)
  now_version=$(printf '%s' "$status" | awk '/^Pangolin Money/{print $3; exit}')
  printf '%s\n' "$status" >"$WORK/pre-upgrade-status.txt"
  [ "$now_version" = "$LIVE_VERSION" ] ||
    die "starting build is $now_version, expected $LIVE_VERSION; the plan changed under us"
  section "Starting build (step 3)" "$status"
  confirm "Upgrade $APP_HOST from $LIVE_VERSION to $VERSION now (timeout ${UPGRADE_TIMEOUT}s)?" ||
    die "upgrade declined at the gate; tag $VERSION exists but the host was not touched"
  cap "pangolin upgrade" env PANGOLIN_UPGRADE_TIMEOUT="$UPGRADE_TIMEOUT" sudo pangolin upgrade "$VERSION"
  printf '%s\n' "$CAP" | grep -q "Upgrade to $VERSION successful" ||
    die "upgrade output did not confirm success"
  PRE_COPY=$(sudo ls -1 /srv/pangolin/upgrade-copies/ | grep "^pre-upgrade-" | tail -1)
  section "Pre-upgrade copy" "/srv/pangolin/upgrade-copies/$PRE_COPY"
}

# ---------- phase: proxy pair (reconfigure, only if needed) ----------
apply_proxy_pair() {
  local want="$PROXY_HOSTS" have=""
  have=$(sed -n 's/^PANGOLIN_PROXY_HOSTS=//p' "$ENV_FILE" | head -1)
  if [ "$have" = "$want" ] && [ "$FORCE_PROXY" = 0 ]; then
    log "proxy list already $want; skipping reconfigure"
    section "Proxy pair" "already applied ($want); reconfigure skipped"
    return 0
  fi
  if [ "$DO_RECONFIGURE" = 0 ]; then
    warn "--no-reconfigure set but .env has [$have] and config wants [$want]"
    section "Proxy pair" "NOT applied: config wants $want, .env has $have (--no-reconfigure)"
    return 0
  fi
  log "applying the proxy pair through pangolin reconfigure (the installer will ask its"
  log "questions; every answer is prefilled with the current value, accept the defaults)"
  confirm "Run: sudo pangolin reconfigure --proxy-host $want ?" ||
    die "reconfigure declined; the host keeps its current proxy list"
  cap "pangolin reconfigure" sudo pangolin reconfigure --proxy-host "$want"
  printf '%s\n' "$CAP" | grep -q "Pangolin believes it only from $want." ||
    warn "reconfigure output did not show the expected NPM summary line"
  printf '%s\n' "$CAP" | grep -q "^Finished" || die "reconfigure did not report a finish"
}

# ---------- phase: pair proof ----------
pair_proof() {
  log "waiting for $APP_HOST to answer"
  local ok=0
  for _ in $(seq 1 45); do
    if curl -m 10 -fsS "https://$APP_HOST/healthz" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 4
  done
  [ "$ok" = 1 ] || die "$APP_HOST did not pass /healthz within 180s"
  cap "healthz" curl -fsS "https://$APP_HOST/healthz"
  log "forecast routes must answer 401 anonymously, through each proxy node in turn"
  local r variant code line all_ok=1
  local -a variants=("direct")
  IFS=',' read -ra IPS <<<"$PROXY_HOSTS"
  variants+=("${IPS[@]}")
  for variant in "${variants[@]}"; do
    for r in forecast forecast-net-worth forecast-assumptions; do
      if [ "$variant" = "direct" ]; then
        code=$(curl -m 15 -s -o /dev/null -w '%{http_code}' "https://$APP_HOST/api/planning/$r" || echo err)
      else
        code=$(curl -m 15 -s -o /dev/null -w '%{http_code}' \
          --resolve "$APP_HOST:443:$variant" "https://$APP_HOST/api/planning/$r" || echo err)
      fi
      line="$r via $variant -> $code"
      printf '  %s\n' "$line"
      echo "$line" >>"$WORK/pair-proof.txt"
      [ "$code" = 401 ] || all_ok=0
    done
  done
  section "Pair proof (healthz, forecast routes via each node)" "$(cat "$WORK/pair-proof.txt")"
  [ "$all_ok" = 1 ] || die "a forecast route did not answer 401 through every node"
  cap "proxy keys in .env" grep -E 'PANGOLIN_(PROXY_HOSTS|TRUSTED_PROXIES)=' "$ENV_FILE"
  printf '%s\n' "$CAP" | grep -q "PANGOLIN_PROXY_HOSTS=$PROXY_HOSTS" ||
    die "PANGOLIN_PROXY_HOSTS in .env does not match $PROXY_HOSTS"
  cap "nft proxy4 set" sudo nft list set inet pangolin proxy4
}

# ---------- phase: status, first backup after upgrade, manifest ----------
post_upgrade_proof() {
  cap "pangolin status (after upgrade)" sudo pangolin status
  local v s
  v=$(printf '%s' "$CAP" | awk '/^Pangolin Money/{print $3; exit}')
  s=$(printf '%s' "$CAP" | awk '/^Schema:/{print $2; exit}')
  [ "$v" = "$VERSION" ] || die "status reports $v, expected $VERSION"
  [ "$s" = "$MIGRATIONS" ] || die "status reports schema $s, expected $MIGRATIONS"
  log "first backup after the upgrade"
  cap "sudo pangolin backup (first after upgrade)" sudo pangolin backup
  local snap2 id2
  id2=$(printf '%s' "$CAP" | sed -n 's/^Backup \([0-9A-Z]*\) started/\1/p')
  snap2=$(printf '%s' "$CAP" | sed -n 's/^Backup done at .*: snapshot \([0-9a-f]*\)/\1/p')
  [ -n "$snap2" ] || die "no snapshot id in the first post-upgrade backup"
  local man envs
  # shellcheck source=/dev/null
  envs=$(set -a && . "$ENV_FILE" && printf 'RESTIC_REPOSITORY=%s\nRESTIC_PASSWORD_FILE=%s\n' \
    "$PANGOLIN_BACKUP_REPOSITORY" "$RESTIC_PASSWORD_FILE")
  man=$(sudo env $envs restic dump "$snap2" "/data/backup/staging/$id2/manifest.json")
  local fields count
  fields=$(printf '%s' "$man" | grep -oE '"(format|schemaVersion|balanceDate)"[^,}]*' | tr -d '"')
  count=$(printf '%s' "$man" | jq '.accounts | length')
  printf '%s\n%s\n' "snapshot: $snap2 (backup id $id2)" "$fields" >"$WORK/manifest-fields.txt"
  printf 'accounts: %s\n' "$count" >>"$WORK/manifest-fields.txt"
  section "First backup after upgrade" "$(cat "$WORK/manifest-fields.txt")"
  printf '%s\n' "$fields" | grep -q "format: *2" || die "manifest format is not 2"
  printf '%s\n' "$fields" | grep -q "schemaVersion: *$MIGRATIONS" ||
    die "manifest schemaVersion is not $MIGRATIONS"
  [ "$count" -gt 0 ] || warn "manifest lists $count accounts; check that this is expected"
}

# ---------- phase: cleanup, accept gate, close-out ----------
finish() {
  log "deleting the check:upgrade copies and sidecars (they hold household data)"
  cleanup
  section "Copies deleted" "all check:upgrade copies and sidecars removed at $(date -u '+%Y-%m-%d %H:%M UTC')"

  local notes accepted
  notes=$(release_notes)
  {
    printf '# Release %s\n\n' "$VERSION"
    printf 'Generated by `scripts/release.sh` on %s, %s UTC. Tag `%s` -> commit `%s`.\n' \
      "$(hostname)" "$(date -u '+%Y-%m-%d %H:%M')" "$VERSION" "$PAGE_SHA"
    printf '\nPrevious release `%s`; schema %s to %s. Digest `%s`.\n' \
      "$PREV" "$LIVE_SCHEMA" "$MIGRATIONS" "$DIGEST"
    printf '\n## Release notes\n\n%s\n' "$notes"
    printf '\n## Evidence\n'
    cat "$EVID"
  } >"docs/release-$VERSION.md"

  if confirm "Everything above is green. Accept $VERSION (records acceptance and close-outs the docs)?"; then
    accepted="accepted by $(git config user.name || id -un), $(date -u '+%Y-%m-%d')"
    printf '\n## Decision\n\nOutcome: accepted.\n\n%s\n' "$accepted" >>"docs/release-$VERSION.md"
  else
    printf '\n## Decision\n\nOutcome: NOT accepted yet; the host is upgraded and every check above\npassed. Accept or roll back by hand before relying on this release.\n' >>"docs/release-$VERSION.md"
    log "not accepted: page written with a pending decision; fix, then re-run the close-out by hand"
  fi

  git add "docs/release-$VERSION.md"
  git commit -q -m "docs(bmad): close out $VERSION release evidence"
  net 600 git push origin "$BRANCH"
  log "done. tag $VERSION -> $PAGE_SHA; close-out commit $(git rev-parse --short HEAD) pushed to $BRANCH"
  log "https://github.com/$(git remote get-url origin | sed -E 's#.*(github\.com[:/])##; s#\.git$##')/releases/tag/$VERSION"
}

# ---------- run ----------
log "Pangolin Money release $VERSION (dry-run: $DRY)"
preflight
real_data_proof
draft_page
if [ "$DRY" = 1 ]; then exit 0; fi # unreachable today, kept honest if draft_page learns actions
# draft_page already exited when DRY=1
push_tag_and_ci
release_run
backup_gate
do_upgrade
apply_proxy_pair
pair_proof
post_upgrade_proof
finish
