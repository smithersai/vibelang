// Property-based fuzzer for packages/runtime/src/producers.ts ($produce, $yield, $forOf).
//
// Universal invariants:
//   1. Coldness & replayability: calling $produce runs nothing until consumed,
//      and consuming the same Producer twice runs the body twice independently.
//   2. Stream & Iterable equivalence: $forOf over a $produce Stream and $forOf
//      over an equivalent synchronous Iterable produce identical collected
//      elements and identical completion records across `normal`, `continue`,
//      `break`, labeled `break`/`continue`, and `return` jumps.
//   3. Resource cleanup & failure propagation: breaking out of $forOf early or
//      failing in either the producer or the loop body closes the producer scope
//      (running Effect.ensuring finalizers) and preserves the exact typed failure.

import { describe, expect, test } from "bun:test"
import * as fc from "fast-check"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import { $forOf, $produce, $yield } from "../src/producers.js"
import { $normal } from "../src/regions.js"

const $continue = (label = "") => ({ kind: "continue", label }) as const
const $break = (label = "") => ({ kind: "break", label }) as const
const $return = (value: unknown) => ({ kind: "return", value }) as const

type JumpAction =
  | { readonly kind: "normal" }
  | { readonly kind: "continue"; readonly label: string }
  | { readonly kind: "break"; readonly label: string }
  | { readonly kind: "return"; readonly value: number }

describe("$produce / $yield / $forOf property fuzzing", () => {
  test("property: $forOf over $produce Stream matches $forOf over Iterable across all jump completions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 0, maxLength: 10 }),
        fc.integer({ min: 0, max: 10 }),
        fc.oneof<fc.Arbitrary<JumpAction>>(
          fc.constant({ kind: "normal" } as const),
          fc.constantFrom("", "loop", "outer").map((label) => ({ kind: "continue" as const, label })),
          fc.constantFrom("", "loop", "outer").map((label) => ({ kind: "break" as const, label })),
          fc.integer({ min: 1, max: 99 }).map((value) => ({ kind: "return" as const, value })),
        ),
        async (items, jumpIndex, action) => {
          let finalized = 0
          const producer = $produce(() =>
            Effect.ensuring(
              Effect.gen(function* () {
                for (const item of items) {
                  yield* $yield(item)
                }
              }),
              Effect.sync(() => {
                finalized++
              }),
            ),
          )

          // Coldness: constructing the producer must not run its body.
          expect(finalized).toBe(0)

          const makeBody = (seen: number[]) => (v: number) =>
            Effect.sync(() => {
              const idx = seen.length
              seen.push(v)
              if (idx !== jumpIndex) return $normal
              switch (action.kind) {
                case "normal":
                  return $normal
                case "continue":
                  return $continue(action.label)
                case "break":
                  return $break(action.label)
                case "return":
                  return $return(action.value)
              }
            })

          const streamSeen: number[] = []
          const streamCompletion = await Effect.runPromise($forOf(producer, makeBody(streamSeen), "loop"))

          const iterSeen: number[] = []
          const iterCompletion = await Effect.runPromise($forOf(items, makeBody(iterSeen), "loop"))

          expect(streamSeen).toEqual(iterSeen)
          expect(streamCompletion).toEqual(iterCompletion)
          expect(finalized).toBe(1)

          // Replayability: consuming the same producer a second time yields the exact same result.
          const replaySeen: number[] = []
          const replayCompletion = await Effect.runPromise($forOf(producer, makeBody(replaySeen), "loop"))
          expect(replaySeen).toEqual(streamSeen)
          expect(replayCompletion).toEqual(streamCompletion)
          expect(finalized).toBe(2)
        },
      ),
      { numRuns: 80, seed: 20261122 },
    )
  })

  test("property: typed failure in producer or consumer body propagates cleanly and runs producer finalizer", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 7 }),
        fc.boolean(),
        async (items, failAtRaw, failInProducer) => {
          const failAt = failAtRaw % items.length
          let finalized = false
          const producer = $produce(() =>
            Effect.ensuring(
              Effect.gen(function* () {
                for (let i = 0; i < items.length; i++) {
                  if (failInProducer && i === failAt) {
                    return yield* Effect.fail(`producer-err-${i}`)
                  }
                  yield* $yield(items[i]!)
                }
              }),
              Effect.sync(() => {
                finalized = true
              }),
            ),
          )

          const seen: number[] = []
          const exit = await Effect.runPromiseExit(
            $forOf(producer, (v) =>
              Effect.suspend(() => {
                const idx = seen.length
                if (!failInProducer && idx === failAt) {
                  return Effect.fail(`body-err-${idx}`)
                }
                seen.push(v)
                return Effect.succeed($normal)
              }),
            ),
          )

          expect(Exit.isFailure(exit)).toBe(true)
          expect(finalized).toBe(true)
          expect(seen).toEqual(items.slice(0, failAt))
          if (Exit.isFailure(exit)) {
            const first = exit.cause.reasons[0] as { error?: unknown } | undefined
            expect(first?.error).toBe(
              failInProducer ? `producer-err-${failAt}` : `body-err-${failAt}`,
            )
          }
        },
      ),
      { numRuns: 60, seed: 20261123 },
    )
  })

  test("property: Stream.runCollect over $produce preserves exact element sequence", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(fc.integer(), fc.string({ maxLength: 8 }), fc.boolean()), {
          minLength: 0,
          maxLength: 12,
        }),
        async (items) => {
          const producer = $produce(() =>
            Effect.gen(function* () {
              for (const item of items) {
                yield* $yield(item)
              }
            }),
          )
          const collected = await Effect.runPromise(Stream.runCollect(producer))
          expect(Array.from(collected)).toEqual(items)
        },
      ),
      { numRuns: 60, seed: 20261124 },
    )
  })
})
