#!/bin/sh
# Tests vibelang/metro, vibelang/babel and vibelang/emit (packages/compiler)
# against Metro, Babel with the React Compiler, and oxc-transform-react, at
# the versions package.json pins.
#
# Usage: sh packages/compiler/test/tools/run.sh [node --test options]
#
# Environment:
#   VIBELANG_BINARY      a native vibelang compiler; skips the Go build
#   EFFECT_NODE_MODULES  a node_modules directory that holds effect 4.1.0
#                        (default: experiments/node_modules)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)

if [ -z "${VIBELANG_BINARY:-}" ]; then
	VIBELANG_BINARY=$repo/packages/compiler/native/vibelang
	echo "build: go build -o packages/compiler/native/vibelang ./cmd/tsc"
	(cd "$repo/typescript/tsc" && CGO_ENABLED=0 sh "$repo/scripts/native-output.sh" build "$VIBELANG_BINARY" -trimpath ./cmd/tsc)
fi
export VIBELANG_BINARY
EFFECT_NODE_MODULES=${EFFECT_NODE_MODULES:-$repo/experiments/node_modules}
export EFFECT_NODE_MODULES

cd "$here"
# --no-cache keeps bunfig.toml's minimumReleaseAge in force (bunfig.toml).
bun install --frozen-lockfile --no-cache
node --test --test-timeout=300000 "$@" ./*.test.mjs
