#!/bin/sh
# Pangolin Money installer: one command from a fresh VM to the first-login link, behind an
# existing Nginx Proxy Manager. Safe to re-run: it never regenerates a secret, keeps every value
# in .env (it adds missing keys; only --image, --build and --data-root replace theirs), and
# restarts the stack.
#
# Usage: sh install.sh [options]        (as root; every prompt also has a flag)
#
#   --proxy npm|caddy|tailscale   proxy mode; only npm (an existing Nginx Proxy Manager) today
#   --hostname NAME               public host name; the app is served at https://NAME
#   --backup-server URL           restic REST URL, e.g. rest:https://nas.lan:8000/pangolin, of an
#                                 append-only rest-server: nightly backups go there (allowlisted);
#                                 an empty value ("") turns backups off
#   --npm-host IP                 the NPM host: the only address that may reach the app port
#   --admin-network CIDR          the network SSH is allowed from, e.g. 192.168.1.0/24
#   --tang-url URL                the Tang server that unlocks the data disk, e.g. http://tang.lan
#                                 (allowlisted, so the disk still unlocks behind the firewall)
#   --ghcr-token-file FILE        a GHCR read-only token (packages: read) for a private image
#   --ghcr-token TOKEN            the same, inline (visible in the process list; prefer a file)
#   --ghcr-user NAME              the GHCR user name (default: the image's owner)
#   --dns IP[,IP...]              the DNS resolvers to allow (default: from /etc/resolv.conf);
#                                 replaces PANGOLIN_DNS_SERVERS in an existing .env
#   --data-root DIR               the data directory, on the encrypted disk (default /srv/pangolin);
#                                 replaces PANGOLIN_DATA_ROOT in an existing .env
#   --http-port PORT              the host port NPM forwards to (default 3000)
#   --ssh-port PORT               the SSH port to allow from the admin network (default 22)
#   --image REF                   the image to run (default ghcr.io/sbwilson/pangolin:latest);
#                                 replaces PANGOLIN_IMAGE in an existing .env
#   --build                       build the image here from the repository, as pangolin:local
#   --ref REF                     the branch or tag --build checks out (default: the
#                                 repository's default branch)
#   --repo URL                    the repository --build clones
#   --bundle                      write the recovery bundle again (it is written on first install)
#   --non-interactive             never prompt; take answers from flags and the existing .env
#   --no-docker                   do not install or run Docker (files and firewall only)
#   --root DIR                    write every file under DIR instead of /, and change nothing
#                                 on this host (no packages, firewall, systemd or Docker)
#   -h, --help                    show this help
set -eu

DEFAULT_IMAGE=ghcr.io/sbwilson/pangolin:latest
DEFAULT_REPO=https://github.com/sbwilson/pangolin.git
# The image's `node` user, which owns the data root and the secrets it reads.
CONTAINER_UID=1000
INSTALL_DIR=/opt/pangolin
# How long to wait for /healthz, in seconds; overridable for tests.
HEALTH_TIMEOUT=${PANGOLIN_HEALTH_TIMEOUT:-90}

ROOT=
NON_INTERACTIVE=0
NO_DOCKER=0
BUNDLE=0
BUILD=0
REF=
REPO=$DEFAULT_REPO
ARG_PROXY=
ARG_HOST=
ARG_BACKUP=
ARG_BACKUP_SET=0
ARG_NPM=
ARG_ADMIN=
ARG_TOKEN=
ARG_TOKEN_FILE=
ARG_GHCR_USER=
ARG_DNS=
ARG_DATA_ROOT=
ARG_HTTP_PORT=
ARG_SSH_PORT=
ARG_IMAGE=
ARG_TANG=
ARG_TANG_SET=0
ROOT_SET=0

WORK=
TTY_ECHO_OFF=0
WARNINGS=0
GENERATED=0
BUNDLE_PATH=
BUNDLE_ID=
NEW_BUNDLE_ID=0
BACKUP_CHANGED=0
# An explicit --backup-server "": backups off. OLD_BACKUP is the repository .env held before.
BACKUP_OFF=0
OLD_BACKUP=
# .env keys this run replaces because a flag asked for a new value (--image, --build, --data-root).
REPLACE=

# ---------------------------------------------------------------------------------------------
# Output

say() {
  printf '%s\n' "$*"
}

step() {
  printf '\n==> %s\n' "$*"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'WARNING: %s\n' "$*" >&2
}

die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

usage() {
  # The header comment from "Usage:" to the line before `set -eu`.
  sed -n '/^# Usage:/,/^set -eu/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

cleanup() {
  if [ "$TTY_ECHO_OFF" -eq 1 ]; then stty echo </dev/tty 2>/dev/null || true; fi
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
}

# A path on the target system: under --root when one is given.
path() {
  printf '%s%s' "$ROOT" "$1"
}

staging() {
  [ -n "$ROOT" ]
}

# Whether to use Docker (pull or check the image, start the stack, wait for it). A --root run
# skips it, unless a test sets PANGOLIN_INSTALL_STUB_DOCKER=1 to drive a stub `docker` on PATH;
# without --root that variable is ignored, so a real install behaves the same either way.
run_stack() {
  [ "$NO_DOCKER" -eq 0 ] || return 1
  if staging; then [ "${PANGOLIN_INSTALL_STUB_DOCKER:-0}" = 1 ]; else return 0; fi
}

# ---------------------------------------------------------------------------------------------
# Arguments

parse_args() {
  while [ $# -gt 0 ]; do
    opt=$1
    value=
    has_value=0
    case "$opt" in
      --*=*) value=${opt#*=}; opt=${opt%%=*}; has_value=1 ;;
    esac
    case "$opt" in
      --proxy | --hostname | --backup-server | --npm-host | --admin-network | --ghcr-token | \
        --ghcr-token-file | --ghcr-user | --dns | --data-root | --http-port | --ssh-port | \
        --image | --ref | --repo | --root | --tang-url)
        if [ "$has_value" -eq 0 ]; then
          [ $# -ge 2 ] || die "$opt needs a value"
          value=$2
          shift
        fi
        ;;
    esac
    case "$opt" in
      --proxy) ARG_PROXY=$value ;;
      --hostname) ARG_HOST=$value ;;
      --backup-server) ARG_BACKUP=$value; ARG_BACKUP_SET=1 ;;
      --npm-host) ARG_NPM=$value ;;
      --admin-network) ARG_ADMIN=$value ;;
      --ghcr-token) ARG_TOKEN=$value ;;
      --ghcr-token-file) ARG_TOKEN_FILE=$value ;;
      --ghcr-user) ARG_GHCR_USER=$value ;;
      --dns) ARG_DNS=$value ;;
      --data-root) ARG_DATA_ROOT=$value ;;
      --http-port) ARG_HTTP_PORT=$value ;;
      --ssh-port) ARG_SSH_PORT=$value ;;
      --image) ARG_IMAGE=$value ;;
      --ref) REF=$value ;;
      --repo) REPO=$value ;;
      --root) ROOT=$value; ROOT_SET=1 ;;
      --tang-url) ARG_TANG=$value; ARG_TANG_SET=1 ;;
      --build) BUILD=1 ;;
      --bundle) BUNDLE=1 ;;
      --non-interactive) NON_INTERACTIVE=1 ;;
      --no-docker) NO_DOCKER=1 ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option: $opt (see --help)" ;;
    esac
    shift
  done
  if [ "$ROOT_SET" -eq 1 ]; then
    case "$ROOT" in /*) ;; *) die "--root must be an absolute path" ;; esac
    while :; do
      case "$ROOT" in */) ROOT=${ROOT%/} ;; *) break ;; esac
    done
    # An empty ROOT would turn a staging run into a real install.
    [ -n "$ROOT" ] || die "--root must be a directory other than /"
  fi
  if [ "$BUILD" -eq 1 ] && [ -n "$ARG_IMAGE" ]; then die "use --image or --build, not both"; fi
  printf '%s\n' "$HEALTH_TIMEOUT" | grep -Eq '^[0-9]+$' ||
    die "PANGOLIN_HEALTH_TIMEOUT must be a number of seconds"
}

require_root() {
  if staging; then return 0; fi
  if [ "$(id -u)" -ne 0 ]; then
    die "run install.sh as root, e.g. sudo sh install.sh (it installs packages, a firewall and Docker)"
  fi
}

# ---------------------------------------------------------------------------------------------
# Validation

is_ipv4() {
  printf '%s\n' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || return 1
  for octet in $(printf '%s' "$1" | tr '.' ' '); do
    [ "$octet" -le 255 ] || return 1
  done
}

# An IPv6 address: at most eight groups of up to four hex digits, and at most one `::`.
is_ipv6() {
  printf '%s\n' "$1" | awk '
    {
      s = $0
      if (s !~ /^[0-9A-Fa-f:]+$/ || s ~ /:::/) exit 1
      n = gsub(/::/, "&", s)
      if (n > 1) exit 1
      if (n == 0 && (s ~ /^:/ || s ~ /:$/)) exit 1
      if (n == 1 && (s ~ /^:[^:]/ || s ~ /[^:]:$/)) exit 1
      groups = 0
      count = split(s, part, ":")
      for (i = 1; i <= count; i++) {
        if (part[i] == "") continue
        if (length(part[i]) > 4) exit 1
        groups++
      }
      if (n == 0 && groups != 8) exit 1
      if (n == 1 && groups > 7) exit 1
      exit 0
    }'
}

is_ip() {
  is_ipv4 "$1" || is_ipv6 "$1"
}

is_cidr() {
  case "$1" in
    */*) ;;
    *) return 1 ;;
  esac
  cidr_ip=${1%/*}
  cidr_len=${1##*/}
  printf '%s\n' "$cidr_len" | grep -Eq '^[0-9]{1,3}$' || return 1
  if is_ipv4 "$cidr_ip"; then [ "$cidr_len" -le 32 ]; else is_ipv6 "$cidr_ip" && [ "$cidr_len" -le 128 ]; fi
}

