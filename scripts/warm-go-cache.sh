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

# Read literal package selectors from their declarations, without loading the
# graph or requiring Node/Bun in the Go-only cache workflow. Keep exact packages
# exact; recursive selectors stay recursive. The independent graph audit checks
# coverage, and the native fixture executes a newly declared package with Go.
inventory=$(awk -f "$root/scripts/go-cache-packages.awk" \
    "$root/PACKAGE.ts" "$root/typescript/PACKAGE.ts" \
    "$root/typescript/tsc/PACKAGE.ts" "$root/scripts/check-forms-table.sh")
inventory=$(printf '%s\n' "$inventory" | LC_ALL=C sort -u)
tests=
commands=
for p in $inventory; do
    case "$p" in
        ./internal/*) tests="$tests $p" ;;
        ./cmd/*) commands="$commands $p" ;;
    esac
done
if [ -z "$tests" ] || [ -z "$commands" ]; then
    echo "warm-go-cache: incomplete package inventory (test and command packages required)" >&2
    exit 1
fi

if [ "${1:-}" = --print ]; then
	printf '%s\n' "$inventory"
	exit 0
fi

export GOCACHE="${GOCACHE:-$HOME/.cache/go-build-smthrs}" CGO_ENABLED=0
start=$(date +%s)
cd "$root/typescript/tsc"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
# The targets' flags: Go keys a compile on its flags and environment, not on
# the -run, -count or -p a test target adds.
for c in $commands; do go build -p 8 -trimpath -o "$out/" "$c"; done
# -run '^$' compiles and vets each test package and runs no test.
# shellcheck disable=SC2086
go test -p 8 -count=1 -trimpath -run '^$' $tests >/dev/null

# A build that uses an entry sets its mtime to now when the mtime is over an
# hour old, so an entry older than 90 minutes went unused: an earlier main's
# objects. Deleting them keeps the saved cache to about one main's build.
before=$(du -sk "$GOCACHE" | cut -f1)
find "$GOCACHE" -type f -name '*-[ad]' -mmin +90 -delete
echo "warm-go-cache: $(($(date +%s) - start))s, ${before} KiB before trim, $(du -sk "$GOCACHE" | cut -f1) KiB after"
