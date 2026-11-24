#!/bin/sh
# Build the compiler/runtime and install experiments first (scripts/setup.sh).
# The Bun runtime suite starts Node subprocesses from PATH; also run its core
# compatibility checks and node:test files directly in each Node, and the
# compiler's Node test runner.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
for version in ${NODE_TEST_VERSIONS:-22.22.3 24.11.1 24}; do
  npx -y -p "node@$version" -c '
    set -eu
    node --version
    node --test packages/runtime/tests/node-compat.mjs packages/runtime/tests/entry-exports.node.test.mjs \
      packages/runtime/tests/binding-iterator.test.mjs packages/runtime/tests/commonjs-entry-capture.node.test.mjs \
      packages/runtime/tests/package-source-maps.test.mjs
    (cd packages/runtime && bun test --timeout 30000)
    (cd packages/compiler && npm test)
  '
done
