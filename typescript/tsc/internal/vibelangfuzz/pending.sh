#!/bin/sh
# Runs the inputs that testdata/pending/ lists and fails on an XPASS: a
# pending line whose input now meets the specification. A change that
# resolves a pending line deletes it in the same commit. The merge gate runs
# this (//:go-vibelangfuzz-pending), where the whole seed suite
# (//:go-vibelangfuzz) runs only post-merge, so a fix that leaves its lines
# behind fails before it lands instead of turning main red.
#
#   cd typescript/tsc && sh internal/vibelangfuzz/pending.sh
#
# Known hang inputs skip when selected by name. The build graph's pending
# target also requires //:go-vibelangfuzz-hangs, which runs TestPendingHangs.
#
# A corpus input (corpus:<file>) runs by name in its target. A feature
# (feature:<name>) is a probe in TestVIPConstructs or TestDataSpecRules, and
# its line also covers every probe that requires it, so those two tests run
# whole: deleting a feature line whose own probe passes, while a probe that
# requires it still fails, fails here (6c82278e deleted vip18.any, and
# vip18.any-catch-first turned main 4e088ab33903 RED post-merge).
# Every non-corpus key, regardless of its prefix, runs its target's whole
# short seed set, with the tests PendingCompanion registers for the target
# in the same process. TestMain then rejects lines no oracle raised or
# deliberately omitted. A complete matrix registered as a companion runs
# whole here, since some pending keys are raised only there (SkipShortMatrix).
#
# The build graph runs these inputs as parallel groups of units. A unit is
# one probe test, run whole (probe:TestVIPConstructs, probe:TestDataSpecRules),
# or a test function that a pending line names, run with the same selectors
# and companions as in the whole run:
#
#   sh internal/vibelangfuzz/pending.sh --units       # print every unit
#   sh internal/vibelangfuzz/pending.sh --companions  # print "<target> <test>"
#   VIBELANG_PENDING_UNITS='probe:TestDataSpecRules FuzzA' sh internal/vibelangfuzz/pending.sh
#
# A selected unit that no pending line names fails, so a stale group cannot
# pass by running nothing.
set -eu
export VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_MATRIX=1
dir=internal/vibelangfuzz
probes='TestVIPConstructs|TestDataSpecRules'

# alternation reads names on stdin and prints them as one regexp alternation.
alternation() { sed 's/[][\\.^$*+?(){}|]/\\&/g' | sort -u | paste -sd'|' -; }
lines() { cat "$dir"/testdata/pending/*.txt; }
# A subtest name never holds a slash, so a key with one names no input.
names=$(lines | awk '!/^#/ && NF >= 4 && $2 ~ /^(corpus|feature):/ { sub(/^[^:]*:/, "", $2); if ($2 !~ /[ \/]/) print $2 }' | alternation)
named=$(lines | awk '!/^#/ && NF >= 4 && $2 ~ /^(corpus|feature):/ { print $1 }' | alternation)
whole=$(lines | awk '!/^#/ && NF >= 4 && $2 !~ /^corpus:/ && $3 != "superseded" { print $1 }' | alternation)

# companion_map prints "<target> <test>" for each test a PendingCompanion
# call registers, resolving a target constant to its name.
companion_map() {
  consts=$(sed -nE 's/^(const[[:space:]]+|[[:space:]]+)([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*"((Fuzz|Test)[A-Za-z0-9_]*)".*/\2 \3/p' "$dir"/*.go)
  sed -nE 's/^var _ = PendingCompanion\(([^,]+), (.*)\)$/\1 \2/p' "$dir"/*_test.go |
    while read -r target tests; do
      case $target in
        \"*\") target=${target#\"}; target=${target%\"} ;;
        *) name=$(printf '%s\n' "$consts" | awk -v c="$target" '$1 == c { print $2; exit }')
           [ -n "$name" ] || { echo "pending.sh: cannot resolve PendingCompanion target $target" >&2; exit 2; }
           target=$name ;;
      esac
      printf '%s\n' "$tests" | tr ',' '\n' | sed -nE 's/^[[:space:]]*"([^"]+)".*/\1/p' | sed "s/^/$target /"
    done
}

# members prints the names of an alternation of test names, one per line.
members() { printf '%s\n' "$1" | tr '|' '\n' | sed '/^$/d'; }
units() { { members "$probes" | sed 's/^/probe:/'; members "$named"; members "$whole"; } | sort -u; }
if [ "${1:-}" = --units ]; then
  units
  exit 0
fi
if [ "${1:-}" = --companions ]; then
  companion_map
  exit 0
fi
[ $# -eq 0 ] || { echo "usage: pending.sh [--units | --companions]" >&2; exit 2; }

if [ -n "${VIBELANG_PENDING_UNITS+set}" ]; then
  selected=$(printf '%s\n' $VIBELANG_PENDING_UNITS | sort -u)
  all=$(units)
  for unit in $selected; do
    printf '%s\n' "$all" | grep -Fqx -- "$unit" ||
      { echo "pending.sh: no pending line names unit $unit" >&2; exit 2; }
  done
  [ -n "$selected" ] || { echo "pending.sh: VIBELANG_PENDING_UNITS names no unit" >&2; exit 2; }
  # keep prints the selected members of an alternation as an alternation.
  keep() { members "$1" | { grep -Fx -- "$selected" || true; } | paste -sd'|' -; }
  probes=$(printf '%s\n' "$selected" | sed -n 's/^probe://p' | paste -sd'|' -)
  named=$(keep "$named")
  whole=$(keep "$whole")
fi
map=$(companion_map)
companions=$(members "$whole" | while read -r target; do
  printf '%s\n' "$map" | awk -v t="$target" '$1 == t { print $2 }'
done | alternation)

bin=$(mktemp "${TMPDIR:-/tmp}/vibelangfuzz-pending.XXXXXX")
trap 'rm -f "$bin"' EXIT
go test -c -trimpath -o "$bin" "./$dir/"

cd "$dir"
status=0
if [ -n "$probes" ]; then
  "$bin" -test.short -test.count=1 -test.timeout=15m -test.run "^($probes)\$" || status=1
fi
if [ -n "$named" ]; then
  "$bin" -test.short -test.count=1 -test.timeout=15m -test.run "^($named)\$/^($names)\$" || status=1
fi
if [ -n "$whole" ]; then
  "$bin" -test.short -test.count=1 -test.timeout=15m -test.run "^($whole${companions:+|$companions})\$" || status=1
fi
exit $status
