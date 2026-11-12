import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { checkProperty } from "./testing/property.mjs"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
const stock = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-probe-diagnostic-context.json", import.meta.url)))
assert.ok(readFileSync(new URL("../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(corpus.rule))
function diagnose({ code = 2589, role = "check", aspect = "type", name = "Value", entry = "index.d.ts", entrypoint = "." } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-probe-diagnostic-"))
  try {
    for (const [side, value] of [["before", "string"], ["after", "number"]]) {
      const dir = join(root, side); mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      mkdirSync(dirname(join(dir, entry)), { recursive: true })
      writeFileSync(join(dir, entry), aspect === "type"
        ? "export interface " + name + " { readonly value: " + value + " }"
        : "export declare const " + name + ": { readonly value: " + value + " };")
    }
    const ts = { ...stock, getPreEmitDiagnostics(program, source, ...args) {
      const diagnostics = stock.getPreEmitDiagnostics(program, source, ...args)
      const alias = source?.statements.find(node => stock.isTypeAliasDeclaration(node) &&
        (role === "helper" ? node.name.text === "__Same" : new RegExp("^__" + role + "[0-9]+$").test(node.name.text)))
      return !alias ? diagnostics : [...diagnostics, {
        file: source, start: alias.name.getStart(source), length: alias.name.end - alias.name.getStart(source),
        category: stock.DiagnosticCategory.Error, code,
        messageText: corpus.diagnostics[code],
      }]
    } }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), {
      beforeEntrypoints: { [entrypoint]: entry }, afterEntrypoints: { [entrypoint]: entry },
      compilerOptions: { types: [], lib: ["lib.es5.d.ts"] },
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("a non-assertion probe error retains the compared export and generated assertion", () => {
  const result = diagnose()
  assert.equal(result.comparisonComplete, false)
  assert.equal(result.identical, false)
  const diagnostic = result.environmentDiagnostics.find(item => item.diagnostic.startsWith("TS2589:"))
  assert.ok(diagnostic?.blocking, JSON.stringify(result))
  assert.equal(diagnostic.entrypoint, ".")
  assert.equal(diagnostic.export, "Value")
  assert.equal(diagnostic.aspect, "type")
  assert.match(diagnostic.probe, /__Assert<__Same</)
})

function verify(shape) {
  const result = diagnose(shape)
  assert.equal(result.comparisonComplete, false)
  assert.equal(result.identical, false)
  const diagnostic = result.environmentDiagnostics.find(item => item.diagnostic.startsWith("TS" + shape.code + ":"))
  assert.ok(diagnostic?.blocking, JSON.stringify(result))
  assert.equal(diagnostic.entrypoint, shape.entrypoint ?? ".")
  assert.equal(diagnostic.export, shape.name ?? "Value")
  assert.equal(diagnostic.aspect, shape.aspect)
  assert.match(diagnostic.probe, shape.role === "check" ? /__Assert<__Same</ : /__Assert<__Assignable</)
}
for (const code of [2589, 2590, 2322])
  for (const role of ["check", "assign"])
    for (const aspect of ["type", "value"])
      test("TS" + code + " on the " + role + " probe names its " + aspect + " export", () => verify({ code, role, aspect }))

test("an identity-helper error remains blocking without borrowing a compared export", () => {
  const result = diagnose({ code: 2304, role: "helper" })
  const diagnostic = result.environmentDiagnostics.find(item => item.diagnostic.startsWith("TS2304:"))
  assert.ok(diagnostic?.blocking, JSON.stringify(result))
  assert.equal(result.comparisonComplete, false)
  for (const key of ["entrypoint", "export", "aspect", "probe"]) assert.equal(diagnostic[key], undefined)
})
test("a failed strict identity assertion remains a type difference", () => {
  const result = diagnose({ code: 2344 })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(item => item.export === "Value" && item.aspect === "type"))
  assert.ok(!result.environmentDiagnostics.some(item => item.blocking), JSON.stringify(result))
})
test("property: non-assertion probe failures retain export context and remain unavailable", async () => {
  await checkProperty(fc, {
    name: corpus.property, rule: corpus.rule,
    command: "node --test scripts/api-identity-probe-diagnostics.test.mjs",
    arbitrary: fc.record({
      code: fc.constantFrom(2589, 2590, 2322),
      role: fc.constantFrom("check", "assign"), aspect: fc.constantFrom("type", "value"),
      name: fc.constantFrom("Value", "Result", "Input"),
      entry: fc.constantFrom("index.d.ts", "types/public.d.ts", "deep/api/entry.d.ts"),
      entrypoint: fc.constantFrom(".", "./public", "./deep/entry"),
    }),
    numRuns: 24, check: verify,
  })
})
