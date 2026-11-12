import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"

const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-recursive-namespace-split.json", import.meta.url)))
assert.ok(readFileSync(new URL("../" + corpus.spec.split("#")[0], import.meta.url), "utf8").includes(corpus.rule))
const { ts, assertLibraries } = createEs5FixtureGuard(loadTypeScript(), "Recursive namespace fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const compilerOptions = { types: [], lib: ["lib.es5.d.ts"], strict: true,
  module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true }
function verify({ namespace = "Self", primitive = "string", hops = 1, star = false, reverse = false, mutual = false, changed, profile = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-recursive-namespace-"))
  try {
    const snapshots = structuredClone({ before: corpus.before, after: corpus.after })
    for (const [side, files] of Object.entries(snapshots)) {
      const next = side === "after"
      for (const file of Object.keys(files)) files[file] = files[file].replaceAll("Self", namespace).replaceAll("value: string", "value: " + primitive)
      if (mutual) {
        files["index.d.ts"] = files["index.d.ts"].replace('from "./index.js"', 'from "./peer.js"')
        files["peer.d.ts"] = 'export * as Owner from "./index.js"; export { get } from "./index.js";'
      }
      if (next && hops > 1) {
        files["hop.d.ts"] = files["index.d.ts"].match(/export \{ get \} from [^;]+;/)[0]
        files["index.d.ts"] = files["index.d.ts"].replace('from "./index.vibe.body.js"', 'from "./hop.js"')
      }
      if (next && star) files["index.d.ts"] = files["index.d.ts"].replace("export { get }", "export *")
      if (next && changed === "type") files["index.vibe.body.d.ts"] = files["index.vibe.body.d.ts"].replace("=> number", "=> string")
      if (next && changed === "doc") files["index.vibe.body.d.ts"] = files["index.vibe.body.d.ts"].replace("Reads a value.", "Reads another value.")
      if (next && changed === "name") {
        files["index.d.ts"] = files["index.d.ts"].replace("export { get }", "export { get as read }")
        if (mutual) files["peer.d.ts"] = files["peer.d.ts"].replace("export { get }", "export { read as get }")
      }
      if (next && changed === "runtime") files["index.d.ts"] = files["index.d.ts"].replace("export { get }", "export type { get }")
      const dir = join(root, side); mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true })
        writeFileSync(join(dir, file), text)
      }
    }
    for (const side of ["before", "after"]) {
      const input = ts.createProgram([join(root, side, "index.d.ts")], compilerOptions)
      assert.deepEqual(ts.getPreEmitDiagnostics(input).map(d => d.code), [], "native TypeScript accepts each declaration")
    }
    if (!changed) {
      const consumer = join(root, "consumer.ts")
      writeFileSync(consumer, 'import * as A from "./before/index.js"; import * as B from "./after/index.js";' +
        'declare const a: typeof A; declare const b: typeof B; const x: typeof A = b; const y: typeof B = a;' +
        '\n// @ts-expect-error namespace bindings are readonly\nA.get = a.get;' +
        '\n// @ts-expect-error re-exported namespace bindings are readonly\nB.get = b.get;')
      assert.deepEqual(ts.getPreEmitDiagnostics(ts.createProgram([consumer], compilerOptions)).map(d => d.code), [],
        "both native namespace types assign in both directions and reject writes")
    }
    const before = join(root, reverse ? "after" : "before"), after = join(root, reverse ? "before" : "after")
    const result = compareApiIdentity(ts, before, after, { compilerOptions, profile })
    assertLibraries()
    if (!changed) assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, !changed, JSON.stringify(result))
    if (changed) assert.ok(result.nameDifferences.length || result.typeDifferences.length ||
      result.docDifferences.length || result.environmentDiagnostics.some(d => d.blocking), JSON.stringify(result))
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("a self namespace preserves identity through a named module-body re-export", () => {
  const records = []
  const originalError = console.error
  try {
    console.error = line => records.push(JSON.parse(String(line)))
    verify({ profile: true })
  } finally { console.error = originalError }
  assert.ok(records.some(record => record.stage === "recursive-namespace-views" && record.recursiveNamespaceViews > 0),
    "profiling identifies the recursive namespace proof")
})
test("a star module-body re-export remains identical", () => { verify({ star: true }) })
for (const mutual of [false, true])
  for (const reverse of [false, true])
    test("recursive namespace layout: mutual " + mutual + ", reverse " + reverse, () => { verify({ mutual, reverse, hops: 2 }) })
for (const changed of ["type", "doc", "name", "runtime"])
  test("recursive namespace " + changed + " changes remain observable", () => { verify({ changed }) })
test("property: recursive module namespaces preserve splits and expose changed exports", async () => {
  await checkProperty(fc, {
    name: corpus.property, rule: corpus.rule,
    command: "node --test scripts/api-identity-recursive-namespace.test.mjs",
    arbitrary: fc.record({
      namespace: fc.constantFrom("Self", "ProviderShared", "Registry"),
      primitive: fc.constantFrom("string", "number", "boolean"),
      hops: fc.integer({ min: 1, max: 2 }), star: fc.boolean(), mutual: fc.boolean(), reverse: fc.boolean(),
    }),
    numRuns: 24,
    check: shape => {
      verify(shape)
      for (const changed of ["type", "doc", "name", "runtime"])
        verify({ ...shape, star: false, changed })
    },
  })
})

function compareControl(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-namespace-control-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      const dir = join(root, side); mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
      assert.deepEqual(ts.getPreEmitDiagnostics(ts.createProgram([join(dir, "index.d.ts")], compilerOptions)).map(d => d.code), [])
    }
    const result = compareApiIdentity(ts, join(root, "before"), join(root, "after"), { compilerOptions })
    assertLibraries()
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("recursive object properties keep their written mutability", () => {
  const text = 'export * as Self from "./index.js"; export declare const box: { readonly value: string; next?: typeof box };'
  assert.equal(compareControl({ "index.d.ts": text }, { "index.d.ts": text.replace("readonly value", "value") }).identical, false)
})
for (const merge of [false, true])
  test("a recursive namespace retains distinct nominal exports: merge " + merge, () => {
    const classes = "export declare class A { private brand; } export declare class B { private brand; }"
    const before = { "index.d.ts": 'export * as Self from "./index.js";' + classes + "export type Pair = [A, B];" }
    const after = {
      "index.d.ts": 'export * as Self from "./index.js"; import { A, B } from "./index.vibe.body.js"; export { A, B }; export type Pair = [A, B];',
      "index.vibe.body.d.ts": merge ? "export declare class A { private brand; } export { A as B };" : classes,
    }
    assert.equal(compareControl(before, after).identical, !merge)
  })
test("a changed recursive namespace target remains observable", () => {
  const text = 'export * as Self from "./index.js"; export declare const get: (value: string) => number;'
  const before = { "index.d.ts": text }
  const after = { "index.d.ts": text.replace('from "./index.js"', 'from "./peer.js"'), "peer.d.ts": text.replaceAll("./index.js", "./peer.js").replace("=> number", "=> string") }
  const result = compareControl(before, after)
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export.startsWith("Self")), JSON.stringify(result))
})
