#!/bin/sh
# Builds vibelang and vibelang-runtime, then runs the headless language
# server test, vibelang/lsp-smoke.mjs, on vibelang/lsp-fixture.
#
# Usage: vibelang/lsp-smoke.sh [--no-build]
#   --no-build uses the build graph's built/local/tsc and runtime dist/.
#
# Environment:
#   EFFECT_NODE_MODULES    a node_modules directory that holds effect 4.1.0
#                          (default: ../experiments/node_modules)
#   VIBELANG_RUNTIME   the vibelang-runtime package directory
#                          (default: ../packages/runtime, built here with vibelang)
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
no_build=false
case ${1:-} in
--no-build) no_build=true ;;
"") ;;
*) echo "Usage: $0 [--no-build]" >&2; exit 2 ;;
esac
vibelang="$root/built/local/vibelang"
if "$no_build"; then vibelang="$root/built/local/tsc"; fi
fixture="$root/vibelang/lsp-fixture"
effect_modules=${EFFECT_NODE_MODULES:-}
if [ -z "$effect_modules" ]; then
	effect_modules="$root/../experiments/node_modules"
fi
runtime=${VIBELANG_RUNTIME:-$root/../packages/runtime}
runtime=$(cd "$runtime" && pwd)

# The same flags as smoke.sh, so both builds share Go build cache entries.
if ! "$no_build"; then
	echo "build: go build -trimpath -gcflags=all=-dwarf=false -o built/local/vibelang ./cmd/tsc"
	(cd "$root/tsc" && CGO_ENABLED=0 go build -trimpath -gcflags=all=-dwarf=false -o "$vibelang" ./cmd/tsc)
fi

# The binary names itself, and the TypeScript version it is built on.
version=$("$vibelang" --version)
title=$("$vibelang" --help | head -1)
case "$version" in
VibeLang\ *\(TypeScript\ *\)) echo "ok   vibelang --version: $version" ;;
*) echo "FAIL vibelang --version: $version"; exit 1 ;;
esac
case "$title" in
"vibelang: The VibeLang Compiler - Version "*) echo "ok   vibelang --help: $title" ;;
*) echo "FAIL vibelang --help: $title"; exit 1 ;;
esac

# The fixture's .vibe files use the prelude, so the runtime's declarations must
# be built, as smoke.sh builds them, against the same copy of effect.
effect_real=$(cd "$effect_modules/effect" && pwd -P)
if ! "$no_build"; then
	if [ "$(cd "$runtime/node_modules/effect" 2>/dev/null && pwd -P)" != "$effect_real" ]; then
		mkdir -p "$runtime/node_modules"
		rm -rf "$runtime/node_modules/effect"
		ln -s "$effect_real" "$runtime/node_modules/effect"
	fi
	echo "build: vibelang -p $runtime/tsconfig.json"
	"$vibelang" -p "$runtime/tsconfig.json"
fi

[ -L "$fixture/node_modules" ] && rm "$fixture/node_modules" # an older lsp-smoke.sh linked the whole directory
mkdir -p "$fixture/node_modules"
ln -sfn "$effect_real" "$fixture/node_modules/effect"
ln -sfn "$runtime" "$fixture/node_modules/vibelang-runtime"
exec node "$root/vibelang/lsp-smoke.mjs" "$vibelang"
