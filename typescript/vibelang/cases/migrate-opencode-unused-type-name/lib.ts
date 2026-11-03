import { Effect } from "effect"
import { local, type Box } from "./types.js"

type Local = Parameters<typeof local>[0]

export const read = Effect.fn("read")(function* (box: Box) {
  return yield* Effect.succeed(box.value)
})

export const again = Effect.fn("again")(function* (box: Box) {
  return yield* Effect.succeed(box.value + box.value)
})

export const count = Effect.fn("count")(function* (input: Local) {
  return yield* Effect.succeed(input.n + 1)
})

export const run = () => local({ n: 1 })
