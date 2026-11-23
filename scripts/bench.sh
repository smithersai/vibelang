#!/bin/sh
# Incremental performance benchmark runner backed by Smithers (scripts/bench/PACKAGE.ts).
# Only benchmarks whose declared source/build dependencies changed re-run; all others
# replay their cached JSON metrics from `.flows/` in milliseconds, and the report
# aggregates every suite into Markdown, JSON, and a self-contained HTML dashboard.
#
# Usage:
#   sh scripts/bench.sh                         # incremental run of all suites + print report
#   sh scripts/bench.sh //scripts/bench:go-fmt  # run one or more specific benchmark targets
#   sh scripts/bench.sh --no-cache              # force re-measurement bypassing result cache
#   sh scripts/bench.sh --save-baseline         # save current report as scripts/bench/baseline.json
#   sh scripts/bench.sh --all                   # also run exclusive long-running scaling benchmarks
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

smthrs="$root/.smithers/node_modules/.bin/smthrs"
if [ ! -x "$smthrs" ]; then
  echo "bench.sh: missing $smthrs; run sh scripts/ci.sh --prepare-only first" >&2
  exit 1
fi

no_cache=0
save_baseline=0
run_all=0
targets=""
for arg in "$@"; do
  case "$arg" in
    --no-cache) no_cache=1 ;;
    --save-baseline) save_baseline=1 ;;
    --all) run_all=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) targets="$targets $arg" ;;
  esac
done

extra_flags=""
[ "$no_cache" -eq 1 ] && extra_flags="$extra_flags --no-cache"

if [ -n "$targets" ]; then
  # shellcheck disable=SC2086
  "$smthrs" ci $targets --workspace "$root" --jobs 1 --ui plain $extra_flags
else
  # Default: build the full incremental report (runs only invalidated benchmarks, replays rest).
  # --jobs 1 avoids CPU contention across benchmarks for cleaner measurements.
  # shellcheck disable=SC2086
  "$smthrs" build //scripts/bench:report --workspace "$root" --jobs 1 --ui plain $extra_flags
  if [ "$run_all" -eq 1 ]; then
    # shellcheck disable=SC2086
    "$smthrs" test //scripts/bench/... --include-exclusive --workspace "$root" --jobs 1 --ui plain $extra_flags
  fi
  if [ "$save_baseline" -eq 1 ]; then
    node scripts/bench/report.mjs --results-dir .cache/bench/results --no-baseline --save-baseline scripts/bench/baseline.json
    echo "Saved baseline to scripts/bench/baseline.json"
  fi
  if [ -f .cache/bench/report.md ]; then
    echo
    cat .cache/bench/report.md
    echo "HTML dashboard: $root/.cache/bench/report.html"
  fi
fi
