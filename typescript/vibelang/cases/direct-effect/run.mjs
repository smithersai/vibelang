// Checks cold Effects, repeated execution and native generator scheduling.
// rule-evidence: docs/design/src/001-functions.md#effect-functions
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
const { Cause, Effect, Exit } = await import("effect")
const Scheduler = await import("effect/Scheduler")
const program = await import("./out/main.js")

let ops = 0
const base = new Scheduler.MixedScheduler()
const counting = { executionMode: base.executionMode, shouldYield: () => (ops++, false), makeDispatcher: () => base.makeDispatcher() }
const measure = (effect) => {
  ops = 0
  const value = Effect.runSync(Effect.provideService(effect, Scheduler.Scheduler, counting))
  return { value, ops }
}
const floor = measure(Effect.void).ops
const show = (name, effect) => {
  const { value, ops } = measure(effect)
  console.log(`${name}: ${JSON.stringify(value)} in ${ops - floor + 1} ops`)
}

show("step", program.step(1))
const runs = []
const recorded = program.record(runs, 7)
console.log(`record called, body runs: ${runs.length}`)
show("record", recorded)
show("record again", recorded)
console.log(`record ran, body runs: ${runs.length}`)
show("ignore", program.ignore("event"))
show("resolve cached", program.resolve("hit", () => Effect.succeed("miss")))
show("resolve load", program.resolve(undefined, () => Effect.succeed("miss")))
show("greet", new program.Greeter("ada").greet())
const exit = Effect.runSyncExit(program.first([]))
console.log(`first: ${exit._tag}, defect ${Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof TypeError}`)

// The empty arrow has the same construction and scheduling as Effect.gen.
// Exercise repeated execution, arbitrary arguments and a stateful sibling.
fc.assert(fc.property(
  fc.string(), fc.integer(), fc.integer({ min: 1, max: 8 }),
  (event, value, repetitions) => {
    const actual = program.ignore(event)
    const reference = Effect.gen(function* () {})
    const calls = []
    const recorded = program.record(calls, value)
    assert.deepEqual(calls, [], "construction must stay cold")
    for (let run = 0; run < repetitions; run++) {
      assert.deepEqual(measure(actual), measure(reference), "empty arrow must match the native generator")
      assert.equal(Effect.runSync(recorded), value)
      assert.equal(calls.length, run + 1, "saved effects rerun their body")
    }
  }
), { seed: 140105, numRuns: 128 })
