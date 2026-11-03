import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { addVibeIncludes } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-vibex-story-selectors.json", import.meta.url)))
const extensions = [".vibe", ".vibex"].map(extension => ({ extension, isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }))

test("opencode: setup preserves JSX project membership after story files become .vibex", () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-vibex-selectors-"))
  try {
    for (const file of corpus.files.flatMap(file => [file, file.replace(/\.tsx$/, ".vibex")])) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), "export const value = 1\n")
    }
    for (const include of [["src"], corpus.config.include]) {
      const text = addVibeIncludes(JSON.stringify({ ...corpus.config, include }), ts)
      const parsed = ts.parseJsonConfigFileContent(JSON.parse(text), ts.sys, root, undefined, undefined, undefined, extensions)
      assert.deepEqual(parsed.errors, [])
      assert.deepEqual(parsed.fileNames.map(file => file.slice(root.length + 1)).sort(),
        ["src/updater/beta-dialog.tsx", "src/updater/beta-dialog.vibex"])
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("selectors: include and exclude widen together, preserving JSONC and unrelated settings", () => {
  const text = '{\n  // stories stay excluded\n  "exclude": ["**/*.stories.tsx",],\n  "compilerOptions": {"jsx": "preserve"},\n  "include": ["src/**/*.tsx",],\n}\n'
  const next = addVibeIncludes(text, ts)
  assert.ok(next.includes("// stories stay excluded"))
  assert.ok(next.includes('"compilerOptions": {"jsx": "preserve"}'))
  const { config, error } = ts.parseConfigFileTextToJson("tsconfig.json", next)
  assert.equal(error, undefined)
  assert.deepEqual(config.include, ["src/**/*.tsx", "src/**/*.vibex"])
  assert.deepEqual(config.exclude, ["**/*.stories.tsx", "**/*.stories.vibex"])
  assert.equal(addVibeIncludes(next, ts), next)
})

test("property: TS/JSX selector counterparts are complete, unique and idempotent", () => {
  const pattern = fc.tuple(fc.constantFrom("src/**/", "**/", "packages/*/", "./nested/"),
    fc.constantFrom("*", "*.stories", "entry", "café"),
    fc.constantFrom(".ts", ".mts", ".tsx", ".vibe", ".vibex", ".d.ts", ".d.mts", ".d.tsx", ".js", ""))
    .map(parts => parts.join(""))
  fc.assert(fc.property(fc.array(pattern, { maxLength: 12 }), fc.array(pattern, { maxLength: 12 }), (include, exclude) => {
    const original = { include, exclude, compilerOptions: { strict: true }, files: ["keep.tsx"] }
    const next = addVibeIncludes(JSON.stringify(original), ts)
    const parsed = JSON.parse(next)
    for (const key of ["include", "exclude"]) {
      const counterparts = original[key].filter(p => /\.(?:mts|ts|tsx)$/.test(p) && !/\.d\.(?:mts|ts|tsx)$/.test(p))
        .map(p => p.replace(/\.(?:mts|ts|tsx)$/, p.endsWith(".tsx") ? ".vibex" : ".vibe"))
      assert.deepEqual(parsed[key], [...original[key], ...new Set(counterparts.filter(p => !original[key].includes(p)))])
    }
    assert.deepEqual(parsed.compilerOptions, original.compilerOptions)
    assert.deepEqual(parsed.files, original.files)
    assert.equal(addVibeIncludes(next, ts), next)
  }), { seed: 810039, numRuns: 300 })
})
