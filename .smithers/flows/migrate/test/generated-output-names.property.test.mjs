import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { rewriteSourceLiterals } from "../lib/source-paths.mjs"
import { checkConvertedPaths } from "../lib/converted-paths.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-generated-output-name.json", import.meta.url), "utf8"))
const rewrite = (text, name = "index", extension = ".ts", file = "packages/generator/src/generate.ts") => {
  const from = "packages/generator/src/" + name + extension
  const to = from.slice(0, -extension.length) + (extension === ".tsx" ? ".vibex" : ".vibe")
  const renames = [{ from, to }], inventory = [file, from, to]
  return { ...rewriteSourceLiterals(ts, text, file, renames, { inventory }), from, to, file, inventory }
}
test("a generator retains its output basename when its own source is renamed", () => {
  const result = rewrite(corpus.source, "index", ".ts", corpus.file)
  assert.equal(result.text, corpus.source)
  assert.deepEqual(result.edits, [])
})
test("bare data remains visible to the audit without being changed or refused", () => {
  const source = 'const files = [{ path: "index.ts" }]; const name = "index.ts";'
  const result = rewrite(source)
  assert.equal(result.text, source)
  const audit = checkConvertedPaths({ ts, tracked: [result.file, result.to], read: file => file === result.file ? source : "export {}\n" })
  assert.deepEqual(audit.refusals, [])
  assert.ok(audit.reports.some(report => report.kind === "bare-name"))
})
test("source imports, URLs, path fragments and input configuration still follow the rename", () => {
  for (const source of [
    'import { value } from "./index.ts";',
    'const p = new URL("index.ts", import.meta.url);',
    'const p = path.join(__dirname, "index.ts");',
    'const p = readFileSync("index.ts", "utf8");',
    'const p = fs.readFile("index.ts");',
    'export default { entrypoints: ["index.ts"] };'
  ]) {
    const result = rewrite(source)
    assert.equal(result.edits.length, 1, source)
    assert.ok(result.text.includes("index.vibe"), result.text)
  }
  const config = rewrite('{"include":["index.ts"]}', "index", ".ts", "packages/generator/src/tsconfig.json")
  assert.equal(config.text, '{"include":["index.vibe"]}')
})
test("property: output records, constants and map keys preserve generated TypeScript filenames", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/), fc.constantFrom(".ts", ".tsx", ".mts", ".cts"), fc.constantFrom("path", "filename", "name", "output"), fc.constantFrom('"', "'", "`"), (name, extension, key, quote) => {
    const literal = quote + name + extension + quote
    const source = "const files = [{ " + key + ": " + literal + ", content: 'generated' }]; const name = " + literal + "; const byName = { [" + literal + "]: 1 };"
    const result = rewrite(source, name, extension)
    assert.equal(result.text, source)
    assert.deepEqual(result.edits, [])
    const input = rewrite("const source = new URL(" + literal + ", import.meta.url)", name, extension)
    assert.equal(input.edits.length, 1)
    assert.ok(input.text.includes(name + (extension === ".tsx" ? ".vibex" : ".vibe")))
  }), { seed: 119028, numRuns: 100 })
})
