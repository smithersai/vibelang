#!/bin/sh
# Runs a bounded rotating slice of Fuzz targets so each scheduled nightly
# finishes within the 24-hour target budget (#476), replacing the unbounded
# crontab loop that previously took ~281 hours across all 843 targets.
#
# Environment:
#   NIGHTLY_ROOT          State and run output directory (default: $HOME/es-nightly)
#   NIGHTLY_TARGETS       Targets per night (default: 40)
#   NIGHTLY_TARGET_TIME   Per-target fuzztime (default: 20m)
#   NIGHTLY_PARALLEL      Fuzz workers per target (default: 16)
#   NIGHTLY_MIN_FREE_GB   Minimum free GiB required on $NIGHTLY_ROOT (default: 40)
#   NIGHTLY_GO            Go binary (default: go; override in tests)
#   NIGHTLY_CAMPAIGN      Campaign script path (default: typescript/tsc/internal/vibelangfuzz/campaign.sh)
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
root=${NIGHTLY_ROOT:-$HOME/es-nightly}
slice_size=${NIGHTLY_TARGETS:-40}
target_time=${NIGHTLY_TARGET_TIME:-20m}
parallel=${NIGHTLY_PARALLEL:-16}
min_free_gb=${NIGHTLY_MIN_FREE_GB:-40}
go_bin=${NIGHTLY_GO:-go}
campaign=${NIGHTLY_CAMPAIGN:-$repo/typescript/tsc/internal/vibelangfuzz/campaign.sh}

case "$slice_size" in
  ''|*[!0-9]*) echo "nightly-fuzz: NIGHTLY_TARGETS must be a positive integer, got $slice_size" >&2; exit 2 ;;
esac
[ "$slice_size" -gt 0 ] || { echo "nightly-fuzz: NIGHTLY_TARGETS must be > 0" >&2; exit 2; }

mkdir -p "$root/runs"
lock_dir="$root/lock.d"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "$(date -u +%FT%TZ) another run holds $lock_dir; skipping"
  exit 0
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

free_gb=$(df -Pk "$root" | awk 'NR == 2 { print int($4 / 1048576) }')
if [ "$free_gb" -lt "$min_free_gb" ]; then
  echo "$(date -u +%FT%TZ) only ${free_gb} GB free (need ${min_free_gb} GB); skipping"
  exit 0
fi

targets_file="$root/targets.tmp.$$"
trap 'rm -f "$targets_file"; rmdir "$lock_dir" 2>/dev/null || true' EXIT

(cd "$repo/typescript/tsc" && GOFLAGS= "$go_bin" test -list '^Fuzz' ./internal/vibelangfuzz/) | grep '^Fuzz' | sort -u > "$targets_file"
total=$(wc -l < "$targets_file" | tr -d ' ')
if [ "$total" -eq 0 ]; then
  echo "nightly-fuzz: no Fuzz targets discovered" >&2
  exit 1
fi

cursor_file="$root/cursor"
cursor=0
if [ -f "$cursor_file" ]; then
  raw=$(cat "$cursor_file" 2>/dev/null || printf '0')
  case "$raw" in
    ''|*[!0-9]*) cursor=0 ;;
    *) cursor=$((raw % total)) ;;
  esac
fi

count=$slice_size
[ "$count" -gt "$total" ] && count=$total

selected=$(awk -v start="$cursor" -v count="$count" -v total="$total" '
  { targets[NR - 1] = $0 }
  END {
    for (i = 0; i < count; i++) {
      idx = (start + i) % total
      printf "%s%s", (i > 0 ? " " : ""), targets[idx]
    }
    printf "\n"
  }
' "$targets_file")

next_cursor=$(((cursor + count) % total))
day=$(date -u +%F-%H%M%S)
out="$root/runs/$day"
mkdir -p "$out"
printf '%s\n' "$selected" > "$out/slice.txt"

status=0
# shellcheck disable=SC2086
CAMPAIGN_OUT="$out" CAMPAIGN_PARALLEL="$parallel" sh "$campaign" "$target_time" $selected > "$out/campaign.txt" 2>&1 || status=$?

printf '%s\n' "$next_cursor" > "$cursor_file.tmp.$$"
mv "$cursor_file.tmp.$$" "$cursor_file"
ln -sfn "$out" "$root/latest"
echo "$(date -u +%FT%TZ) nightly-fuzz: ran $count/$total targets (cursor $cursor -> $next_cursor, status $status)"
exit "$status"
