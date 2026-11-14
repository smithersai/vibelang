import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Latch from "effect/Latch"
import { Patterns } from "vibelang-runtime/experimental"
import * as MapReduceModule from "vibelang-runtime/experimental/patterns/MapReduce"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { MapReduce, PatternError } = Patterns

test("MapReduce: the subpath module is the namespace's module", () => {
  expect(MapReduceModule.run).toBe(MapReduce.run)
})

test("MapReduce.run types its result by the empty-input policy", async () => {
  const callbacks = {
    concurrency: 1,
    map: ({ shard }: { readonly shard: number }) => Effect.succeed(String(shard)),
    reduce: ({ mapped }: { readonly mapped: ReadonlyArray<string> }) => Effect.succeed(mapped.length)
  }
  for (const onEmpty of ["reduce", "fail"] as const) {
    const reduced: Effect.Effect<number, unknown> = MapReduce.run({ shards: [1] }, { ...callbacks, onEmpty })
    expect(await Effect.runPromise(reduced)).toBe(1)
  }
  const succeeded: Effect.Effect<number | ReadonlyArray<string>, unknown> = MapReduce.run(
    { shards: [] as Array<number> },
    { ...callbacks, onEmpty: "succeed" }
  )
  expect(await Effect.runPromise(succeeded)).toEqual([])
})

test("MapReduce.run maps every shard and reduces the values in shard order", async () => {
  const result = await Effect.runPromise(MapReduce.run({ shards: [1, 2, 3, 4, 5] }, {
    concurrency: 2,
    onEmpty: "reduce",
    map: ({ index, shard }) => Effect.succeed(`${index}:${shard * 2}`),
    reduce: ({ mapped }) => Effect.succeed(mapped.join("|"))
  }))
  expect(result).toBe("0:2|1:4|2:6|3:8|4:10")
})

test("MapReduce.run hands map and reduce the caller's input object", async () => {
  const input = { shards: ["a"], label: "job" }
  const seen: Array<unknown> = []
  await Effect.runPromise(MapReduce.run(input, {
    concurrency: 1,
    onEmpty: "reduce",
    map: ({ input }) => Effect.sync(() => (seen.push(input), 1)),
    reduce: ({ input }) => Effect.sync(() => (seen.push(input), 2))
  }))
  expect(seen[0]).toBe(input)
  expect(seen[1]).toBe(input)
})

test("MapReduce.run returns mapped values in shard order rather than completion order", async () => {
  const program = Effect.gen(function*() {
    const gates = yield* Effect.all([Latch.make(), Latch.make(), Latch.make()])
    const finished = yield* Effect.all([Latch.make(), Latch.make(), Latch.make()])
    const allStarted = yield* Latch.make()
    const completionOrder: Array<number> = []
    let started = 0
    const running = yield* MapReduce.run({ shards: ["a", "b", "c"] }, {
      concurrency: 3,
      onEmpty: "reduce",
      map: ({ index, shard }) =>
        Effect.gen(function*() {
          started += 1
          if (started === 3) yield* Latch.open(allStarted)
          yield* Latch.await(gates[index]!)
          completionOrder.push(index)
          yield* Latch.open(finished[index]!)
          return `${index}:${shard}`
        }),
      reduce: ({ mapped }) => Effect.succeed(mapped)
    }).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Latch.await(allStarted)
    for (const index of [2, 1, 0]) {
      yield* Latch.open(gates[index]!)
      yield* Latch.await(finished[index]!)
    }
    const result = yield* Fiber.join(running)
    return { completionOrder, result }
  })
  expect(await Effect.runPromise(program)).toEqual({ completionOrder: [2, 1, 0], result: ["0:a", "1:b", "2:c"] })
})

