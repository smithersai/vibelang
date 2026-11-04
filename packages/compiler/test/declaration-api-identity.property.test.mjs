import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  declarationApiTypeScript as ts, declarationApiForms as forms, declarationApiModes as modes,
  emitDeclarationApiPair, emitDeclarationApiPairs, compareDeclarationApiPairs,
} from "../../../scripts/declaration-api-oracle.mjs"
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check")
const rule = "Ordinary declarations use the native twin's relative specifiers;"
assert.ok(readFileSync(new URL("../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(rule))

async function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "declaration-api-"))
  try { return await run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
test("declaration API identity matches the live tsc twin across the full configuration table", { timeout: 300_000 }, context => withRoot(async root => {
  assert.equal(ts.version, "5.9.3")
  const requests = []
  for (const resolution of modes) for (const allow of [false, true]) for (const rewrite of [false, true])
    for (const packageType of ["module", "commonjs"]) for (const form of forms)
      for (const style of [null, ".js", "extensionless", ".ts"])
        requests.push({ resolution, allow, rewrite, packageType, form, style,
          doc: "Public value for " + [resolution, +allow, +rewrite, packageType, form[0]].join("/") + "." })
  const rows = await emitDeclarationApiPairs(root, requests, context.signal)
  assert.equal(rows.length, 1792)
  for (const row of rows.filter(row => !row.nativeGraphValid))
    assert.ok(row.form.startsWith("stale-"), "Unexpected invalid native declaration: " + row.key)
  const result = compareDeclarationApiPairs(root, rows)
  if (process.env.VIBELANG_API_MATRIX_REPORT)
    writeFileSync(process.env.VIBELANG_API_MATRIX_REPORT, JSON.stringify(result, null, 2) + "\n")
  assert.equal(result.nativeInvalidGraphs.length, 256)
  assert.equal(result.comparisons, 1536)
  assert.equal(result.identical, true, JSON.stringify({
    names: result.nameDifferences, types: result.typeDifferences, docs: result.docDifferences,
  }, null, 2))
}))

test("property: declaration API identity follows tsc for config, spelling, export form, type and docs", { timeout: 120_000 }, context => withRoot(async root => {
  const validForms = forms.filter(form => !form[0].startsWith("stale-"))
  let round = 0, cases = 0
  const optionsArbitrary = fc.record({
    resolution: fc.constantFrom(...modes), allow: fc.boolean(), rewrite: fc.boolean(),
    packageType: fc.constantFrom("module", "commonjs"), form: fc.constantFrom(...validForms),
    style: fc.constantFrom(null, ".js", "extensionless", ".ts"),
    syntax: fc.constantFrom("named", "star", "alias", "type"), quote: fc.constantFrom("'", '"'),
    shape: fc.constantFrom("number", "string", "{ readonly id: number }"),
    doc: fc.constantFrom("Public value documentation.", "Stable API documentation.", "First line.\n * Second line."),
  })
  await fc.assert(fc.asyncProperty(fc.array(optionsArbitrary, { minLength: 8, maxLength: 8 }), async options => {
    const batchRoot = join(root, String(round++))
    const rows = await emitDeclarationApiPairs(batchRoot, options, context.signal)
    cases += rows.length
    for (const row of rows) assert.equal(row.nativeGraphValid, true, row.key)
    const result = compareDeclarationApiPairs(batchRoot, rows)
    assert.equal(result.identical, true, JSON.stringify({
      options, names: result.nameDifferences, types: result.typeDifferences, docs: result.docDifferences,
    }))
  }), { seed: 263, numRuns: 3 })
  assert.equal(cases, 24)
}))
