#!/usr/bin/env bash
# The parity harness for gate 1 of decision (B): stock TypeScript 7 through
# VibeLang's content mapper against the fork, declaration by declaration, over
# every case in typescript/vibelang/cases and every example with .vibe sources.
#
#   packages/ts-mapper/test/parity/run.sh               measure: out/summary.md, out/summary.json
#   packages/ts-mapper/test/parity/run.sh --docs        docs/examples/templates diagnostic census
#   packages/ts-mapper/test/parity/run.sh --gate        also write out/gate-<date>.json, the record a gate verdict cites
#   packages/ts-mapper/test/parity/run.sh --self-test   mutation self-test and negative probes; exits 1 on failure
#   packages/ts-mapper/test/parity/run.sh ch04 ref2     only the cases whose names contain ch04 or ref2
#   packages/ts-mapper/test/parity/run.sh --jobs 12     compile 12 projects at a time (default: half the cores, at most 12)
#
# Every run generates the fork reference (out/reference) and the manifest
# (out/manifest.json, whose hash heads summary.md) from the fork built here,
# at this revision. Only expectations.json, the migration sites' expected
# declarations, is committed. Everything under out/ is gitignored. The
# comparison measures progress; it exits 0 whatever the numbers are.
#
# Steps:
#   1. Check free disk: stop below 3 GiB.
#   2. Build the fork's tsc and vibelang-mapper once into out/bin.
#   3. Assemble a mapper package scope under out/work, with effect 4.1.0
#      and a copy of packages/runtime built with the fork's tsc beside it.
#   4. Find stock tsc: the typescript@$TS7_VERSION cache e2e.sh uses, else install it there.
#   5. Run parity.ts with bun. Its runtime column (runtime.ts) compiles each
#      runnable case with vibelang-mapper --emit and runs it against the case's
#      expect-result, under out/work/runtime.
#
# Environment:
#   TS7_VERSION          stock TypeScript version (default: devDependencies.typescript in
#                        packages/ts-mapper/package.json, as e2e.sh)
#   TS7_DIR              a directory whose node_modules/.bin/tsc is that version, instead of the cache
#   EFFECT_NODE_MODULES  a node_modules that holds effect 4.1.0 (default experiments/node_modules)
#   PARITY_REVISION      revision label for the report (default current jj revision)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package="$(cd "$here/../.." && pwd)"
root="$(cd "$package/../.." && pwd)"
out="$here/out"
ts7_version="${TS7_VERSION:-$(node -e 'process.stdout.write(require(process.argv[1]).devDependencies.typescript)' "$package/package.json")}"

free_kib=$(df -k "$root" | awk 'NR==2 {print $4}')
if [ "$free_kib" -lt $((3 * 1024 * 1024)) ]; then
  echo "parity: only $((free_kib / 1024)) MiB free on $(df -k "$root" | awk 'NR==2 {print $1}'); need 3 GiB" >&2
  exit 1
fi

SECONDS=0
mkdir -p "$out/bin"
# -trimpath keys the Go build cache by module path, so every jj workspace
# shares one set of entries; -buildvcs=false keeps the binaries' hashes, which
# the manifest records, the same in every checkout.
echo "parity: go build ./cmd/tsc ./cmd/vibelang-mapper" >&2
(cd "$root/typescript/tsc" &&
  CGO_ENABLED=0 go build -trimpath -buildvcs=false -gcflags=all=-dwarf=false -o "$out/bin/tsc" ./cmd/tsc &&
  CGO_ENABLED=0 go build -trimpath -buildvcs=false -gcflags=all=-dwarf=false -o "$out/bin/vibelang-mapper" ./cmd/vibelang-mapper)

# The production --emit entry does not accept mapper-entry options yet.
# Build a test-only entry against the same package with a Go source overlay;
# the overlay and binary stay in out/, and production sources stay intact.
bun -e 'console.log(JSON.stringify({ Replace: { [process.argv[1]]: process.argv[2] } }))' \
  "$root/typescript/tsc/cmd/vibelang-mapper/main.go" "$here/emit-main.go" > "$out/emit-overlay.json"
(cd "$root/typescript/tsc" && CGO_ENABLED=0 go build -overlay "$out/emit-overlay.json" -trimpath -buildvcs=false -gcflags=all=-dwarf=false -o "$out/bin/vibelang-emit-options" ./cmd/vibelang-mapper)

