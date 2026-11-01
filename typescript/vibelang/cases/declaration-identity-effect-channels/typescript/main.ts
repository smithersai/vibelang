import { Effect } from "effect"
import { base, derived, list, read, tag, untag } from "./lib.js"

export const same = Effect.fn(function* (n: number) {
  if (n > 0) yield* tag()
  if (n < 0) yield* untag()
})

export const wider = Effect.fn(function* (n: number) {
  if (n > 0) yield* tag()
  if (n < 0) yield* list()
})

export const block = Effect.gen(function* () {
  yield* untag()
  yield* tag()
})

export const otherSuccess = Effect.fn(function* (n: number) {
  if (n > 0) yield* tag()
  return yield* read()
})

export const subclass = Effect.fn(function* (n: number) {
  if (n > 0) yield* base()
  return yield* derived()
})

const quiet = Effect.fn(function* (n: number) {
  return n
})

export const helper = Effect.fn(function* (n: number) {
  const m = yield* quiet(n)
  if (m > 0) yield* tag()
  if (m < 0) yield* untag()
})
