#!/bin/sh
# Compiles every Go package the build graph's targets compile, with their
# flags, into the graph's Go cache, then deletes the entries this build did not
# use. .github/workflows/go-cache.yml runs it on each push to main and saves
# the cache that the merge queue's hosted pre-gate restores, so a hosted gate
# compiles only what its change touched (docs/maintainers/build.md).
#
# Usage: scripts/warm-go-cache.sh [--print]
#   --print   print the package patterns it compiles and stop
#
# Environment:
#   GOCACHE   the cache to fill (default: $HOME/.cache/go-build-smthrs, the
#             one every Go target in the graph names)
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# The packages the graph's Go targets and scripts/check-forms-table.sh compile.
# scripts/go-cache.test.mjs fails when a target names a package these miss.
tests="./internal/vibelang/... ./internal/vibelangmapper/... ./internal/vibelangfuzz/... ./internal/checker/...
./internal/effecttsgo/shim/checker/ ./internal/parser/... ./internal/format/... ./internal/core/..."
commands="./cmd/tsc ./cmd/vibelang-forms"

if [ "${1:-}" = --print ]; then
	for p in $tests $commands; do echo "$p"; done
	exit 0
fi

export GOCACHE="${GOCACHE:-$HOME/.cache/go-build-smthrs}" CGO_ENABLED=0
start=$(date +%s)
cd "$root/typescript/tsc"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
# The targets' flags: Go keys a compile on its flags and environment, not on
# the -run, -count or -p a test target adds.
for c in $commands; do go build -trimpath -o "$out/" "$c"; done
# -run '^$' compiles and vets each test package and runs no test.
# shellcheck disable=SC2086
go test -count=1 -trimpath -run '^$' $tests >/dev/null

# A build that uses an entry sets its mtime to now when the mtime is over an
# hour old, so an entry older than 90 minutes went unused: an earlier main's
# objects. Deleting them keeps the saved cache to about one main's build.
before=$(du -sk "$GOCACHE" | cut -f1)
find "$GOCACHE" -type f -name '*-[ad]' -mmin +90 -delete
echo "warm-go-cache: $(($(date +%s) - start))s, ${before} KiB before trim, $(du -sk "$GOCACHE" | cut -f1) KiB after"
