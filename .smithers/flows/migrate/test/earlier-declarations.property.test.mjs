import { createRequire } from "node:module"
import { test } from "node:test"
import { check } from "./earlier-declarations-oracle.mjs"
import { assertParallelProperty } from "../../../../scripts/testing/parallel-property.mjs"
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")

const member = fc.record({
  name: fc.constantFrom("id", "name", "args", "f"),
  readonly: fc.boolean(),
  optional: fc.boolean(),
  type: fc.constantFrom("string", "number", "Name", "readonly string[]", "(element: Element) => void")
})
// Each sample uses the same independent declaration oracle and its own fixture.
test("foldkit-11: setup reports exactly the earlier declarations whose members a new toolchain changes", async () => {
  await assertParallelProperty(fc, {
    arbitraries: [
      fc.uniqueArray(member, { selector: (m) => m.name, minLength: 1, maxLength: 4 }),
      fc.option(fc.tuple(fc.nat(3), fc.constantFrom("readonly", "optional"))),
      fc.boolean()
    ],
    oracle: check, module: new URL("./earlier-declarations-oracle.mjs", import.meta.url),
    seed: 11011, numRuns: 300
  })
})
