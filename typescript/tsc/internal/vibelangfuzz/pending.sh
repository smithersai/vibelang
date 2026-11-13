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
# A rule table checks rule:, control:, reject: and diagnostic: keys inside
# whichever seed picks the rule, so a target with such lines runs its whole
# short seed set. Keys of what generated programs do (compile:, exit:, ek:)
# name no input; the post-merge suite finds those.
#
# The build graph runs these inputs as parallel groups of units. A unit is
# one probe test, run whole (probe:TestVIPConstructs, probe:TestDataSpecRules),
# or a test function that a pending line names, run with the same selectors
# as in the whole run:
#
#   sh internal/vibelangfuzz/pending.sh --units     # print every unit
#   VIBELANG_PENDING_UNITS='probe:TestDataSpecRules FuzzA' sh internal/vibelangfuzz/pending.sh
#
# A selected unit that no pending line names fails, so a stale group cannot
# pass by running nothing.
set -eu
dir=internal/vibelangfuzz
probes='TestVIPConstructs|TestDataSpecRules'

# alternation reads names on stdin and prints them as one regexp alternation.
alternation() { sed 's/[][\\.^$*+?(){}|]/\\&/g' | sort -u | paste -sd'|' -; }
lines() { cat "$dir"/testdata/pending/*.txt; }
# A subtest name never holds a slash, so a key with one names no input.
names=$(lines | sed -nE 's#^[A-Za-z]+[[:space:]]+(corpus|feature):([^ /]+)[[:space:]].*#\2#p' | alternation)
named=$(lines | sed -nE 's/^([A-Za-z]+)[[:space:]]+(corpus|feature):.*/\1/p' | alternation)
whole=$(lines | sed -nE 's/^([A-Za-z]+)[[:space:]]+(rule|control|reject|diagnostic):.*/\1/p' | alternation)

# members prints the names of an alternation of test names, one per line.
members() { printf '%s\n' "$1" | tr '|' '\n' | sed '/^$/d'; }
units() { { members "$probes" | sed 's/^/probe:/'; members "$named"; members "$whole"; } | sort -u; }
if [ "${1:-}" = --units ]; then
  units
  exit 0
fi
[ $# -eq 0 ] || { echo "usage: pending.sh [--units]" >&2; exit 2; }

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
  "$bin" -test.short -test.count=1 -test.timeout=15m -test.run "^($whole)\$" || status=1
fi
exit $status
