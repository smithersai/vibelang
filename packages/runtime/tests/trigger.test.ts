import { expect, test } from "bun:test"
import fc from "fast-check"
import { Context, Deferred, Effect, Exit, Layer, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { WorkflowEngine } from "effect/workflow"
import { $workflow } from "vibelang-runtime"
import { Durable, Trigger } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { layerCrypto, layerSlowCrypto, settle } from "./support/webcrypto.ts"

// The outside world a run changes: each run records its id and channel once
// it may proceed. A run blocks while `gate` is closed, so a test can hold the
// last run open across later occurrences.
interface World {
  readonly runs: Array<string>
  gate: Deferred.Deferred<void> | undefined
}
const Outside = Context.Service<World>("test/Trigger/Outside")

const Report = Durable.workflow("test#Report", { payload: { channel: Schema.String } })

const reportLayer = Report.toLayer(({ channel }) =>
  Effect.gen(function*() {
    const world = yield* Outside
    const instance = yield* WorkflowEngine.WorkflowInstance
    if (world.gate !== undefined) yield* Deferred.await(world.gate)
    world.runs.push(`${instance.executionId}:${channel}`)
  })
)

const t0 = Date.parse("2026-01-01T00:00:00Z")
const at = (iso: string) => Date.parse(iso)

interface Stores {
  readonly durable: Durable.Store
  readonly triggers: Trigger.Store
  readonly world: World
}

const stores = (): Stores => ({ durable: Durable.makeMemoryStore(), triggers: Trigger.makeMemoryStore(), world: { runs: [], gate: undefined } })

// One host: its own engine and scheduler over the shared stores.
const host = (
  shared: Stores,
  triggers: ReadonlyArray<Trigger.Trigger<any> | Effect.Effect<Trigger.Trigger<any>, Trigger.TriggerError>>,
  options: { readonly runner?: Layer.Layer<Trigger.RunnerService, never, WorkflowEngine.WorkflowEngine | Durable.Durable>; readonly layer?: Trigger.LayerOptions } = {}
) => {
  const base = Layer.mergeAll(
    reportLayer,
    options.runner ?? Trigger.layerRunnerDurable,
    Trigger.layerStore(shared.triggers)
  ).pipe(
    Layer.provideMerge(Durable.layerStore(shared.durable)),
    Layer.provide(Layer.succeed(Outside, shared.world))
  )
  return Trigger.layer(triggers, options.layer).pipe(Layer.provideMerge(base))
}

const start = (layer: Layer.Layer<any, any>) =>
  Effect.gen(function*() {
    const scope = yield* Scope.make()
    yield* Layer.buildWithScope(layer, scope)
    return scope
  })

const advanceTo = (iso: string) => Effect.andThen(TestClock.setTime(at(iso)), settle)

const ledger = (triggers: Trigger.Store, id: string) =>
  Effect.provide(Stream.runCollect(Trigger.fires(id)), Trigger.layerStore(triggers))

const outcomes = (fires: ReadonlyArray<Trigger.Fire>) =>
  [...fires].reverse().map((fire) => `${new Date(fire.occurrence).toISOString()} ${fire.outcome}`)

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(TestClock.layer()), Effect.provide(layerCrypto)) as Effect.Effect<A, E>)

const nightly = (options: Partial<Trigger.CronOptions<typeof Report>> = {}) =>
  Trigger.cron(Report, { id: "nightly", cron: "0 3 * * *", input: { channel: "#ops" }, ...options })

const refusal = (effect: Effect.Effect<unknown, Trigger.TriggerError>) =>
  run(Effect.flip(effect).pipe(Effect.map((error) => `${error.code} ${error.path ?? ""}`.trim())))

