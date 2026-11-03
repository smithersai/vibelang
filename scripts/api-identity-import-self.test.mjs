import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-import-self-export.json", import.meta.url)))
const ts = loadTypeScript()
assert.ok(readFileSync(new URL("../" + corpus.spec.split("#")[0], import.meta.url), "utf8").includes(corpus.rule), "property quotes the current API-identity rule")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const options = {
  strict: true, noEmit: true, types: [],
  module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler,
}
function diagnostics(files) {
  return ts.getPreEmitDiagnostics(ts.createProgram(files, options)).map(d => ({
    code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  }))
}
function fixture(before, after, check) {
  const root = mkdtempSync(join(tmpdir(), "api-import-self-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      const dir = join(root, side)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"types":"./index.d.ts"}')
      for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
      assert.deepEqual(diagnostics([join(dir, "index.d.ts")]), [], "stock TypeScript accepts each original")
    }
    return check(join(root, "before"), join(root, "after"), root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function verify({ namespace = "Self", value = "string", changed, reverse = false, position = 1, typeOnly = false, aliases = false } = {}) {
  const self = 'export * as ' + namespace + ' from "./index.js";'
  const imports = [
    'import ' + (typeOnly ? "type " : "") + '{ Out } from "./leaf.js";',
    'import type { Marker } from "./marker.js";',
  ]
  const declaration = '/** Reads the value. */\nexport declare const get: <T>(value: T) => Out<T>;\nexport type Tag = Marker;'
  const files = {
    "leaf.d.ts": corpus.before["leaf.d.ts"].replace("{ value:", "{ field:"),
    "marker.d.ts": "export type Marker = " + value + ";",
  }
  const before = { ...files, "index.d.ts": [self, ...imports, ...(aliases ? [self.replace(namespace, namespace + "Again")] : []), declaration].join("\n") }
  const statements = [...imports]
  statements.splice(position, 0, self)
  if (aliases) statements.push(self.replace(namespace, namespace + "Again"))
  const after = { ...files, "index.d.ts": [...statements, declaration].join("\n") }
  if (changed === "type") after["leaf.d.ts"] = after["leaf.d.ts"].replace("? V :", "? [V] :")
  if (changed === "doc") after["index.d.ts"] = after["index.d.ts"].replace("Reads the value.", "Reads a different value.")
  if (changed === "name") after["index.d.ts"] = after["index.d.ts"].replace("const get:", "const read:")
  if (changed === "dependency") after["marker.d.ts"] = "export type Marker = " + (value === "number" ? "boolean" : "number") + ";"
  return fixture(reverse ? after : before, reverse ? before : after, (a, b, root) => {
    if (!changed || changed === "doc") {
      const consumer = join(root, "consumer.ts")
      writeFileSync(consumer, 'import * as A from "./before/index.js"; import * as B from "./after/index.js";\n' +
        'declare const a: typeof A.get; declare const b: typeof B.get;\n' +
        'const forward: typeof B.get = a; const reverse: typeof A.get = b;\n')
      assert.deepEqual(diagnostics([consumer]), [], "stock TypeScript accepts both assignment directions")
    }
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, !changed, JSON.stringify(result))
    const kind = changed === "doc" ? "docDifferences" : changed === "name" ? "nameDifferences" : "typeDifferences"
    if (changed) assert.ok(result[kind].length, JSON.stringify(result))
    return result
  })
}

test("opencode corpus: a bound import crossing a self-namespace export preserves deferred infer identity", () => {
  fixture(corpus.before, corpus.after, (a, b, root) => {
    const consumer = join(root, "consumer.ts")
    writeFileSync(consumer, 'import * as A from "./before/index.js"; import * as B from "./after/index.js";declare const a:typeof A.get;declare const b:typeof B.get;const x:typeof B.get=a;const y:typeof A.get=b;')
    assert.deepEqual(diagnostics([consumer]), [], "native TypeScript accepts both assignments")
    const stages = []
    const error = console.error
    let result
    try {
      console.error = value => { stages.push(JSON.parse(value)) }
      result = compareApiIdentity(ts, a, b, { profile: true })
    } finally { console.error = error }
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, true, JSON.stringify(result))
    assert.ok(stages.some(stage => stage.stage === "module-equivalence-complete" &&
      stage.provedModules > 0 && stage.selfNamespaceImportRuns > 0), "profile reports the resolved normalization proof")
  })
})
for (const position of [0, 1, 2])
  for (const reverse of [false, true])
    test("self export position " + position + ", reverse " + reverse, () => verify({ position, reverse, aliases: true }))
for (const changed of ["type", "doc", "name", "dependency"])
  test("crossed self export keeps " + changed + " changes observable", () => verify({ changed, position: 2 }))

test("self-export normalization cannot merge distinct same-text nominal dependencies", () => {
  const shared = {
    "a.d.ts": "export declare class Item { private brand; }",
    "b.d.ts": "export declare class Item { private brand; }",
  }
  const before = { ...shared, "index.d.ts": 'export * as Self from "./index.js"; import { Item as A } from "./a.js"; import { Item as B } from "./b.js"; export type Pair = [A, B];' }
  const after = { ...shared, "index.d.ts": 'import { Item as A } from "./a.js"; export * as Self from "./index.js"; import { Item as B } from "./a.js"; export type Pair = [A, B];' }
  fixture(before, after, (a, b) => assert.equal(compareApiIdentity(ts, a, b).identical, false))
})

test("property: import/self-export positions preserve identity while API mutations remain visible", async () => {
  await checkProperty(fc, {
    name: corpus.property, rule: corpus.rule,
    command: "node --test scripts/api-identity-import-self.test.mjs",
    arbitrary: fc.record({
      namespace: fc.constantFrom("Self", "Session", "Rpc"),
      value: fc.constantFrom("string", "number", "boolean"),
      position: fc.integer({ min: 0, max: 2 }), reverse: fc.boolean(), typeOnly: fc.boolean(), aliases: fc.boolean(),
      changed: fc.option(fc.constantFrom("type", "doc", "name", "dependency"), { nil: undefined }),
    }),
    numRuns: 24, check: input => { verify(input) },
  })
})
