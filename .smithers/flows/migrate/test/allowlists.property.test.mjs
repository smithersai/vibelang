import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const quote = 'Setup warns with the file and line when a string source-extension allowlist includes `.ts` but omits `.vibe`.'
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-source-extension-allowlist.json", import.meta.url)))

function warnings(source, file = "collector.ts") {
  const root = mkdtempSync(join(tmpdir(), "migrate-allowlist-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }))
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), source)
    const result = wireDeveloperTools({ root, ts, specsFor: () => ({}) })
    assert.equal(readFileSync(join(root, file), "utf8"), source, "the warning does not rewrite repository configuration")
    return result.warnings
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("foldkit-22: setup names a source collector's omitted native extension and its line", () => {
  const result = warnings(corpus.source, corpus.file)
  assert.ok(result.some(w => w.startsWith(corpus.file + ":" + corpus.line + ":") && w.includes(".vibe")))
})

test("extension allowlists: arrays and Sets warn exactly when ts is present and vibe is absent", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  fc.assert(fc.property(fc.uniqueArray(fc.constantFrom(".ts", ".mts", ".js", ".json", ".vibe", ".d.vibe.ts"), { minLength: 0 }),
    fc.integer({ min: 0, max: 5 }), fc.boolean(), fc.boolean(), (extensions, blankLines, set, singleQuoted) => {
      const literals = extensions.map(e => singleQuoted ? "'" + e + "'" : JSON.stringify(e))
      const list = "[" + literals.join(", ") + "]"
      const source = "\n".repeat(blankLines) + "const extensions = " + (set ? "new Set(" + list + ")" : list + " as const") + "\n"
      const result = warnings(source)
      const expected = extensions.includes(".ts") && !extensions.includes(".vibe")
      assert.equal(result.length, Number(expected))
      if (expected) {
        assert.match(result[0], new RegExp("^collector.ts:" + (blankLines + 1) + ":"))
        assert.ok(result[0].includes(".d.vibe.ts"), "tell the user to exclude generated sidecars too")
      }
    }), { seed: 220022, numRuns: 250 })
})

test("comments, code strings, unrelated lists and vendored sources do not warn", () => {
  assert.deepEqual(warnings("// const extensions = ['.ts']\nconst text = \"['.ts']\"; const unrelated = ['.ts', 'word'];\n"), [])
  // A nested package not listed as a workspace belongs to a vendored repository.
  const root = mkdtempSync(join(tmpdir(), "migrate-allowlist-vendor-"))
  try {
    writeFileSync(join(root, "package.json"), "{}")
    mkdirSync(join(root, "vendor"))
    writeFileSync(join(root, "vendor/package.json"), "{}")
    writeFileSync(join(root, "vendor/collector.ts"), "const extensions = ['.ts']")
    assert.deepEqual(wireDeveloperTools({ root, ts, specsFor: () => ({}) }).warnings, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
