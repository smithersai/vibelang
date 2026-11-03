import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")

function verify({ name, global, changed = false }) {
  const root = mkdtempSync(join(tmpdir(), "api-global-alias-"))
  try {
    for (const side of ["before", "after"]) {
      const dir = join(root, side)
      mkdirSync(dir)
      writeFileSync(join(dir, "index.d.ts"), "export import " + name + " = globalThis." +
        (changed && side === "after" ? "Partial" : global) + ";\n")
      const program = ts.createProgram([join(dir, "index.d.ts")], { noEmit: true, strict: true, types: [] })
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "stock tsc accepts the alias")
    }
    const result = compareApiIdentity(ts, join(root, "before"), join(root, "after"))
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, !changed, JSON.stringify(result))
    if (changed) assert.ok(result.typeDifferences.length, JSON.stringify(result))
    assert.ok(!result.environmentDiagnostics.some(d => d.blocking), JSON.stringify(result))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("generic global aliases do not turn the standard library into an external module", () => {
  verify({ name: "Dictionary", global: "Record" })
})
test("generic global alias mutations still fail declaration identity", () => {
  verify({ name: "Dictionary", global: "Readonly", changed: true })
})
test("property: renamed generic library aliases preserve their library environment", async () => {
  await checkProperty(fc, {
    name: "api-identity-global-generic-alias",
    rule: "Every exported type must be identical; a type-only import alias of a generic global library binding preserves that binding and the ambient library.",
    command: "node --test scripts/api-identity-global-alias.test.mjs",
    arbitrary: fc.record({
      name: fc.constantFrom("Dictionary", "Freeze", "CrossArray", "Renamed"),
      global: fc.constantFrom("Record", "Readonly", "Array", "ReadonlyArray", "Partial", "Pick"),
    }),
    numRuns: 4,
    check: verify,
  })
})
