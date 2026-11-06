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
  "scripts/go-test-cache.test.mjs",
] as const

// These suites inspect commands and inventories, without compiling the compiler
// or reading acceptance cases. Keep their installed parser/property libraries
// keyed by the manifests and locks used to provision docs/tools.
export const buildContractFiles = [
  ...buildContractSuites,
  "build-contract-inputs.ts",
  "PACKAGE.ts",
  "packages/PACKAGE.ts",
  "typescript/PACKAGE.ts",
  "typescript/tsc/PACKAGE.ts",
  "typescript/vibelang/PACKAGE.ts",
  "experiments/package.json",
  "packages/runtime/package.json",
  "packages/runtime/tests/main.test.ts",
  "docs/tools/package.json",
  "docs/tools/bun.lock",
  ".smithers/package.json",
  "scripts/build-vibelang.sh",
  "scripts/check-forms-table.sh",
  "scripts/warm-go-cache.sh",
  "scripts/testing/node-failures.mjs",
  "scripts/go-test-progress.mjs",
  ".github/workflows/go-cache.yml",
  ".github/workflows/mq-pregate.yml",
  "typescript/vibelang/smoke.sh",
  "typescript/vibelang/lsp-smoke.sh",
  "packages/vite/test/run.sh",
  "packages/unplugin/test/run.sh",
  "packages/compiler/test/eslint/run.sh",
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
    "typescript/tsc/internal/**/vibelang*_test.go",
  ], { cwd: root })
  return S.Filegroup({
    srcs: [...new Set([...buildContractFiles, ...inventory])].sort().map(path => S.file("//" + path)),
  })
}
