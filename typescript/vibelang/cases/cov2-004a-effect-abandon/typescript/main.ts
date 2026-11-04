import { Effect } from "effect"
function* numbers(log: string[]) { try { yield 1; yield 2 } finally { log.push("closed") } }
function typed(log: string[]) {
  return Effect.gen(function* () {
    const iterator = numbers(log)
    const first = iterator.next()
    if (!first.done) return yield* Effect.fail("bad")
    return 0
  })
}
export function main(): Effect.Effect<unknown> {
  return Effect.gen(function* () {
    const log: string[] = []
    const result = yield* Effect.exit(typed(log))
    return [result._tag, log]
  })
}
