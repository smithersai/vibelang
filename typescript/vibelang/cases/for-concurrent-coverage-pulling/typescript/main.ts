import { Effect } from "effect"
import { items } from "./iterable.js"
export function main(): Effect.Effect<string[]> {
 return Effect.gen(function* () {
  const out: string[] = []
  for (const limit of [1, 2] as const) {
    const log: string[] = []
    const result = yield* Effect.catch(Effect.gen(function* () {
      yield* Effect.forEach(items(log), n => Effect.gen(function* () {
        log.push("body:" + n)
        if (n === 1) return yield* Effect.fail("stop")
      }), { concurrency: limit, discard: true })
      return "ok"
    }), () => Effect.succeed("failed"))
    out.push(result, ...log)
  }
  const parent = yield* Effect.withFiber(f => Effect.succeed(f))
  for (const limit of [1, 2] as const) {
    const flags: boolean[] = []
    yield* Effect.forEach([1, 2, 3], n => Effect.gen(function* () {
      const item = yield* Effect.withFiber(f => Effect.succeed(f))
      flags.push(item === parent)
    }), { concurrency: limit, discard: true })
    out.push(flags.join(","))
  }
  return out
 })
}