is_port() {
  printf '%s\n' "$1" | grep -Eq '^[0-9]{1,5}$' && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# A DNS name with at least one dot (passkeys need a domain, never an IP address).
is_public_host() {
  is_ipv4 "$1" && return 1
  printf '%s\n' "$1" |
    grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
}

# The allowlist entry (host:port) for an http(s) URL (a restic REST URL may start with `rest:`),
# or nothing when it is not one.
url_entry() {
  backup_url=${1#rest:}
  case "$backup_url" in
    https://*) backup_port=443 ;;
    http://*) backup_port=80 ;;
    *) return 0 ;;
  esac
  backup_rest=${backup_url#*://}
  backup_hostport=${backup_rest%%/*}
  backup_hostport=${backup_hostport##*@}
  [ -n "$backup_hostport" ] || return 0
  case "$backup_hostport" in
    \[*\]:*) printf '%s\n' "$backup_hostport" ;;
    \[*\]) printf '%s:%s\n' "$backup_hostport" "$backup_port" ;;
    *:*) printf '%s\n' "$backup_hostport" ;;
    *) printf '%s:%s\n' "$backup_hostport" "$backup_port" ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# Prompts

has_tty() {
  [ -r /dev/tty ] && [ -w /dev/tty ] && (exec </dev/tty) 2>/dev/null
}

# ask QUESTION DEFAULT: the answer (or the default), from the terminal. With --non-interactive,
# the default.
ask() {
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    printf '%s' "$2"
    return 0
  fi
  if [ -n "$2" ]; then
    printf '%s [%s]: ' "$1" "$2" >/dev/tty
  else
    printf '%s: ' "$1" >/dev/tty
  fi
  answer=
  IFS= read -r answer </dev/tty || answer=
  if [ -z "$answer" ]; then answer=$2; fi
  printf '%s' "$answer"
}

# ask_secret QUESTION: an answer read with echo off; never printed.
ask_secret() {
  printf '%s: ' "$1" >/dev/tty
  # This runs in a command substitution, whose shell has no traps: restore echo here too.
  trap 'stty echo </dev/tty 2>/dev/null; exit 130' INT TERM
  stty -echo </dev/tty
  TTY_ECHO_OFF=1
  answer=
  IFS= read -r answer </dev/tty || answer=
  stty echo </dev/tty
  TTY_ECHO_OFF=0
  trap - INT TERM
  printf '\n' >/dev/tty
  printf '%s' "$answer"
}

# The last value of KEY in FILE (a .env or os-release), without surrounding quotes. Parsed,
# never sourced.
file_value() {
  [ -r "$2" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$2" | tail -n 1 |
    sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/"
}

env_file() {
  path "$INSTALL_DIR/.env"
}

existing() {
  file_value "$1" "$(env_file)"
}

# The resolvers in resolv.conf (plus, when it lists systemd-resolved's 127.0.0.53 stub, those in
# its upstream file), comma-separated, lower case, each once. firewall/render.sh's host_resolvers
# reads them the same way on every re-render; keep the two in step.
detect_dns() {
  set -- /etc/resolv.conf
  if grep -Eq '^[[:space:]]*nameserver[[:space:]]+127\.0\.0\.53([[:space:]]|$)' /etc/resolv.conf 2>/dev/null; then
    set -- /etc/resolv.conf /run/systemd/resolve/resolv.conf
  fi
  # Skips loopback, unspecified, IPv4-mapped, link-local (fe80::/10) and zone-scoped (`%`)
  # resolvers; nftables cannot match the last two.
  for dns_file in "$@"; do
    [ -r "$dns_file" ] && cat "$dns_file"
  done 2>/dev/null |
    awk '$1 == "nameserver" { a = tolower($2); if (a !~ /^127\./ && a != "::1" && a != "0.0.0.0" && a != "::" && a !~ /^::ffff:/ && a !~ /%/ && a !~ /^fe[89ab][0-9a-f]:/ && !seen[a]++) print a }' |
    paste -sd, - || true
}

detect_distro() {
  os_release=$(path /etc/os-release)
  [ -r "$os_release" ] || die "cannot read /etc/os-release. Supported: Debian 13; Ubuntu 24.04 and Rocky Linux 9 (unproven)"
  DISTRO_ID=$(file_value ID "$os_release")
  DISTRO_VERSION=$(file_value VERSION_ID "$os_release")
  DISTRO_CODENAME=$(file_value VERSION_CODENAME "$os_release")
  DISTRO_NAME=$(file_value PRETTY_NAME "$os_release")
  [ -n "$DISTRO_NAME" ] || DISTRO_NAME="$DISTRO_ID $DISTRO_VERSION"
  PROVEN=0
  SELINUX=0
  case "$DISTRO_ID:$DISTRO_VERSION" in
    debian:13) PKG=apt; PROVEN=1 ;;
    ubuntu:24.04) PKG=apt ;;
    rocky:9 | rocky:9.*) PKG=dnf; SELINUX=1 ;;
    *)
      die "unsupported distribution: $DISTRO_NAME. Supported: Debian 13 (the proven path); Ubuntu 24.04 and Rocky Linux 9 (written, unproven)"
      ;;
  esac
  say "Distribution: $DISTRO_NAME ($PKG)"
  if [ "$PROVEN" -eq 0 ]; then
    warn "$DISTRO_NAME is written for but not yet proven; Debian 13 is the tested path"
  fi
}

settings() {
  # Proxy mode first: an unsupported answer stops before anything changes.
  PROXY_MODE=$ARG_PROXY
  if [ -z "$PROXY_MODE" ]; then
    default=$(existing PANGOLIN_PROXY_MODE)
    PROXY_MODE=$(ask "Proxy mode: npm (existing Nginx Proxy Manager), caddy (bundled) or tailscale (Tailscale only)" "${default:-npm}")
  fi
  case "$PROXY_MODE" in
    npm) ;;
    caddy | tailscale)
      die "proxy mode '$PROXY_MODE' is not yet supported; only npm (an existing Nginx Proxy Manager) is. Nothing was changed."
      ;;
    *) die "unknown proxy mode '$PROXY_MODE': choose npm, caddy or tailscale" ;;
  esac

  current_url=$(existing PANGOLIN_PUBLIC_URL)
  PUBLIC_HOST=$ARG_HOST
  if [ -z "$PUBLIC_HOST" ]; then
    default=${current_url#https://}
    default=${default#http://}
    default=${default%/}
    while :; do
      PUBLIC_HOST=$(ask "Public host name people open (e.g. money.example.com)" "$default")
      if [ -z "$PUBLIC_HOST" ] && [ "$NON_INTERACTIVE" -eq 1 ]; then
        die "--hostname is required with --non-interactive on a first install"
      fi
      is_public_host "$PUBLIC_HOST" && break
      [ "$NON_INTERACTIVE" -eq 0 ] || break
      say "Enter a DNS name such as money.example.com (not an IP address)." >/dev/tty
    done
  fi
  is_public_host "$PUBLIC_HOST" || die "not a public host name (a DNS name with a dot, not an IP): $PUBLIC_HOST"

  BACKUP=$ARG_BACKUP
  if [ "$ARG_BACKUP_SET" -eq 0 ]; then
    default=$(existing PANGOLIN_BACKUP_REPOSITORY)
    # A reinstall over kept data has no .env: the server uninstall.sh recorded is the default.
    if [ ! -f "$(env_file)" ] && [ -f "$(kept_backup_record)" ]; then
      default=$(file_value PANGOLIN_BACKUP_REPOSITORY "$(kept_backup_record)")
    fi
    while :; do
      BACKUP=$(ask "Backup server, a restic REST URL (e.g. rest:https://nas.lan:8000/pangolin; empty to skip)" "$default")
      [ -z "$BACKUP" ] && break
      [ -n "$(url_entry "$BACKUP")" ] && break
      [ "$NON_INTERACTIVE" -eq 0 ] || break
      say "Enter a URL such as rest:https://nas.lan:8000/pangolin." >/dev/tty
    done
  fi
  if [ -n "$BACKUP" ] && [ -z "$(url_entry "$BACKUP")" ]; then
    die "not a restic REST URL: use rest:https://host:port/path (or rest:http://...)"
  fi
  if [ -z "$BACKUP" ] && [ "$ARG_BACKUP_SET" -eq 1 ]; then
    BACKUP_OFF=1
  fi
  [ -n "$BACKUP" ] || [ "$BACKUP_OFF" -eq 1 ] || warn "no backup server set: add PANGOLIN_BACKUP_REPOSITORY to .env and its host to allowlist.conf before enabling backups"

  TANG_URL=$ARG_TANG
  if [ "$ARG_TANG_SET" -eq 0 ]; then
    default=$(existing PANGOLIN_TANG_URL)
    while :; do
      TANG_URL=$(ask "Tang server that unlocks the data disk (e.g. http://tang.lan; empty if none)" "$default")
      [ -z "$TANG_URL" ] && break
      [ -n "$(url_entry "$TANG_URL")" ] && break
      [ "$NON_INTERACTIVE" -eq 0 ] || break
      say "Enter a URL such as http://tang.lan." >/dev/tty
    done
  fi
  if [ -n "$TANG_URL" ] && { [ -z "$(url_entry "$TANG_URL")" ] || [ "${TANG_URL#rest:}" != "$TANG_URL" ]; }; then
    die "not a Tang URL: use http://host[:port]"
  fi

  NPM_HOST=$ARG_NPM
  if [ -z "$NPM_HOST" ]; then
    default=$(existing PANGOLIN_NPM_HOST)
    while :; do
      NPM_HOST=$(ask "IPv4 address of the Nginx Proxy Manager host" "$default")
      is_ipv4 "$NPM_HOST" && break
      [ "$NON_INTERACTIVE" -eq 0 ] || break
      say "Enter an IPv4 address such as 192.168.1.10." >/dev/tty
    done
  fi
  if [ -z "$NPM_HOST" ]; then die "--npm-host is required with --non-interactive on a first install"; fi
  if is_ipv6 "$NPM_HOST"; then
    die "the app port is published on IPv4 only: give the NPM host's IPv4 address, not $NPM_HOST"
  fi
  is_ipv4 "$NPM_HOST" || die "not an IPv4 address: $NPM_HOST"

  ADMIN_NETWORK=$ARG_ADMIN
  if [ -z "$ADMIN_NETWORK" ]; then
    default=$(existing PANGOLIN_ADMIN_NETWORK)
    while :; do
      ADMIN_NETWORK=$(ask "Network allowed to SSH in (e.g. 192.168.1.0/24)" "$default")
      if is_ip "$ADMIN_NETWORK"; then
        if is_ipv4 "$ADMIN_NETWORK"; then ADMIN_NETWORK=$ADMIN_NETWORK/32; else ADMIN_NETWORK=$ADMIN_NETWORK/128; fi
      fi
      is_cidr "$ADMIN_NETWORK" && break
      [ "$NON_INTERACTIVE" -eq 0 ] || break
      say "Enter a network such as 192.168.1.0/24." >/dev/tty
    done
  elif is_ip "$ADMIN_NETWORK"; then
    if is_ipv4 "$ADMIN_NETWORK"; then ADMIN_NETWORK=$ADMIN_NETWORK/32; else ADMIN_NETWORK=$ADMIN_NETWORK/128; fi
  fi
  if [ -z "$ADMIN_NETWORK" ]; then die "--admin-network is required with --non-interactive on a first install"; fi
  is_cidr "$ADMIN_NETWORK" || die "not a network (address/prefix): $ADMIN_NETWORK"

  DNS_SERVERS=$ARG_DNS
  if [ -z "$DNS_SERVERS" ]; then DNS_SERVERS=$(existing PANGOLIN_DNS_SERVERS); fi
  if [ -z "$DNS_SERVERS" ]; then DNS_SERVERS=$(detect_dns); fi
  if [ -z "$DNS_SERVERS" ]; then
    DNS_SERVERS=$(ask "DNS resolvers to allow (comma-separated IPs)" "")
  fi
  [ -n "$DNS_SERVERS" ] || die "no DNS resolver found in /etc/resolv.conf: pass --dns IP[,IP...]"
  for resolver in $(printf '%s' "$DNS_SERVERS" | tr ',' ' '); do
    is_ip "$resolver" || die "not a DNS resolver IP: $resolver"
  done

  DATA_ROOT=$ARG_DATA_ROOT
  if [ -z "$DATA_ROOT" ]; then DATA_ROOT=$(existing PANGOLIN_DATA_ROOT); fi
  DATA_ROOT=${DATA_ROOT:-/srv/pangolin}
  case "$DATA_ROOT" in /*) ;; *) die "--data-root must be an absolute path" ;; esac
  DATA_ROOT=${DATA_ROOT%/}

  HTTP_PORT=${ARG_HTTP_PORT:-$(existing PANGOLIN_HTTP_PORT)}
  HTTP_PORT=${HTTP_PORT:-3000}
  is_port "$HTTP_PORT" || die "not a port: $HTTP_PORT"
  SSH_PORT=${ARG_SSH_PORT:-$(existing PANGOLIN_SSH_PORT)}
  SSH_PORT=${SSH_PORT:-22}
  is_port "$SSH_PORT" || die "not a port: $SSH_PORT"

  if [ "$BUILD" -eq 1 ]; then
    IMAGE=pangolin:local
  else
    IMAGE=${ARG_IMAGE:-$(existing PANGOLIN_IMAGE)}
    IMAGE=${IMAGE:-$DEFAULT_IMAGE}
  fi

  # The GHCR token: only for a registry image, and only asked when none is stored yet.
  TOKEN_SOURCE=
  if [ -n "$ARG_TOKEN_FILE" ]; then
    [ -r "$ARG_TOKEN_FILE" ] || die "cannot read the token file $ARG_TOKEN_FILE"
    TOKEN_SOURCE="file"
  elif [ -n "$ARG_TOKEN" ]; then
    TOKEN_SOURCE=arg
  elif [ "$BUILD" -eq 0 ] && [ "$NON_INTERACTIVE" -eq 0 ] &&
    [ ! -s "$(path "$INSTALL_DIR/secrets/ghcr-token")" ]; then
    case "$IMAGE" in
      ghcr.io/*)
        ARG_TOKEN=$(ask_secret "GHCR read-only token for a private image (packages: read; empty for a public image)")
        if [ -n "$ARG_TOKEN" ]; then TOKEN_SOURCE=arg; fi
        ;;
    esac
  fi
}

env_has() {
  [ -f "$(env_file)" ] && grep -q "^[[:space:]]*$1=" "$(env_file)"
}

# settle VAR KEY [replace]: when .env already holds KEY with another value than VAR, keep .env's
# (and warn), or with `replace` (an explicit --image, --build or --data-root) mark KEY to be
# replaced. Every later step, host checks included, then uses the value this run will write.
settle() {
  env_has "$2" || return 0
  settle_current=$(existing "$2")
  settle_wanted=
  eval "settle_wanted=\${$1}"
  [ "$settle_wanted" != "$settle_current" ] || return 0
  if [ "${3:-}" = replace ]; then
    REPLACE="$REPLACE $2"
    say "Replacing $2 in .env: $settle_current -> $settle_wanted (asked for on this run)"
    return 0
  fi
  warn "kept $2=$settle_current in .env (you asked for $settle_wanted): edit $INSTALL_DIR/.env to change it, then re-run"
  eval "$1=\$settle_current"
}

settle_all() {
  PUBLIC_URL=https://$PUBLIC_HOST
  settle PROXY_MODE PANGOLIN_PROXY_MODE
  settle PUBLIC_URL PANGOLIN_PUBLIC_URL
  settle NPM_HOST PANGOLIN_NPM_HOST
  settle ADMIN_NETWORK PANGOLIN_ADMIN_NETWORK
  settle SSH_PORT PANGOLIN_SSH_PORT
  settle HTTP_PORT PANGOLIN_HTTP_PORT
  # Resolvers asked for with --dns replace the ones in .env: the way to repair a firewall whose
  # stored resolvers went stale.
  if [ -n "$ARG_DNS" ]; then
    settle DNS_SERVERS PANGOLIN_DNS_SERVERS replace
  else
    settle DNS_SERVERS PANGOLIN_DNS_SERVERS
  fi
  # A backup server asked for (--backup-server, or typed at the prompt) replaces the one in .env.
  # An explicit --backup-server "" blanks it (the key stays, empty: the server reads that as not
  # configured), and write_allowlist drops the old repository's allowlist entry. That is not a
  # change that writes a bundle: the bundle's RESTIC_REPOSITORY still opens the old backups.
  if [ "$BACKUP_OFF" -eq 1 ]; then
    OLD_BACKUP=$(existing PANGOLIN_BACKUP_REPOSITORY)
    if [ -n "$OLD_BACKUP" ]; then REPLACE="$REPLACE PANGOLIN_BACKUP_REPOSITORY"; fi
  elif [ -n "$BACKUP" ]; then
    settle BACKUP PANGOLIN_BACKUP_REPOSITORY replace
  else
    settle BACKUP PANGOLIN_BACKUP_REPOSITORY
  fi
  # A backup server set or changed on this run, on an install that has a .env, means a new
  # bundle (write_bundle), so the one the user stores carries RESTIC_REPOSITORY. Compared before
  # write_env touches .env. Without a .env, a first install's new secrets already write one; but
  # a reinstall over the secrets uninstall.sh kept (no .env, every secret there) generates none,
  # and the bundle the user has does not name this backup server: that is a change too.
  if [ -f "$(env_file)" ] && [ -n "$BACKUP" ] &&
    [ "$BACKUP" != "$(existing PANGOLIN_BACKUP_REPOSITORY)" ]; then
    BACKUP_CHANGED=1
  # uninstall.sh records the backup server it removed with .env (kept_backup_record); a
  # reinstall with that same one is no change. Without a record, nothing says which server the
  # bundle names, so a new one is written.
  elif [ ! -f "$(env_file)" ] && [ -n "$BACKUP" ] && kept_secrets; then
    if [ ! -f "$(kept_backup_record)" ] ||
      [ "$BACKUP" != "$(file_value PANGOLIN_BACKUP_REPOSITORY "$(kept_backup_record)")" ]; then
      BACKUP_CHANGED=1
    fi
  fi
  settle TANG_URL PANGOLIN_TANG_URL
  previous_data_root=$(existing PANGOLIN_DATA_ROOT)
  settle DATA_ROOT PANGOLIN_DATA_ROOT replace
  # A changed data root starts the app on whatever is there: say so when the household's
  # database stays behind in the old one.
  if [ -n "$previous_data_root" ] && [ "$previous_data_root" != "$DATA_ROOT" ] &&
    [ -e "$(path "$previous_data_root/pangolin.sqlite")" ] &&
    [ ! -e "$(path "$DATA_ROOT/pangolin.sqlite")" ]; then
    warn "the data root moves from $previous_data_root, which holds the household database, to $DATA_ROOT, which has none: the app will start there on an empty database, with a new setup link. To keep the household afterwards: stop the stack (docker compose --project-directory $INSTALL_DIR down), replace the contents of $DATA_ROOT with those of $previous_data_root, then start it again (docker compose --project-directory $INSTALL_DIR up -d)"
  fi
  settle IMAGE PANGOLIN_IMAGE replace
  PUBLIC_HOST=${PUBLIC_URL#https://}
  PUBLIC_HOST=${PUBLIC_HOST#http://}
}

# ---------------------------------------------------------------------------------------------
# Host checks: each one warns, never fails.

check_host() {
  step "Checking the host"
  mem_kb=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo 2>/dev/null || true)
  if [ -n "$mem_kb" ]; then
    if [ "$mem_kb" -lt 900000 ]; then
      warn "RAM is $((mem_kb / 1024)) MB, below the 1 GB minimum (2-4 GB recommended)"
    elif [ "$mem_kb" -lt 1900000 ]; then
      warn "RAM is $((mem_kb / 1024)) MB; 2-4 GB is recommended"
    else
      say "RAM: $((mem_kb / 1024)) MB"
    fi
  else
    warn "could not read the RAM size from /proc/meminfo"
  fi

  # The data root may not exist yet: check the nearest directory that does.
  probe=$(path "$DATA_ROOT")
  while [ ! -d "$probe" ] && [ "$probe" != / ]; do probe=$(dirname "$probe"); done
  free_kb=$(df -Pk "$probe" 2>/dev/null | awk 'NR == 2 { print $4 }' || true)
  if [ -n "$free_kb" ]; then
    if [ "$free_kb" -lt 10485760 ]; then
      warn "only $((free_kb / 1048576)) GB free for the data root $DATA_ROOT (10 GB minimum, 50 GB recommended)"
    else
      say "Disk: $((free_kb / 1048576)) GB free for $DATA_ROOT"
    fi
  else
    warn "could not check the free space for $DATA_ROOT"
  fi

  encrypted=0
  if command -v findmnt >/dev/null 2>&1 && command -v lsblk >/dev/null 2>&1; then
    source_dev=$(findmnt -n -o SOURCE -T "$probe" 2>/dev/null | sed 's/\[.*//' || true)
    if [ -n "$source_dev" ] && lsblk -n -s -o TYPE "$source_dev" 2>/dev/null | grep -qw crypt; then
      encrypted=1
    fi
  fi
  if [ "$encrypted" -eq 1 ]; then
    say "Encryption: $DATA_ROOT is on a dm-crypt (LUKS) device"
  else
    printf '\n' >&2
    printf '%s\n' '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' >&2
    warn "the data root $DATA_ROOT is NOT on a dm-crypt (LUKS) device."
    printf '%s\n' "  Your finances would sit on disk, and in every VM backup, unencrypted." \
      "  Encrypt the data disk with LUKS, unlocked by Clevis + Tang (docs/install.md), mount it" \
      "  at $DATA_ROOT, then re-run install.sh. The install continues." >&2
    printf '%s\n\n' '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' >&2
  fi

  if data_root_is_mount; then
    say "Mount: $DATA_ROOT is a mount point; Docker will wait for it (RequiresMountsFor)"
  else
    warn "the data root $DATA_ROOT is not a mount point: if the data disk ever fails to mount, Docker would start the app on the system disk with an empty database. Mount the encrypted data disk there and re-run install.sh"
  fi

  virt=
  if command -v systemd-detect-virt >/dev/null 2>&1; then
    virt=$(systemd-detect-virt --container 2>/dev/null || true)
  fi
  if [ -z "$virt" ] || [ "$virt" = none ]; then
    if tr '\0' '\n' </proc/1/environ 2>/dev/null | grep -q '^container=lxc'; then virt=lxc; fi
  fi
  case "$virt" in
    lxc*) warn "this is an LXC container, not a VM: use a VM for isolation and simpler disk encryption" ;;
  esac

  if ! grep -qw aes /proc/cpuinfo 2>/dev/null; then
    warn "the CPU does not expose AES-NI: set the VM's CPU type to 'host' in Proxmox so encryption is fast"
  fi
}

# Whether the data root is a mount point. Under --root, a test may answer for it with
# PANGOLIN_INSTALL_STUB_MOUNTPOINT=1 (or 0); without --root that variable is ignored.
data_root_is_mount() {
  if staging && [ -n "${PANGOLIN_INSTALL_STUB_MOUNTPOINT:-}" ]; then
    [ "$PANGOLIN_INSTALL_STUB_MOUNTPOINT" = 1 ]
    return
  fi
  command -v mountpoint >/dev/null 2>&1 && mountpoint -q "$(path "$DATA_ROOT")"
}

# Whether IPv4 address $1 is inside IPv4 network $2 (address/prefix).
ipv4_in_network() {
  awk -v ip="$1" -v net="$2" '
    function toint(a,   p) { split(a, p, "."); return ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4] }
    BEGIN {
      split(net, n, "/"); bits = n[2] + 0
      size = 2 ^ (32 - bits)
      exit !(int(toint(ip) / size) == int(toint(n[1]) / size))
    }'
}

check_ssh_session() {
  [ -n "${SSH_CONNECTION:-}" ] || return 0
  client=${SSH_CONNECTION%% *}
  if is_ipv4 "$client" && is_ipv4 "${ADMIN_NETWORK%/*}"; then
    if ! ipv4_in_network "$client" "$ADMIN_NETWORK"; then
      warn "this SSH session comes from $client, outside the admin network $ADMIN_NETWORK: once the firewall is on, new SSH connections from $client are refused (this one stays open)"
    fi
  fi
}

# ---------------------------------------------------------------------------------------------
# Packages

install_packages() {
  if staging; then return 0; fi
  step "Installing packages"
  need_docker=0
  if [ "$NO_DOCKER" -eq 0 ] && ! command -v docker >/dev/null 2>&1; then need_docker=1; fi
  extra=
  if [ "$BUILD" -eq 1 ]; then extra=git; fi
  case "$PKG" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -q
      # shellcheck disable=SC2086 # $extra is empty or one word
      apt-get install -y -q ca-certificates curl nftables iptables $extra
      if [ "$need_docker" -eq 1 ]; then
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL "https://download.docker.com/linux/$DISTRO_ID/gpg" -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc
        printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
          "$(dpkg --print-architecture)" "$DISTRO_ID" "$DISTRO_CODENAME" >/etc/apt/sources.list.d/docker.list
        apt-get update -q
        apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      fi
      ;;
    dnf)
      # shellcheck disable=SC2086
      dnf -y -q install nftables curl $extra
      if [ "$need_docker" -eq 1 ]; then
        dnf -y -q install dnf-plugins-core
        dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
        dnf -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      fi
      ;;
  esac
  if [ "$NO_DOCKER" -eq 0 ]; then
    systemctl enable --now docker >/dev/null
    docker compose version >/dev/null 2>&1 || die "the Docker Compose plugin is missing: install docker-compose-plugin"
    say "Docker: $(docker --version)"
  fi
}

