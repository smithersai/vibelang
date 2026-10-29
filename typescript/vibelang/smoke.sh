#!/bin/sh
# Builds tsc and vibelang-runtime, then compiles and runs every case under
# vibelang/cases with vibelang/harness.mjs, which describes the cases.
#
# Usage: vibelang/smoke.sh [--status] [--verbose] [--jobs N] [case...]
#
#   --status    one line per case: name, owner, and ok, FAIL, pending, or XPASS
#   case        a case name, or a substring that selects every case containing it
#
# Prerequisites (from the repository root):
#   (cd experiments && bun install --frozen-lockfile)
#   (cd packages/runtime && bun install --frozen-lockfile)
# Runtime build dependencies include Node types and all platform packages.
#
# Environment:
#   EFFECT_NODE_MODULES    a node_modules directory that holds effect 4.1.0
#                          (default: ../experiments/node_modules)
#   VIBELANG_RUNTIME   the vibelang-runtime package directory
#                          (default: ../packages/runtime, built here with tsc)
#
# The suite fails when a case that is not pending fails.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
tsc="$root/built/local/tsc"
effect_modules=${EFFECT_NODE_MODULES:-}
if [ -z "$effect_modules" ]; then
	effect_modules="$root/../experiments/node_modules"
fi
runtime=${VIBELANG_RUNTIME:-$root/../packages/runtime}
runtime=$(cd "$runtime" && pwd)

# Report missing build dependencies before starting an expensive Go build.
if [ -f "$runtime/tsconfig.json" ]; then
	for dependency in @types/node @effect/platform-node @effect/platform-bun @effect/platform-browser; do
		if [ ! -f "$runtime/node_modules/$dependency/package.json" ]; then
			echo "smoke.sh: missing runtime build dependency $dependency in $runtime." >&2
			echo "Run: (cd \"$runtime\" && bun install --frozen-lockfile)" >&2
			exit 2
		fi
	done
fi

# -trimpath keys the Go build cache by module path instead of directory, so
# every jj workspace shares one set of cache entries. Without DWARF the cache
# entries are smaller; panics still print stack traces.
echo "build: go build -trimpath -gcflags=all=-dwarf=false -o built/local/tsc ./cmd/tsc"
(cd "$root/tsc" && CGO_ENABLED=0 go build -trimpath -gcflags=all=-dwarf=false -o "$tsc" ./cmd/tsc)
# The runtime's dist/ is not checked in, and the Go tests compile cases
# against it, so build it before they run. Build it from source with this tsc, so
# a commit that changes the compiler and the runtime is tested as one. The
# runtime resolves effect from its own node_modules; point that at the copy
# the cases use, replacing any other install, so a program and its type
# checking see one copy of effect.
if [ -f "$runtime/tsconfig.json" ]; then
	effect_real=$(cd "$effect_modules/effect" && pwd -P)
	if [ "$(cd "$runtime/node_modules/effect" 2>/dev/null && pwd -P)" != "$effect_real" ]; then
		mkdir -p "$runtime/node_modules"
		rm -rf "$runtime/node_modules/effect"
		ln -s "$effect_real" "$runtime/node_modules/effect"
	fi
	echo "build: tsc -p $runtime/tsconfig.json"
	"$tsc" -p "$runtime/tsconfig.json"
fi

echo "test: go test -timeout=20m ./internal/vibelang/"
(cd "$root/tsc" && CGO_ENABLED=0 go test -timeout=20m -trimpath -gcflags=all=-dwarf=false ./internal/vibelang/ >/dev/null) ||
	(cd "$root/tsc" && CGO_ENABLED=0 go test -timeout=20m -trimpath -gcflags=all=-dwarf=false ./internal/vibelang/; exit 1)

# The fuzz targets' seed corpus: every oracle runs on the cases, the snippets
# and the saved reproductions, a pending gap skips, and a fixed one fails as
# XPASS (internal/vibelangfuzz/testdata/pending/README.md).
# Parallel declaration emit must not race. Without -race the regression test
# passes even on the racing code, so it runs under the race detector.
echo "test: go test -race -run TestDeclarationEmitInParallel ./internal/vibelang/"
(cd "$root/tsc" && CGO_ENABLED=1 go test -race -count=1 -trimpath -run TestDeclarationEmitInParallel ./internal/vibelang/ >/dev/null) ||
	(cd "$root/tsc" && CGO_ENABLED=1 go test -race -count=1 -trimpath -run TestDeclarationEmitInParallel ./internal/vibelang/; exit 1)

# The parity target and the declaration consumer compare with the stock
# TypeScript the mapper pins, installed as CONTRIBUTING.md says.
ts7_version=$(node -p 'require(process.argv[1]).devDependencies.typescript' "$root/../packages/ts-mapper/package.json")
ts7_cache="$root/../packages/ts-mapper/test/.cache/typescript-$ts7_version"
if [ ! -x "$ts7_cache/node_modules/.bin/tsc" ]; then
	echo "install: typescript@$ts7_version into $ts7_cache"
	npm install --prefix "$ts7_cache" --no-audit --no-fund --silent "typescript@$ts7_version"
fi
# The seed run looks for wrong results, not hangs: TestPendingHangs probes the
# known ones, and the campaigns find new ones. A loaded shared host can take
# longer than the campaigns' 10 s for an ordinary compile, so a stage here
# fails as a hang only after 120 s.
echo "test: go test -short ./internal/vibelangfuzz/..."
(cd "$root/tsc" && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$effect_modules go test -short -timeout=20m -trimpath -gcflags=all=-dwarf=false ./internal/vibelangfuzz/... >/dev/null) ||
	(cd "$root/tsc" && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$effect_modules go test -short -timeout=20m -trimpath -gcflags=all=-dwarf=false ./internal/vibelangfuzz/...; exit 1)

EFFECT_NODE_MODULES=$effect_modules VIBELANG_RUNTIME=$runtime exec node "$root/vibelang/harness.mjs" "$@"
