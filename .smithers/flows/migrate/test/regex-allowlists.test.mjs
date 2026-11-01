import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { extensionAllowlistWarnings, wireDeveloperTools } from "../lib/tooling.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-plugin-extension-regex.json", import.meta.url), "utf8"))
const quote = "Setup also warns when a literal source-extension regex accepts TypeScript filenames but skips the corresponding `.vibe` filename."
function inspect(source, file = "plugin.ts") {
  return extensionAllowlistWarnings(ts, source, file)
}
test("alchemy: setup identifies the regex that silently excludes native transform inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-plugin-filter-"))
  try {
    writeFileSync(join(root, "package.json"), "{}")
    mkdirSync(join(root, "src"))
    for (const file of corpus.files) writeFileSync(join(root, file), corpus.source)
    const result = wireDeveloperTools({ root, ts, specsFor: () => ({}) })
    for (const file of corpus.files) {
      assert.ok(result.warnings.some(w => w.startsWith(file + ":" + corpus.line + ":") && w.includes('regex') && w.includes(".vibe")))
      assert.equal(readFileSync(join(root, file), "utf8"), corpus.source, "setup warns without guessing a repository plugin rewrite")
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("property: extension regex warnings follow filename acceptance across flags and alternate patterns", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  fc.assert(fc.property(
    fc.uniqueArray(fc.constantFrom("ts", "tsx", "mts", "cts", "js", "mjs", "vibe", "json"), { minLength: 1 }),
    fc.constantFrom("", "g", "y", "i", "gi", "m", "s", "u"), fc.boolean(), fc.integer({ min: 0, max: 6 }),
    (extensions, flags, characterClass, blankLines) => {
      const pattern = (characterClass ? "[.]" : "\\.") + "(?:" + extensions.join("|") + ")$"
      const literal = "/" + pattern + "/" + flags
      const source = "\n".repeat(blankLines) + "const filter = { id: " + literal + " };\n"
      const expected = extensions.some(e => ["ts", "tsx", "mts", "cts"].includes(e)) && !extensions.includes("vibe")
      const result = inspect(source)
      assert.equal(result.length, Number(expected), source)
      if (expected) {
        assert.match(result[0], new RegExp("^plugin.ts:" + (blankLines + 1) + ":"))
        assert.ok(result[0].includes(".d.vibe.ts"), "the warning calls out generated declaration sidecars")
      }
    }
  ), { seed: 460046, numRuns: 500 })
})
test("regex scans skip comments, strings, non-extension patterns, JS-only filters and already native filters", () => {
  for (const source of [
    "// /\\.ts$/\nconst text = '/\\\\.ts$/';",
    "const filter = /\\.js$/g;",
    "const filter = /\\.(?:ts|vibe)$/gy;",
    "const pattern = /^typescript$/;",
    "const filter = /.*/;",
  ]) assert.deepEqual(inspect(source), [], source)
  assert.equal(inspect("const SUPPORTED_FILE_RE = /\\.(?:m?[jt]sx?|cjs|cts)$/;").length, 1)
  assert.equal(inspect("const filter = /[.](?:mts|cts)$/;").length, 1)
})
test("setup does not inspect a foreign package's plugin filters", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-plugin-vendor-"))
  try {
    writeFileSync(join(root, "package.json"), "{}")
    mkdirSync(join(root, "vendor"))
    writeFileSync(join(root, "vendor/package.json"), "{}")
    writeFileSync(join(root, "vendor/PurePlugin.ts"), corpus.source)
    assert.deepEqual(wireDeveloperTools({ root, ts, specsFor: () => ({}) }).warnings, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
