#!/bin/sh
# Pangolin Money uninstaller: removes what install.sh put on this host: the stack, the firewall
# rules and units, the pangolin command and the install directory. It asks before deleting the
# data directory (the household database and attachments), and asks you to type the directory
# to confirm. When the data directory is kept, so are the secrets in /opt/pangolin/secrets, which
# that database needs: a reinstall reuses them. It leaves Docker, its apt source, the recovery
# bundle and the backup server alone.
#
# Usage: sh uninstall.sh [options]      (as root)
#
#   --keep-data        keep the data directory and the secrets in /opt/pangolin/secrets (the
#                      default when it cannot ask)
#   --delete-data      delete the data directory without asking: the household database and
#                      attachments are gone for good; keep a backup first
#   --yes              do not ask before removing the stack, firewall and command (the data
#                      directory is still asked about unless --keep-data or --delete-data)
#   --non-interactive  never prompt; keep the data directory unless --delete-data is given
#   --root DIR         act on files under DIR instead of /, and change nothing on this host
#                      (no Docker, firewall or systemd)
#   -h, --help         show this help
set -eu

INSTALL_DIR=/opt/pangolin
DEFAULT_DATA_ROOT=/srv/pangolin

ROOT=
DATA_CHOICE=ask # ask | keep | delete
ASSUME_YES=0
NON_INTERACTIVE=0

say() {
  printf '%s\n' "$*"
}

step() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf 'WARNING: %s\n' "$*" >&2
}

die() {
  printf 'uninstall.sh: %s\n' "$*" >&2
  exit 1
}

usage() {
  # The header comment from "Usage:" to the line before `set -eu`.
  sed -n '/^# Usage:/,/^set -eu/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

# A path on the target system: under --root when one is given.
path() {
  printf '%s%s' "$ROOT" "$1"
}

staging() {
  [ -n "$ROOT" ]
}

parse_args() {
  while [ $# -gt 0 ]; do
    case $1 in
      --keep-data) DATA_CHOICE=keep ;;
      --delete-data) DATA_CHOICE=delete ;;
      --yes) ASSUME_YES=1 ;;
      --non-interactive) NON_INTERACTIVE=1 ;;
      --root)
        [ $# -ge 2 ] || die "--root needs a directory"
        ROOT=${2%/}
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
  done
}

# ask PROMPT: read one line of the answer; empty when it cannot ask.
ask() {
  ANSWER=
  [ "$NON_INTERACTIVE" -eq 0 ] || return 0
  printf '%s ' "$1" >&2
  read -r ANSWER || ANSWER=
}

# The data directory install.sh recorded in .env, else its default.
data_root() {
  env_file=$(path "$INSTALL_DIR/.env")
  value=
  if [ -r "$env_file" ]; then
    value=$(sed -n 's/^PANGOLIN_DATA_ROOT=//p' "$env_file" | tail -n 1)
  fi
  printf '%s' "${value:-$DEFAULT_DATA_ROOT}"
}

# A data root this script will delete: absolute, and at least two levels deep, so a bad .env can
# never point it at / or a top-level directory such as /srv or /home.
safe_data_root() {
  case $1 in
    /*/*) ;;
    *) return 1 ;;
  esac
  case $1 in
    */ | *//* | */. | */.. | */./* | */../*) return 1 ;;
  esac
  return 0
}

# Settles DATA_ACTION (keep | delete) before anything is changed. DATA_EXISTS=0 when there is
# certainly no data directory (so there is nothing for kept secrets to serve).
decide_data() {
  DATA_ROOT=$(data_root)
  DATA_ACTION=keep
  DATA_EXISTS=1
  if ! safe_data_root "$DATA_ROOT"; then
    warn "the data directory '$DATA_ROOT' is not a path this script will delete; it is kept"
    return 0
  fi
  target=$(path "$DATA_ROOT")
  if [ ! -d "$target" ]; then
    DATA_EXISTS=0
    say "There is no data directory at $DATA_ROOT: nothing to delete."
    return 0
  fi
  case $DATA_CHOICE in
    keep) return 0 ;;
    delete)
      DATA_ACTION=delete
      return 0
      ;;
  esac
  say "The data directory $DATA_ROOT holds the household database and attachments."
  say "Deleting it also deletes the secrets in $INSTALL_DIR/secrets, which it needs; both cannot be"
  say "undone. Backups already pushed stay on the backup server (restoring them needs the bundle)."
  ask "Delete $DATA_ROOT? [y/N]"
  case $ANSWER in
    y | Y | yes | YES) ;;
    *)
      say "Keeping $DATA_ROOT."
      return 0
      ;;
  esac
  ask "Type the directory to confirm ($DATA_ROOT):"
  if [ "$ANSWER" = "$DATA_ROOT" ]; then
    DATA_ACTION=delete
  else
    say "That does not match: keeping $DATA_ROOT."
  fi
}

stop_stack() {
  compose_file=$(path "$INSTALL_DIR/compose.yaml")
  [ -f "$compose_file" ] || return 0
  if staging; then return 0; fi
  if ! command -v docker >/dev/null 2>&1; then
    warn "docker is not installed: the stack was not stopped"
    return 0
  fi
  step "Stopping the stack"
  docker compose --project-directory "$INSTALL_DIR" -f "$compose_file" down --remove-orphans ||
    warn "docker compose down failed: stop the pangolin container yourself"
}