# ---------------------------------------------------------------------------------------------
# Files

# chown to the container's user, as root only (a --root run as a normal user skips it).
own() {
  if [ "$(id -u)" -eq 0 ]; then chown "$CONTAINER_UID:$CONTAINER_UID" "$@"; fi
}

prepare_dirs() {
  step "Preparing $INSTALL_DIR and $DATA_ROOT"
  install_dir=$(path "$INSTALL_DIR")
  mkdir -p "$install_dir" "$install_dir/firewall"
  chmod 0755 "$install_dir" "$install_dir/firewall"
  mkdir -p "$install_dir/secrets"
  chmod 0700 "$install_dir/secrets"
  data_dir=$(path "$DATA_ROOT")
  mkdir -p "$data_dir"
  chmod 0700 "$data_dir"
  own "$data_dir"
}

# has_secret FILE: FILE holds something besides whitespace (a blank secret is a missing one).
has_secret() {
  [ -s "$1" ] && grep -q '[^[:space:]]' "$1"
}

# kept_secrets: every secret is already in secrets/ (an earlier install's, such as those
# uninstall.sh keeps), so this run generates none.
kept_secrets() {
  for name in auth-secret app-key restic-password; do
    has_secret "$(path "$INSTALL_DIR/secrets")/$name" || return 1
  done
}