test("cron refuses a bad expression, zone, input or bound with a TriggerError", async () => {
  expect(await refusal(nightly({ cron: "0 3 * *" }))).toBe("invalid_cron cron")
  expect(await refusal(nightly({ cron: "0 0 3 * * *" }))).toBe("invalid_cron cron")
  expect(await refusal(nightly({ cron: "0 25 * * *" }))).toBe("invalid_cron cron")
  expect(await refusal(nightly({ cron: "0 0 30 2 *" }))).toBe("unsatisfiable_cron cron")
  expect(await refusal(nightly({ timezone: "Mars/Olympus" }))).toBe("invalid_timezone timezone")
  expect(await refusal(nightly({ input: { channel: 7 } as any }))).toBe("invalid_input input")
  expect(await refusal(nightly({ overlap: "queue" as any }))).toBe("invalid_options overlap")
  expect(await refusal(nightly({ catchUp: "all" }))).toBe("invalid_options maxCatchUp")
  expect(await refusal(nightly({ catchUp: "none", maxCatchUp: 2 }))).toBe("invalid_options maxCatchUp")
  expect(await refusal(nightly({ catchUp: "one", maxCatchUp: 0 }))).toBe("invalid_options maxCatchUp")
  expect(await refusal(nightly({ catchUp: "all", maxCatchUp: 1001 }))).toBe("invalid_options maxCatchUp")
  const ok = await run(nightly({ catchUp: "one", timezone: "Europe/Paris" }))
  expect([ok.overlap, ok.catchUp, ok.maxCatchUp, ok.enabled, ok.timezone]).toEqual(["skip", "one", 1, true, "Europe/Paris"])
})

test("layer refuses two triggers with one id", async () => {
  const shared = stores()
  const exit = await Effect.runPromiseExit(Effect.scoped(start(host(shared, [nightly(), nightly()]))).pipe(Effect.provide(TestClock.layer())))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(JSON.stringify(exit)).toContain("Two triggers have the id")
})

test("each occurrence starts its own run, even with equal input", async () => {
  const shared = stores()
  await run(Effect.gen(function*() {
    yield* TestClock.setTime(t0)
    yield* start(host(shared, [nightly()]))
    yield* advanceTo("2026-01-01T02:59:00Z")
    expect(shared.world.runs).toEqual([])
    yield* advanceTo("2026-01-01T03:00:00Z")
    yield* advanceTo("2026-01-02T03:00:00Z")
    expect(shared.world.runs.length).toBe(2)
    const [first, second] = shared.world.runs.map((entry) => entry.split(":")[0])
    expect(first).not.toBe(second)
    const fires = yield* ledger(shared.triggers, "nightly")
    expect(outcomes(fires)).toEqual(["2026-01-01T03:00:00.000Z launched", "2026-01-02T03:00:00.000Z launched"])
    expect(fires.map((fire) => fire.run)).toEqual([second, first])
  }))
})

test("a launch is recorded once its run has started, however late hashing the run's key finishes", async () => {
  const shared = stores()
  await run(Effect.gen(function*() {
    yield* TestClock.setTime(t0)
    yield* start(host(shared, [nightly()]))
    yield* advanceTo("2026-01-01T03:00:00Z")
    yield* advanceTo("2026-01-02T03:00:00Z")
    expect(shared.world.runs.length).toBe(2)
    expect(outcomes(yield* ledger(shared.triggers, "nightly"))).toEqual(["2026-01-01T03:00:00.000Z launched", "2026-01-02T03:00:00.000Z launched"])
  }).pipe(Effect.provide(layerSlowCrypto(50))))
})

test("a missed occurrence after a crash fires once under catchUp one", async () => {
  const shared = stores()
  await run(Effect.gen(function*() {
    yield* TestClock.setTime(t0)
    const first = yield* start(host(shared, [nightly({ catchUp: "one" })]))
    yield* advanceTo("2026-01-01T03:00:00Z")
    expect(shared.world.runs.length).toBe(1)
    yield* Scope.close(first, Exit.void)
    // Down from 04:00 on the 1st to 05:00 on the 3rd: the 2nd and 3rd at 03:00 passed.
    yield* advanceTo("2026-01-03T05:00:00Z")
    yield* start(host(shared, [nightly({ catchUp: "one" })]))
    yield* settle
    expect(shared.world.runs.length).toBe(2)
    expect(outcomes(yield* ledger(shared.triggers, "nightly"))).toEqual([
      "2026-01-01T03:00:00.000Z launched",
      "2026-01-02T03:00:00.000Z missed",
      "2026-01-03T03:00:00.000Z launched"
    ])
    // Running on does not fire the missed one later.
    yield* advanceTo("2026-01-03T23:00:00Z")
    expect(shared.world.runs.length).toBe(2)
  }))
})