effect_modules="${EFFECT_NODE_MODULES:-}"
if [ -z "$effect_modules" ]; then
  effect_modules="$root/experiments/node_modules"
fi
[ -f "$effect_modules/effect/package.json" ] || { echo "parity: no effect in $effect_modules; set EFFECT_NODE_MODULES" >&2; exit 2; }
effect_real="$(cd "$effect_modules/effect" && pwd -P)"
effect_version="$(bun -e 'console.log(require(process.argv[1]).version)' "$effect_real/package.json")"
[ "$effect_version" = 4.1.0 ] || { echo "parity: effect is $effect_version, expected 4.1.0" >&2; exit 2; }

# A case without package.json inherits its enclosing package scope. In
# NodeNext, a self-reference to vibelang-ts-mapper/prelude wins over the case's
# node_modules. Make that enclosing scope our own package, so neither route
# can reach the repository package's node_modules (catch-match exposed this).
mapper_package="$out/work"
rm -rf "$mapper_package/node_modules" "$mapper_package/bin" "$out/runtime-build"
mkdir -p "$mapper_package/node_modules" "$mapper_package/bin" "$out/runtime-build/node_modules"
cp "$package/package.json" "$package/prelude.d.ts" "$mapper_package/"
cp "$out/bin/vibelang-mapper" "$mapper_package/bin/"
ln -s "$effect_real" "$mapper_package/node_modules/effect"

# Build from copied sources: all generated runtime files and dependency
# links belong to the harness, and both compilers use this same runtime.
runtime="$mapper_package/node_modules/vibelang-runtime"
mkdir -p "$runtime"
cp "$root/packages/runtime/package.json" "$runtime/"
cp -R "$root/packages/runtime/src" "$root/packages/runtime/tsconfig.json" "$out/runtime-build/"
# The experimental platform layers (D313) need the optional @effect/platform-*
# packages and Node's types, which this build does not install.
rm -rf "$out/runtime-build/src/experimental/platform-"* "$out/runtime-build/src/experimental/internal/node"*
ln -s "$effect_real" "$out/runtime-build/node_modules/effect"
echo "parity: build packages/runtime copy with the fork" >&2
"$out/bin/tsc" -p "$out/runtime-build/tsconfig.json" --outDir "$runtime/dist"

if [ -n "${TS7_DIR:-}" ]; then
  stock_dir="$TS7_DIR"
else
  stock_dir="$package/test/.cache/typescript-$ts7_version"
  if [ ! -x "$stock_dir/node_modules/.bin/tsc" ]; then
    mkdir -p "$stock_dir"
    (cd "$stock_dir" && { [ -f package.json ] || printf '{"private":true}\n' > package.json; } && npm install --no-audit --no-fund --silent "typescript@$ts7_version")
  fi
fi
stock_tsc="$stock_dir/node_modules/.bin/tsc"
[ -x "$stock_tsc" ] || { echo "parity: no stock tsc at $stock_tsc" >&2; exit 2; }

revision="${PARITY_REVISION:-}"
if [ -z "$revision" ]; then
  revision="$(cd "$root" && jj log --no-graph -r @ -T 'commit_id.short(12) ++ " (change " ++ change_id.short(12) ++ ", parent " ++ parents.map(|c| c.commit_id().short(12)).join(",") ++ ")"' 2>/dev/null || echo unknown)"
fi

PARITY_ROOT="$root" \
PARITY_FORK_TSC="$out/bin/tsc" \
PARITY_MAPPER="$out/bin/vibelang-mapper" \
PARITY_TRACING_EMITTER="$out/bin/vibelang-emit-options" \
PARITY_STOCK_TSC="$stock_tsc" \
PARITY_EFFECT_DIR="$effect_real" \
PARITY_RUNTIME_DIR="$runtime" \
PARITY_MAPPER_PACKAGE="$mapper_package" \
PARITY_REVISION="$revision" \
PARITY_GO_VERSION="$(go env GOVERSION)" \
PARITY_BUILD_SECONDS="$SECONDS" \
TS7_VERSION="$ts7_version" \
  exec bun "$here/parity.ts" "$@"