remove_firewall() {
  step "Removing the firewall"
  units=$(path /etc/systemd/system)
  if ! staging; then
    for unit in pangolin-allowlist.timer pangolin-allowlist.service pangolin-firewall.service; do
      systemctl disable --now "$unit" >/dev/null 2>&1 || true
    done
  fi
  for unit in pangolin-firewall.service pangolin-allowlist.service pangolin-allowlist.timer; do
    rm -f "$units/$unit"
  done
  # enable_unit's symlinks under --root; systemctl removed the real ones.
  for wants in sysinit.target.wants multi-user.target.wants timers.target.wants; do
    for unit in pangolin-firewall.service pangolin-allowlist.service pangolin-allowlist.timer; do
      rm -f "$units/$wants/$unit"
    done
  done
  rm -f "$units/docker.service.d/pangolin-data.conf"
  rmdir "$units/docker.service.d" 2>/dev/null || true
  if ! staging; then
    systemctl daemon-reload || true
    # Only our table: `nft flush ruleset` would also remove Docker's chains.
    if command -v nft >/dev/null 2>&1; then
      nft delete table inet pangolin 2>/dev/null || true
    fi
  fi
}

remove_command_and_images() {
  step "Removing the pangolin command and images"
  rm -f "$(path /usr/local/bin/pangolin)"
  if staging || ! command -v docker >/dev/null 2>&1; then return 0; fi
  images=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null |
    grep -E '^(ghcr\.io/[^/]+/pangolin|pangolin):' || true)
  for image in $images; do
    docker image rm "$image" >/dev/null 2>&1 || warn "could not remove the image $image"
  done
}

remove_data() {
  [ "$DATA_ACTION" = delete ] || return 0
  step "Deleting the data directory $DATA_ROOT"
  target=$(path "$DATA_ROOT")
  # The contents, then the directory itself: a mount point (the encrypted data disk) cannot be
  # removed, and stays mounted but empty.
  find "$target" -mindepth 1 -delete
  rmdir "$target" 2>/dev/null || true
}

# Removes the install directory. When a data directory is kept, the three secrets its database
# needs stay in secrets/ (contents, modes and owners as they are), and a reinstall reuses them;
# anything else there (the GHCR token) goes. KEPT_SECRETS=1 when it kept them.
remove_install_dir() {
  install_dir=$(path "$INSTALL_DIR")
  KEPT_SECRETS=0
  if [ "$DATA_ACTION" = keep ] && [ "$DATA_EXISTS" -eq 1 ] && [ -d "$install_dir/secrets" ]; then
    step "Removing $INSTALL_DIR, except the secrets the data needs"
    find "$install_dir" -mindepth 1 -maxdepth 1 ! -name secrets -exec rm -rf {} +
    find "$install_dir/secrets" -mindepth 1 -maxdepth 1 ! -name auth-secret ! -name app-key \
      ! -name restic-password -exec rm -rf {} +
    KEPT_SECRETS=1
  else
    step "Removing $INSTALL_DIR"
    rm -rf "$install_dir"
  fi
}

main() {
  parse_args "$@"
  if ! staging && [ "$(id -u)" -ne 0 ]; then die "run as root (sudo sh uninstall.sh)"; fi
  if [ ! -d "$(path "$INSTALL_DIR")" ] && [ ! -f "$(path /usr/local/bin/pangolin)" ]; then
    die "Pangolin Money does not look installed here (no $INSTALL_DIR)"
  fi

  if [ "$ASSUME_YES" -eq 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
    ask "Remove the Pangolin stack, firewall and command from this host? [y/N]"
    case $ANSWER in
      y | Y | yes | YES) ;;
      *) die "cancelled: nothing was changed" ;;
    esac
  fi
  # Settled before anything is changed, so a cancelled answer leaves the host as it was.
  decide_data

  stop_stack
  remove_firewall
  remove_command_and_images
  remove_data
  remove_install_dir

  step "Done"
  if [ "$KEPT_SECRETS" -eq 1 ]; then
    say "Kept the data directory $DATA_ROOT and the secrets in $INSTALL_DIR/secrets"
    say "(a reinstall reuses them; the database needs them, so never delete one without the other)."
    if [ "$DATA_ROOT" != "$DEFAULT_DATA_ROOT" ] && safe_data_root "$DATA_ROOT"; then
      say "Reinstall with --data-root $DATA_ROOT, or install.sh starts an empty household on"
      say "$DEFAULT_DATA_ROOT."
    fi
  elif [ "$DATA_ACTION" = keep ] && [ "$DATA_EXISTS" -eq 1 ]; then
    say "Kept the data directory $DATA_ROOT."
  fi
  say "Not touched: Docker and its apt source, the recovery bundle in /root"
  say "(pangolin-recovery-bundle-*.txt: store it safely, then delete it), the backup server's"
  say "repository, the Nginx Proxy Manager host and any Tang binding."
}

main "$@"