test("catchUp none launches nothing for the downtime; all launches the newest maxCatchUp", async () => {
  for (const [options, expected] of [
    [{ catchUp: "none" }, ["2026-01-01T03:00:00.000Z launched", "2026-01-05T03:00:00.000Z missed"]],
    [{ catchUp: "all", maxCatchUp: 2, overlap: "buffer-one" }, [
      "2026-01-01T03:00:00.000Z launched",
      "2026-01-03T03:00:00.000Z missed",
      "2026-01-04T03:00:00.000Z launched",
      "2026-01-05T03:00:00.000Z launched"
    ]]
  ] as const) {
    const shared = stores()
    await run(Effect.gen(function*() {
      yield* TestClock.setTime(t0)
      const first = yield* start(host(shared, [nightly(options)]))
      yield* advanceTo("2026-01-01T03:00:00Z")
      yield* Scope.close(first, Exit.void)
      yield* advanceTo("2026-01-05T12:00:00Z")
      yield* start(host(shared, [nightly(options)]))
      yield* settle
      // A buffered occurrence launches at the next look once the run before it ended.
      yield* advanceTo("2026-01-05T12:01:00Z")
      expect(outcomes(yield* ledger(shared.triggers, "nightly"))).toEqual([...expected])
    }))
  }
})

test("overlap: skip drops, buffer-one keeps the newest, supersede cancels the running one", async () => {
  const cases = {
    "skip": ["2026-01-01T00:01:00.000Z launched", "2026-01-01T00:02:00.000Z skipped", "2026-01-01T00:03:00.000Z skipped", "2026-01-01T00:05:00.000Z launched"],
    "buffer-one": ["2026-01-01T00:01:00.000Z launched", "2026-01-01T00:02:00.000Z skipped", "2026-01-01T00:03:00.000Z launched", "2026-01-01T00:05:00.000Z launched"],
    "supersede": ["2026-01-01T00:01:00.000Z superseded", "2026-01-01T00:02:00.000Z superseded", "2026-01-01T00:03:00.000Z launched", "2026-01-01T00:05:00.000Z launched"]
  } as const
  for (const [overlap, expected] of Object.entries(cases)) {
    const shared = stores()
    await run(Effect.gen(function*() {
      yield* TestClock.setTime(t0)
      shared.world.gate = yield* Deferred.make<void>()
      const minutely = Trigger.cron(Report, { id: "minutely", cron: "* * * * *", input: { channel: "#ops" }, overlap: overlap as Trigger.Overlap })
      yield* start(host(shared, [minutely], { layer: { pollInterval: "10 seconds", lease: "1 minute" } }))
      yield* advanceTo("2026-01-01T00:01:00Z")
      yield* advanceTo("2026-01-01T00:02:00Z")
      yield* advanceTo("2026-01-01T00:03:00Z")
      // Open the gate: the runs held so far finish, and later ones never wait.
      const gate = shared.world.gate!
      shared.world.gate = undefined
      yield* Deferred.succeed(gate, void 0)
      yield* settle
      yield* advanceTo("2026-01-01T00:03:30Z")
      yield* advanceTo("2026-01-01T00:04:00Z")
      yield* advanceTo("2026-01-01T00:05:00Z")
      const fires = (yield* ledger(shared.triggers, "minutely")).filter((fire) => fire.occurrence !== at("2026-01-01T00:04:00Z"))
      expect([overlap, ...outcomes(fires)]).toEqual([overlap, ...expected])
    }))
  }
})