# The .env line PANGOLIN_BACKUP_REPOSITORY=... that uninstall.sh keeps with the secrets when it
# removes .env. Read once, by settle_all on a reinstall; write_env removes it.
kept_backup_record() {
  path "$INSTALL_DIR/secrets/.backup-repository"
}

# New secrets over an existing database would silently break it: TOTP sign-in, the restic
# repository and attachments all depend on the old ones. So when the data root already holds a
# database, every secret must already be there. main runs this once DATA_ROOT is settled and
# before anything is installed, created or written; it stops naming the missing ones.
check_secrets_for_database() {
  [ -e "$(path "$DATA_ROOT/pangolin.sqlite")" ] || return 0
  secrets=$(path "$INSTALL_DIR/secrets")
  missing=
  for name in auth-secret app-key restic-password; do
    has_secret "$secrets/$name" || missing="$missing $name"
  done
  [ -n "$missing" ] || return 0
  printf 'install.sh: %s\n' \
    "the data root $DATA_ROOT already holds a database, but these secrets are missing or empty" \
    "  in $INSTALL_DIR/secrets:$missing" \
    "New secrets would lock the household out of that database (sign-in codes, backups and" \
    "attachments all need the old ones), so nothing was changed. Either:" \
    "  - put the old secrets back from the recovery bundle, one value per file, then re-run" \
    "    install.sh:" \
    "      PANGOLIN_AUTH_SECRET -> $INSTALL_DIR/secrets/auth-secret" \
    "      PANGOLIN_APP_KEY     -> $INSTALL_DIR/secrets/app-key" \
    "      RESTIC_PASSWORD      -> $INSTALL_DIR/secrets/restic-password" \
    "    e.g.  sudo mkdir -p -m 0700 $INSTALL_DIR/secrets" \
    "          sudo tee $INSTALL_DIR/secrets/auth-secret > /dev/null" \
    "          (paste the value, Enter, then Ctrl-D: it stays out of your shell history)" \
    "    install.sh sets their modes and owners on the re-run." \
    "  - or, for a fresh install, move everything in $DATA_ROOT aside (keep it until you are sure" \
    "    you no longer need it) and re-run install.sh. That generates a new restic password, so" \
    "    the old backup repository can no longer be used: give it a new repository path with" \
    "    --backup-server." >&2
  exit 1
}

