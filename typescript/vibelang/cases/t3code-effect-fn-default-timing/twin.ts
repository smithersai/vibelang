import { Effect, Stream } from "effect"
let counter = 0
const events: number[] = []
const state = { value: 1 }
export function reset() { counter = 0; events.length = 0; state.value = 1 }
export function snapshot() { return { counter, events: [...events] } }
export function change(value: number) { state.value = value }
function tick(weight: number) { counter += weight; events.push(counter); return counter }

export function fromState(value = state.value) { return Effect.gen(function* () { return value }) }
export function fromArgument(input: { branch: string }, value = input.branch) { return Effect.gen(function* () { return value }) }
export function fresh(options: { seen?: number } = {}) { return Effect.gen(function* () { options.seen = (options.seen ?? 0) + 1; return options }) }
export function freshArray(values: number[] = []) { return Effect.gen(function* () { values.push(1); return values }) }
export function effectValue(value = Effect.succeed(tick(1))) { return Effect.gen(function* () { return yield* value }) }
export function make(weights: number[], supplied?: number) {
  const f = (a = tick(weights[0]), b = a + tick(weights[1]), c = b + tick(weights[2])) => Effect.gen(function* () {
    events.push(-c)
    return [a, b, c]
  })
  return f(supplied)
}
export const generator = { values(value = tick(3)) { return Stream.fromEffect(Effect.gen(function* () { return [value, tick(1)] })).pipe(Stream.flatMap(Stream.fromIterable)) } }
export const migrated = Effect.fn(function* (input: { branch: string }, value = input.branch, options: { seen?: number } = {}) {
  options.seen = (options.seen ?? 0) + 1
  return { resolved: value, allocated: options }
})

export const migratedState = Effect.fnUntraced(function* (value = state.value) { return value })
export const migratedWeights = Effect.fnUntraced(function* (weights: number[], a = tick(weights[0]), b = a + tick(weights[1]), c = b + tick(weights[2])) {
  events.push(-c)
  return [a, b, c]
})
