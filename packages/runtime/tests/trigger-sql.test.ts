import { afterAll, expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Context, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { WorkflowEngine } from "effect/workflow"
import { Durable, Trigger } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"
import { layerCrypto, settle } from "./support/webcrypto.ts"

const scratch = mkdtempSync(join(tmpdir(), "trigger-sql-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0
const database = () => join(scratch, `triggers-${++files}.db`)

// The store a scheduler sees over SQLite, read through the layer's own service.
const sqlStore = (filename: string) =>
  ManagedRuntime.make(
    Trigger.layerSql.pipe(Layer.provide(Durable.layerSql), Layer.provide(sqlite(filename)))
  ).runPromise(Effect.service(Trigger.TriggerStore))

const fire = (occurrence: number, outcome: Trigger.Outcome, run?: string): Trigger.Fire => ({
  trigger: "t",
  occurrence,
  outcome,
  run,
  detail: undefined,
  at: occurrence
})

// One contract, two stores: what the scheduler relies on.
const contract = (name: string, make: () => Promise<Trigger.Store>) => {
  test(`${name} store: register inserts once and a changed schedule moves the watermark and is recorded`, async () => {
    const store = await make()
    const row = await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "0 3 * * * UTC", enabled: true, at: 100 }))
    expect(row).toMatchObject({ id: "t", workflow: "w", enabled: true, watermark: 100, active: undefined, pending: undefined, owner: undefined })
    const same = await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "0 3 * * * UTC", enabled: false, at: 200 }))
    expect(same).toMatchObject({ watermark: 100, enabled: false })
    expect(await Effect.runPromise(store.fires("t"))).toEqual([])
    const moved = await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "0 4 * * * UTC", enabled: true, at: 300 }))
    expect(moved).toMatchObject({ watermark: 300, schedule: "0 4 * * * UTC" })
    const fires = await Effect.runPromise(store.fires("t"))
    expect(fires.map((fire) => [fire.occurrence, fire.outcome])).toEqual([[300, "missed"]])
  })

  test(`${name} store: rescheduling drops buffered and unstarted occurrences and preserves launched runs`, async () => {
    const store = await make()
    await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "old", enabled: true, at: 0 }))
    await Effect.runPromise(store.acquire("t", "a", 0, 100))
    await Effect.runPromise(store.update("t", "a", {
      watermark: 30, active: { run: "running", occurrence: 10 }, pending: 30
    }, [fire(10, "launched", "running"), fire(20, "claimed"), fire(30, "buffered")]))
    const unchanged = await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "old", enabled: true, at: 40 }))
    expect(unchanged.pending).toBe(30)
    const changed = await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "new", enabled: true, at: 50 }))
    expect(changed.pending).toBeUndefined()
    expect(changed.active).toEqual({ run: "running", occurrence: 10 })
    expect((await Effect.runPromise(store.fires("t"))).map(({ occurrence, outcome }) => [occurrence, outcome])).toEqual([
      [50, "missed"], [30, "missed"], [20, "missed"], [10, "launched"]
    ])
  })

  test(`${name} store: changing either the workflow or the schedule drops only unstarted work`, async () => {
    await checkProperty(fc, {
      name: "trigger-reschedule-drops-owed",
      rule: "VIP-61: a changed cron, timezone or workflow drops what the old schedule owed and records a missed row",
      command: "bun test tests/trigger-sql.test.ts",
      arbitrary: fc.record({
        workflowChanges: fc.boolean(),
        times: fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 8 })
      }),
      numRuns: 30,
      check: async ({ workflowChanges, times }) => {
        const store = await make()
        await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "old", enabled: true, at: 0 }))
        await Effect.runPromise(store.acquire("t", "a", 0, 2000))
        const rows = times.map((time, i) => fire(time, i % 2 === 0 ? "claimed" : "buffered"))
        await Effect.runPromise(store.update("t", "a", { watermark: Math.max(...times), pending: times[0] }, rows))
        await Effect.runPromise(store.register({
          id: "t", workflow: workflowChanges ? "replacement" : "w",
          schedule: workflowChanges ? "old" : "new", enabled: true, at: 1001
        }))
        expect(Option.getOrThrow(await Effect.runPromise(store.get("t"))).pending).toBeUndefined()
        expect((await Effect.runPromise(store.fires("t"))).every(({ outcome }) => outcome === "missed")).toBe(true)
      }
    })
  })

  test(`${name} store: one lease holder at a time, taken over once it expires`, async () => {
    const store = await make()
    await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "s", enabled: true, at: 0 }))
    expect(Option.isSome(await Effect.runPromise(store.acquire("t", "a", 10, 100)))).toBe(true)
    expect(Option.isNone(await Effect.runPromise(store.acquire("t", "b", 50, 100)))).toBe(true)
    expect(Option.getOrThrow(await Effect.runPromise(store.acquire("t", "a", 60, 100))).leaseUntil).toBe(160)
    expect(Option.isNone(await Effect.runPromise(store.acquire("t", "b", 159, 100)))).toBe(true)
    expect(Option.getOrThrow(await Effect.runPromise(store.acquire("t", "b", 160, 100))).owner).toBe("b")
    await Effect.runPromise(store.release("t", "a"))
    expect(Option.getOrThrow(await Effect.runPromise(store.get("t"))).owner).toBe("b")
    await Effect.runPromise(store.release("t", "b"))
    expect(Option.getOrThrow(await Effect.runPromise(store.acquire("t", "a", 161, 100))).owner).toBe("a")
    expect(Option.isNone(await Effect.runPromise(store.acquire("missing", "a", 0, 100)))).toBe(true)
  })

  test(`${name} store: a write without the lease is refused and changes nothing`, async () => {
    const store = await make()
    await Effect.runPromise(store.register({ id: "t", workflow: "w", schedule: "s", enabled: true, at: 0 }))
    await Effect.runPromise(store.acquire("t", "a", 0, 100))
    await Effect.runPromise(store.update("t", "a", { watermark: 5, active: { run: "r1", occurrence: 5 }, pending: 7 }, [fire(5, "launched", "r1"), fire(7, "buffered")]))
    await Effect.runPromise(store.acquire("t", "b", 100, 100))
    const stale = await Effect.runPromiseExit(store.update("t", "a", { watermark: 9 }, [fire(9, "claimed")]))
    expect(Exit.isFailure(stale) && Cause.pretty(stale.cause)).toContain("LeaseLost")
    expect(Option.getOrThrow(await Effect.runPromise(store.get("t")))).toMatchObject({ watermark: 5, active: { run: "r1", occurrence: 5 }, pending: 7 })
    await Effect.runPromise(store.update("t", "b", { active: null, pending: null }, [fire(7, "launched", "r2")]))
    expect(Option.getOrThrow(await Effect.runPromise(store.get("t")))).toMatchObject({ watermark: 5, active: undefined, pending: undefined })
    const fires = await Effect.runPromise(store.fires("t"))
    expect(fires.map((fire) => [fire.occurrence, fire.outcome, fire.run])).toEqual([[7, "launched", "r2"], [5, "launched", "r1"]])
  })
}

