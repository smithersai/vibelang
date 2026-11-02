import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Queue, Stream } from "effect"
import { $produce, $yield } from "vibelang-runtime"

// VIP-21/002: "yield x evaluates to undefined" after its offer completes.
// Queue.offer itself returns a boolean, which source yield must not expose.
test("producer yield evaluates to undefined for both buffered and waiting offers", async () => {
  const results: unknown[] = []
  const stream = $produce(() => Effect.gen(function* () {
    results.push(yield* $yield(7))
    results.push(yield* $yield(8))
    results.push(yield* $yield(undefined))
  }))
  expect(await Effect.runPromise(Stream.runCollect(stream))).toEqual([7, 8, undefined])
  expect(results).toEqual([undefined, undefined, undefined])
})

test("producer offers match the explicit undefined-valued Effect counterpart", async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.oneof(fc.integer(), fc.string({ maxLength: 8 }), fc.constant(undefined)), { maxLength: 12 }),
    fc.constantFrom(1, 2, "unbounded" as const),
    async (values, concurrency) => {
      const actualResults: unknown[] = []
      const expectedResults: unknown[] = []
      const actual = $produce(() => Effect.forEach(values, value =>
        Effect.flatMap($yield(value), result => Effect.sync(() => { actualResults.push(result) })),
        { concurrency, discard: true }))
      const expected = Stream.callback<number | string | undefined>(queue => Effect.gen(function* () {
        yield* Effect.forEach(values, value =>
          Effect.flatMap(Effect.as(Queue.offer(queue, value), undefined), result =>
            Effect.sync(() => { expectedResults.push(result) })),
          { concurrency, discard: true })
        yield* Queue.end(queue)
      }), { bufferSize: 1, strategy: "suspend" })
      for (let iteration = 0; iteration < 2; iteration++) {
        expect(await Effect.runPromise(Stream.runCollect(actual))).toEqual(await Effect.runPromise(Stream.runCollect(expected)))
        expect(actualResults).toEqual(expectedResults)
        expect(actualResults.every(value => value === undefined)).toBe(true)
      }
    }
  ), { seed: 210021, numRuns: 40 })
})
