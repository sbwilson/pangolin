#!/bin/sh
# Usage: previous-db.sh <image> <data-dir>
# Creates the database a release's image makes on first boot: pulls <image>, runs it on
# <data-dir> as deploy/compose.yaml runs it (read-only root, no capabilities, tmpfs /tmp and
# /run), waits for /healthz, stops it, and hands <data-dir> to the calling user. The container
# is always removed on exit.
# Fails naming the image when the pull fails, it cannot start or it never becomes healthy (then
# after its logs), and when it left no pangolin.sqlite in <data-dir>.
# PANGOLIN_PREVIOUS_TIMEOUT (seconds, default 120) and PANGOLIN_PREVIOUS_POLL (seconds,
# default 3), both positive whole numbers, set how long and how often /healthz is polled.
set -eu

[ $# -eq 2 ] || { echo "Usage: previous-db.sh <image> <data-dir>" >&2; exit 2; }
image=$1
data=$2
timeout=${PANGOLIN_PREVIOUS_TIMEOUT:-120}
poll=${PANGOLIN_PREVIOUS_POLL:-3}
name=pangolin-previous
for value in "$timeout" "$poll"; do
  case $value in
    # A leading zero is refused too: `$((08))` is invalid octal and `00` would never advance.
    '' | *[!0-9]* | 0*)
      echo "PANGOLIN_PREVIOUS_TIMEOUT and PANGOLIN_PREVIOUS_POLL must be positive whole numbers" >&2
      exit 2
      ;;
  esac
done

if ! docker pull "$image"; then
  tag=${image##*:}
  echo "::error::Cannot pull $image. If $tag is a release that failed its gates, it has no image: delete the tag (git push --delete origin $tag && git tag -d $tag) before pushing the next one." >&2
  exit 1
fi

trap 'docker rm -f "$name" > /dev/null 2>&1 || true' EXIT

mkdir -p "$data"
sudo chown 1000:1000 "$data"
if ! docker run -d --name "$name" --init --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:mode=1777,size=64m --tmpfs /run:mode=0700,uid=1000,gid=1000,size=1m \
  -e PANGOLIN_DATA_DIR=/data -v "$data":/data -p 127.0.0.1:3000:3000 "$image"; then
  if docker container inspect "$name" > /dev/null 2>&1; then docker logs "$name" || true; fi
  echo "::error::Cannot start $image" >&2
  exit 1
fi

healthy=false
waited=0
while :; do
  if curl -fsS --connect-timeout "$poll" --max-time "$poll" http://127.0.0.1:3000/healthz > /dev/null; then
    healthy=true
    break
  fi
  [ "$waited" -lt "$timeout" ] || break
  sleep "$poll"
  waited=$((waited + poll))
done

stopped=true
docker stop "$name" || stopped=false
if [ "$healthy" != true ]; then
  docker logs "$name" || true
  echo "::error::$image never became healthy within ${timeout}s" >&2
  exit 1
fi
if [ "$stopped" != true ]; then
  docker logs "$name" || true
  echo "::error::Cannot stop $image cleanly" >&2
  exit 1
fi
sudo chown -R "$(id -u):$(id -g)" "$data"
if [ ! -f "$data/pangolin.sqlite" ]; then
  echo "::error::No pangolin.sqlite in $data after first boot of $image" >&2
  exit 1
fi
