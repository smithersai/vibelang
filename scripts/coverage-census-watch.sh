#!/usr/bin/env bash
# Disk-backed, restartable 15-minute census. No compiler build or agent process.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${CENSUS_OUT:-$HOME/vibe/review-spec/coverage}"
state="${CENSUS_STATE:-$HOME/vibe/fix/alpha/coverage-census-scratch/watch}"
mkdir -p "$state" "$out"
exec 9>"$state/lock"
flock -n 9 || { echo "coverage census watcher already running"; exit 0; }
echo "$$" > "$state/pid"
trap 'rm -f "$state/pid"' EXIT
while :; do
  if jj git fetch --remote github >"$state/fetch.log" 2>&1; then
    revision=$(jj --ignore-working-copy log --no-graph -r main@github -T 'commit_id')
    # Recheck on any main update: test-only additions can close existing gaps too.
    previous=$(cat "$out/REVISION" 2>/dev/null || true)
    # External exclusions and collector changes can alter coverage without a new commit.
    inputs=$({ sha256sum PACKAGE.ts docs/tools/coverage-census.ts docs/tools/spec-normative.ts docs/tools/spec-rules.mjs
      if [ -f docs/tools/rule-evidence.ts ]; then sha256sum docs/tools/rule-evidence.ts; fi
      if [ -d "$out/not-rules" ]; then
        find "$out/not-rules" -maxdepth 1 -name "*.csv" -type f -print0 | sort -z | xargs -0 -r sha256sum
      fi
    } | sha256sum | cut -d " " -f 1)
    previous_inputs=$(cat "$state/INPUTS" 2>/dev/null || true)
    if [ "$revision" != "$previous" ] || [ "$inputs" != "$previous_inputs" ]; then
      if CENSUS_REVISION="$revision" CENSUS_OUT="$out" "${CENSUS_SMTHRS:-$PWD/.smithers/node_modules/.bin/smthrs}" target //:spec-coverage-census --jobs 1 >"$state/run.log" 2>&1; then
        printf "%s\n" "$inputs" > "$state/INPUTS"
        printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$revision" "$(cat "$out/PERCENT")" >> "$state/history.log"
      else
        printf '%s census failed; see %s/run.log\n' "$(date -u +%FT%TZ)" "$state" >> "$state/history.log"
      fi
    fi
    printf '%s checked %s\n' "$(date -u +%FT%TZ)" "$revision" > "$state/LAST_CHECK"
  else
    printf '%s fetch failed; retry next interval\n' "$(date -u +%FT%TZ)" >> "$state/history.log"
  fi
  [ "${CENSUS_ONCE:-0}" = 1 ] && break
  sleep 900
done
