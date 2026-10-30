#!/bin/sh
# Compile all examples, then compare finite programs with their output fixtures.
# After sh scripts/setup.sh (or building the compiler and installing runtime deps):
# VIBELANG=/absolute/path/to/native/vibelang \
#   VIBELANG_BINARY=/absolute/path/to/native/vibelang sh scripts/check-examples.sh
# VIBELANG selects the direct checks; VIBELANG_BINARY also selects the native
# compiler used by example package scripts, Vite and Vitest.
# Detailed diagnostics and output remain in .cache/check-examples/.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
logs="$root/.cache/check-examples"
mkdir -p "$logs"
compiler=${VIBELANG:-}
if [ -z "$compiler" ]; then
  if command -v vibelang >/dev/null 2>&1; then
    compiler=$(command -v vibelang)
  else
    compiler="$root/typescript/built/local/tsc"
  fi
fi
# Resolve a caller-supplied relative path before changing into an example.
case "$compiler" in
  /*) ;;
  */*) compiler="$(pwd)/$compiler" ;;
esac
work=$(mktemp -d "${TMPDIR:-/tmp}/vibelang-examples.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
# Pack the built runtime so the example and runtime resolve the same Effect.
runtime=$(cd "$root/packages/runtime" && npm pack --pack-destination "$work" --ignore-scripts --silent)
node "$root/scripts/prepare-examples.mjs" "$root" "$work" "$work/$runtime"
failed=0
# Known-broken examples, one "name|owner|reason" per line. A listed example still
# runs: its failure prints BROKEN and does not fail the check, and its pass prints
# XPASS and fails it, so the commit that fixes the example deletes its line.
broken='alchemy-stack|alchemy-41|alchemy 2.0.0-beta.84 imports effect/Crypto, which effect 4.1.0 removed, so importing @alchemy.run/cloudflare fails'
broken_seen=
fail() {
  reason=$(printf '%s\n' "$broken" | awk -F'|' -v n="$1" '$1 == n { print "owner " $2 ": " $3 }')
  if [ -n "$reason" ]; then
    printf 'BROKEN %-10s known broken, %s\n' "$1" "$reason"
    broken_seen="$broken_seen $1"
  else
    failed=1
  fi
}
for name in hello users http-api file-tree resilience approval pipeline react-vite vue-vite svelte-vite foldkit-app alchemy-stack; do
  dir="$work/$name"
  log="$logs/$name.log"
  if ! (cd "$dir" && bun install --no-cache) >"$log" 2>&1; then
    printf 'FAIL %-10s install (see .cache/check-examples/%s.log)\n' "$name" "$name"
    fail "$name"
    continue
  fi
  case "$name" in
    *-vite)
      if (cd "$dir" && bun run test) >>"$log" 2>&1; then
        printf 'OK   %-10s typecheck, tests and production build\n' "$name"
      else
        printf 'FAIL %-10s typecheck, tests or build (see .cache/check-examples/%s.log)\n' "$name" "$name"
        fail "$name"
      fi
      continue ;;
    # Each framework project tests its VibeLang source and its Effect
    # TypeScript original with one suite; alchemy-stack never deploys.
    foldkit-app|alchemy-stack)
      if (cd "$dir" && bun run test) >>"$log" 2>&1; then
        printf 'OK   %-10s bun run test over both versions\n' "$name"
      else
        printf 'FAIL %-10s bun run test (see .cache/check-examples/%s.log)\n' "$name" "$name"
        fail "$name"
      fi
      continue ;;
  esac
  if ! (cd "$dir" && "$compiler" -p .) >>"$log" 2>&1; then
    printf 'FAIL %-10s compile (see .cache/check-examples/%s.log)\n' "$name" "$name"
    fail "$name"
    continue
  fi
  if node -e 'process.exit(JSON.parse(require("node:fs").readFileSync(process.argv[1])).scripts?.test ? 0 : 1)' "$dir/package.json"; then
    if ! (cd "$dir" && bun run test) >>"$log" 2>&1; then
      printf 'FAIL %-10s tests (see .cache/check-examples/%s.log)\n' "$name" "$name"
      fail "$name"
      continue
    fi
  fi
  if [ ! -f "$dir/expected-output.txt" ]; then
    printf 'OK   %-10s compile (long-running server; use bun run test)\n' "$name"
    continue
  fi
  # main.js runs its exported main when node starts it (D135).
  entry=dist/main.js
  # Bound execution so an incorrect producer or fiber lifetime cannot hang CI.
  if ! (cd "$dir" && node --input-type=module - "$entry" <<'JS'
import { spawnSync } from "node:child_process"
const result = spawnSync(process.execPath, [process.argv[2]], {
  encoding: "utf8", timeout: 15000, killSignal: "SIGKILL"
})
process.stdout.write(result.stdout ?? "")
process.stderr.write(result.stderr ?? "")
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
JS
  ) >"$logs/$name.output" 2>&1; then
    printf 'FAIL %-10s run (see .cache/check-examples/%s.output)\n' "$name" "$name"
    fail "$name"
  elif ! diff -u "$dir/expected-output.txt" "$logs/$name.output" >"$logs/$name.diff"; then
    printf 'FAIL %-10s output (see .cache/check-examples/%s.diff)\n' "$name" "$name"
    fail "$name"
  else
    printf 'OK   %-10s compile and output\n' "$name"
  fi
done
for name in $(printf '%s\n' "$broken" | cut -d'|' -f1); do
  case " $broken_seen " in
    *" $name "*) ;;
    *) printf 'XPASS %-10s passes; delete its known-broken line in scripts/check-examples.sh\n' "$name"; failed=1 ;;
  esac
done
exit "$failed"
