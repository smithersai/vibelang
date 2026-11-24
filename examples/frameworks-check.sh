#!/bin/sh
# Install, type-check, test, and build the React, Vue, and Svelte examples.
#   sh examples/frameworks-check.sh [react-vite vue-vite svelte-vite]
# Each project installs its pinned published dependencies.
# Set VIBELANG_BINARY to an absolute path to check with a different compiler.
# Each example gets one status line. Logs stay in .cache/frameworks-check/.
# bun install --no-cache fetches fresh manifests, so each example's
# bunfig.toml minimumReleaseAge applies; a warm manifest cache skips it
# (https://github.com/oven-sh/bun/issues/45831). Keep --no-cache until that is fixed.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname -- "$here")
logs="$root/.cache/frameworks-check"
mkdir -p "$logs"
[ "$#" -gt 0 ] || set -- react-vite vue-vite svelte-vite

failed=0
# step NAME COMMAND...: runs COMMAND in the example and appends to its log.
step() {
  label=$1
  shift
  printf '$ %s\n' "$*" >>"$log"
  if (cd "$dir" && "$@") >>"$log" 2>&1; then
    return 0
  fi
  printf 'FAIL %-12s %s (see .cache/frameworks-check/%s.log)\n' "$name" "$label" "$name"
  failed=1
  return 1
}
for name in "$@"; do
  dir="$here/$name"
  log="$logs/$name.log"
  : >"$log"
  step install bun install --no-cache &&
    step typecheck bun run typecheck &&
    step vitest bun x vitest run &&
    step build bun run build || continue
  if grep -q "warning EK[0-9]" "$log"; then
    printf 'FAIL %-12s compiler warnings (see .cache/frameworks-check/%s.log)\n' "$name" "$name"
    failed=1
  else
    printf 'OK   %-12s install, vibelang type check, Vitest, vite build\n' "$name"
  fi
done
exit "$failed"