# 32 random bytes, base64 (url-safe and unpadded with `url`).
random_secret() {
  if [ "${1:-}" = url ]; then
    head -c 32 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_'
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
  printf '\n'
}

generate_secrets() {
  secrets=$(path "$INSTALL_DIR/secrets")
  for name in auth-secret app-key restic-password; do
    file=$secrets/$name
    if has_secret "$file"; then
      say "Kept the existing secret $name"
    else
      # Pending until write_bundle has put a bundle for these secrets in place, so a re-run after
      # an interrupted install still writes one. Made before the secret, so no new secret is
      # ever without it.
      mark_bundle_pending
      case "$name" in
        app-key) (umask 077 && random_secret >"$file.new") ;;
        *) (umask 077 && random_secret url >"$file.new") ;;
      esac
      mv "$file.new" "$file"
      GENERATED=1
      say "Generated the secret $name"
    fi
    # The auth secret and the restic password are mounted into the container (each as a single
    # read-only file), so they belong to the container's user; the restic password is 0400, as
    # the container only ever reads it. app-key stays root's until the story that uses it.
    case "$name" in
      auth-secret) chmod 0600 "$file" && own "$file" ;;
      restic-password) chmod 0400 "$file" && own "$file" ;;
      *) chmod 0600 "$file" ;;
    esac
  done
  if [ -n "$TOKEN_SOURCE" ]; then store_token; fi
}

# The mark that a recovery bundle is due and not yet in place (new secrets, --bundle, a backup
# server change): while it exists, every run writes the bundle. Root's only, beside the secrets.
pending_mark() {
  path "$INSTALL_DIR/secrets/.bundle-pending"
}

mark_bundle_pending() {
  (umask 077 && : >"$(pending_mark)")
  chmod 0600 "$(pending_mark)"
}

# Stores the GHCR token from --ghcr-token-file, --ghcr-token or the prompt (TOKEN_SOURCE).
store_token() {
  token_file=$(path "$INSTALL_DIR/secrets/ghcr-token")
  if [ "$TOKEN_SOURCE" = file ]; then
    (umask 077 && tr -d '\r\n' <"$ARG_TOKEN_FILE" >"$token_file.new")
  else
    (umask 077 && printf '%s' "$ARG_TOKEN" | tr -d '\r\n' >"$token_file.new")
  fi
  mv "$token_file.new" "$token_file"
  # Root's only: the container never needs it.
  chmod 0600 "$token_file"
  say "Stored the GHCR token"
}

# A recovery bundle's id: the UTC time and 4 random hex characters, e.g. 20261003T010203Z-a1b2.
# Not a secret: the server only compares it with the id `pangolin confirm-bundle` confirmed.
new_bundle_id() {
  printf '%s-%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' \n')"
}

# Every bundle written gets a new id in .env (PANGOLIN_RECOVERY_BUNDLE_ID, printed in the bundle
# too), so the server warns until that bundle's safe storage is confirmed (AD-27). A bundle is
# written when secrets were generated (this run, or a run that died before its bundle: the
# pending mark), when asked for with --bundle, or when the backup server was set or changed.
write_bundle() {
  if [ "$GENERATED" -eq 0 ] && [ "$BUNDLE" -eq 0 ] && [ "$BACKUP_CHANGED" -eq 0 ] &&
    [ ! -e "$(pending_mark)" ]; then
    return 0
  fi
  # Until the bundle is in place, so a run that dies before then is retried by the next.
  mark_bundle_pending
  secrets=$(path "$INSTALL_DIR/secrets")
  mkdir -p "$(path /root)"
  BUNDLE_PATH=/root/pangolin-recovery-bundle-$(date +%Y-%m-%d).txt
  bundle=$(path "$BUNDLE_PATH")
  previous_id=$(existing PANGOLIN_RECOVERY_BUNDLE_ID)
  BUNDLE_ID=$(new_bundle_id)
  while [ "$BUNDLE_ID" = "$previous_id" ]; do BUNDLE_ID=$(new_bundle_id); done
  (
    umask 077
    {
      printf '%s\n' "Pangolin Money recovery bundle for https://$PUBLIC_HOST, written $(date -u +%Y-%m-%dT%H:%M:%SZ)." \
        "Bundle id: $BUNDLE_ID" \
        "" \
        "Everything needed to restore this server onto a new host: without these, a backup cannot" \
        "be decrypted, attachments cannot be read and authenticator codes stop working." \
        "Store it offline (a password manager, or printed and locked away), then delete this file:" \
        "  shred -u $BUNDLE_PATH" \
        ""
      printf 'PANGOLIN_APP_KEY=%s\n' "$(cat "$secrets/app-key")"
      printf 'PANGOLIN_AUTH_SECRET=%s\n' "$(cat "$secrets/auth-secret")"
      printf 'RESTIC_PASSWORD=%s\n' "$(cat "$secrets/restic-password")"
      if [ -n "$BACKUP" ]; then printf 'RESTIC_REPOSITORY=%s\n' "$BACKUP"; fi
    } >"$bundle.new"
  )
  # The id goes into .env before the bundle is in place, so no bundle names an id the server
  # never sees.
  if env_has PANGOLIN_RECOVERY_BUNDLE_ID; then
    env_replace PANGOLIN_RECOVERY_BUNDLE_ID "$BUNDLE_ID"
  else
    env_add PANGOLIN_RECOVERY_BUNDLE_ID "$BUNDLE_ID"
  fi
  chmod 0600 "$(env_file)"
  mv "$bundle.new" "$bundle"
  chmod 0600 "$bundle"
  rm -f "$(pending_mark)"
  say "Recovery bundle id $BUNDLE_ID set in .env (PANGOLIN_RECOVERY_BUNDLE_ID)"
}

# Appends KEY=VALUE to .env unless KEY is already there.
env_add() {
  env=$(env_file)
  if env_has "$1"; then return 0; fi
  printf '%s=%s\n' "$1" "$2" >>"$env"
  ENV_ADDED="$ENV_ADDED $1"
}

# Replaces KEY's line in .env with KEY=VALUE (the first occurrence; later ones are dropped).
env_replace() {
  env=$(env_file)
  (
    umask 077
    awk -v key="$1" -v value="$2" '
      index($0, key "=") == 1 || $0 ~ "^[[:space:]]+" key "=" {
        if (!done) print key "=" value
        done = 1
        next
      }
      { print }' "$env" >"$env.new"
  )
  mv "$env.new" "$env"
}

write_env() {
  step "Writing $INSTALL_DIR/.env"
  env=$(env_file)
  if [ ! -f "$env" ]; then
    (
      umask 077
      printf '%s\n' "# Pangolin Money settings, read by compose.yaml and the container." \
        "# install.sh only adds missing keys (and replaces a key when --image, --build, --data-root," \
        "# --backup-server or --dns asks it to): your edits are kept. Secrets live in secrets/." >"$env"
    )
  fi
  chmod 0600 "$env"
  # The new backup server is about to be saved: mark its bundle due first, or a run that dies
  # before write_bundle leaves .env current and the bundle never written.
  if [ "$BACKUP_CHANGED" -eq 1 ]; then mark_bundle_pending; fi
  for key in $REPLACE; do
    case "$key" in
      PANGOLIN_IMAGE) env_replace "$key" "$IMAGE" ;;
      PANGOLIN_DATA_ROOT) env_replace "$key" "$DATA_ROOT" ;;
      PANGOLIN_BACKUP_REPOSITORY) env_replace "$key" "$BACKUP" ;;
      PANGOLIN_DNS_SERVERS) env_replace "$key" "$DNS_SERVERS" ;;
    esac
    say "Replaced $key in .env"
  done
  chmod 0600 "$env"
  ENV_ADDED=
  env_add PANGOLIN_PROXY_MODE "$PROXY_MODE"
  env_add PANGOLIN_IMAGE "$IMAGE"
  env_add PANGOLIN_PUBLIC_URL "$PUBLIC_URL"
  env_add PANGOLIN_TRUSTED_PROXIES "$NPM_HOST"
  env_add PANGOLIN_NPM_HOST "$NPM_HOST"
  env_add PANGOLIN_ADMIN_NETWORK "$ADMIN_NETWORK"
  env_add PANGOLIN_SSH_PORT "$SSH_PORT"
  env_add PANGOLIN_HTTP_PORT "$HTTP_PORT"
  env_add PANGOLIN_DNS_SERVERS "$DNS_SERVERS"
  env_add PANGOLIN_DATA_ROOT "$DATA_ROOT"
  if [ -n "$BACKUP" ]; then env_add PANGOLIN_BACKUP_REPOSITORY "$BACKUP"; fi
  if [ -n "$TANG_URL" ]; then env_add PANGOLIN_TANG_URL "$TANG_URL"; fi
  # An install from before bundle ids (story 1.17), or with an empty one, gets an id now, so the
  # server warns until the bundle it already has is confirmed stored safely; no bundle is
  # written for it. When this run writes a bundle (new secrets, a pending mark, --bundle or a
  # backup server set or changed), write_bundle sets the id instead.
  if [ -z "$(existing PANGOLIN_RECOVERY_BUNDLE_ID)" ] && [ "$GENERATED" -eq 0 ] && [ "$BUNDLE" -eq 0 ] &&
    [ ! -e "$(pending_mark)" ] && [ "$BACKUP_CHANGED" -eq 0 ]; then
    if env_has PANGOLIN_RECOVERY_BUNDLE_ID; then
      env_replace PANGOLIN_RECOVERY_BUNDLE_ID "$(new_bundle_id)"
      ENV_ADDED="$ENV_ADDED PANGOLIN_RECOVERY_BUNDLE_ID"
    else
      env_add PANGOLIN_RECOVERY_BUNDLE_ID "$(new_bundle_id)"
    fi
    NEW_BUNDLE_ID=1
  fi
  if [ "$SELINUX" -eq 1 ]; then
    env_add PANGOLIN_DATA_MOUNT_MODE "rw,Z"
    env_add PANGOLIN_SECRETS_MOUNT_MODE "ro,Z"
  fi
  # .env holds the backup server now: uninstall.sh's record of the old one has done its job.
  rm -f "$(kept_backup_record)"
  if [ -n "$ENV_ADDED" ]; then say "Added:$ENV_ADDED"; else say "Nothing to add; every key was already set"; fi
  if [ "$BACKUP_OFF" -eq 1 ]; then
    if [ "$NO_DOCKER" -eq 1 ]; then
      say "Backups are off in .env (--backup-server \"\"): the server stops scheduling them once the stack restarts (not done with --no-docker)"
    else
      say "Backups are off in .env (--backup-server \"\"): the server stops scheduling them when this run restarts the stack"
    fi
  fi
  trusted=$(existing PANGOLIN_TRUSTED_PROXIES)
  if [ "$trusted" != "$NPM_HOST" ]; then
    warn "PANGOLIN_TRUSTED_PROXIES=$trusted differs from PANGOLIN_NPM_HOST=$NPM_HOST in .env: client addresses from NPM are not believed unless it lists the NPM host"
  fi
}

