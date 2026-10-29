#!/bin/sh
# Builds the vibelang compiler and vibelang-runtime from this checkout, then
# bundles test/fixture with webpack, Rspack, Rollup, Rolldown, esbuild, Bun,
# and Vite through vibelang-unplugin and checks each bundle, and bundles the
# compiler's output of test/entry with each of them (entry.test.mjs).
#
# Usage: sh packages/unplugin/test/run.sh [node --test options]
#
# Environment:
#   VIBELANG_BINARY        a native vibelang compiler; skips the Go build
#   EFFECT_NODE_MODULES  a node_modules directory that holds effect 4.1.0
#                        (default: experiments/node_modules)
set -eu

package=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$package/../.." && pwd)
runtime=$repo/packages/runtime

if [ -z "${VIBELANG_BINARY:-}" ]; then
	VIBELANG_BINARY=$repo/packages/compiler/native/vibelang
	echo "build: go build -o packages/compiler/native/vibelang ./cmd/tsc"
	(cd "$repo/typescript/tsc" && CGO_ENABLED=0 go build -trimpath -gcflags=all=-dwarf=false -o "$VIBELANG_BINARY" ./cmd/tsc)
fi
export VIBELANG_BINARY

effect_modules=${EFFECT_NODE_MODULES:-$repo/experiments/node_modules}
effect=$(cd "$effect_modules/effect" && pwd -P)

# The runtime's dist/ is not checked in. Build a private copy with this
# compiler against the same effect the fixtures use, so a test loads one copy
# of effect. The copy keeps the tests from writing packages/runtime, which the
# build graph's runtime and compiler targets read while these tests run.
built=$package/test/.fixtures/vibelang-runtime
rm -rf "$built"
mkdir -p "$built/node_modules"
cp -R "$runtime/package.json" "$runtime/tsconfig.json" "$runtime/src" "$built/"
# Node resolves a package's imports from its real path, so @effect/platform-*
# are copied, not linked: they must import the effect beside them.
for entry in "$runtime"/node_modules/* "$runtime"/node_modules/.bin; do
	name=$(basename "$entry")
	case "$name" in effect|@effect) continue ;; esac
	if [ -e "$entry" ]; then ln -s "$(cd "$entry" && pwd -P)" "$built/node_modules/$name"; fi
done
cp -RL "$runtime/node_modules/@effect" "$built/node_modules/@effect"
ln -s "$effect" "$built/node_modules/effect"
echo "build: vibelang -p test/.fixtures/vibelang-runtime/tsconfig.json"
"$VIBELANG_BINARY" -p "$built/tsconfig.json"

# Every fixture copy lives under test/.fixtures and resolves packages here.
modules=$package/test/.fixtures/node_modules
mkdir -p "$modules"
rm -rf "$modules/effect" "$modules/vibelang-runtime" "$modules/vibelang" "$modules/vibelang-unplugin"
ln -s "$effect" "$modules/effect"
ln -s "$built" "$modules/vibelang-runtime"
# The plugin's compile backend is the project's vibelang package (vibelang/project).
ln -s "$repo/packages/compiler" "$modules/vibelang"
# A fixture program that imports vibelang-unplugin/deferred resolves this package.
ln -s "$package" "$modules/vibelang-unplugin"

# bunfig.toml's minimumReleaseAge applies only to fresh manifests; a warm
# manifest cache skips it (https://github.com/oven-sh/bun/issues/45831).
# Keep --no-cache until that is fixed.
# The compiler peer may be unpublished; fixtures use this checkout.
(cd "$package" && bun install --frozen-lockfile --no-cache --omit peer)
rm -rf "$package/node_modules/vibelang"
ln -s "$repo/packages/compiler" "$package/node_modules/vibelang"

cd "$package"
exec node --test "$@" test/backend-cache.test.mjs test/bundlers.test.mjs test/bundlers.property.test.mjs test/deferred.test.mjs test/deferred-types.test.mjs test/entry.test.mjs