test("a host that dies after starting a run leaves the occurrence claimed; the next lease holder joins that run", async () => {
  const shared = stores()
  await run(Effect.gen(function*() {
    yield* TestClock.setTime(t0)
    // The injected fault: the real Durable runner, except that the process
    // freezes after the run started and before the launch is recorded.
    const frozen = Layer.effect(
      Trigger.Runner,
      Effect.map(Effect.service(Trigger.Runner), (real) => ({ ...real, start: (launch: Trigger.Launch) => Effect.andThen(real.start(launch), Effect.never) }))
    ).pipe(Layer.provide(Trigger.layerRunnerDurable))
    yield* start(host(shared, [nightly()], { runner: frozen }))
    yield* advanceTo("2026-01-01T03:00:00Z")
    expect(shared.world.runs.length).toBe(1)
    expect(outcomes(yield* ledger(shared.triggers, "nightly"))).toEqual(["2026-01-01T03:00:00.000Z claimed"])
    // A second host starts; it waits out the frozen host's lease, then finishes the launch.
    yield* start(host(shared, [nightly()]))
    yield* advanceTo("2026-01-01T03:04:00Z")
    expect(outcomes(yield* ledger(shared.triggers, "nightly"))).toEqual(["2026-01-01T03:00:00.000Z claimed"])
    yield* advanceTo("2026-01-01T03:06:00Z")
    const fires = yield* ledger(shared.triggers, "nightly")
    expect(outcomes(fires)).toEqual(["2026-01-01T03:00:00.000Z launched"])
    // At-least-once dispatch, one run: the retry joined the run the frozen host started.
    expect(shared.world.runs.length).toBe(1)
    expect(shared.world.runs[0]!.split(":")[0]).toBe(fires[0]!.run!)
  }))
})

test("two hosts over one store launch each occurrence once", async () => {
  const shared = stores()
  await run(Effect.gen(function*() {
    yield* TestClock.setTime(t0)
    const hourly = Trigger.cron(Report, { id: "hourly", cron: "0 * * * *", input: { channel: "#ops" } })
    yield* start(host(shared, [hourly]))
    yield* start(host(shared, [hourly]))
    for (let hour = 1; hour <= 6; hour++) yield* advanceTo(`2026-01-01T0${hour}:00:00Z`)
    const fires = yield* ledger(shared.triggers, "hourly")
    expect(fires.length).toBe(6)
    expect(fires.every((fire) => fire.outcome === "launched")).toBe(true)
    expect(shared.world.runs.length).toBe(6)
  }))
})

test("a disabled trigger launches nothing and owes nothing once enabled", async () => {
  const shared = stores()
  await run(Effect.gen(function*() {
    yield* TestClock.setTime(t0)
    const first = yield* start(host(shared, [nightly({ enabled: false, catchUp: "one" })]))
    yield* advanceTo("2026-01-02T12:00:00Z")
    yield* Scope.close(first, Exit.void)
    expect(shared.world.runs).toEqual([])
    yield* start(host(shared, [nightly({ catchUp: "one" })]))
    yield* settle
    expect(shared.world.runs).toEqual([])
    yield* advanceTo("2026-01-03T03:00:00Z")
    expect(shared.world.runs.length).toBe(1)
  }))
})

// A second adapter of the Runner port: every run finishes at once, so the
// property sees catch-up alone, with no overlap in the way.
const instantRunner = (started: Array<string>): Layer.Layer<Trigger.RunnerService> =>
  Layer.succeed(Trigger.Runner, {
    start: (launch) => Effect.sync(() => (started.includes(launch.idempotencyKey) ? undefined : started.push(launch.idempotencyKey), launch.idempotencyKey)),
    inspect: () => Effect.succeed("completed" as const),
    cancel: () => Effect.void,
    send: () => Effect.void
  })

interface Downtime {
  readonly downHours: number
  readonly upHours: number
  readonly catchUp: Trigger.CatchUp
  readonly bound: number
}

