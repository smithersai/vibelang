import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/foldkit-nominal-ambient-reference.json", import.meta.url)))
const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function verify({ lib = false, path = "ambient.d.ts", value = 1, missing = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-nominal-reference-"))
  const before = join(root, "before"), after = join(root, "after")
  const ambient = n => corpus.before["ambient.d.ts"].replace("version: 1", `version: ${n}`)
  try {
    for (const dir of [before, after]) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, "package.json"), '{"types":"index.d.ts"}')
      writeFileSync(join(dir, path), ambient(value))
      const index = corpus.before["index.d.ts"].replace("./ambient.d.ts", "./" + path)
        .replace("value: T;", "value: T;" + (lib ? " big: typeof BigInt;" : ""))
      writeFileSync(join(dir, "index.d.ts"), (lib ? '/// <reference lib="es2020" />\n' : '') + index)
      const program = ts.createProgram([join(dir, "index.d.ts")], { strict: true, noEmit: true, types: [] })
      const diagnostics = ts.getPreEmitDiagnostics(program)
      assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, { getCanonicalFileName:x=>x,getCurrentDirectory:()=>dir,getNewLine:()=>"\n" }))
    }
    if (missing) {
      for (const dir of [before, after]) {
        rmSync(join(dir, path))
        const program = ts.createProgram([join(dir, "index.d.ts")], { strict: true, noEmit: true, types: [] })
        assert.ok(ts.getPreEmitDiagnostics(program).some(diagnostic => diagnostic.code === 6053))
      }
      const invalid = compareApiIdentity(ts, before, after)
      assert.equal(invalid.comparisonComplete, false, JSON.stringify(invalid))
      assert.equal(invalid.identical, false, JSON.stringify(invalid))
      assert.deepEqual(invalid.typeDifferences, [])
      assert.ok(invalid.environmentDiagnostics.some(item => item.blocking && /TS6053/.test(item.diagnostic)), JSON.stringify(invalid))
      return
    }
    const same = compareApiIdentity(ts, before, after)
    assert.equal(same.comparisonComplete, true, JSON.stringify(same))
    assert.equal(same.identical, true, JSON.stringify(same))
    writeFileSync(join(after, path), ambient(value + 1))
    const changed = compareApiIdentity(ts, before, after)
    assert.equal(changed.comparisonComplete, true, JSON.stringify(changed))
    assert.equal(changed.identical, false, JSON.stringify(changed))
    assert.ok(changed.typeDifferences.length, JSON.stringify(changed))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("nominal alignment preserves leading declaration path references", () => verify())
test("nominal alignment preserves leading library references", () => verify({ lib: true }))
test("missing declaration references in both inputs remain invalid", () => verify({ missing: true }))
test("property: nominal identity keeps referenced ambient exports and mutations", async () => {
  await checkProperty(fc, {
    name: "api-identity-nominal-reference-directives",
    rule: "Will: a package compared with itself is always identical; ambient declarations stay in the comparison and a real API difference must never be hidden.",
    command: "node --test scripts/api-identity-nominal-references.test.mjs",
    arbitrary: fc.record({ lib: fc.boolean(), path: fc.constantFrom("ambient.d.ts", "types/ambient.d.ts", "types/env/global.d.ts"), value: fc.integer({ min: -10, max: 10 }) }),
    numRuns: 24,
    check: verify,
  })
})
