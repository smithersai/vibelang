import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { splitPlatform, splitBatchPlatform } from "../lib/platform.mjs"
import { prepareState, applyState } from "../lib/codemod-state.mjs"
import { restorePrivateResolverExports } from "../lib/import-meta-platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const rule = "VibeLang imposes no additional restriction on `import.meta` syntax."

test("TestPlatformImportMetaQuoted", () => {
  assert.ok(readFileSync(SpecPath("005-services.md"), "utf8").includes(rule))
})

const expressions = [
  'import.meta.glob<string>("./*.md", { eager: true, query: "?raw", import: "default" })',
  'import.meta.glob<string>("./*.md")', "import.meta.env.MODE", "import.meta.hot",
  "import.meta.dirname", "import.meta.filename", "import.meta.resolve(specifier)",
  "import.meta.main", "import.meta", 'import.meta["env"]', "({ ...import.meta })",
  "import.meta?.env", 'import.meta.resolve?.("./input")', "import.meta.env.KEY++",
  "import.meta.url", "(import.meta as ImportMeta).url",
]
const positions = [
  expression => "export const run = (specifier: string) => " + expression + ";",
  expression => "export function run(specifier: string) { try { return " + expression + " } catch { return undefined } }",
  expression => "export const run = (specifier: string) => () => " + expression + ";",
  expression => "export const run = (specifier: string) => { const later = () => " + expression + "; return later };",
  expression => "export const run = (specifier: string) => [0, " + expression + ", 2];",
]
test("metadata expressions, captures and script headers need no platform companion", () => {
  const check = (expression, position, header) => {
    const source = header + positions[position](expression) + "\nexport const value = 1;\n"
    assert.equal(splitPlatform(source, "provider.ts", ts), null, source)
  }
  for (const expression of expressions) check(expression, 0, "")
  fc.assert(fc.property(fc.constantFrom(...expressions), fc.integer({ min: 0, max: positions.length - 1 }),
    fc.constantFrom("", "#!/usr/bin/env node\n", "// retained comment\n"), check),
    { numRuns: 250, seed: 4402190 })
})

test("migration keeps a bundler's original literal macro and metadata in the renamed module", () => {
  const root = mkdtempSync(join(tmpdir(), "import-meta-preserved-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", private: true }))
    const text = '#!/usr/bin/env node\nexport const pages = import.meta.glob("./*.md", { query: "?raw", import: "default", eager: true });\nexport const env = import.meta.env;\nexport const hot = import.meta.hot;\n'
    writeFileSync(join(root, "src/documents.ts"), text)
    const state = prepareState(root, ["src/documents.ts"], ["src/documents.ts"], { ts, moduleBodies: true })
    assert.deepEqual(state.platform, { splits: [], refused: [] })
    applyState(root, state)
    assert.equal(readFileSync(join(root, "src/documents.vibe"), "utf8"), text)
    assert.equal(existsSync(join(root, "src/documents.platform.ts")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("metadata preservation also applies beside existing companions and wildcard exports", () => {
  for (const moduleBodies of [true, false]) {
    const files = { "src/provider.ts": "export const metadata = import.meta;\n",
      "src/provider.platform.ts": "export const authored = 1;\n",
      "package.json": JSON.stringify({ exports: { "./*": "./src/*.ts" } }) }
    const snapshot = { ...files }
    const result = splitBatchPlatform(".", ["src/provider.ts"], ts, { moduleBodies,
      exists: file => Object.hasOwn(files, file), read: file => files[file], write: (file, text) => { files[file] = text } })
    assert.deepEqual(result, { splits: [], refused: [] })
    assert.deepEqual(files, snapshot)
  }
})

test("minimized migration corpus keeps metadata without generating obsolete helpers", () => {
  const directory = new URL("./corpus/", import.meta.url)
  for (const name of readdirSync(directory).filter(name => /import-meta|provider-import-meta|lang-documents-glob/.test(name) && name.endsWith(".json"))) {
    const corpus = JSON.parse(readFileSync(new URL(name, directory), "utf8"))
    for (const source of [corpus.minimal, corpus.text, corpus.source].filter(text => typeof text === "string")) {
      if (name === "lang-documents-glob.json") assert.equal(splitPlatform(source, "documents.ts", ts), null)
      const result = splitPlatform(source, "entry.ts", ts, { globals: ["process"] })
      if (result && !result.refused) {
        assert.doesNotMatch(result.module + result.platform, /\$importMeta(?:Resolve|Dirname|Filename|Env)/, name)
      }
    }
  }
})

test("older private companion receipts can still be reverted", () => {
  const root = mkdtempSync(join(tmpdir(), "import-meta-undo-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ exports: { "./*": "./src/*.ts", "./provider.platform": null } }))
    restorePrivateResolverExports(root, { privateExports: { manifest: "package.json", keys: ["./provider.platform"] } })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports, { "./*": "./src/*.ts" })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("unrelated platform operations move while literal bundler macros retain their module and inputs", () => {
  for (const moduleBodies of [true, false]) {
    for (const expression of ['import.meta.glob("./*.md", { eager: true })', "import.meta.env", "import.meta.hot", "import.meta"]) {
      const metadata = "export const metadata = " + expression + ";"
      const files = { "entry.ts": metadata + "\nexport function cwd(): string { return process.cwd() }\n",
        "package.json": JSON.stringify({ private: true, type: "module" }) }
      const result = splitBatchPlatform(".", ["entry.ts"], ts, { moduleBodies,
        globalsOf: () => ["process"], exists: file => Object.hasOwn(files, file),
        read: file => files[file], write: (file, text) => { files[file] = text } })
      assert.deepEqual(result.refused, [], expression)
      assert.equal(result.splits.length, 1, expression)
      assert.ok(files["entry.ts"].includes(metadata), files["entry.ts"])
      assert.doesNotMatch(Object.values(files).join("\n"), /\$importMeta(?:Resolve|Dirname|Filename|Env)/)
    }
  }
})
