import { expect, test } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { Workflow } from "effect/workflow"
import { Durable } from "vibelang-runtime/experimental"

// A price lookup whose handler counts its calls, cached under each scope.
const setup = (cache: Durable.CacheOptions, implementationVersion: string | undefined = "1") => {
  const calls: Array<string> = []
  const Price = Durable.task(`cache#Price-${cache.scope ?? "run"}`, {
    payload: { sku: Schema.String },
    success: Schema.Number,
    cache,
    implementationVersion
  })
  const Quote = Workflow.make(`cache#Quote-${cache.scope ?? "run"}`, {
    payload: { customer: Schema.String, skus: Schema.Array(Schema.String) },
    success: Schema.Number,
    idempotencyKey: ({ customer, skus }) => `${customer}:${skus.join(",")}`
  })
  const Other = Workflow.make(`cache#Other-${cache.scope ?? "run"}`, {
    payload: { sku: Schema.String },
    success: Schema.Number,
    idempotencyKey: ({ sku }) => sku
  })
  const priceLayer = (version: string | undefined) =>
    Price.toLayer(({ sku }) => Effect.sync(() => (calls.push(`${sku}@${version}`), sku.length)))
  const layer = (store: Durable.Store) =>
    Layer.mergeAll(
      Quote.toLayer(({ skus }) => Effect.map(Effect.forEach(skus, (sku) => Price({ sku })), (prices) => prices.reduce((a, b) => a + b, 0))),
      Other.toLayer(({ sku }) => Price({ sku }))
    ).pipe(Layer.provide(priceLayer(implementationVersion)), Layer.provideMerge(Durable.layerStore(store)))
  return { calls, Price, Quote, Other, layer }
}

test("a run-scoped cache reuses an equal call within one run, not across runs", async () => {
  const { calls, Quote, layer } = setup({ scope: "run" })
  const store = Durable.makeMemoryStore()
  const quote = (customer: string) => Effect.runPromise(Quote.execute({ customer, skus: ["ab", "ab", "c"] }).pipe(Effect.provide(layer(store))))
  expect(await quote("ada")).toBe(5)
  expect(calls).toEqual(["ab@1", "c@1"])
  expect(await quote("bob")).toBe(5)
  expect(calls).toEqual(["ab@1", "c@1", "ab@1", "c@1"])
})

test("a flow-scoped cache reuses across runs of the workflow only", async () => {
  const { calls, Quote, Other, layer } = setup({ scope: "flow" })
  const store = Durable.makeMemoryStore()
  expect(await Effect.runPromise(Quote.execute({ customer: "ada", skus: ["ab"] }).pipe(Effect.provide(layer(store))))).toBe(2)
  expect(await Effect.runPromise(Quote.execute({ customer: "bob", skus: ["ab"] }).pipe(Effect.provide(layer(store))))).toBe(2)
  expect(calls).toEqual(["ab@1"])
  expect(await Effect.runPromise(Other.execute({ sku: "ab" }).pipe(Effect.provide(layer(store))))).toBe(2)
  expect(calls).toEqual(["ab@1", "ab@1"])
})

test("a shared cache reuses across workflows, and a new implementationVersion misses", async () => {
  const first = setup({ scope: "shared" }, "1")
  const store = Durable.makeMemoryStore()
  await Effect.runPromise(first.Quote.execute({ customer: "ada", skus: ["ab"] }).pipe(Effect.provide(first.layer(store))))
  await Effect.runPromise(first.Other.execute({ sku: "ab" }).pipe(Effect.provide(first.layer(store))))
  expect(first.calls).toEqual(["ab@1"])
  const second = setup({ scope: "shared" }, "2")
  await Effect.runPromise(second.Quote.execute({ customer: "bob", skus: ["ab"] }).pipe(Effect.provide(second.layer(store))))
  expect(second.calls).toEqual(["ab@2"])
})

test("an expired entry misses, and a finished run's result comes from its journal, not the cache", async () => {
  const { calls, Quote, layer } = setup({ scope: "flow", ttlMs: 5 })
  const store = Durable.makeMemoryStore()
  const quote = (customer: string) => Effect.runPromise(Quote.execute({ customer, skus: ["ab"] }).pipe(Effect.provide(layer(store))))
  expect(await quote("ada")).toBe(2)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(await quote("bob")).toBe(2)
  expect(calls).toEqual(["ab@1", "ab@1"])
  await new Promise((resolve) => setTimeout(resolve, 20))
  // Both entries have expired; the finished run still answers from its journal.
  expect(await quote("ada")).toBe(2)
  expect(calls).toEqual(["ab@1", "ab@1"])
})

test("a cache hit is journaled as the step's result", async () => {
  const { Quote, layer } = setup({ scope: "flow" })
  const store = Durable.makeMemoryStore()
  await Effect.runPromise(Quote.execute({ customer: "ada", skus: ["ab"] }).pipe(Effect.provide(layer(store))))
  await Effect.runPromise(Quote.execute({ customer: "bob", skus: ["ab"] }).pipe(Effect.provide(layer(store))))
  const run = await Effect.runPromise(Quote.executionId({ customer: "bob", skus: ["ab"] }))
  const entries = Array.from(await Effect.runPromise(Stream.runCollect(Durable.history(run)).pipe(Effect.provide(Durable.layerStore(store)))))
  expect(entries.map((entry) => entry.eventType)).toEqual(["RunStarted", "StepStarted", "StepCompleted", "RunCompleted"])
})

test("reuse across runs needs an implementationVersion, and only a sealed task caches", () => {
  expect(() => Durable.task("cache#NoVersion", { payload: {}, cache: { scope: "shared" } })).toThrow(/needs an implementationVersion/)
  expect(() => Durable.task("cache#NoVersionFlow", { payload: {}, cache: { scope: "flow" } })).toThrow(/needs an implementationVersion/)
  expect(() => Durable.task("cache#Send", { payload: {}, tier: "irreversible", cache: {}, implementationVersion: "1" })).toThrow(
    /only a sealed task caches/
  )
  expect(() => Durable.task("cache#RunScope", { payload: {}, cache: {} })).not.toThrow()
})
