import { Effect, Stream, Deferred, Queue } from "effect"
export function main(): Effect.Effect<number> {
 return Effect.gen(function* () {
  const ready = yield* Deferred.make<void>()
  let evaluated=0,observed=-1
  function values() {
    return Stream.callback<number>(q => Effect.gen(function* () {
      for (const n of [1,2,3,4,5]) {
        evaluated++
        if (n===3) yield* Deferred.succeed(ready,undefined)
        yield* Queue.offer(q,n)
      }
      yield* Queue.end(q)
    }),{bufferSize:1,strategy:"suspend"})
  }
  yield* Stream.runForEachWhile(values(), n => Effect.gen(function* () {
    yield* Deferred.await(ready)
    yield* Effect.yieldNow
    observed=evaluated
    return false
  }))
  return observed
 })
}
