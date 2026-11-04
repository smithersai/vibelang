import { Effect } from "effect"
import { ev } from "./events.js"
export function main() {
  return Effect.gen(function* () {
    const v0 = yield* Effect.sync(() => { ev("e0"); return 1 })
    const v1 = yield* Effect.succeed(v0 + 1)
    return v1
  })
}
export function identities() {
  return [Effect.sync === Effect.sync, Effect.callback === Effect.callback, Effect.forkIn === Effect.forkIn, Effect.never === Effect.never, Effect.yieldNow === Effect.yieldNow]
}
