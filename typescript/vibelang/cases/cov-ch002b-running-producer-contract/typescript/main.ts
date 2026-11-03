import { Effect, Stream, Queue, Exit, Cause } from "effect"
export function values(): Stream.Stream<number | string | undefined> {
 return Stream.callback<number | string | undefined>((queue) => Effect.gen(function* () {
   yield* Queue.offer(queue, yield* Effect.succeed(1))
   yield* Effect.uninterruptibleMask(() => Effect.gen(function* () { yield* Queue.offer(queue, 2) }))
   yield* Queue.offer(queue, undefined)
 }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
}
export function empty(): Stream.Stream<never> {
 return Stream.callback<never>((queue) => Effect.gen(function* () {}).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
}
export function failed(): Stream.Stream<never, string> {
 return Stream.callback<never, string>((queue) => Effect.gen(function* () { yield* Effect.fail("boom") }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
}
export function main(): Effect.Effect<unknown> {
 return Effect.gen(function* () {
 const valuesExit = yield* Effect.exit(Stream.runCollect(values()))
 const emptyExit = yield* Effect.exit(Stream.runCollect(empty()))
 const failedExit = yield* Effect.exit(Stream.runCollect(failed()))
 return [
   Exit.isSuccess(valuesExit) ? valuesExit.value : [],
   Exit.isSuccess(emptyExit) ? emptyExit.value : ["wrong"],
   Exit.isFailure(failedExit),
   Exit.isFailure(failedExit) ? Cause.squash(failedExit.cause) : "wrong"
 ]
 })
}
