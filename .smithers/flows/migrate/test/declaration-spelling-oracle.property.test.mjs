import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-declaration-import-spelling.json", import.meta.url), "utf8"))
const chapter = readFileSync(new URL("../../../../docs/design/vips/0027-declaration-output.md", import.meta.url), "utf8")
const quote = "Neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` rewrites declaration specifiers; JavaScript output rewriting is separate."
const emit = (input, options = {}) => ts.transpileDeclaration(input, {
  compilerOptions: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, rewriteRelativeImportExtensions: true, ...options },
  reportDiagnostics: true
})

test("declaration spelling oracle quotes VIP-27 and pins stock TypeScript", () => {
  assert.ok(chapter.includes(quote))
  assert.equal(ts.version, "5.9.3")
})

test("opencode-declaration-import-spelling: the source twin preserves its written extension", () => {
  for (const key of ["original", "twin"]) {
    const result = emit(corpus[key], { rewriteRelativeImportExtensions: corpus.rewriteRelativeImportExtensions })
    assert.deepEqual(result.diagnostics, [])
    assert.equal(result.outputText, corpus[key].replace("; export", ";\nexport") + "\n")
  }
})

test("stock declaration imports, reexports and type queries preserve each written spelling", () => {
  fc.assert(fc.property(
    fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/),
    fc.constantFrom("", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".mts", ".cjs", ".cts"),
    fc.boolean(), fc.boolean(), fc.boolean(),
    (name, suffix, rewrite, importing, bundler) => {
      const specifier = "./nested/" + name + suffix
      const text = 'import type { Input } from "' + specifier + '";\nexport type Output = Input;\nexport type Query = import("' + specifier + '").Input;\nexport { value } from "' + specifier + '";\n'
      const result = emit(text, {
        rewriteRelativeImportExtensions: rewrite, allowImportingTsExtensions: importing,
        module: bundler ? ts.ModuleKind.ESNext : ts.ModuleKind.NodeNext,
        moduleResolution: bundler ? ts.ModuleResolutionKind.Bundler : ts.ModuleResolutionKind.NodeNext
      })
      assert.deepEqual(result.diagnostics, [])
      assert.equal(result.outputText, text)
    }
  ), { seed: 275903, numRuns: 100 })
})