# ---------------------------------------------------------------------------------------------
# Image and support files

compose() {
  docker compose --project-directory "$INSTALL_DIR" -f "$INSTALL_DIR/compose.yaml" "$@"
}

# What building on this VM reaches: the repository (also for a later git pull in the clone) and
# the release downloads it redirects to (the restic binary),
# Docker Hub for the base image, and npm for pnpm and the dependencies.
BUILD_HOSTS="github.com:443 release-assets.githubusercontent.com:443 objects.githubusercontent.com:443 registry.npmjs.org:443 registry-1.docker.io:443 auth.docker.io:443 production.cloudflare.docker.com:443 production.cloudfront.docker.com:443"

# The comment above the backup server's allowlist entry: allowlist_remove finds what
# allowlist_add (or a fresh allowlist.conf) wrote under it.
BACKUP_ALLOWLIST_LABEL="Backup server (restic REST)"

# allowlist_add FILE COMMENT ENTRY...: appends the entries FILE lacks, under COMMENT. True when it
# added any.
allowlist_add() {
  allowlist_file=$1
  allowlist_comment=$2
  shift 2
  missing=
  for entry in "$@"; do
    grep -Fqx "$entry" "$allowlist_file" || missing="$missing $entry"
  done
  [ -n "$missing" ] || return 1
  printf '\n# %s (added by install.sh)\n' "$allowlist_comment" >>"$allowlist_file"
  for entry in $missing; do printf '%s\n' "$entry" >>"$allowlist_file"; done
  say "Added to allowlist.conf:$missing"
}

# allowlist_remove FILE COMMENT ENTRY: drops ENTRY where it sits directly under a line starting
# "# COMMENT" (install.sh's own, as allowlist_add writes it), with that line and the blank line
# before it. A line equal to ENTRY that is not under it is the operator's: it stays, and so says.
# True when it removed any.
allowlist_remove() {
  grep -Fqx "$3" "$1" || return 1
  awk -v entry="$3" -v comment="# $2" '
    { line[NR] = $0 }
    END {
      for (i = 2; i <= NR; i++) {
        if (line[i] != entry || index(line[i - 1], comment) != 1) continue
        drop[i] = 1
        drop[i - 1] = 1
        if (i > 2 && line[i - 2] == "") drop[i - 2] = 1
      }
      for (i = 1; i <= NR; i++) if (!drop[i]) print line[i]
    }' "$1" >"$1.new"
  if cmp -s "$1" "$1.new"; then
    rm -f "$1.new"
    say "Kept $3 in allowlist.conf: install.sh did not write it there"
    return 1
  fi
  chmod 0644 "$1.new"
  mv "$1.new" "$1"
  say "Removed from allowlist.conf: $3"
}

# On a re-run the firewall is already on: an allowlist change must be applied before the step
# that needs it. (A first install turns the firewall on only after writing allowlist.conf.)
# `apply_allowlist_now early`, before write_env has stored a new --dns, only warns when the reload
# fails: stale resolvers in .env can make it refuse, and the firewall step applies it again.
apply_allowlist_now() {
  if ! staging && systemctl is-active --quiet pangolin-allowlist.timer 2>/dev/null; then
    if ! systemctl start pangolin-allowlist.service; then
      [ "${1:-}" = early ] ||
        die "the firewall did not reload: see 'journalctl -u pangolin-allowlist.service'"
      warn "the firewall did not reload yet (see 'journalctl -u pangolin-allowlist.service'); it is applied again after .env is written"
    fi
  fi
}

add_build_hosts() {
  # shellcheck disable=SC2086 # one word per host
  allowlist_add "$1" "install.sh --build: building the image on this VM, and git in its clone" $BUILD_HOSTS
}

allow_build_hosts() {
  allowlist=$(path "$INSTALL_DIR/allowlist.conf")
  [ -f "$allowlist" ] || return 0
  if add_build_hosts "$allowlist"; then apply_allowlist_now; fi
}

# The hosts apt fetches from, as allowlist entries (host:80 or host:443, or the URI's own port):
# every http(s) URI in sources.list, sources.list.d/*.list and deb822 *.sources files.
apt_mirror_entries() {
  for file in "$(path /etc/apt/sources.list)" "$(path /etc/apt/sources.list.d)"/*.list \
    "$(path /etc/apt/sources.list.d)"/*.sources; do
    [ -f "$file" ] || continue
    grep -v '^[[:space:]]*#' "$file" | grep -Eo 'https?://[^/[:space:]]+' || true
  done | awk -F'://' '{
      host = $2; sub(/^[^@]*@/, "", host)
      if (host ~ /:[0-9]+$/) { print host } else { print host ":" ($1 == "https" ? 443 : 80) }
    }' | sort -u
}

# apt must reach the mirrors this VM actually uses (install.sh itself runs apt-get update).
allow_package_mirrors() {
  [ "$PKG" = apt ] || return 0
  allowlist=$(path "$INSTALL_DIR/allowlist.conf")
  [ -f "$allowlist" ] || return 0
  # shellcheck disable=SC2046 # one entry per word
  if allowlist_add "$allowlist" "apt mirrors this VM uses" $(apt_mirror_entries); then
    # Runs before write_env: a --dns repair is not in .env yet.
    apply_allowlist_now early
  fi
}

build_image() {
  allow_build_hosts
  step "Building $IMAGE from $REPO at ${REF:-its default branch}"
  src=$(path "$INSTALL_DIR/src")
  # With no --ref, build the repository's default branch (HEAD) rather than assume its name.
  if [ -d "$src/.git" ]; then
    git -C "$src" fetch --depth 1 origin "${REF:-HEAD}"
    git -C "$src" checkout --quiet --force FETCH_HEAD
  elif [ -n "$REF" ]; then
    git clone --quiet --depth 1 --branch "$REF" "$REPO" "$src"
  else
    git clone --quiet --depth 1 "$REPO" "$src"
  fi
  version=${REF:-$(git -C "$src" rev-parse --short HEAD)}
  docker build --build-arg "PANGOLIN_VERSION=$version" -t pangolin:local "$src"
}

# Signs in to ghcr.io with the stored token, when there is one and the image is on GHCR.
ghcr_login() {
  token_file=$(path "$INSTALL_DIR/secrets/ghcr-token")
  [ -s "$token_file" ] || return 0
  case "$IMAGE" in
    ghcr.io/*)
      user=$ARG_GHCR_USER
      if [ -z "$user" ]; then
        user=${IMAGE#ghcr.io/}
        user=${user%%/*}
      fi
      docker login ghcr.io --username "$user" --password-stdin <"$token_file" >/dev/null ||
        return 1
      say "Signed in to ghcr.io as $user"
      ;;
  esac
}

pull_image() {
  step "Pulling $IMAGE"
  docker pull "$IMAGE"
}

# The pull failed: the registry refuses a private image without a token, and answers the same
# "denied" for an image that was never published. Offer both ways out, or name them and stop.
pull_failed() {
  printf '\nCould not pull %s.\n' "$IMAGE" >&2
  printf '%s\n' \
    "The registry refused it: either no release has been published yet, or the image is" \
    "private and needs a read-only token (packages: read)." >&2
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    die "re-run with --build to build the image on this VM, or with --ghcr-token-file FILE for a private image"
  fi
  while :; do
    choice=$(ask "Build it here from $REPO (${REF:-default branch}) [b], give a GHCR token [t], or quit [q]?" b)
    case "$choice" in
      b | B | build)
        BUILD=1
        IMAGE=pangolin:local
        env_replace PANGOLIN_IMAGE "$IMAGE"
        say "Replacing PANGOLIN_IMAGE in .env: $IMAGE"
        build_image
        return 0
        ;;
      t | T | token)
        ARG_TOKEN=$(ask_secret "GHCR read-only token (packages: read)")
        if [ -z "$ARG_TOKEN" ]; then
          say "No token entered."
          continue
        fi
        TOKEN_SOURCE=arg
        store_token
        ARG_TOKEN=
        if ! ghcr_login; then
          say "ghcr.io did not accept that token."
          continue
        fi
        if pull_image; then return 0; fi
        printf '\nStill could not pull %s with that token.\n' "$IMAGE" >&2
        ;;
      q | Q | quit) die "stopped: re-run with --build, or with --ghcr-token-file FILE" ;;
      *) say "Answer b, t or q." ;;
    esac
  done
}

obtain_image() {
  run_stack || return 0
  if [ "$BUILD" -eq 1 ]; then
    build_image
    return 0
  fi
  case "$IMAGE" in
    */*) ;;
    *)
      # A local image (e.g. pangolin:local from --build) is never pulled.
      docker image inspect "$IMAGE" >/dev/null 2>&1 ||
        die "the local image $IMAGE does not exist here: re-run with --build to build it, or with --image and a registry image"
      say "Using the local image $IMAGE"
      return 0
      ;;
  esac
  ghcr_login || say "ghcr.io did not accept the stored token."
  if pull_image; then return 0; fi
  pull_failed
}

