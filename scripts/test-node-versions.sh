#!/bin/sh
# Build the compiler/runtime and install experiments first (scripts/setup.sh).
# The Bun runtime suite starts Node subprocesses from PATH; also run its core
# compatibility checks directly in each Node, and the compiler's Node test runner.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
for version in ${NODE_TEST_VERSIONS:-22.22.3 24.11.1 24}; do
  npx -y -p "node@$version" -c '
    set -eu
    node --version
    node --test packages/runtime/tests/node-compat.mjs
    (cd packages/runtime && bun test)
    (cd packages/compiler && npm test)
  '
done
