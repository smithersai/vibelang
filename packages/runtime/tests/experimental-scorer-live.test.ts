import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Exit, Layer, Schema } from "effect"
import { Durable, Scorer } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

const Double = Durable.workflow("test#Double", { payload: { n: Schema.Number }, success: Schema.Number, error: Schema.String })
const DoubleLive = Double.toLayer(({ n }) => n > 100 ? Effect.fail("too big") : Effect.succeed(n * 2))

const even = Scorer.make({
  name: "even",
  version: "1",
  score: (run: { input: { readonly n: number }; output: number }) => ({ score: run.output === run.input.n * 2 ? 1 : 0, reason: `doubled ${run.input.n}` })
})

// The workflow's implementation over an engine wrapped by bind, and the
// engine and store it needs; the store is shared so the test reads it.
const live = <R>(binding: Layer.Layer<any, any, R>, store: Layer.Layer<Scorer.ScoreStore, never, any> = Scorer.memory) =>
  DoubleLive.pipe(Layer.provide(binding), Layer.provideMerge(Durable.memory), Layer.provideMerge(store))

const stored = (filter?: Scorer.Filter) =>
  Effect.gen(function*() {
    const store = yield* Scorer.ScoreStore
    return yield* store.observations(filter)
  })

test("a bound scorer grades each finished run once", async () => {
  const observations = await Effect.runPromise(Effect.gen(function*() {
    expect(yield* Double.execute({ n: 2 })).toBe(4)
    expect(yield* Double.execute({ n: 2 })).toBe(4)
    expect(yield* Double.execute({ n: 3 })).toBe(6)
    return yield* stored()
  }).pipe(Effect.provide(live(Scorer.bind(even, Double)))))
  expect(observations).toHaveLength(2)
  expect(observations.map((item) => [item.kind, item.score, item.reason])).toEqual([
    ["score", 1, "doubled 2"],
    ["score", 1, "doubled 3"]
  ])
  expect(observations[0]).toMatchObject({ workflow: "test#Double", scorer: even.scorerKey, scorerName: "even" })
  expect(new Set(observations.map((item) => item.run)).size).toBe(2)
})

test("a run that fails is not scored", async () => {
  const observations = await Effect.runPromise(Effect.gen(function*() {
    const exit = yield* Effect.exit(Double.execute({ n: 101 }))
    expect(Exit.isFailure(exit)).toBe(true)
    return yield* stored()
  }).pipe(Effect.provide(live(Scorer.bind(even, Double)))))
  expect(observations).toEqual([])
})

interface JudgeShape {
  readonly grade: (value: number) => Effect.Effect<number, Error>
}
const Judge = Context.Service<JudgeShape>("test/ScorerLive/Judge")
const judged = Scorer.make({
  name: "judged",
  version: "1",
  score: (run: { output: number }) =>
    Effect.gen(function*() {
      const judge = yield* Judge
      return yield* judge.grade(run.output)
    })
})

test("a scorer whose judge is down records an inconclusive observation and leaves the run's result alone", async () => {
  const down = Layer.succeed(Judge, { grade: () => Effect.fail(new Error("judge unreachable")) })
  const observations = await Effect.runPromise(Effect.gen(function*() {
    expect(yield* Double.execute({ n: 5 })).toBe(10)
    return yield* stored()
  }).pipe(Effect.provide(live(Scorer.bind(judged, Double).pipe(Layer.provide(down))))))
  expect(observations).toEqual([
    expect.objectContaining({ kind: "inconclusive", code: "inconclusive", reason: expect.stringContaining("judge unreachable") })
  ])
  expect(observations[0]!.score).toBeUndefined()
})

test("a store that fails cannot fail the run", async () => {
  const broken = Layer.succeed(Scorer.ScoreStore, {
    recordOnce: () => Effect.die(new Error("disk full")),
    observations: () => Effect.succeed([]),
    aggregate: () => Effect.succeed({ count: 0, mean: undefined, min: undefined, inconclusive: 0 }),
    prune: () => Effect.succeed(0)
  })
  const result = await Effect.runPromise(Double.execute({ n: 7 }).pipe(Effect.provide(live(Scorer.bind(even, Double), broken))))
  expect(result).toBe(14)
})

test("sampling none scores nothing, and a bad policy or declaration fails the layer", async () => {
  const none = await Effect.runPromise(Effect.gen(function*() {
    yield* Double.execute({ n: 1 })
    return yield* stored()
  }).pipe(Effect.provide(live(Scorer.bind(even, Double, { sampling: "none" })))))
  expect(none).toEqual([])
  for (const [binding, code] of [
    [Scorer.bind(even, Double, { sampling: { ratio: 1, seed: "s" } }), "invalid_sampling"],
    [Scorer.bind(even, Double, { sampling: { ratio: 0.5, seed: "" } }), "invalid_sampling"],
    [Scorer.bind(Scorer.make({ name: "", version: "1", score: () => 1 }), Double), "invalid_declaration"]
  ] as const) {
    const exit = await Effect.runPromiseExit(Double.execute({ n: 1 }).pipe(Effect.provide(live(binding))))
    expect(exit).toMatchObject({ _tag: "Failure" })
    expect(JSON.stringify(exit)).toContain(code)
  }
})

