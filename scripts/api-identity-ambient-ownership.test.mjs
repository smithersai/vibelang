import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/foldkit-nested-ambient-root.json", import.meta.url)))
const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function verify({ published = true, generic = false, module = "*.md", value = 1, reverse = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-ambient-ownership-"))
  const before = join(root, "before"), after = join(before, "after")
  const ambient = value => corpus.before["ambient.d.ts"].replace('"*.md"', JSON.stringify(module)).replace("version: 1", `version: ${value}`)
  try {
    for (const [dir, parameter] of [[before, "T"], [after, generic ? "U" : "T"]]) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "package.json"), JSON.stringify(published ? JSON.parse(corpus.before["package.json"]) : { types: "./index.d.ts" }))
      writeFileSync(join(dir, "index.d.ts"), corpus.before["index.d.ts"] +
        (generic ? `export declare class Box<${parameter}> { private secret; value: ${parameter}; }` : ""))
      writeFileSync(join(dir, "ambient.d.ts"), ambient(value))
      const program = ts.createProgram([join(dir, "index.d.ts"), join(dir, "ambient.d.ts")], { strict: true, noEmit: true, types: [] })
      assert.equal(ts.getPreEmitDiagnostics(program).length, 0)
    }
    const same = compareApiIdentity(ts, ...(reverse ? [after, before] : [before, after]))
    assert.equal(same.comparisonComplete, true, JSON.stringify(same))
    assert.equal(same.identical, true, JSON.stringify(same))
    writeFileSync(join(after, "ambient.d.ts"), ambient(value + 1))
    const changed = compareApiIdentity(ts, ...(reverse ? [after, before] : [before, after]))
    assert.equal(changed.comparisonComplete, true, JSON.stringify(changed))
    assert.equal(changed.identical, false, JSON.stringify(changed))
    assert.ok(changed.typeDifferences.length, JSON.stringify(changed))
    if (generic) {
      writeFileSync(join(after, "ambient.d.ts"), ambient(value))
      writeFileSync(join(after, "index.d.ts"), readFileSync(join(after, "index.d.ts"), "utf8").replace("private secret", "private changed"))
      const privateChange = compareApiIdentity(ts, ...(reverse ? [after, before] : [before, after]))
      assert.equal(privateChange.comparisonComplete, true, JSON.stringify(privateChange))
      assert.equal(privateChange.identical, false, JSON.stringify(privateChange))
      assert.ok(privateChange.typeDifferences.some(item => item.export === "Box"), JSON.stringify(privateChange))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("nested published ambient copies do not add exports to their enclosing snapshot", () => verify())
test("nested referenced ambient copies cannot mask a real type mutation", () => verify({ published: false }))
test("nested snapshots retain corresponding private class origins", () => verify({ generic: true }))
test("property: nested ambient snapshot ownership preserves self identity and mutations", async () => {
  await checkProperty(fc, {
    name: "api-identity-nested-ambient-ownership",
    rule: "Will: a package compared with itself is always identical; ambient declaration exports are compared like others, and a real API difference must never be hidden.",
    command: "node --test scripts/api-identity-ambient-ownership.test.mjs",
    generatorVersion: 2,
    arbitrary: fc.record({ reverse: fc.boolean(), published: fc.boolean(), generic: fc.boolean(), module: fc.constantFrom("*.md", "virtual"), value: fc.integer({ min: -10, max: 10 }) }),
    numRuns: 24,
    check: verify,
  })
})
