#!/usr/bin/env node
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const { aliasImport, forgetPaths, jsxOf, pathsOf, rootDirsOf } = await import(path.join(root, "packages/compiler/paths-imports.mjs"))
const { extensionlessImport } = await import(path.join(root, "packages/compiler/relative-imports.mjs"))
const { hasVibeDirective } = await import(path.join(root, "packages/compiler/vibe-directive.mjs"))
const { reexportOf, sourceOfEmitted } = await import(path.join(root, "packages/compiler/emitted-js.mjs"))
const { parseJsonc } = await import(path.join(root, "packages/compiler/cache.mjs"))
const { lineAndColumn, mapDiagnostic, sourceSpan } = await import(path.join(root, "packages/compiler/oxlint.mjs"))

// Fixture directory with multi-level extends tsconfig + JSONC comments + 20 path aliases.
const work = mkdtempSync(path.join(os.tmpdir(), "vibelang-compiler-js-bench-"))
try {
  const baseConfig = path.join(work, "tsconfig.base.json")
  const appConfig = path.join(work, "tsconfig.json")
  const pathsObj = {}
  for (let i = 0; i < 20; i++) {
    pathsObj[`@mod${i}/*`] = [`./src/mod${i}/*`]
  }
  pathsObj["@/*"] = ["./src/*"]
  const baseJsonc = `// Base tsconfig for VibeLang project\n{\n  /* compiler options */\n  "compilerOptions": {\n    "strict": true,\n    "jsx": "react-jsx",\n    "rootDirs": ["./src", "./generated"],\n    "paths": ${JSON.stringify(pathsObj, null, 2)},\n  },\n}\n`
  const appJsonc = `{\n  // extend base\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": {\n    "target": "ES2022",\n  },\n}\n`
  writeFileSync(baseConfig, baseJsonc)
  writeFileSync(appConfig, appJsonc)
  mkdirSync(path.join(work, "src/mod15"), { recursive: true })
  const targetFile = path.join(work, "src/mod15/service.vibe")
  writeFileSync(targetFile, "export const ok = 1\n")

  const fileSet = new Set([targetFile, path.join(work, "src/util.vibe")])
  const inMemoryExists = (p) => fileSet.has(p)

  const directiveFile = "// @vibe\nexport effect function f() { return 1 }\n" + "const x = 1\n".repeat(200)
  const plainFile = "// regular ts file\nexport const x = 1\n".repeat(200)

  const bigSource = Array.from({ length: 400 }, (_, i) => `export const line_${i} = ${i} * 2 + "hello world"`).join("\n")
  const bigSourceBuf = Buffer.from(bigSource, "utf8")
  const segments = Array.from({ length: 200 }, (_, i) => [i * 50, 40, i * 45, 35, 0])
  const sampleDiag = {
    code: "eslint(no-unused-vars)",
    message: "unused binding",
    severity: "warning",
    labels: [{ span: { offset: 4520, length: 12 } }]
  }

  await runSuite({
    suite: "compiler-js-helpers",
    category: "packages",
    description: "Hot JS helpers in packages/compiler: paths-imports, relative-imports, vibe-directive, cache JSONC, oxlint span mapping.",
    cases: [
      {
        name: "pathsOf(config, uncached JSONC+extends)",
        fn: () => {
          forgetPaths()
          return pathsOf(appConfig)
        },
        verify: (v) => assert.ok(v?.paths?.["@/*"])
      },
      {
        name: "aliasImport(21 path patterns, in-mem fs)",
        fn: () => aliasImport(appConfig, "@mod15/service", { fileExists: inMemoryExists }),
        verify: (v) => assert.equal(v, targetFile)
      },
      {
        name: "rootDirsOf(config with extends)",
        fn: () => rootDirsOf(appConfig),
        verify: (v) => assert.equal(v?.length, 2)
      },
      {
        name: "jsxOf(config with extends)",
        fn: () => jsxOf(appConfig),
        verify: (v) => assert.equal(v, "react-jsx")
      },
      {
        name: "extensionlessImport(in-mem fs)",
        fn: () => extensionlessImport(path.join(work, "src"), "./util", inMemoryExists),
        verify: (v) => assert.equal(v, path.join(work, "src/util.vibe"))
      },
      {
        name: "hasVibeDirective(match)",
        fn: () => hasVibeDirective("a.ts", directiveFile),
        verify: (v) => assert.equal(v, true)
      },
      {
        name: "hasVibeDirective(miss, 4KB file)",
        fn: () => hasVibeDirective("a.ts", plainFile),
        verify: (v) => assert.equal(v, false)
      },
      {
        name: "cache.parseJsonc(21-alias tsconfig)",
        fn: () => parseJsonc(baseJsonc),
        verify: (v) => assert.equal(v.compilerOptions.strict, true)
      },
      {
        name: "emitted-js sourceOfEmitted + reexportOf",
        fn: () => {
          const s = sourceOfEmitted("/proj/.vibelang/js/src/a.mjs")
          return reexportOf(s, true)
        },
        verify: (v) => assert.ok(v.includes("export"))
      },
      {
        name: "oxlint.sourceSpan(200 segments)",
        fn: () => sourceSpan(segments, 4520, 12),
        verify: (v) => assert.ok(v && v.start > 0)
      },
      {
        name: "oxlint.lineAndColumn(400-line file)",
        fn: () => lineAndColumn(bigSourceBuf, bigSourceBuf.length - 10),
        verify: (v) => assert.equal(v.line, 400)
      },
      {
        name: "oxlint.mapDiagnostic(200 segments)",
        fn: () => mapDiagnostic(sampleDiag, segments, bigSourceBuf, "a.vibe"),
        verify: (v) => assert.ok(v && v.filename === "a.vibe")
      }
    ]
  })
} finally {
  rmSync(work, { recursive: true, force: true })
}
