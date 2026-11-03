import { Effect, Stream } from "effect"
// Native block completions are independently observed through eval in .ts.
function completion(source: string): number { return eval(source) }
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  const out = [completion("{ 7 }"), completion("8; {}"), completion("outer: { { 9; break outer } }")]
  yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    yield* Stream.runForEachWhile(Stream.make(10), n => restore(Effect.sync(() => { out.push(n); return true })))
    yield* Effect.forEach([11], n => Effect.uninterruptibleMask(resume => resume(Effect.sync(() => { out.push(n) }))), {concurrency:1, discard:true})
  }))
  return out
 })
}
