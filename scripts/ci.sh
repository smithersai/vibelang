#!/bin/sh
# Installs what the build graph's targets read, then runs its build and test
# targets with `smthrs ci` and the result cache: each target whose inputs
# changed runs, every other replays. docs/maintainers/build.md describes the
# graph.
#
# Usage: scripts/ci.sh [smthrs ci arguments]   (default: //... --jobs 8)
#
# Environment:
#   CI_RESULTS   also write one status per target, as JSON, to this new file
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

# Installs are not targets: their lockfiles are the identity each target keys
# on. Reuse an existing tree only if its Effect version matches the exact pin.
# Detach stale shared links before installing, so another checkout stays intact.
install() {
	if [ -e "$1/node_modules" ] && node scripts/check-effect-install.mjs "$1"; then return; fi
	[ ! -L "$1/node_modules" ] || rm "$1/node_modules"
	(cd "$1" && bun install --frozen-lockfile >/dev/null)
}
(cd .smithers && bun install --frozen-lockfile >/dev/null)
for dir in packages/runtime packages/compiler experiments docs/tools; do install "$dir"; done

# The parity tests compare with the stock TypeScript the mapper pins.
ts7_version=$(node -p 'require("./packages/ts-mapper/package.json").devDependencies.typescript')
ts7_cache="packages/ts-mapper/test/.cache/typescript-$ts7_version"
[ -x "$ts7_cache/node_modules/.bin/tsc" ] ||
	npm install --prefix "$ts7_cache" --no-audit --no-fund --silent "typescript@$ts7_version"

[ $# -gt 0 ] || set -- //... --jobs 8
exec .smithers/node_modules/.bin/smthrs ci "$@" --workspace "$root" --ui plain ${CI_RESULTS:+--results-file "$CI_RESULTS"}
