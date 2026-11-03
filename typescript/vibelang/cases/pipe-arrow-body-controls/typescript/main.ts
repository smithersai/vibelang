import { Effect } from "effect"
let calls = 0
const first = calls += 1
const plain = () => first
const second = 2
const later = async () => second
const third = 3
const effectful = () => Effect.succeed(third)
const fourth = 4
const block = () => { return fourth }
const fifth = 5
const nested = { f: () => fifth }
const sixth = 6
const program = Effect.succeed(sixth)
let assigned = 0
const chose: number | ((m: number) => number) = true ? (assigned = 7) : m => m
const choseLater: number | ((m: number) => number) = false ? (assigned = 9) : m => m
export const main = () => Effect.gen(function* () {
  return [calls, plain(), yield* Effect.promise(later), yield* effectful(), block(), nested.f(), yield* program, assigned, typeof chose, typeof choseLater]
})
