#!/bin/sh
# Tests vibelang/eslint (packages/compiler/eslint.mjs) against ESLint,
# typescript-eslint, and the plugins Smithers lints with, at the versions
# package.json pins.
#
# Usage: sh packages/compiler/test/eslint/run.sh [node --test options]
#
# Environment:
#   VIBELANG_BINARY  a native vibelang compiler; skips the Go build
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)

if [ -z "${VIBELANG_BINARY:-}" ]; then
	VIBELANG_BINARY=$repo/packages/compiler/native/vibelang
	echo "build: go build -o packages/compiler/native/vibelang ./cmd/tsc"
	(cd "$repo/typescript/tsc" && CGO_ENABLED=0 sh "$repo/scripts/native-output.sh" build "$VIBELANG_BINARY" -trimpath ./cmd/tsc)
fi
export VIBELANG_BINARY

cd "$here"
# --no-cache keeps bunfig.toml's minimumReleaseAge in force (bunfig.toml).
bun install --frozen-lockfile --no-cache
node --test "$@" ./*.test.mjs
