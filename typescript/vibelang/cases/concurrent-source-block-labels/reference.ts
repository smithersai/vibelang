import { Effect } from "effect"

export const reference = () => Effect.gen(function* () {
  const seen: string[] = []
  source: {
    const marker = 1
    let items: number[]
    {
      seen.push("head")
      if (marker === 1) break source
      items = [1]
    }
    yield* Effect.forEach(items, (item) => Effect.sync(() => {
      seen.push(`unexpected:${item}`)
    }), { discard: true })
  }
  seen.push("after")
  {
    const limit = 1
    yield* Effect.forEach([1, 2], (item) => Effect.sync(() => {
      if (item === 1) return
      seen.push(`item:${item}`)
    }), { concurrency: limit, discard: true })
  }
  return seen
})
