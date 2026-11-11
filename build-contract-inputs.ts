import { globSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { Smithers } from "@smthrs/targets"

export const buildContractSuites = [
  "scripts/bun-test-budgets.test.mjs",
  "scripts/compiler-test-inputs.test.mjs",
  "scripts/compiler-failure-output.test.mjs",
  "scripts/compiler-shard-installs.test.mjs",
  "scripts/go-build-flags.test.mjs",
  "scripts/go-cache.test.mjs",
  "scripts/go-shared-test-inventory.test.mjs",
  "scripts/go-fuzz-test-inventory.test.mjs",
  "scripts/go-test-cache.test.mjs",
  "scripts/source-map-tool-coverage.test.mjs",
  "scripts/package-test-inventory.test.mjs",
  "scripts/package-test-fixtures.test.mjs",
] as const

export const buildContractExclusions = buildContractSuites
  .map(file => file.slice("scripts/".length, -".test.mjs".length)).join("|")

// These suites inspect commands and inventories, without compiling the compiler
// or reading acceptance cases. Keep their installed parser/property libraries
// keyed by the manifests and locks used to provision docs/tools.
export const buildContractFiles = [
  ...buildContractSuites,
  "build-contract-inputs.ts",
  "packages/test-inventory.json",
  "packages/test-groups.json",
  "packages/test-batches.json",
  "scripts/testing/node-selection.mjs",
  "scripts/testing/package-fixtures.mjs",
  "scripts/testing/prepare-package-tests.mjs",
  "scripts/testing/run-package-test.mjs",
  "scripts/testing/package-declarations.mjs",
  "api-inputs.ts",
  "PACKAGE.ts",
  "packages/PACKAGE.ts",
  "typescript/PACKAGE.ts",
  "typescript/tsc/PACKAGE.ts",
  "typescript/vibelang/PACKAGE.ts",
  "experiments/package.json",
  "packages/runtime/package.json",
  "packages/runtime/tests/main.test.ts",
  "docs/maintainers/source-maps.md",
  "docs/tools/package.json",
  "docs/tools/bun.lock",
  ".smithers/package.json",
  "scripts/build-vibelang.sh",
  "scripts/check-forms-table.sh",
  "scripts/warm-go-cache.sh",
  "scripts/go-cache-packages.awk",
  "scripts/go-test-shards.sh",
  "scripts/testing/package-declaration.mjs",
  "scripts/testing/migrate-shards.mjs",
  "scripts/testing/node-failures.mjs",
  "scripts/go-test-progress.mjs",
  ".github/workflows/go-cache.yml",
  ".github/workflows/mq-pregate.yml",
  "typescript/vibelang/smoke.sh",
  "typescript/vibelang/lsp-smoke.sh",
  "packages/vite/test/run.sh",
  "packages/unplugin/test/run.sh",
  "packages/compiler/test/eslint/run.sh",
  "packages/compiler/test/tools/run.sh",
  "packages/ts-mapper/test/e2e.sh",
  "packages/ts-mapper/test/parity/run.sh",
  "packages/ts-mapper/test/parity/parity.ts",
  "typescript/VIBELANG.md",
  "docs/research/fuzzing.md",
] as const

export function createBuildContractInputs(S: typeof Smithers) {
  // Absolute workspace file references cross PACKAGE.ts boundaries. Inventories
  // include new files on each plan, including tests in newly created packages.
  const root = fileURLToPath(new URL("./", import.meta.url))
  const inventory = globSync([
    "packages/compiler/test/*.mjs",
    "packages/compiler/test/tools/*.test.mjs",
    "packages/compiler/test/source-maps/*.test.mjs",
    "packages/runtime/**/{*.test,*.spec,*_test,*_spec}.{ts,tsx,js,jsx,mjs,cjs}",
    "packages/vite/test/*.test.mjs",
    "packages/unplugin/test/*.test.mjs",
    "packages/typescript-shim/test/*.test.mjs",
    "typescript/tsc/internal/**/vibelang*_test.go",
    "typescript/tsc/internal/vibelangfuzz/**/*.go",
    "typescript/tsc/internal/vibelangfuzz/**/testdata/shard-seconds.txt",
  ], { cwd: root, exclude: path => path.split("/").some(part => ["node_modules", "dist", ".cache", ".fixtures"].includes(part)) })
  return S.Filegroup({
    srcs: [...new Set([...buildContractFiles, ...inventory])].sort().map(path => S.file("//" + path)),
  })
}
