import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
import { checkProperty } from "./testing/property.mjs"

const stockTs = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const options = { lib: ["lib.es5.d.ts"], strict: true, noEmit: true, types: [] }
function fixture(run, source = "export declare const value: Readonly<Record<string, number>>;") {
  const root = mkdtempSync(join(tmpdir(), "api-library-scope-")), file = join(root, "index.d.ts")
  try { writeFileSync(file, source); return run(file) }
  finally { rmSync(root, { recursive: true, force: true }) }
}
function failure(check) {
  try { check() } catch (error) { return error }
  assert.fail("the library guard must reject an unexpected environment")
}

test("ES5 fixture programs retain native declaration validity", () => fixture(file => {
  const { ts, assertLibraries } = createEs5FixtureGuard(stockTs, "Fixture")
  const program = ts.createProgram([file], options)
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
  assertLibraries()
}))

test("library guards preserve independent native missing-type errors", () => fixture(file => {
  const { ts, assertLibraries } = createEs5FixtureGuard(stockTs, "Fixture")
  const program = ts.createProgram([file], options)
  assert.ok(ts.getPreEmitDiagnostics(program).some(d => d.code === 2583))
  assertLibraries()
}, "export declare const value: BigInt;"))

test("library guards still require the actual ES5 library", () => fixture(file => {
  const { ts, assertLibraries } = createEs5FixtureGuard(stockTs, "Fixture")
  ts.createProgram([file], { noLib: true, noEmit: true, types: [] })
  assert.deepEqual(failure(assertLibraries).actual, { count: 1, examples: ["missing lib.es5.d.ts"] })
}))

test("repeated native browser programs produce bounded library-name diagnostics", () => fixture(file => {
  const { ts, assertLibraries } = createEs5FixtureGuard(stockTs, "Fixture")
  const counts = []
  for (let i = 0; i < 3; i++) {
    ts.createProgram([file], { noEmit: true, types: [], target: ts.ScriptTarget.ESNext })
    const error = failure(assertLibraries), { count, examples } = error.actual
    counts.push(count)
    assert.ok(count > 16)
    assert.equal(examples.length, 16)
    assert.equal(new Set(examples).size, examples.length)
    assert.ok(examples.every(name => !/[\\/]/.test(name)))
    assert.ok(JSON.stringify(error.actual).length < 6000)
  }
  assert.ok(counts.every(count => count === counts[0]), "repeated programs must not multiply the diagnostic count")
}))

test("property: repeated native library selections report each unexpected name once", async () => {
  await checkProperty(fc, {
    name: "api-identity-fixture-library-diagnostics",
    rule: "ES5 fixture guards retain native diagnostics and report distinct unexpected library names with bounded examples.",
    command: "node --test scripts/api-identity-library-scope.test.mjs",
    arbitrary: fc.record({
      extra: fc.constantFrom("lib.es2015.core.d.ts", "lib.es2015.collection.d.ts", "lib.es2015.promise.d.ts"),
      repetitions: fc.integer({ min: 2, max: 4 }),
    }),
    numRuns: 4,
    check: ({ extra, repetitions }) => fixture(file => {
      const { ts, assertLibraries } = createEs5FixtureGuard(stockTs, "Fixture")
      for (let i = 0; i < repetitions; i++) {
        const program = ts.createProgram([file], { ...options, lib: [...options.lib, extra] })
        assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
      }
      assert.deepEqual(failure(assertLibraries).actual, { count: 1, examples: [extra] })
    }),
  })
})
