import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-layer-node-empty-module-marker.json", import.meta.url)))
const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const compilerOptions = { lib: ["lib.es5.d.ts"], types: [] }

function compare(before, after, { invalid = false, changedNames = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-empty-module-marker-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, side, file)), { recursive: true })
        writeFileSync(join(root, side, file), text)
      }
    }
    const names = []
    for (const side of ["before", "after"]) {
      const path = join(root, side, "index.d.ts")
      const program = ts.createProgram([path], {
        ...compilerOptions, strict: true, noEmit: true,
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      })
      if (!invalid) assert.deepEqual(ts.getPreEmitDiagnostics(program).map(row => row.code), [], "stock TypeScript accepts the fixture")
      const checker = program.getTypeChecker()
      names.push(checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(path))).map(row => row.name).sort())
    }
    if (!changedNames) assert.deepEqual(names[0], names[1], "stock TypeScript sees the same public names before and after")
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), {
      compilerOptions, beforeEntrypoints: { ".": "index.d.ts" }, afterEntrypoints: { ".": "index.d.ts" },
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function layout({ name = "Services", forward = false, marker = "export {};\n", prefix = false, changed = false, changedDoc = false } = {}) {
  const original = corpus.source.replaceAll("Services", name)
  let source = original
  if (changed) source = source.replace(" ? R : T extends object", " ? readonly [R] : T extends object")
  if (changedDoc) source = source.replace("Services required by a tool.", "A different description.")
  const marked = prefix ? marker + source : source + marker
  const after = forward ? {
    "index.d.ts": `export type { ${name}, Token } from "./index.vibe.platform.js";\n` + marker,
    "index.vibe.platform.d.ts": marked,
  } : { "index.d.ts": marked }
  return [{ "index.d.ts": original, "token.d.ts": corpus.dependency }, { ...after, "token.d.ts": corpus.dependency }]
}
function same(result) {
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
}
test("a redundant empty module marker preserves a recursive exported type", () => {
  assert.ok(readFileSync(new URL("../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(corpus.rule))
  same(compare(...layout()))
})
test("empty markers in a module-body owner and body preserve a forwarding proof", () => {
  same(compare(...layout({ forward: true })))
})
test("empty markers preserve unchanged APIs and still reject a changed exported type", () => {
  for (const forward of [false, true]) {
    const result = compare(...layout({ forward, changed: true }))
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, false)
    assert.ok(result.typeDifferences.length, JSON.stringify(result))
  }
})
test("empty markers do not hide changed export documentation", () => {
  for (const forward of [false, true]) {
    const result = compare(...layout({ forward, changedDoc: true }))
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, false)
    assert.ok(result.docDifferences.length, JSON.stringify(result))
  }
})
test("the only module marker still changes a script's global scope", () => {
  const before = {
    "index.d.ts": 'import "./config.js"; export type Value = typeof globalSetting;\n',
    "config.d.ts": "declare const globalSetting: number;\n",
  }
  const after = { ...before, "config.d.ts": before["config.d.ts"] + "export {};\n" }
  const result = compare(before, after, { invalid: true })
  assert.equal(result.identical, false)
  assert.ok(result.environmentDiagnostics.some(row => row.blocking && row.diagnostic.includes("TS2304")), JSON.stringify(result))
})
test("a marker that makes ambient declarations private still changes exported names", () => {
  const source = corpus.source.replace('export type { Token } from "./token.js";\n', "")
  const result = compare({ "index.d.ts": source }, { "index.d.ts": source + "export {};\n" }, { changedNames: true })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false)
  assert.deepEqual(result.nameDifferences.map(row => row.export).sort(), ["Eff", "ServicesOf"])
})
test("property: marker spelling, position and forwarding retain a recursive API and reject type changes", () => {
  fc.assert(fc.property(
    fc.constantFrom("Services", "Required", "Requirements"),
    fc.boolean(), fc.boolean(), fc.constantFrom("export {};\n", "export type {};\n", "export {};\nexport {};\n"),
    (name, forward, prefix, marker) => {
      same(compare(...layout({ name, forward, prefix, marker })))
      const result = compare(...layout({ name, forward, prefix, marker, changed: true }))
      assert.equal(result.comparisonComplete, true, JSON.stringify(result))
      assert.equal(result.identical, false, JSON.stringify(result))
      assert.ok(result.typeDifferences.length, JSON.stringify(result))
    },
  ), { numRuns: 12, seed: 401112 })
})

