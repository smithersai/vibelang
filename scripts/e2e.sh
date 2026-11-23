#!/bin/sh
# Exercise the real local install path. No prototype fallback or skipped failures.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/vibelang-e2e.XXXXXX")
trap 'rm -rf "$scratch"' EXIT HUP INT TERM
export BUN_CREATE_DIR="$scratch/templates"
export VIBELANG_BIN_DIR="$scratch/bin"
export PATH="$VIBELANG_BIN_DIR:$PATH"
step=setup
trap 'code=$?; [ "$code" -eq 0 ] || echo "e2e: FAIL $step (exit $code)" >&2; rm -rf "$scratch"' EXIT
echo "e2e: setup (isolated template and PATH launcher)"
sh "$root/scripts/setup.sh"
echo "e2e: PASS setup"
step=scaffold
echo "e2e: scaffold"
(cd "$scratch" && bun create vibelang app --no-git --no-install)
echo "e2e: PASS scaffold"
cd "$scratch/app"
step=install
echo "e2e: install"
bun install
echo "e2e: PASS install"
step=one-effect
echo "e2e: one copy of effect"
# Node resolves imports from a module's real path, so compare where the
# runtime's real files and the project find effect.
node --input-type=module -e '
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
const runtime = createRequire(realpathSync("node_modules/vibelang-runtime/dist/index.js")).resolve("effect")
const project = createRequire(realpathSync("package.json")).resolve("effect")
if (runtime !== project) {
  console.error(`e2e: the runtime loads ${runtime}, the project loads ${project}`)
  process.exit(1)
}'
echo "e2e: PASS one copy of effect"
step=build
echo "e2e: build"
bun run build
echo "e2e: PASS build"
step=start
echo "e2e: start"
bun run start >"$scratch/stdout.txt" 2>&1 || {
  code=$?
  cat "$scratch/stdout.txt"
  exit "$code"
}
cat "$scratch/stdout.txt"
grep -Fq 'Hello, VibeLang!' "$scratch/stdout.txt"
grep -Fq 'Recovered from EmptyName' "$scratch/stdout.txt"
echo "e2e: PASS start (greeting and typed recovery)"
step=test
echo "e2e: test"
bun run test
echo "e2e: PASS test"
echo "e2e: PASS all steps"