# Where compose.yaml, allowlist.conf.default and firewall/ come from: next to this script (a
# checkout), the --build clone, or the image itself (/app/deploy) for a lone downloaded script.
# A re-run that keeps an image `pangolin upgrade` pinned by digest takes compose.yaml and the
# pangolin command from that image, as a lone script does, so they match the image that runs
# rather than this checkout (seam S11e). Sets PINNED to the image's deploy directory, or leaves
# it empty: a tag-pinned image, --image, --build or --no-docker use the checkout's files.
PINNED=
take_pinned_files() {
  [ -z "$ARG_IMAGE" ] && [ "$BUILD" -eq 0 ] && run_stack || return 0
  case "$IMAGE" in *@sha256:*) ;; *) return 0 ;; esac
  # Already taken from the image (a lone script).
  [ "$SUPPORT" != "$WORK/deploy" ] || return 0
  if ! container=$(docker create "$IMAGE" 2>/dev/null); then
    warn "could not read the pinned image $IMAGE: compose.yaml and the pangolin command come from this checkout"
    return 0
  fi
  if ! docker cp "$container:/app/deploy" "$WORK/pinned" >/dev/null; then
    warn "could not copy /app/deploy out of the pinned image $IMAGE: compose.yaml and the pangolin command come from this checkout"
  elif [ ! -f "$WORK/pinned/compose.yaml" ]; then
    warn "the pinned image $IMAGE has no /app/deploy/compose.yaml: compose.yaml and the pangolin command come from this checkout"
  else
    PINNED=$WORK/pinned
    say "Taking compose.yaml and the pangolin command from the pinned image $IMAGE"
  fi
  docker rm "$container" >/dev/null 2>&1 || true
}

locate_support() {
  script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || script_dir=
  for candidate in "$script_dir" "$(path "$INSTALL_DIR/src/deploy")"; do
    if [ -n "$candidate" ] && [ -f "$candidate/compose.yaml" ] &&
      [ -f "$candidate/allowlist.conf.default" ] && [ -f "$candidate/firewall/render.sh" ]; then
      SUPPORT=$candidate
      return 0
    fi
  done
  if staging || [ "$NO_DOCKER" -eq 1 ]; then
    die "compose.yaml, allowlist.conf.default and firewall/ must sit next to install.sh"
  fi
  container=$(docker create "$IMAGE")
  if ! docker cp "$container:/app/deploy" "$WORK/deploy" >/dev/null; then
    docker rm "$container" >/dev/null
    die "the image $IMAGE has no /app/deploy: run install.sh from a checkout of the repository"
  fi
  docker rm "$container" >/dev/null
  SUPPORT=$WORK/deploy
}

# Mirror hosts the default allowlist (Debian) does not cover.
distro_allowlist() {
  case "$DISTRO_ID" in
    ubuntu)
      printf '%s\n' "" "# Ubuntu packages (added by install.sh)" "archive.ubuntu.com:80" \
        "archive.ubuntu.com:443" "security.ubuntu.com:80" "security.ubuntu.com:443" \
        "ports.ubuntu.com:80"
      ;;
    rocky)
      printf '%s\n' "" "# Rocky Linux packages (added by install.sh)" \
        "mirrors.rockylinux.org:443" "dl.rockylinux.org:443"
      ;;
  esac
}

# allowlist.conf: written fresh on a first install; on a re-run the operator's file is kept and
# only install.sh's own entries (backup server, Tang server) are added or dropped.
write_allowlist() {
  allowlist=$(path "$INSTALL_DIR/allowlist.conf")
  tang_entry=$(url_entry "$TANG_URL")
  if [ -f "$allowlist" ]; then
    say "Kept the existing allowlist.conf"
    # Backups turned off: the entry install.sh added for the old repository goes (unless the Tang
    # server shares it); any line the operator wrote stays.
    entry=$(url_entry "$OLD_BACKUP")
    if [ "$BACKUP_OFF" -eq 1 ] && [ -n "$entry" ] && [ "$entry" != "$tang_entry" ] &&
      allowlist_remove "$allowlist" "$BACKUP_ALLOWLIST_LABEL" "$entry"; then
      apply_allowlist_now
    fi
    entry=$(url_entry "$BACKUP")
    if [ -n "$entry" ] && ! grep -Fqx "$entry" "$allowlist"; then
      allowlist_add "$allowlist" "$BACKUP_ALLOWLIST_LABEL" "$entry" || true
      apply_allowlist_now
    fi
    # Without Tang the data disk does not unlock at boot, so its entry is added back.
    if [ -n "$tang_entry" ] && ! grep -Fqx "$tang_entry" "$allowlist"; then
      printf '%s\n' "" "# Tang server: unlocks the data disk (added by install.sh)" "$tang_entry" >>"$allowlist"
      say "Added the Tang server $tang_entry to allowlist.conf"
    fi
  else
    {
      cat "$SUPPORT/allowlist.conf.default"
      distro_allowlist
      entry=$(url_entry "$BACKUP")
      if [ -n "$entry" ]; then printf '%s\n' "" "# $BACKUP_ALLOWLIST_LABEL" "$entry"; fi
      if [ -n "$tang_entry" ]; then
        printf '%s\n' "" "# Tang server: unlocks the data disk" "$tang_entry"
      fi
    } >"$allowlist.new"
    if [ "$PKG" = apt ]; then
      # shellcheck disable=SC2046 # one entry per word
      allowlist_add "$allowlist.new" "apt mirrors this VM uses" $(apt_mirror_entries) || true
    fi
    if [ "$BUILD" -eq 1 ]; then add_build_hosts "$allowlist.new" || true; fi
    chmod 0644 "$allowlist.new"
    mv "$allowlist.new" "$allowlist"
    say "Wrote allowlist.conf"
  fi
}

write_data_dropin() {
  units=$(path /etc/systemd/system)
  # Docker (and so the app) must not start without the encrypted data disk mounted: otherwise
  # it would create a fresh database and setup link on the empty system-disk directory.
  if data_root_is_mount; then
    mkdir -p "$units/docker.service.d"
    printf '%s\n' "# Written by Pangolin Money's install.sh: Docker waits for the data disk." \
      "[Unit]" "RequiresMountsFor=$DATA_ROOT" >"$units/docker.service.d/pangolin-data.conf"
    chmod 0644 "$units/docker.service.d/pangolin-data.conf"
  elif [ -f "$units/docker.service.d/pangolin-data.conf" ] &&
    ! grep -qx "RequiresMountsFor=$DATA_ROOT" "$units/docker.service.d/pangolin-data.conf"; then
    # Left by an earlier run for another data root that was a mount point: it would hold Docker
    # at boot waiting for that disk. One for this data root stays, even while its disk is not
    # mounted, so Docker never starts the app on the empty system-disk directory.
    rm -f "$units/docker.service.d/pangolin-data.conf"
    rmdir "$units/docker.service.d" 2>/dev/null || true
    say "Removed the Docker drop-in that waited for the previous data disk"
  fi
}

write_files() {
  step "Writing compose.yaml, the allowlist and the firewall"
  install_dir=$(path "$INSTALL_DIR")
  cp "${PINNED:-$SUPPORT}/compose.yaml" "$install_dir/compose.yaml.new"
  cp "$SUPPORT/cosign.pub" "$install_dir/cosign.pub"
  chmod 0644 "$install_dir/compose.yaml.new"
  mv "$install_dir/compose.yaml.new" "$install_dir/compose.yaml"

  # render.sh before write_allowlist: on a re-run its reload (apply_allowlist_now) runs the
  # render.sh this run installs, not the previous release's. The units stay below: that reload
  # does not daemon-reload, so systemd keeps the loaded ones until install_firewall does.
  cp "$SUPPORT/firewall/render.sh" "$install_dir/firewall/render.sh.new"
  chmod 0755 "$install_dir/firewall/render.sh.new"
  mv "$install_dir/firewall/render.sh.new" "$install_dir/firewall/render.sh"

  write_allowlist

  # The admin CLI on the host: `pangolin status`, `pangolin reset-user` (run in the container).
  cli=$SUPPORT/pangolin
  if [ -n "$PINNED" ] && [ -f "$PINNED/pangolin" ]; then cli=$PINNED/pangolin; fi
  if [ -f "$cli" ]; then
    bin=$(path /usr/local/bin)
    mkdir -p "$bin"
    cp "$cli" "$bin/pangolin.new"
    chmod 0755 "$bin/pangolin.new"
    mv "$bin/pangolin.new" "$bin/pangolin"
    say "Installed the pangolin command to /usr/local/bin/pangolin"
  else
    warn "this release has no pangolin command (deploy/pangolin); install a newer release for 'pangolin status'"
  fi
  units=$(path /etc/systemd/system)
  mkdir -p "$units"
  for unit in pangolin-firewall.service pangolin-allowlist.service pangolin-allowlist.timer; do
    cp "$SUPPORT/firewall/$unit" "$units/$unit"
    chmod 0644 "$units/$unit"
  done

  write_data_dropin
}

# enable_unit UNIT TARGET: `systemctl enable`, or under --root the symlink it would create.
enable_unit() {
  if staging; then
    wants=$(path "/etc/systemd/system/$2.wants")
    mkdir -p "$wants"
    ln -sf "/etc/systemd/system/$1" "$wants/$1"
  else
    systemctl enable --quiet "$1"
  fi
}

