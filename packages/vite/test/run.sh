#!/bin/sh
# Builds the vibelang compiler and vibelang-runtime from this checkout, links
# the fixtures' node_modules, and runs the vibelang-vite tests.
#
# Usage: sh packages/vite/test/run.sh [node --test options]
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

# The compiler peer may not be published yet. Fixtures link this checkout below.
(cd "$package" && bun install --frozen-lockfile --no-cache --omit peer)

# Fixtures resolve effect and the runtime from test/.fixtures/node_modules. The
# plugin's compile backend, vibelang/project, is the vibelang package beside it.
modules=$package/test/.fixtures/node_modules
mkdir -p "$modules"
rm -rf "$modules/effect" "$modules/vibelang-runtime" "$package/node_modules/vibelang"
ln -s "$effect" "$modules/effect"
ln -s "$built" "$modules/vibelang-runtime"
ln -s "$repo/packages/compiler" "$package/node_modules/vibelang"

cd "$package"
# Includes plugin.property.test.mjs; FC_* controls property selection and replay.
exec node --test "$@" test/*.test.mjs
