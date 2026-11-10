import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { Durable } from "vibelang-runtime/experimental"

// Two steps; the plan lists them. `version` changes the second step's key.
const make = (version: string | undefined) => {
  const Fetch = Durable.task("plan#Fetch", { payload: { repo: Schema.String }, success: Schema.Number })
  const Label = Durable.task("plan#Label", { payload: { count: Schema.Number }, success: Schema.String })
  const Triage = Durable.workflow("plan#Triage", {
    payload: { repo: Schema.String, owners: Schema.ReadonlySet(Schema.String) },
    success: Schema.String,
    plan: version === undefined ? undefined : ({ repo, owners }) => ({
      nodes: [
        { key: "fetch", task: "plan#Fetch", repo },
        { key: version === "1" ? "label" : "label-v2", task: "plan#Label", after: ["fetch"], owners: [...owners] }
      ]
    })
  })
  const layer = (store: Durable.Store, hold?: Deferred.Deferred<void>, entered?: Deferred.Deferred<void>) =>
    Triage.toLayer(({ repo }) => Effect.flatMap(Fetch({ repo }), (count) => Label({ count }))).pipe(
      Layer.provide(Layer.mergeAll(
        Fetch.toLayer(({ repo }) => Effect.succeed(repo.length)),
        Label.toLayer(({ count }) =>
          Effect.gen(function*() {
            if (entered) yield* Deferred.succeed(entered, void 0)
            if (hold) yield* Deferred.await(hold)
            return `labels:${count}`
          })
        )
      )),
      Layer.provideMerge(Durable.layerStore(store))
    )
  return { Triage, layer }
}

const payload = { repo: "smithersai/smithers", owners: new Set(["b", "a"]) }

// Starts a run and kills its engine inside the second step.
const crashInLabel = async (store: Durable.Store, version: string | undefined) => {
  const { Triage, layer } = make(version)
  const hold = Deferred.makeUnsafe<void>()
  const entered = Deferred.makeUnsafe<void>()
  const fiber = Effect.runFork(Triage.execute(payload).pipe(Effect.provide(layer(store, hold, entered))))
  await Effect.runPromise(Deferred.await(entered))
  await Effect.runPromise(Fiber.interrupt(fiber))
}

test("plan gives the plan for the payload the body sees, and its digest, running nothing", async () => {
  const { Triage } = make("1")
  const one = await Effect.runPromise(Durable.plan(Triage, payload))
  const two = await Effect.runPromise(Durable.plan(Triage, { ...payload, owners: new Set(["a", "b"]) }))
  expect(one.plan).toEqual({
    nodes: [
      { key: "fetch", task: "plan#Fetch", repo: "smithersai/smithers" },
      { key: "label", task: "plan#Label", after: ["fetch"], owners: ["a", "b"] }
    ]
  })
  expect(one.digest).toMatch(/^[0-9a-f]{64}$/)
  expect(two.digest).toBe(one.digest)
  expect((await Effect.runPromise(Durable.plan(make(undefined).Triage, payload))).digest).toBe(null)
})

test("a resume under the same plan continues; under a changed plan it dies with plan_changed", async () => {
  const store = Durable.makeMemoryStore()
  await crashInLabel(store, "1")
  const changed = make("2")
  const exit = await Effect.runPromiseExit(changed.Triage.execute(payload).pipe(Effect.provide(changed.layer(store))))
  expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("plan_changed")
  const same = make("1")
  expect(await Effect.runPromise(same.Triage.execute(payload).pipe(Effect.provide(same.layer(store))))).toBe("labels:19")
  const run = await Effect.runPromise(same.Triage.executionId(payload))
  const kinds = Array.from(await Effect.runPromise(
    Stream.runCollect(Stream.map(Durable.history(run), (entry) => entry.eventType)).pipe(Effect.provide(Durable.layerStore(store)))
  ))
  expect(kinds.slice(0, 2)).toEqual(["RunStarted", "PlanRecorded"])
  expect(kinds.filter((kind) => kind === "PlanRecorded").length).toBe(1)
})

test("a run recorded without a plan is refused under a workflow that now declares one", async () => {
  const store = Durable.makeMemoryStore()
  await crashInLabel(store, undefined)
  const planned = make("1")
  const exit = await Effect.runPromiseExit(planned.Triage.execute(payload).pipe(Effect.provide(planned.layer(store))))
  expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain("recorded plan none")
})

test("diff names added, removed and changed nodes by key", () => {
  const a = { nodes: [{ key: "fetch", task: "F" }, { key: "label", task: "L" }, { key: "notify", task: "N" }] }
  const b = { nodes: [{ key: "fetch", task: "F2" }, { key: "label-v2", task: "L" }, { key: "notify", task: "N" }] }
  expect(Durable.diff(a, b)).toEqual({ added: ["label-v2"], removed: ["label"], changed: ["fetch"] })
  expect(Durable.diff(a, a)).toEqual({ added: [], removed: [], changed: [] })
})
