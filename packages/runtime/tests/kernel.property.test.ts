import { test } from "bun:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { programArbitrary, runInterrupted, runProgram } from "./property-programs.ts"

const failures = "docs/design/history/src/217-part2-ch17-failures.md: Combining causes, catch, finalization (D305/D306)"
const machine = "docs/design/history/src/320-part3-ch20-machine.md: Final, Mask, interrupt transitions"
const regressions = new URL("./property-regressions/", import.meta.url)

function effectVersion() {
  const manifest = new URL("../package.json", import.meta.resolve("effect"))
  assert.equal(JSON.parse(readFileSync(manifest, "utf8")).version, "4.0.6", "differential oracle must be Effect 4.0.6")
}

test("kernel-programs: Exit, ordered Cause and finalizer trace match Effect 4.0.6", async () => {
  effectVersion()
  // Chapter 17 specifies every ordered reason, deduplication, defect election and cleanup order.
  await checkProperty(fc, {
    name: "kernel-programs", rule: `${failures}; ${machine}`, command: "bun test tests/kernel.property.test.ts",
    arbitrary: programArbitrary(fc), regressions,
    check: async program => assert.deepEqual(await runProgram(program, "runtime"), await runProgram(program, "effect"))
  })
}, 60000)

test("kernel-interruption: Deferred-gated interruption preserves masks and cleanup", async () => {
  effectVersion()
  // Chapter 20: a pending interrupt waits for Mask restoration; Final runs uninterruptibly.
  await checkProperty(fc, {
    name: "kernel-interruption", rule: `${machine}; ${failures}`, command: "bun test tests/kernel.property.test.ts",
    arbitrary: fc.record({ body: programArbitrary(fc), masked: fc.boolean() }), regressions,
    check: async input => assert.deepEqual(await runInterrupted(input, "runtime"), await runInterrupted(input, "effect"))
  })
}, 60000)
