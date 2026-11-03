import { Effect } from "effect"
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  let active=0,peak=0
  yield* Effect.forEach([1,2,3], n => Effect.gen(function* () {
    active++;peak=Math.max(peak,active);yield* Effect.yieldNow;active--
  }), {concurrency:"unbounded",discard:true})
  return [peak]
 })
}
