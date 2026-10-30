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
# A corpus input (corpus:<file>) runs by name in its target, and a feature
# (feature:<name>) runs its probe in TestVIPConstructs or TestDataSpecRules.
# A rule table checks rule:, control:, reject: and diagnostic: keys inside
# whichever seed picks the rule, so a target with such lines runs its whole
# short seed set. Keys of what generated programs do (compile:, exit:, ek:)
# name no input; the post-merge suite finds those.
set -eu
dir=internal/vibelangfuzz
bin=$(mktemp "${TMPDIR:-/tmp}/vibelangfuzz-pending.XXXXXX")
trap 'rm -f "$bin"' EXIT
go test -c -trimpath -o "$bin" "./$dir/"

# alternation reads names on stdin and prints them as one regexp alternation.
alternation() { sed 's/[][\\.^$*+?(){}|]/\\&/g' | sort -u | paste -sd'|' -; }
lines() { cat "$dir"/testdata/pending/*.txt; }
# A subtest name never holds a slash, so a key with one names no input.
names=$(lines | sed -nE 's#^[A-Za-z]+ (corpus|feature):([^ /]+) .*#\2#p' | alternation)
named=$(lines | sed -nE 's/^([A-Za-z]+) (corpus|feature):.*/\1/p' | alternation)
whole=$(lines | sed -nE 's/^([A-Za-z]+) (rule|control|reject|diagnostic):.*/\1/p' | alternation)

cd "$dir"
status=0
"$bin" -test.short -test.count=1 -test.timeout=15m \
  -test.run "^($named|TestVIPConstructs|TestDataSpecRules)\$/^($names)\$" || status=1
if [ -n "$whole" ]; then
  "$bin" -test.short -test.count=1 -test.timeout=15m -test.run "^($whole)\$" || status=1
fi
exit $status