install_firewall() {
  render=$(path "$INSTALL_DIR/firewall/render.sh")
  if staging; then
    # Nothing is loaded and names are not resolved: the saved ruleset the early unit would load
    # holds no allowlisted addresses yet. The host's resolvers are read under --root too.
    (
      PANGOLIN_RESOLV_CONF=$(path /etc/resolv.conf)
      PANGOLIN_RESOLVED_CONF=$(path /run/systemd/resolve/resolv.conf)
      export PANGOLIN_RESOLV_CONF PANGOLIN_RESOLVED_CONF
      sh "$render" --home "$(path "$INSTALL_DIR")" --no-resolve ruleset >"$(path "$INSTALL_DIR/firewall/pangolin.nft")"
      sh "$render" --home "$(path "$INSTALL_DIR")" --no-resolve proxmox >"$(path "$INSTALL_DIR/proxmox-firewall.txt")"
    )
    enable_unit pangolin-firewall.service sysinit.target
    enable_unit pangolin-allowlist.service multi-user.target
    enable_unit pangolin-allowlist.timer timers.target
    return 0
  fi
  step "Turning on the firewall"
  if [ "$PKG" = dnf ] && systemctl is-active --quiet firewalld 2>/dev/null; then
    # Unproven: firewalld keeps its own table, which must also accept this traffic.
    family=ipv4
    firewall-cmd --quiet --permanent --add-rich-rule="rule family=$family source address=$NPM_HOST port port=$HTTP_PORT protocol=tcp accept"
    if is_ipv6 "${ADMIN_NETWORK%/*}"; then family=ipv6; fi
    firewall-cmd --quiet --permanent --add-rich-rule="rule family=$family source address=$ADMIN_NETWORK port port=$SSH_PORT protocol=tcp accept"
    firewall-cmd --quiet --reload
  fi
  if systemctl is-enabled --quiet nftables 2>/dev/null; then
    warn "nftables.service is enabled: its 'flush ruleset' on restart clears Docker's rules and Pangolin's until the next timer run; consider 'systemctl disable nftables'"
  fi
  systemctl daemon-reload
  enable_unit pangolin-allowlist.service multi-user.target
  enable_unit pangolin-allowlist.timer timers.target
  # Resolves the allowlist, loads the ruleset and saves it as firewall/pangolin.nft ...
  applied=1
  before=$(systemctl show -p InvocationID --value pangolin-allowlist.service 2>/dev/null || true)
  systemctl start pangolin-allowlist.service || applied=0
  # ... which pangolin-firewall.service loads early at every boot, before the network and Docker
  # (falling back to a fail-closed ruleset when the saved file is missing or does not load).
  enable_unit pangolin-firewall.service sysinit.target
  if [ "$applied" -eq 0 ]; then
    # render.sh's own reason (such as no allowlist host resolving, with the --dns fix), from
    # this run of the unit only (none when it never started), the refusal first.
    journalctl --sync 2>/dev/null || true
    invocation=$(systemctl show -p InvocationID --value pangolin-allowlist.service 2>/dev/null || true)
    if [ -n "$invocation" ] && [ "$invocation" != "$before" ]; then
      lines=$(journalctl -q --no-pager -o cat "_SYSTEMD_INVOCATION_ID=$invocation" 2>/dev/null |
        grep '^render\.sh:' || true)
      if [ -n "$lines" ]; then
        printf '%s\n' "$lines" | grep 'no allowlist host resolved' >&2 || true
        printf '%s\n' "$lines" | grep -v 'no allowlist host resolved' | tail -n 20 >&2 || true
      fi
    fi
    systemctl start pangolin-firewall.service || true
    die "the firewall ruleset was not applied (the previous ruleset, or on a first install a fail-closed one, is in place): see 'journalctl -u pangolin-allowlist.service'"
  fi
  systemctl start pangolin-firewall.service
  systemctl start pangolin-allowlist.timer
  say "nftables ruleset loaded and saved; it loads early at boot, and pangolin-allowlist.timer re-resolves the allowlist every 15 minutes"
}

# ---------------------------------------------------------------------------------------------
# Stack

start_stack() {
  run_stack || return 0
  step "Starting the stack"
  # Flushing the whole ruleset (nft flush ruleset, or restarting nftables.service) also removes
  # Docker's own chains, and containers then fail to publish ports. Restarting Docker rebuilds them.
  if ! staging && command -v iptables >/dev/null 2>&1 && ! iptables -t nat -n -L DOCKER >/dev/null 2>&1; then
    warn "Docker's firewall chains are missing (was the ruleset flushed?); restarting Docker to rebuild them"
    systemctl restart docker
  fi
  compose up -d --force-recreate --remove-orphans
}

wait_healthy() {
  run_stack || return 0
  step "Waiting for /healthz (up to $HEALTH_TIMEOUT s)"
  waited=0
  status=starting
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    id=$(compose ps -q pangolin 2>/dev/null || true)
    if [ -n "$id" ]; then
      status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo missing)
      if [ "$status" = healthy ]; then
        say "Healthy after $waited s"
        return 0
      fi
    fi
    sleep 3
    waited=$((waited + 3))
  done
  printf '\nThe container is not healthy after %s s (status: %s). Its last log lines:\n\n' "$HEALTH_TIMEOUT" "$status" >&2
  compose logs --no-color --tail 40 pangolin >&2 || true
  die "the stack did not become healthy; fix the cause above, then re-run install.sh"
}

vm_address() {
  if staging; then
    echo "<the VM IP address>"
    return 0
  fi
  address=$(ip -4 route get "$NPM_HOST" 2>/dev/null |
    awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }' || true)
  echo "${address:-<the VM IP address>}"
}

summary() {
  host=${PUBLIC_URL#https://}
  host=${host#http://}
  step "Nginx Proxy Manager: add a Proxy Host"
  printf '%s\n' \
    "  Details" \
    "    Domain Names            $host" \
    "    Scheme                  http" \
    "    Forward Hostname / IP   $(vm_address)" \
    "    Forward Port            $HTTP_PORT" \
    "    Cache Assets            off" \
    "    Block Common Exploits   on" \
    "    Websockets Support      off" \
    "  SSL" \
    "    SSL Certificate         request a new one (or choose yours)" \
    "    Force SSL, HTTP/2 Support, HSTS Enabled: on" \
    "  NPM sends X-Forwarded-For; Pangolin believes it only from $NPM_HOST." \
    "  Check it afterwards: curl https://$host/healthz  ->  {\"ok\":true,...}" \
    "  (with \"warnings\":[\"recovery-bundle-unconfirmed\"] until you run: sudo pangolin confirm-bundle)"

  proxmox=$(path "$INSTALL_DIR/proxmox-firewall.txt")
  if [ -f "$proxmox" ]; then
    step "Optional: Proxmox VM firewall rules (also in $INSTALL_DIR/proxmox-firewall.txt)"
    cat "$proxmox"
  fi

  if [ -n "$BUNDLE_PATH" ]; then
    step "Recovery bundle"
    if [ "$BACKUP_CHANGED" -eq 1 ]; then
      say "  Rewritten to include the backup repository ($BACKUP): store this one in place of the old."
    fi
    printf '%s\n' \
      "  $BUNDLE_PATH" \
      "  holds the application key, auth secret and restic password: everything a restore onto a" \
      "  new host needs. Store it offline now (a password manager, or printed and locked away)," \
      "  then delete it: shred -u $BUNDLE_PATH" \
      "  It is written again with install.sh --bundle, when the backup server changes, or on the" \
      "  next run if this one stops before the bundle is in place" \
      "  Its id is $BUNDLE_ID. Once it is stored safely, run: sudo pangolin confirm-bundle" \
      "  (pangolin status warns until you do)"
  elif [ "$NEW_BUNDLE_ID" -eq 1 ]; then
    step "Recovery bundle"
    printf '%s\n' \
      "  This install now tracks whether its recovery bundle is stored safely (bundle id" \
      "  $(existing PANGOLIN_RECOVERY_BUNDLE_ID) in .env). Once the bundle you already have is stored" \
      "  offline, run: sudo pangolin confirm-bundle  (or write a new one with install.sh --bundle)"
  fi

  step "First login"
  if [ "$NO_DOCKER" -eq 1 ] || staging; then
    say "  (--no-docker: the stack was not started here.)"
  fi
  link_file=$(path "$DATA_ROOT/setup-link.txt")
  if [ -s "$link_file" ]; then
    say "  Open this one-time link through NPM within 24 hours to create the first login:"
    say "  $(head -n 1 "$link_file")"
  elif [ ! -e "$(path "$DATA_ROOT/pangolin.sqlite")" ]; then
    say "  The server has not run yet; on first boot it writes the link to $DATA_ROOT/setup-link.txt"
  else
    say "  An account already exists, so there is no setup link: sign in at $PUBLIC_URL"
  fi

  step "Administration"
  printf '%s\n' "  sudo pangolin status                 is the server up and ready, its jobs and last backup?" \
    "  sudo pangolin backup                 back up now (nightly at 02:30 otherwise)" \
    "  sudo pangolin restore [latest|ID]    stop, verify and swap in a backup, start again (asks about credentials)" \
    "  sudo pangolin reset-user <email>     both of you locked out: clears that person's sign-in" \
    "                                       and prints a 24-hour link to set it up again" \
    "  sudo pangolin confirm-bundle         the recovery bundle is stored safely offline: ends" \
    "                                       status's warning until a new bundle is written"

  if [ "$WARNINGS" -gt 0 ]; then
    printf '\nFinished with %s warning(s); see the WARNING lines above.\n' "$WARNINGS"
  else
    printf '\nFinished.\n'
  fi
}

main() {
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  parse_args "$@"
  require_root
  if [ "$NON_INTERACTIVE" -eq 0 ] && ! has_tty; then
    die "no terminal to ask on: pass --non-interactive with the answers as flags (see --help)"
  fi
  WORK=$(mktemp -d)
  say "Pangolin Money installer"
  detect_distro
  settings
  settle_all
  check_host
  check_secrets_for_database
  check_ssh_session
  allow_package_mirrors
  install_packages
  prepare_dirs
  generate_secrets
  write_env
  write_bundle
  obtain_image
  locate_support
  take_pinned_files
  write_files
  install_firewall
  start_stack
  wait_healthy
  summary
}

main "$@"