contract("memory", async () => Trigger.makeMemoryStore())
contract("sql", () => sqlStore(database()))

// A host over a SQLite file: its own connection, Durable engine and scheduler.
interface World {
  readonly runs: Array<string>
}
const Outside = Context.Service<World>("test/TriggerSql/Outside")
const Report = Durable.workflow("test#Report", { payload: { channel: Schema.String } })
const reportLayer = Report.toLayer(({ channel }) =>
  Effect.gen(function*() {
    const instance = yield* WorkflowEngine.WorkflowInstance
    ;(yield* Outside).runs.push(`${instance.executionId}:${channel}`)
  })
)

const host = (filename: string, world: World, triggers: ReadonlyArray<Effect.Effect<Trigger.Trigger<any>, Trigger.TriggerError>>) =>
  Trigger.layer(triggers).pipe(
    Layer.provideMerge(Layer.merge(reportLayer, Trigger.layerSql)),
    Layer.provideMerge(Durable.layerSql),
    Layer.provide(Layer.succeed(Outside, world)),
    Layer.provide(sqlite(filename))
  )

const start = (layer: Layer.Layer<any, any>) =>
  Effect.gen(function*() {
    const scope = yield* Scope.make()
    yield* Layer.buildWithScope(layer, scope)
    return scope
  })

const advanceTo = (iso: string) => Effect.andThen(TestClock.setTime(Date.parse(iso)), settle)

test("sql: triggers survive their host; a new host after downtime launches one missed occurrence, and two hosts launch each once", async () => {
  const filename = database()
  const world: World = { runs: [] }
  const nightly = Trigger.cron(Report, { id: "nightly", cron: "0 3 * * *", input: { channel: "#ops" }, catchUp: "one" })
  const fires = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    yield* TestClock.setTime(Date.parse("2026-01-01T00:00:00Z"))
    const first = yield* start(host(filename, world, [nightly]))
    yield* advanceTo("2026-01-01T03:00:00Z")
    yield* Scope.close(first, Exit.void)
    yield* advanceTo("2026-01-03T05:00:00Z")
    // Two new hosts, each with its own connection to the file.
    yield* start(host(filename, world, [nightly]))
    yield* start(host(filename, world, [nightly]))
    yield* settle
    yield* advanceTo("2026-01-04T03:00:00Z")
    return yield* Stream.runCollect(Trigger.fires("nightly")).pipe(
      Effect.provide(Trigger.layerSql.pipe(Layer.provide(Durable.layerSql), Layer.provide(sqlite(filename))))
    )
  })).pipe(Effect.provide(TestClock.layer()), Effect.provide(layerCrypto)))
  expect([...fires].reverse().map((fire) => `${new Date(fire.occurrence).toISOString().slice(0, 10)} ${fire.outcome}`)).toEqual([
    "2026-01-01 launched",
    "2026-01-02 missed",
    "2026-01-03 launched",
    "2026-01-04 launched"
  ])
  expect(world.runs.length).toBe(3)
  expect(new Set(world.runs).size).toBe(3)
})
