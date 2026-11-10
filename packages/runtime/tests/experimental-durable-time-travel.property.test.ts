import { test } from "bun:test"
import { strict as assert } from "node:assert"
import fc from "fast-check"
import { Effect, Layer, Schema, Stream } from "effect"
import { Durable } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// Fork and rewind at any step boundary: the new run gives the original
// result, reuses every step that finished before the position, and runs
// each later step exactly once more. Replay through the end counts every
// finished step.
const Step = Durable.task("ttp#Step", { payload: { i: Schema.Number }, success: Schema.Number })
const Chain = Durable.workflow("ttp#Chain", { payload: { n: Schema.Number }, success: Schema.Number })

type Input = { readonly steps: number; readonly cut: number; readonly mode: "fork" | "rewind" }

const check = async (input: Input) => {
  const store = Durable.makeMemoryStore()
  const ran: Array<number> = []
  const layer = Chain.toLayer(({ n }) =>
    Effect.gen(function*() {
      let total = 0
      for (let i = 0; i < n; i++) total = total * 3 + (yield* Step({ i }))
      return total
    })
  ).pipe(
    Layer.provide(Step.toLayer(({ i }) => Effect.sync(() => (ran.push(i), i + 1)))),
    Layer.provideMerge(Durable.layerStore(store))
  )
  const run = (effect: Effect.Effect<any, any, any>) => Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<any>)
  const original = await run(Chain.execute({ n: input.steps }))
  const id = await Effect.runPromise(Chain.executionId({ n: input.steps }))
  const entries = Array.from(await run(Stream.runCollect(Durable.history(id))) as Iterable<Durable.JournalEntry>)
  const starts = entries.filter((entry) => entry.eventType === "StepStarted")
  const at = starts[input.cut % starts.length]!.seq
  const finished = await run(Durable.replay({ run: id, seq: entries.at(-1)!.seq }, {
    initial: 0,
    reduce: (count, entry) => count + (entry.eventType === "StepCompleted" ? 1 : 0)
  }))
  assert.equal(finished, input.steps)
  ran.length = 0
  let again: number
  if (input.mode === "fork") {
    const copy = await run(Durable.fork({ run: id, seq: at }))
    again = await run(Durable.run(Chain, copy.run).result)
  } else {
    await run(Durable.rewind({ run: id, seq: at }))
    again = await run(Chain.execute({ n: input.steps }))
  }
  assert.equal(again, original)
  const later = starts.filter((entry) => entry.seq >= at).map((entry) => Number((entry.payload as { step: string }).step.split("/")[1]) - 1)
  assert.deepEqual(ran, later)
}

test("fork and rewind at any step reuse earlier steps and rerun each later one once", async () => {
  await checkProperty(fc, {
    name: "durable-time-travel",
    rule: "std-durable: fork(at) reuses steps before at; rewind(at) truncates the run",
    command: "bun test tests/experimental-durable-time-travel.property.test.ts",
    arbitrary: fc.record({
      steps: fc.integer({ min: 1, max: 6 }),
      cut: fc.integer({ min: 0, max: 20 }),
      mode: fc.constantFrom<"fork" | "rewind">("fork", "rewind")
    }),
    numRuns: 100,
    check
  })
}, 60000)
