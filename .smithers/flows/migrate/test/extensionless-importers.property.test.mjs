import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, posix } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { renameBatch, rewriteImports, rewriteSpecifier } from "../lib/codemod.mjs"
import { parseImports } from "../lib/imports.mjs"
const repo = process.env.VIBELANG_FLOW_REPO ?? fileURLToPath(new URL("../../../../", import.meta.url))
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const ts = createRequire(join(repo, "docs/tools/package.json"))("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-extensionless-ts-importer.json", import.meta.url)))
// VIP-27/chapter 7 requires source-named native imports. The oracle is the stock TypeScript module resolver.
const options = { noEmit: true, skipLibCheck: true, strict: true, types: [], target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowArbitraryExtensions: true, allowImportingTsExtensions: true }
function put(root, file, text) {
  mkdirSync(join(root, posix.dirname(file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
function diagnostics(root, importer) {
  return ts.getPreEmitDiagnostics(ts.createProgram([join(root, importer)], options)).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }))
}
test("foldkit-31: stock TypeScript resolves a native sidecar after the actual codemod", () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-extensionless-"))
  try {
    put(root, "package.json", '{"private":true,"type":"module"}')
    put(root, corpus.importer, corpus.before)
    put(root, corpus.originalModule, corpus.module)
    assert.deepEqual(diagnostics(root, corpus.importer), [])
    renameBatch(root, [corpus.originalModule])
    put(root, corpus.nativeModule.replace(/\.vibe$/, ".d.vibe.ts"), corpus.declaration)
    assert.ok(diagnostics(root, corpus.importer).some(d => d.code === 2307), "the unchanged extensionless import must reproduce TS2307")
    const edits = rewriteImports(root, [corpus.importer, corpus.nativeModule], [corpus.nativeModule])
    assert.deepEqual(edits, [{ file: corpus.importer, from: "./leaf", to: "./leaf.vibe" }])
    assert.equal(readFileSync(join(root, corpus.importer), "utf8"), corpus.after)
    assert.deepEqual(diagnostics(root, corpus.importer), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("native source rewrites agree with stock TypeScript's real resolver over extensionless paths", () => {
  const part = fc.constantFrom("src", "nested", "with space", "café", "a.b")
  const dir = fc.array(part, { minLength: 0, maxLength: 3 }).map(parts => parts.join("/"))
  fc.assert(fc.property(dir, dir, fc.constantFrom("leaf", "native.module", "under_score", "café"), fc.boolean(), fc.constantFrom(".ts", ".mts", ".cts", ".tsx"), fc.constantFrom("import", "export", "type", "dynamic"), fc.constantFrom("'", '"'), (importerDir, targetDir, stem, index, extension, form, quote) => {
    const root = mkdtempSync(join(tmpdir(), "foldkit-extensionless-property-"))
    try {
      const importer = posix.join(importerDir, "consumer" + extension)
      const target = posix.join(targetDir, "target", index ? "index.vibe" : stem + ".vibe")
      const originalPath = index ? posix.dirname(target) : target.slice(0, -".vibe".length)
      let specifier = posix.relative(posix.dirname(importer), originalPath)
      if (!specifier.startsWith(".")) specifier = "./" + specifier
      const quoted = quote + specifier + quote
      const text = form === "import" ? "import { answer } from " + quoted + "\nexport const result = answer\n" :
        form === "export" ? "export { answer } from " + quoted + "\n" :
        form === "type" ? "export type Answer = typeof import(" + quoted + ").answer\n" :
        "export const result = import(" + quoted + ")\n"
      put(root, importer, text)
      put(root, target, corpus.module)
      const sidecar = target.replace(/\.vibe$/, ".d.vibe.ts")
      put(root, sidecar, corpus.declaration)
      rewriteImports(root, [importer, target], [target])
      const rewritten = parseImports(readFileSync(join(root, importer), "utf8"))[0].specifier
      const resolution = ts.resolveModuleName(rewritten, join(root, importer), options, ts.sys).resolvedModule
      assert.equal(resolution?.resolvedFileName, join(root, sidecar), JSON.stringify({ importer, target, specifier, rewritten }))
      assert.ok(rewritten.endsWith(".vibe"))
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 33131, numRuns: 200 })
})
test("extensionless TypeScript dependencies stay unchanged, native imports and directory indexes stay explicit", () => {
  assert.equal(rewriteSpecifier("src/use.ts", "./leaf", "src/leaf.ts"), "./leaf")
  assert.equal(rewriteSpecifier("src/use.ts", "./leaf.vibe", "src/leaf.vibe"), "./leaf.vibe")
  assert.equal(rewriteSpecifier("src/use.ts", "./leaf/", "src/leaf/index.vibe"), "./leaf/index.vibe")
  assert.equal(rewriteSpecifier("src/use.ts", "./native.module", "src/native.module.vibe"), "./native.module.vibe")
})
// Detail 272's first addendum: "Extensionless specifiers (`../src/X`) need no edit", and test-diff.mjs refuses one.
// Smithers' packages/smithers/ui/tests/app-operations.test.ts and 120 apps/mvp tests were refused for this edit.
test("a test keeps its extensionless specifier and renames only what names the renamed file", () => {
  const dir = fc.constantFrom("test", "tests", "__tests__", "src", "src/deep/tests")
  const name = fc.constantFrom("app.test.ts", "app.spec.tsx", "helper.ts", "e2e.test.js", "app.test.vibe")
  const spelling = fc.constantFrom("", ".ts", ".js")
  const form = fc.constantFrom(s => `import { a } from ${s}\n`, s => `export { a } from ${s}\n`, s => `const m = await import(${s})\n`, s => `vi.mock(${s})\n`)
  fc.assert(fc.property(dir, name, spelling, fc.boolean(), form, (dirname, file, ext, index, write) => {
    const importer = posix.join(dirname, file)
    if (!/(?:^|\/)(?:test|tests|__tests__)\//.test(importer) && !/\.(?:test|spec)\./.test(file)) return
    if (file.endsWith(".js") && ext !== ".ts") return // a JavaScript file names JavaScript by ./x.js, and has no extensionless .vibe import
    const root = mkdtempSync(join(tmpdir(), "extensionless-test-"))
    try {
      const target = index ? "lib/leaf/index.vibe" : "lib/leaf.vibe"
      const named = (index && ext ? "lib/leaf/index" : "lib/leaf") + ext
      let specifier = posix.relative(posix.dirname(importer), named)
      if (!specifier.startsWith(".")) specifier = "./" + specifier
      const text = write(JSON.stringify(specifier))
      put(root, importer, text)
      put(root, target, "export const a = 1\n")
      const edits = rewriteImports(root, [importer, target], [target])
      if (ext === "") {
        assert.deepEqual(edits, [], JSON.stringify({ importer, specifier }))
        assert.equal(readFileSync(join(root, importer), "utf8"), text)
      } else {
        assert.deepEqual(edits, [{ file: importer, from: specifier, to: specifier.slice(0, -ext.length) + ".vibe" }])
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 272, numRuns: 150 })
})
test("Smithers ui wiki: the test keeps ../src/app-operations/wiki and ../src/flow-form", () => {
  const root = mkdtempSync(join(tmpdir(), "extensionless-wiki-"))
  try {
    const test = "packages/smithers/ui/tests/app-operations.test.ts"
    const text = 'import { a } from "../src/app-operations/wiki"\nimport { b } from "../src/flow-form"\n'
    put(root, test, text)
    put(root, "packages/smithers/ui/src/app-operations/wiki.vibe", "export const a = 1\n")
    put(root, "packages/smithers/ui/src/flow-form.vibe", "export const b = 1\n")
    const scope = [test, "packages/smithers/ui/src/app-operations/wiki.vibe", "packages/smithers/ui/src/flow-form.vibe"]
    assert.deepEqual(rewriteImports(root, scope, scope.slice(1)), [])
    assert.equal(readFileSync(join(root, test), "utf8"), text)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
