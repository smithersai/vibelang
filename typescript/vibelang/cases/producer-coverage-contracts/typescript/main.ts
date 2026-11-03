import { Effect, Stream, Queue, Scope } from "effect"
export function main(): Effect.Effect<Array<number | string>> {
 return Effect.gen(function* () {
  type Numbers = Stream.Stream<number>
  function one(): Numbers | never {
    return Stream.callback<number>(q => Effect.gen(function* () { yield* Queue.offer(q,1); yield* Queue.end(q) }), {bufferSize:1,strategy:"suspend"})
  }
  function union(): Stream.Stream<number | string> {
    return Stream.callback<number | string>(q => Effect.gen(function* () { yield* Queue.offer(q,2); yield* Queue.offer(q,"x"); yield* Queue.end(q) }), {bufferSize:1,strategy:"suspend"})
  }
  function scopes() { return Stream.callback<Scope.Scope>(q => Effect.gen(function* () { yield* Queue.offer(q,yield* Effect.scope); yield* Queue.end(q) }), {bufferSize:1,strategy:"suspend"}) }
  const check: Stream.Stream<Scope.Scope> = scopes()
  const a = yield* Stream.runCollect(one())
  const b = yield* Stream.runCollect(union())
  return [...a,...b]
 })
}
