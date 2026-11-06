#!/bin/sh
# Drives this checkout's source maps through the tools that read them: Node,
# Bun, the V8 inspector, Vite, esbuild, Rollup, Rolldown, webpack, Vitest and
# the language server. docs/maintainers/source-maps.md states what each proves.
#
# Usage: sh packages/compiler/test/source-maps/run.sh [node --test options]
#
# Environment:
#   VIBELANG_BINARY      a native vibelang compiler; skips the Go build
#   EFFECT_NODE_MODULES  a node_modules directory that holds the pinned effect
#                        (default: experiments/node_modules)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
runtime=$repo/packages/runtime

if [ -z "${VIBELANG_BINARY:-}" ]; then
	VIBELANG_BINARY=$repo/packages/compiler/native/vibelang
	echo "build: go build -o packages/compiler/native/vibelang ./cmd/tsc"
	(cd "$repo/typescript/tsc" && CGO_ENABLED=0 sh "$repo/scripts/native-output.sh" build "$VIBELANG_BINARY" -trimpath ./cmd/tsc)
fi
export VIBELANG_BINARY

effect_modules=${EFFECT_NODE_MODULES:-$repo/experiments/node_modules}
effect=$(cd "$effect_modules/effect" && pwd -P)

# A private copy of the runtime, built with this compiler against the effect
# the fixtures use, so a test loads one copy of effect.
built=$here/.fixtures/vibelang-runtime
rm -rf "$built"
mkdir -p "$built/node_modules"
cp -R "$runtime/package.json" "$runtime/tsconfig.json" "$runtime/src" "$built/"
for entry in "$runtime"/node_modules/* "$runtime"/node_modules/.bin; do
	name=$(basename "$entry")
	case "$name" in effect|@effect) continue ;; esac
	if [ -e "$entry" ]; then ln -s "$(cd "$entry" && pwd -P)" "$built/node_modules/$name"; fi
done
cp -RL "$runtime/node_modules/@effect" "$built/node_modules/@effect"
ln -s "$effect" "$built/node_modules/effect"
echo "build: vibelang -p .fixtures/vibelang-runtime/tsconfig.json"
"$VIBELANG_BINARY" -p "$built/tsconfig.json"

# --no-cache keeps bunfig.toml's minimumReleaseAge in force (bunfig.toml).
# The fixtures supply effect, the peer of @effect/vitest.
(cd "$here" && bun install --frozen-lockfile --no-cache --omit peer)

# Private copies of the plugins, which resolve their dependencies from this
# directory's install: installing in their own packages would race the plugin
# targets, which may run beside this one.
plugins=$here/.fixtures/plugins
rm -rf "$plugins"
mkdir -p "$plugins/unplugin" "$plugins/vite"
cp -R "$repo/packages/unplugin/package.json" "$repo/packages/unplugin/src" "$plugins/unplugin/"
cp -R "$repo/packages/vite/package.json" "$repo/packages/vite/src" "$plugins/vite/"

# Every fixture lives under .fixtures and resolves these.
modules=$here/.fixtures/node_modules
mkdir -p "$modules"
rm -rf "$modules/effect" "$modules/vibelang-runtime" "$modules/vibelang"
ln -s "$effect" "$modules/effect"
ln -s "$built" "$modules/vibelang-runtime"
ln -s "$repo/packages/compiler" "$modules/vibelang"
# Copied, not linked: it must import the effect beside it.
rm -rf "$modules/@effect"
mkdir -p "$modules/@effect"
cp -RL "$here/node_modules/@effect/vitest" "$modules/@effect/vitest"

# The fuzz generator's programs, for programs.property.test.mjs.
(cd "$repo/typescript/tsc" && CGO_ENABLED=0 go run -trimpath ./internal/vibelangfuzz/vipgen/programs) >"$here/.fixtures/programs.jsonl"

cd "$here"
# A test that runs past five minutes fails with its name.
exec node --test --test-timeout=300000 "$@" ./*.test.mjs
