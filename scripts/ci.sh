#!/bin/sh
# Installs what the build graph's targets read, then runs its build and test
# targets with `smthrs ci` and the result cache: each target whose inputs
# changed runs, every other replays. docs/maintainers/build.md describes the
# graph.
#
# Usage: scripts/ci.sh [smthrs ci arguments]   (default: //... --jobs 8)
#        scripts/ci.sh --prepare-only          (install prerequisites, no targets)
#
# Environment:
#   CI_GATE_BASE append changed-path seed targets relative to this jj revision
#   CI_CHANGED_PATHS append seed targets from a paths file (for mirrors without jj)
#   CI_RESULTS   also write one status per target, as JSON, to this new file
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

prepare_only=0
if [ "${1:-}" = --prepare-only ]; then
  [ "$#" -eq 1 ] || { echo "usage: scripts/ci.sh --prepare-only (no target arguments)" >&2; exit 2; }
  prepare_only=1
fi

# Installs are not targets: their lockfiles are the identity each target keys
# on. A node_modules symlink is provisioned by its owner: use it as is, without
# installing through it. Every ordinary install is verified against its lockfile;
# an unchanged Effect version says nothing about the other dependencies.
install() {
	[ ! -L "$1/node_modules" ] || return 0
	(cd "$1" && bun install --frozen-lockfile >/dev/null)
}
for dir in .smithers packages/runtime packages/compiler packages/compiler/test/tools experiments docs/tools; do install "$dir"; done
node scripts/share-effect.mjs

# The parity tests compare with the stock TypeScript the mapper pins.
ts7_version=$(node -p 'require("./packages/ts-mapper/package.json").devDependencies.typescript')
for stock_version in "$ts7_version" 7.0.2; do
 ts7_cache="packages/ts-mapper/test/.cache/typescript-$stock_version"
 [ -x "$ts7_cache/node_modules/.bin/tsc" ] ||
  npm install --prefix "$ts7_cache" --no-audit --no-fund --silent "typescript@$stock_version"
done

# A focused check can use the exact CI prerequisites without selecting targets
# or consulting gate-selection inputs. Native builds remain the check's job.
[ "$prepare_only" -eq 0 ] || exit 0

[ $# -gt 0 ] || set -- //... --jobs 8
# A supplied empty paths file is meaningful; a failed lookup must stop the gate.
ci_paths=$(printenv CI_CHANGED_PATHS || true)
ci_base=$(printenv CI_GATE_BASE || true)
if [ -n "$ci_paths" ]; then
  seeds=$(node scripts/fuzz-gate/select.mjs --paths "$ci_paths")
elif [ -n "$ci_base" ]; then
  seeds=$(node scripts/fuzz-gate/select.mjs --base "$ci_base")
else
  seeds=""
fi
# Labels come only from the checked-in map, never from path text.
[ -z "$seeds" ] || set -- "$@" $seeds
# Build-only queue runs must validate what a new user copies too, including
# workers without CI_GATE_BASE/CI_CHANGED_PATHS. The target builds this same
# native compiler and runtime before checking every template.
case " $* " in
  *" //packages:compiler-native "*)
    case " $* " in *" //:starter-templates "*) ;; *) set -- "$@" //:starter-templates ;; esac ;;
esac
exec .smithers/node_modules/.bin/smthrs ci "$@" --workspace "$root" --ui plain ${CI_RESULTS:+--results-file "$CI_RESULTS"}
