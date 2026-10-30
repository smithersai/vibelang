import { Effect } from "effect"
function stringShadow() {
  return Effect.gen(function*() {
    const undefined = "shadow"
    const seen: number[] = []
    yield* Effect.forEach([1, 2], item => Effect.sync(() => { seen.push(item) }), { concurrency: "unbounded", discard: true })
    return { undefined, seen }
  })
}
function numberShadow() {
  return Effect.gen(function*() {
    const undefined = 1
    let active = 0, maximum = 0
    yield* Effect.forEach([1, 2, 3], () => Effect.gen(function*() {
      active++
      maximum = Math.max(maximum, active)
      yield* Effect.yieldNow
      active--
    }), { concurrency: "unbounded", discard: true })
    return { undefined, maximum }
  })
}
export function main() {
  return Effect.gen(function*() {
    return { string: yield* stringShadow(), number: yield* numberShadow() }
  })
}
