import { test } from "bun:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { interruptedArbitrary, interruptIds, programArbitrary, runInterrupted, runProgram, type Program } from "./property-programs.ts"

const failures = "docs/design/history/src/217-part2-ch17-failures.md: Combining causes, catch, finalization (D305/D306)"
const machine = "docs/design/history/src/320-part3-ch20-machine.md: Final, Mask, interrupt transitions"
const regressions = new URL("./property-regressions/", import.meta.url)

function effectVersion() {
  const manifest = new URL("../package.json", import.meta.resolve("effect"))
  assert.equal(JSON.parse(readFileSync(manifest, "utf8")).version, "4.1.6", "differential oracle must be Effect 4.1.6")
}

test("kernel-programs: Exit, ordered Cause and finalizer trace match Effect 4.1.6", async () => {
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
    arbitrary: interruptedArbitrary(fc), regressions,
    check: async input => {
      const observed = await runInterrupted(input, "runtime")
      // An unmasked input must reach its program; a constant trace would compare nothing.
      if (!input.masked && input.point === 1) assert.deepEqual(observed.trace[0], ["step", 1])
      assert.deepEqual(observed, await runInterrupted(input, "effect"))
    }
  })
}, 60000)

const read: Program = { op: "read" }

test("kernel-interruption: an unmasked interrupt lands inside the running program", async () => {
  // Stop before the second read: the first read ran, the second never does, the finalizer still runs.
  const body: Program = { op: "then", body: read, next: read }
  for (const engine of ["runtime", "effect"] as const) {
    const observed = await runInterrupted({ body, masked: false, point: 3 }, engine)
    assert.deepEqual(observed.trace, [["read", 0], ["step", 3], "interrupted-finalizer"], engine)
    assert.deepEqual(observed.exit, { tag: "Failure", reasons: [["Interrupt", 900000010]] }, engine)
  }
})

test("kernel-interruption: an interrupt inside a mask waits for the mask to end", async () => {
  const body: Program = { op: "mask", body: { op: "then", body: read, next: read } }
  for (const engine of ["runtime", "effect"] as const) {
    const observed = await runInterrupted({ body, masked: false, point: 4 }, engine)
    assert.deepEqual(observed.trace, [["read", 0], ["step", 4], ["read", 0], "interrupted-finalizer"], engine)
    assert.deepEqual(observed.exit, { tag: "Failure", reasons: [["Interrupt", 900000010]] }, engine)
  }
})

test("kernel-programs: catch recovers a failure beside interrupts with negative ids", async () => {
  // Negative interruptor ids are generated as well; pin the two explicitly for both catch forms.
  const negative = interruptIds.flatMap((id, value) => id < 0 ? [value] : [])
  assert.equal(negative.length, 2)
  for (const value of negative) for (const kernel of [false, true]) {
    const program: Program = { op: "catch", kernel, next: { op: "success", value: 1 },
      body: { op: "cause", reasons: [{ tag: "Interrupt", value }, { tag: "Fail", value: 2 }] } }
    const observed = await runProgram(program, "runtime")
    assert.deepEqual(observed, { exit: { tag: "Success", value: 1 }, trace: [["catch", 2]] })
    assert.deepEqual(observed, await runProgram(program, "effect"))
  }
})
