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
# on. A node_modules symlink is provisioned by its owner: use it as is, without
# installing through it. Reuse other existing Effect trees only at the exact pin.
install() {
	[ ! -L "$1/node_modules" ] || return 0
	if [ "$1" != .smithers ] && [ -e "$1/node_modules" ] && node scripts/check-effect-install.mjs "$1"; then return; fi
	(cd "$1" && bun install --frozen-lockfile >/dev/null)
}
for dir in .smithers packages/runtime packages/compiler experiments docs/tools; do install "$dir"; done

# The parity tests compare with the stock TypeScript the mapper pins.
ts7_version=$(node -p 'require("./packages/ts-mapper/package.json").devDependencies.typescript')
ts7_cache="packages/ts-mapper/test/.cache/typescript-$ts7_version"
[ -x "$ts7_cache/node_modules/.bin/tsc" ] ||
	npm install --prefix "$ts7_cache" --no-audit --no-fund --silent "typescript@$ts7_version"

[ $# -gt 0 ] || set -- //... --jobs 8
exec .smithers/node_modules/.bin/smthrs ci "$@" --workspace "$root" --ui plain ${CI_RESULTS:+--results-file "$CI_RESULTS"}