test("ratio sampling chooses the same runs every time", async () => {
  const sampling = { ratio: 0.5, seed: "nightly" } as const
  const scoredRuns = () =>
    Effect.runPromise(Effect.gen(function*() {
      for (let n = 0; n < 40; n++) yield* Double.execute({ n })
      return (yield* stored()).map((item) => item.run).sort()
    }).pipe(Effect.provide(live(Scorer.bind(even, Double, { sampling })))))
  const first = await scoredRuns()
  expect(await scoredRuns()).toEqual(first)
  expect(first.length).toBeGreaterThan(5)
  expect(first.length).toBeLessThan(35)
  for (const run of first) expect(Scorer.sampled(sampling, run, even.scorerKey)).toBe(true)
})

test("property: sampling is deterministic and a run sampled at one ratio is sampled at every larger one", async () => {
  await checkProperty(fc, {
    name: "scorer-sampling-monotone",
    rule: "VIP-69 rule 9: a ratio with a seed, so a replay samples the same runs",
    command: "bun test tests/experimental-scorer-live.test.ts",
    arbitrary: fc.record({
      run: fc.string({ maxLength: 40 }),
      key: fc.string({ minLength: 1, maxLength: 64 }),
      seed: fc.string({ minLength: 1, maxLength: 20 }),
      low: fc.double({ min: 0.001, max: 0.998, noNaN: true }),
      gap: fc.double({ min: 0, max: 0.998, noNaN: true })
    }),
    check: ({ run, key, seed, low, gap }: { run: string; key: string; seed: string; low: number; gap: number }) => {
      const high = Math.min(0.999, low + gap)
      const atLow = Scorer.sampled({ ratio: low, seed }, run, key)
      expect(Scorer.sampled({ ratio: low, seed }, run, key)).toBe(atLow)
      if (atLow) expect(Scorer.sampled({ ratio: high, seed }, run, key)).toBe(true)
      expect(Scorer.sampled("all", run, key)).toBe(true)
      expect(Scorer.sampled("none", run, key)).toBe(false)
    },
    numRuns: 300
  })
})

test("the SQL store keeps live scores across restarts, once per run", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-scores-"))
  const filename = join(directory, "scores.sqlite")
  try {
    const store = () => Scorer.layerSql.pipe(Layer.provide(sqlite(filename)))
    await Effect.runPromise(Effect.gen(function*() {
      yield* Double.execute({ n: 2 })
      yield* Double.execute({ n: 2 })
    }).pipe(Effect.provide(live(Scorer.bind(even, Double), store()))))
    const reopened = await Effect.runPromise(Effect.gen(function*() {
      const scores = yield* Scorer.ScoreStore
      const all = yield* scores.observations()
      const aggregate = yield* scores.aggregate({ workflow: "test#Double" })
      const again = yield* scores.recordOnce(all[0]!)
      const pruned = yield* scores.prune({ olderThan: "1 hour" })
      yield* Effect.sleep("5 millis")
      const prunedAll = yield* scores.prune({ olderThan: 0 })
      return { all, aggregate, again, pruned, prunedAll, left: yield* scores.observations() }
    }).pipe(Effect.provide(store()), Effect.scoped))
    expect(reopened.all).toHaveLength(1)
    expect(reopened.all[0]).toMatchObject({ kind: "score", score: 1, reason: "doubled 2", workflow: "test#Double" })
    expect(reopened.aggregate).toEqual({ count: 1, mean: 1, min: 1, inconclusive: 0 })
    expect(reopened.again).toBe(false)
    expect(reopened.pruned).toBe(0)
    expect(reopened.prunedAll).toBe(1)
    expect(reopened.left).toEqual([])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a binding scores only its own workflow", async () => {
  const Triple = Durable.workflow("test#Triple", { payload: { n: Schema.Number }, success: Schema.Number })
  const TripleLive = Triple.toLayer(({ n }) => Effect.succeed(n * 3))
  const observations = await Effect.runPromise(Effect.gen(function*() {
    expect(yield* Triple.execute({ n: 2 })).toBe(6)
    expect(yield* Double.execute({ n: 2 })).toBe(4)
    return yield* stored()
  }).pipe(Effect.provide(
    Layer.mergeAll(DoubleLive, TripleLive).pipe(
      Layer.provide(Scorer.bind(even, Double)),
      Layer.provideMerge(Durable.memory),
      Layer.provideMerge(Scorer.memory)
    )
  )))
  expect(observations.map((item) => item.workflow)).toEqual(["test#Double"])
})

test("a scorer that hangs or interrupts itself cannot hold or change the run", async () => {
  const hangs = Scorer.make({ name: "hangs", version: "1", score: () => Effect.never })
  const quits = Scorer.make({ name: "quits", version: "1", score: () => Effect.interrupt })
  for (const scorer of [hangs, quits]) {
    const observations = await Effect.runPromise(Effect.gen(function*() {
      expect(yield* Double.execute({ n: 4 })).toBe(8)
      return yield* stored()
    }).pipe(Effect.provide(live(Scorer.bind(scorer, Double, { timeout: "20 millis" })))))
    expect(observations).toEqual([expect.objectContaining({ kind: "inconclusive" })])
  }
})

test("prune accepts any duration", async () => {
  const pruned = await Effect.runPromise(Effect.gen(function*() {
    yield* Double.execute({ n: 1 })
    const store = yield* Scorer.ScoreStore
    return [yield* store.prune({ olderThan: 1.5 }), yield* store.prune({ olderThan: "1 hour" })]
  }).pipe(Effect.provide(live(Scorer.bind(even, Double)))))
  expect(pruned).toEqual([0, 0])
})
