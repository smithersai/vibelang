import { Effect, Exit } from "effect"
function test<A, E, R>(body: () => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return body()
}
export function main() {
  return Effect.gen(function* () {
    let evaluations = 0
    const observe = () => Effect.gen(function* () {
      evaluations++
      return yield* Effect.exit(Effect.fail("bad"))
    })
    const first = test(() => Effect.gen(function* () { return Exit.isFailure(yield* observe()) }))
    const second = test(() => Effect.gen(function* () {
      const subject = yield* observe()
      return Exit.isFailure(subject) || Exit.isSuccess(subject)
    }))
    const third = test(() => Effect.gen(function* () { return Exit.isSuccess(yield* observe()) }))
    const a = yield* first
    const b = yield* second
    const c = yield* third
    return [a, b, c, evaluations]
  })
}
