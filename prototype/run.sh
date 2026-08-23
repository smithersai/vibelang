#!/usr/bin/env bash
# Smithers prototype: transpile -> (typecheck output, non-fatal) -> run.
set -uo pipefail
cd "$(dirname "$0")"

echo "== 1. transpile (smithersc) =="
bun smithersc.ts examples/demo.sm || exit 1

echo
echo "== 2. typecheck lowered output (non-fatal) =="
if [ -x node_modules/.bin/tsc ]; then
  if node_modules/.bin/tsc --noEmit --target es2022 --module esnext --moduleResolution bundler examples/demo.ts; then
    echo "tsc: lowered output typechecks clean"
  else
    echo "tsc: reported errors (non-fatal, continuing)"
  fi
else
  echo "tsc not installed (run 'bun add -d typescript' to enable); skipping"
fi

echo
echo "== 3. run lowered demo =="
bun examples/demo.ts