test("MapReduce.run applies every empty-input policy and validates concurrency", async () => {
  const callbacks = {
    map: ({ shard }: { readonly shard: number }) => Effect.succeed(shard * 2),
    reduce: ({ mapped }: { readonly mapped: ReadonlyArray<number> }) => Effect.succeed(mapped.length)
  }
  const empty = { shards: [] as ReadonlyArray<number> }
  for (const concurrency of [0, -1, 1.5, Number.NaN]) {
    const invalid = await Effect.runPromise(Effect.flip(MapReduce.run(empty, { ...callbacks, concurrency, onEmpty: "reduce" })))
    expect(invalid).toBeInstanceOf(PatternError)
    expect(invalid).toMatchObject({ code: "invalid_decorator", message: "MapReduce concurrency must be a positive safe integer" })
  }
  const failed = await Effect.runPromise(Effect.flip(MapReduce.run(empty, { ...callbacks, concurrency: 1, onEmpty: "fail" })))
  expect(failed).toBeInstanceOf(PatternError)
  expect(failed).toMatchObject({ code: "exhausted", message: "MapReduce received no shards" })
  expect(await Effect.runPromise(MapReduce.run(empty, { ...callbacks, concurrency: 1, onEmpty: "succeed" }))).toEqual([])
  expect(await Effect.runPromise(MapReduce.run(empty, { ...callbacks, concurrency: 1, onEmpty: "reduce" }))).toBe(0)
})

test("MapReduce.run defers an empty-input reduction and rebuilds it on every run", async () => {
  let constructions = 0
  const reduced = MapReduce.run({ shards: [] as ReadonlyArray<number> }, {
    concurrency: 1,
    onEmpty: "reduce",
    map: ({ shard }) => Effect.succeed(shard * 2),
    reduce: ({ mapped }) => {
      constructions += 1
      return Effect.succeed(mapped.length + constructions)
    }
  })
  expect(constructions).toBe(0)
  expect(await Effect.runPromise(reduced)).toBe(1)
  expect(await Effect.runPromise(reduced)).toBe(2)
})

test("MapReduce.run fails with the first map failure and never reduces", async () => {
  let reduced = false
  const failure = await Effect.runPromise(Effect.flip(MapReduce.run({ shards: [1, 2, 3] }, {
    concurrency: 1,
    onEmpty: "reduce",
    map: ({ shard }) => shard === 2 ? Effect.fail(`shard ${shard} broke`) : Effect.succeed(shard),
    reduce: () => Effect.sync(() => (reduced = true))
  })))
  expect(failure).toBe("shard 2 broke")
  expect(reduced).toBe(false)
})

test("MapReduce.run reads its options and shards at the call, not when the Effect runs", async () => {
  const shards = [1, 2]
  const options: {
    concurrency: number
    onEmpty: "reduce" | "fail"
    map: (input: { readonly shard: number }) => Effect.Effect<number>
    reduce: (input: { readonly mapped: ReadonlyArray<number> }) => Effect.Effect<number>
  } = {
    concurrency: 1,
    onEmpty: "reduce",
    map: ({ shard }) => Effect.succeed(shard),
    reduce: ({ mapped }) => Effect.succeed(mapped.reduce((sum, value) => sum + value, 0))
  }
  const program = MapReduce.run({ shards }, options)
  shards.push(100)
  options.concurrency = 0
  options.map = () => Effect.succeed(-1)
  expect(await Effect.runPromise(program)).toBe(3)
})

test("property: map-reduce reduces the mapped shards in shard order at any bound", async () => {
  await checkProperty(fc, {
    name: "patterns-mapreduce-shard-order",
    rule: "VIP-73: MapReduce.run splits, maps each part, and reduces the results",
    command: "bun test tests/experimental-patterns-mapreduce.test.ts",
    arbitrary: fc.record({
      shards: fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 10 }),
      concurrency: fc.integer({ min: 1, max: 6 })
    }),
    numRuns: 200,
    check: async ({ shards, concurrency }: { readonly shards: ReadonlyArray<number>; readonly concurrency: number }) => {
      const result = await Effect.runPromise(MapReduce.run({ shards }, {
        concurrency,
        onEmpty: "reduce",
        map: ({ shard, index }) =>
          Effect.gen(function*() {
            for (let turn = 0; turn < shard; turn++) yield* Effect.yieldNow
            return `${index}:${shard}`
          }),
        reduce: ({ mapped }) => Effect.succeed(mapped)
      }))
      expect(result).toEqual(shards.map((shard, index) => `${index}:${shard}`))
    }
  })
})