const catchUpBounded = async ({ downHours, upHours, catchUp, bound }: Downtime) => {
  const triggers = Trigger.makeMemoryStore()
  const started: Array<string> = []
  const hourly = Trigger.cron(Report, {
    id: "hourly",
    cron: "0 * * * *",
    input: { channel: "#ops" },
    catchUp,
    maxCatchUp: catchUp === "all" ? bound : undefined
  })
  const layerOf = () => Trigger.layer([hourly]).pipe(Layer.provide(Layer.merge(Trigger.layerStore(triggers), instantRunner(started))))
  await run(Effect.gen(function*() {
    yield* TestClock.setTime(t0 + 30 * 60_000)
    const first = yield* start(layerOf())
    yield* settle
    yield* Scope.close(first, Exit.void)
    yield* TestClock.setTime(t0 + 30 * 60_000 + downHours * 3_600_000)
    yield* start(layerOf())
    yield* settle
    const owed = catchUp === "none" ? 0 : catchUp === "one" ? Math.min(1, downHours) : Math.min(bound, downHours)
    expect(started.length).toBe(owed)
    for (let hour = 1; hour <= upHours; hour++) yield* TestClock.adjust("1 hour").pipe(Effect.andThen(settle))
    expect(started.length).toBe(owed + upHours)
    expect(new Set(started).size).toBe(started.length)
  }))
}

test("property: catch-up launches at most maxCatchUp missed occurrences, and every on-time one, once", async () => {
  await checkProperty(fc, {
    name: "trigger-catch-up-bounded",
    rule: "VIP-61: catch-up is bounded; one occurrence starts one run",
    command: "bun test tests/trigger.test.ts",
    arbitrary: fc.record({
      downHours: fc.integer({ min: 0, max: 30 }),
      upHours: fc.integer({ min: 0, max: 6 }),
      catchUp: fc.constantFrom<Trigger.CatchUp>("none", "one", "all"),
      bound: fc.integer({ min: 1, max: 5 })
    }),
    numRuns: 60,
    check: catchUpBounded
  })
}, 60000)

// A declared `workflow` (VIP-55): input is its parameter tuple. A tuple of
// its arity and types starts runs with those arguments; anything else is
// refused when the trigger is declared.
const digestRuns: Array<string> = []
const Digest = $workflow(
  "test#Digest",
  {},
  { payload: { channel: Schema.String, day: Schema.Number } },
  (channel: string, day: number) => Effect.sync(() => void digestRuns.push(`${channel}:${day}`))
)

const tupleInput = async (input: ReadonlyArray<unknown>) => {
  digestRuns.length = 0
  const fits = input.length === 2 && typeof input[0] === "string" && typeof input[1] === "number"
  const declared = await Effect.runPromise(Effect.flip(Trigger.cron(Digest, { id: "digest", cron: "0 3 * * *", input: input as any })).pipe(
    Effect.map((error) => error.code),
    Effect.catch(() => Effect.succeed("declared" as const))
  ))
  if (declared !== (fits ? "declared" : "invalid_input")) return false
  if (!fits) return true
  await run(Effect.gen(function*() {
    yield* TestClock.setTime(t0)
    const layer = Trigger.layer([Trigger.cron(Digest, { id: "digest", cron: "0 3 * * *", input: input as any })]).pipe(
      Layer.provideMerge(Layer.merge(Digest.layer, Trigger.memory)),
      Layer.provideMerge(Durable.memory)
    )
    yield* start(layer)
    yield* advanceTo("2026-01-01T03:00:00Z")
  }))
  return digestRuns.length === 1 && digestRuns[0] === `${input[0]}:${input[1]}`
}

test("property: a declared workflow's trigger takes exactly its parameter tuple", async () => {
  await checkProperty(fc, {
    name: "trigger-declared-input-tuple",
    rule: "VIP-61: a trigger is typed by the workflow it starts, so its input is the workflow's parameter tuple",
    command: "bun test tests/trigger.test.ts",
    arbitrary: fc.oneof(
      fc.tuple(fc.string({ maxLength: 4 }), fc.integer({ min: 0, max: 9 })),
      // An extra argument the payload would silently drop.
      fc.tuple(fc.string({ maxLength: 4 }), fc.integer({ min: 0, max: 9 }), fc.string({ maxLength: 4 })),
      fc.array(fc.oneof(fc.string({ maxLength: 4 }), fc.integer({ min: 0, max: 9 }), fc.boolean()), { maxLength: 4 })
    ),
    numRuns: 40,
    check: tupleInput
  })
})
