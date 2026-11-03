import { Effect } from "effect"
export const f = Effect.sync
export const g = Effect.callback
export const n = Effect.never
export function main() {
  return Effect.gen(function*() {
    const input = 7
    const viaSync = yield* f(() => input + 1)
    const viaCallback = yield* g<number>((resume) => resume(Effect.succeed(input + 2)))
    const directSync = yield* Effect.sync(() => input + 3)
    const directCallback = yield* Effect.callback<number>((resume) => resume(Effect.succeed(input + 4)))
    return [f === Effect.sync, g === Effect.callback, n === Effect.never, viaSync, viaCallback, directSync, directCallback]
  })
}
