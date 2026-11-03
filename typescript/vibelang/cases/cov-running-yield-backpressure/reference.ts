// Chapter 2: explicit Effect TypeScript counterpart.
import { Queue, Deferred, Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 const ready = yield* Deferred.make<void>()
 const attempts: number[] = []
 const source = () => Stream.callback<number>(queue => Effect.gen(function* () {
   for (const n of [1, 2, 3, 4]) {
     attempts.push(n)
     if (n === 3) yield* Deferred.succeed(ready, undefined)
     yield* Queue.offer(queue, n)
   }
 }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
 let observed: number[] = []
 yield* Stream.runForEachWhile(source(), item => Effect.gen(function* () {
   yield* Deferred.await(ready)
   observed = attempts.slice()
   return false
 }))
 return observed
}) }
