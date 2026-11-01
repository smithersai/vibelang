import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const { candidates } = await import(process.env.SIDECAR_PLAN_UNDER_TEST || new URL("../lib/plan.mjs", import.meta.url))

test("property: named paths, TypeScript enumerations and test-owned bundles independently retain source identities", () => {
  // Chapter 7 and detail 272 retain modules named by tools, selected by their TypeScript filename, or reached by a test-owned bundle.
  const file = fc.record({
    effect: fc.constantFrom("values", "types", "none"),
    extension: fc.constantFrom(".ts", ".mts", ".d.ts"),
    test: fc.boolean(),
    namedBy: fc.option(fc.constant("src/loader.ts"), { nil: null }),
    enumeratedBy: fc.array(fc.constant("test/load.ts:1 enumerates *.ts"), { maxLength: 2 }),
    bundledBy: fc.array(fc.constant("test/bundle.test.ts"), { maxLength: 2 })
  })
  fc.assert(fc.property(fc.array(file, { maxLength: 24 }), fc.boolean(), (items, includeTests) => {
    const files = items.map((item, i) => ({ ...item, path: "src/module" + i + item.extension }))
    const expected = files.filter(f => f.effect === "values" && (includeTests || !f.test) && f.extension !== ".d.ts" && !f.namedBy && !f.enumeratedBy.length && !f.bundledBy?.length)
    assert.deepEqual(candidates({ files }, { includeTests }).map(f => f.path), expected.map(f => f.path))
  }), {
    seed: 26827236, numRuns: 300,
    examples: [
      [[{ effect: "values", extension: ".ts", test: false, namedBy: null, enumeratedBy: ["test/load.ts:1 enumerates *.ts"] }], false],
      [[{ effect: "values", extension: ".mts", test: false, namedBy: "src/loader.ts", enumeratedBy: [], bundledBy: [] }], false],
      [[{ effect: "values", extension: ".ts", test: false, namedBy: null, enumeratedBy: [], bundledBy: ["test/bundle.test.ts"] }], false]
    ]
  })
})
