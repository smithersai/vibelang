import type { Smithers } from "@smthrs/targets"

type SDK = typeof Smithers

// The comparator uses stock TypeScript from these locked Node installations,
// authored script/corpus inputs, specification chapters and its staged copies.
// Compiler Go, acceptance cases, user prose and site output are separate checks.
export const apiInputPatterns = [
  "scripts/**",
  "docs/design/**",
  "docs/maintainers/api-identity.md",
  "docs/tools/**",
  "experiments/**",
  ".smithers/flows/migrate/lib/api-identity*.mjs",
  ".smithers/flows/migrate/README.md",
  ".smithers/package.json",
  ".smithers/bun.lock",
  ".smithers/WORKSPACE.ts",
  // A fixture under TMPDIR may inherit a repository-level project config.
  "*.json",
  "*.jsonc",
  "package.json",
  "bun.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
] as const

export function createApiIdentityInputs(S: SDK, packageInputs: ReturnType<SDK["Filegroup"]>) {
  return S.Filegroup({
    srcs: [...S.glob([...apiInputPatterns]), packageInputs, S.file("//api-inputs.ts")],
  })
}
