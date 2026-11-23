#!/usr/bin/env node
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const vitePaths = await import(path.join(root, "packages/vite/src/paths-imports.js"))
const viteRel = await import(path.join(root, "packages/vite/src/relative-imports.js"))
const viteDir = await import(path.join(root, "packages/vite/src/vibe-directive.js"))
const unpluginDir = await import(path.join(root, "packages/unplugin/src/vibe-directive.js"))
const unpluginRel = await import(path.join(root, "packages/unplugin/src/relative-imports.js"))
const { bunResolveFilter } = await import(path.join(root, "packages/unplugin/src/index.js"))

const work = mkdtempSync(path.join(os.tmpdir(), "vibelang-bundlers-bench-"))
try {
  const tsconfig = path.join(work, "tsconfig.json")
  const pathsObj = {}
  for (let i = 0; i < 20; i++) pathsObj[`@pkg${i}/*`] = [`./src/pkg${i}/*`]
  writeFileSync(tsconfig, JSON.stringify({
    compilerOptions: { jsx: "react-jsx", rootDirs: ["./src"], paths: pathsObj }
  }, null, 2))
  mkdirSync(path.join(work, "src/pkg12"), { recursive: true })
  const target = path.join(work, "src/pkg12/handler.vibe")
  writeFileSync(target, "export const ok = 1\n")
  const known = new Set([target])
  const exists = (p) => known.has(p)

  const directiveSrc = "// @vibe\n// header\nexport effect function run() { return 1 }\n" + "const a = 1\n".repeat(150)
  const names200 = new Set(Array.from({ length: 200 }, (_, i) => `module_${i}`))
  const indexDirs = new Set(["components", "services", "routes", "models"])

  await runSuite({
    suite: "bundlers",
    category: "bundlers",
    description: "Vite and Unplugin resolver, directive scanner, and filter helpers.",
    cases: [
      {
        name: "vite.aliasImport (20 path aliases)",
        fn: () => vitePaths.aliasImport(tsconfig, "@pkg12/handler", { fileExists: exists }),
        verify: (v) => assert.equal(v, target)
      },
      {
        name: "vite.rootDirsOf(tsconfig)",
        fn: () => vitePaths.rootDirsOf(tsconfig),
        verify: (v) => assert.equal(v?.length, 1)
      },
      {
        name: "vite.extensionlessImport",
        fn: () => viteRel.extensionlessImport(path.join(work, "src/pkg12"), "./handler", exists),
        verify: (v) => assert.equal(v, target)
      },
      {
        name: "vite.hasVibeDirective",
        fn: () => viteDir.hasVibeDirective("a.ts", directiveSrc),
        verify: (v) => assert.equal(v, true)
      },
      {
        name: "unplugin.extensionlessImport",
        fn: () => unpluginRel.extensionlessImport(path.join(work, "src/pkg12"), "./handler", exists),
        verify: (v) => assert.equal(v, target)
      },
      {
        name: "unplugin.hasVibeDirective",
        fn: () => unpluginDir.hasVibeDirective("a.ts", directiveSrc),
        verify: (v) => assert.equal(v, true)
      },
      {
        name: "unplugin.bunResolveFilter (200 names)",
        fn: () => bunResolveFilter(names200, indexDirs),
        verify: (re) => assert.ok(re instanceof RegExp && re.test("./module_99"))
      }
    ]
  })
} finally {
  rmSync(work, { recursive: true, force: true })
}
