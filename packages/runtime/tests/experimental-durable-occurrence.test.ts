import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Exit, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import { DurableDeferred } from "effect/workflow"
import { Durable } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const Echo = Durable.task("occurrence#Echo", { payload: { text: Schema.String }, success: Schema.String })
const gate = DurableDeferred.make("gate", { success: Schema.String })

// Each segment calls the one task once: plainly, or as the only arm of a
// named, recorded race. The body then waits on a durable deferred, so
// completing it replays the body: every race is recorded by then and skips
// its arm.
type Segment = "plain" | "race"
const Relay = Durable.workflow("occurrence#Relay", {
  payload: { id: Schema.String, segments: Schema.Array(Schema.Literals(["plain", "race"])) },
  success: Schema.Array(Schema.String)
})

// The same task inside one of Effect's own recorded combinators and again outside it.
const Raw = Durable.workflow("occurrence#Raw", { payload: { how: Schema.Literals(["raceAll", "into"]) }, success: Schema.String })

const workflows = Layer.mergeAll(
  Relay.toLayer(({ segments }) =>
    Effect.gen(function*() {
      const heard: Array<string> = []
      for (const [index, segment] of segments.entries()) {
        const call = Echo({ text: `${index}:${segment}` })
        heard.push(
          segment === "plain"
            ? yield* call
            : yield* Durable.race({ name: `race-${index}`, success: Schema.String, effects: [call] })
        )
      }
      heard.push(yield* DurableDeferred.await(gate))
      return heard
    })
  ),
  Raw.toLayer(({ how }) =>
    Effect.gen(function*() {
      const inside = Echo({ text: "inside" })
      const first = how === "raceAll"
        ? yield* DurableDeferred.raceAll({ name: "r", success: Schema.String, error: Schema.Never, effects: [inside] })
        : yield* DurableDeferred.into(inside, DurableDeferred.make("d", { success: Schema.String }))
      return `${first}|${yield* Echo({ text: "outside" })}`
    })
  )
).pipe(Layer.provide(Echo.toLayer(({ text }) => Effect.succeed(text))))

const boot = () => ManagedRuntime.make(workflows.pipe(Layer.provideMerge(Durable.memory)))

type Polled = { readonly poll: (run: string) => Effect.Effect<Option.Option<{ readonly _tag: string; readonly exit?: unknown }>, never, any> }

/** Waits until the run has parked (`"Suspended"`) or finished (`"Complete"`), and returns what it polled. */
const settle = async (runtime: ReturnType<typeof boot>, W: Polled, run: string, state: "Suspended" | "Complete") => {
  for (let waited = 0; waited < 2000; waited++) {
    const result = await runtime.runPromise(W.poll(run) as Effect.Effect<Option.Option<{ readonly _tag: string; readonly exit?: unknown }>>)
    if (Option.isSome(result) && result.value._tag === state) return result.value
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error(`run ${run} did not reach ${state}`)
}

const relay = async (id: string, segments: ReadonlyArray<Segment>) => {
  const runtime = boot()
  const payload = { id, segments }
  const run = await Effect.runPromise(Relay.executionId(payload))
  await runtime.runPromise(Relay.execute(payload, { discard: true }))
  await settle(runtime, Relay, run, "Suspended")
  // Completing the deferred replays the body from the top.
  await runtime.runPromise(DurableDeferred.succeed(gate, {
    token: DurableDeferred.tokenFromExecutionId(gate, { workflow: Relay, executionId: run }),
    value: "replayed"
  }))
  const finished = await settle(runtime, Relay, run, "Complete")
  const steps = Array.from(await runtime.runPromise(Stream.runCollect(Durable.history(run))))
    .filter((entry) => entry.eventType === "StepCompleted")
    .map((entry) => (entry.payload as { step: string }).step)
  await runtime.dispose()
  return { exit: finished.exit, steps }
}

test("a task called in a recorded race and again after it keeps both results across a replay", async () => {
  const { exit, steps } = await relay("a", ["race", "plain", "race", "plain"])
  expect(exit).toEqual(Exit.succeed(["0:race", "1:plain", "2:race", "3:plain", "replayed"]))
  // The race numbers its own step, so the plain calls are 1 and 2 whether or not the races run.
  expect(steps).toEqual(["occurrence#Echo/race-0/1", "occurrence#Echo/1", "occurrence#Echo/race-2/1", "occurrence#Echo/2"])
})

test("a task inside Effect's own raceAll or into is refused, not served another call's result", async () => {
  const runtime = boot()
  for (const how of ["raceAll", "into"] as const) {
    const run = await Effect.runPromise(Raw.executionId({ how }))
    await runtime.runPromise(Raw.execute({ how }, { discard: true }))
    const finished = await settle(runtime, Raw, run, "Complete")
    const exit = finished.exit as Exit.Exit<unknown, unknown>
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain("Race with Experimental.Durable.race")
  }
  await runtime.dispose()
})

// The invariant: two calls of one task are two steps, on the first execution and on every replay.
const everyCallIsItsOwnStep = async (segments: ReadonlyArray<Segment>) => {
  const { exit, steps } = await relay("p", segments)
  expect(exit).toEqual(Exit.succeed([...segments.map((segment, index) => `${index}:${segment}`), "replayed"]))
  // Each call ran once: the replay served every one from the journal under the name it first had.
  expect(steps.length).toBe(segments.length)
  expect(new Set(steps).size).toBe(segments.length)
}

test("every call of a task is its own step across a replay, inside a recorded race or not", async () => {
  await checkProperty(fc, {
    name: "durable-task-occurrence",
    rule: "std-durable: two calls of one task are two steps",
    command: "bun test tests/experimental-durable-occurrence.test.ts",
    arbitrary: fc.array(fc.constantFrom<Segment>("plain", "race"), { minLength: 1, maxLength: 6 }),
    numRuns: 50,
    check: everyCallIsItsOwnStep
  })
}, 120000)
