import { Effect, Stream, Queue } from "effect"
export function main(): Effect.Effect<string[]> {
 return Effect.gen(function* () {
  const trace: string[] = []
  function values() {
   return Stream.callback<number>(queue => Effect.gen(function* () {
    const r = yield* Effect.acquireRelease(Effect.sync(() => { trace.push("open"); return 1 }), () => Effect.sync(() => { trace.push("close") }))
    yield* Queue.offer(queue, r)
    yield* Queue.offer(queue, yield* Effect.succeed(2))
    yield* Queue.end(queue)
   }), { bufferSize: 1, strategy: "suspend" })
  }
  const stream = values()
  trace.push("cold:" + trace.length)
  for (const _ of [1, 2]) {
    const xs = yield* Stream.runCollect(stream)
    trace.push(xs.join(","))
  }
  return trace
 })
}
