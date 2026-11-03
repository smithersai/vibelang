import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-self-namespace-alias.json", import.meta.url)))
const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function verify({ namespace = "ToolRuntime", primitive = "string", changed, self = false }) {
  const root = mkdtempSync(join(tmpdir(), "api-self-namespace-"))
  try {
    for (const side of ["before", "after"]) {
      const dir = join(root, side)
      mkdirSync(dir)
      const next = side === "after" && changed
      let declarations = corpus.files["index.d.ts"].replaceAll("ToolRuntime", namespace)
        .replace("value: string", "value: " + primitive)
      if (next === "type") declarations = declarations.replace("value: " + primitive, "value: " + primitive + " | null")
      if (next === "doc") declarations = declarations.replace("/** result */", "/** changed */")
      if (next === "value") declarations = declarations.replace("version: 1", "version: 2")
      if (next === "name") declarations = declarations.replace("export type Description = { label: string };", "")
      writeFileSync(join(dir, "index.d.ts"), declarations)
      const program = ts.createProgram([join(dir, "index.d.ts")], {
        noEmit: true, strict: true, types: [], module: ts.ModuleKind.Preserve,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      })
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "stock tsc accepts the input")
    }
    const before = join(root, "before"), after = self ? before : join(root, "after")
    const result = compareApiIdentity(ts, before, after)
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, !changed, JSON.stringify(result))
    if (changed) {
      const list = changed === "doc" ? "docDifferences" : changed === "name" ? "nameDifferences" : "typeDifferences"
      assert.ok(result[list].length, JSON.stringify(result))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("a self-namespace re-export merged with a generic type alias compares identically", () => verify({}))
test("a merged namespace package compares identically with itself", () => verify({ self: true }))
for (const changed of ["type", "value", "name", "doc"])
  test(`self-namespace ${changed} mutations remain observable`, () => verify({ changed }))
test("property: self-namespace aliases preserve types and expose semantic mutations", async () => {
  await checkProperty(fc, {
    name: "api-identity-self-namespace-alias",
    rule: "Each published export has the same name, type and doc comment; a namespace re-export may share its name with a generic type alias.",
    command: "node --test scripts/api-identity-namespace.test.mjs",
    arbitrary: fc.record({
      namespace: fc.constantFrom("ToolRuntime", "Runtime", "Catalog"),
      primitive: fc.constantFrom("string", "number", "boolean"),
      changed: fc.option(fc.constantFrom("type", "value", "name", "doc"), { nil: undefined }),
    }),
    numRuns: 4,
    check: verify,
  })
})
