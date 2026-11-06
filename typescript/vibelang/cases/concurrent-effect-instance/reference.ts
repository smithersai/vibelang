import { Effect, Fiber } from "effect"

export function main() {
  return Effect.gen(function* () {
    const anchor = yield* Effect.forkChild(Effect.gen(function* () {
      const owner = yield* Effect.fiberId
      const seen: boolean[] = []
      yield* Effect.forEach([1, 2, 3], (item) => Effect.gen(function* () {
        void item
        const current = yield* Effect.fiberId
        const child = yield* Effect.forkChild(Effect.succeed(0))
        seen.push(owner < current && current < child.id)
        yield* Fiber.join(child)
      }), { concurrency: 2, discard: true })
      return seen
    }))
    const seen = yield* Fiber.join(anchor)
    for (const limit of [1, 2, 2.5, NaN, Infinity, "unbounded", undefined, null, -1, 0]) {
      seen.push(...(yield* probe(limit)))
    }
    return seen
  })
}

function probe(limit: any) {
  return Effect.gen(function* () {
    const anchor = yield* Effect.forkChild(Effect.gen(function* () {
      const owner = yield* Effect.fiberId
      const seen: boolean[] = []
      yield* Effect.forEach([1, 2, 3], (item) => Effect.gen(function* () {
        void item
        const current = yield* Effect.fiberId
        const child = yield* Effect.forkChild(Effect.succeed(0))
        seen.push((Math.max(1, limit ?? 1) === 1 ? owner === current : owner < current) && current < child.id)
        yield* Fiber.join(child)
      }), { concurrency: limit, discard: true })
      return seen
    }))
    return yield* Fiber.join(anchor)
  })
}
