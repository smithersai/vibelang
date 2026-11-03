import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { createRequire } from "node:module"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const specsFor = () => ({ vibelang: "0.0.11" })
function fixture(t, jsx) {
  const root = mkdtempSync(join(tmpdir(), "vibex-sgconfig-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", "{}")
  put("sgconfig.yml", "ruleDirs:\n  - rules\n")
  put("rules/tags.yml", 'id: tags\nlanguage: tsx\nfiles: ["src/**/*.{ts,tsx}"]\nignores: ["src/ignored.tsx"]\nrule:\n  kind: identifier\n')
  put("node_modules/vibelang/package.json", '{"name":"vibelang"}')
  put("node_modules/vibelang/tree-sitter/tree-sitter.json", JSON.stringify({
    grammars: [{ name: "vibe", path: ".", "file-types": ["vibe"] }, ...(jsx ? [{ name: "vibex", path: "vibex", "file-types": ["vibex"] }] : [])]
  }))
  return root
}

test("ast-grep setup registers the available JSX parser and routes TSX rules to it", t => {
  const root = fixture(t, true)
  // An earlier setup cloned this TSX-only rule for the plain parser.
  writeFileSync(join(root, "rules/tags.vibelang.yml"), "id: old-tags\nlanguage: VibeLang\nrule:\n  kind: jsx_opening_element\n")
  wireDeveloperTools({ root, specsFor })
  assert.equal(existsSync(join(root, "rules/tags.vibelang.yml")), false, "a JSX-only kind must never reach the plain parser")
  const config = readFileSync(join(root, "sgconfig.yml"), "utf8")
  assert.match(config, /VibeLangJSX:/)
  assert.match(config, /languageSymbol: tree_sitter_vibex/)
  assert.match(config, /extensions: \[vibex\]/)
  const rule = readFileSync(join(root, "rules/tags.vibelang-jsx.yml"), "utf8")
  assert.match(rule, /language: VibeLangJSX/)
  assert.match(rule, /id: tags-vibelang-jsx/)
  assert.ok(rule.includes("src/**/*.{vibe,vibex}"), rule)
  assert.ok(rule.includes("src/ignored.vibex"), rule)
  const original = readFileSync(join(root, "rules/tags.yml"), "utf8")
  assert.ok(original.includes("**/*.d.vibe.ts"), original)
  assert.ok(original.includes("**/*.d.vibex.ts"), original)
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})

test("ast-grep setup keeps a single-parser package usable", t => {
  const root = fixture(t, false)
  wireDeveloperTools({ root, specsFor })
  assert.doesNotMatch(readFileSync(join(root, "sgconfig.yml"), "utf8"), /VibeLangJSX/)
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})

test("generated rule aliases keep JSX-only and TypeScript-only kinds on their own parser", t => {
  const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
  const fc = require("fast-check")
  fc.assert(fc.property(fc.constantFrom("tsx", "TSX", "typescript", "TypeScript", "ts", "TS"), fc.constantFrom("", "'", '"'), (language, quote) => {
    const root = fixture(t, true)
    const jsx = language.toLowerCase() === "tsx"
    const source = "id: tags\nlanguage: " + quote + language + quote + "\nrule:\n  kind: " + (jsx ? "jsx_opening_element" : "type_assertion") + "\n"
    writeFileSync(join(root, "rules/tags.yml"), source)
    wireDeveloperTools({ root, specsFor })
    const suffix = jsx ? "vibelang-jsx" : "vibelang"
    assert.match(readFileSync(join(root, "rules/tags." + suffix + ".yml"), "utf8"), jsx ? /language: VibeLangJSX/ : /language: VibeLang\n/)
    assert.equal(existsSync(join(root, "rules/tags." + (jsx ? "vibelang" : "vibelang-jsx") + ".yml")), false)
    assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
  }), { seed: 3913, numRuns: 36 })
})
