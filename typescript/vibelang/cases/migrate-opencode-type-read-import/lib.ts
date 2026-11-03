import { Effect } from "effect"
import * as Types from "./types.js"
import { local } from "./types.js"

export const read = Effect.fn("read")(function* (box: Types.Box) {
  return yield* Effect.succeed(box.value)
})

export const again = Effect.fn("again")(function* (box: Types.Box) {
  return yield* Effect.succeed(box.value + box.value)
})

export const count = Effect.fn("count")(function* (input: Parameters<typeof Types.local>[0]) {
  return yield* Effect.succeed(input.n + 1)
})

export const run = () => local({ n: 1 })
