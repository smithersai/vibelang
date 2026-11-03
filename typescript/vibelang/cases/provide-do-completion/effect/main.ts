import { Effect, Layer, Exit } from "effect"
const observed: string[] = []
const Live = Layer.effectDiscard(Effect.acquireRelease(Effect.succeed(undefined), (_, exit) => Effect.sync(() => {
  observed.push(Exit.isSuccess(exit) ? String(exit.value) : exit._tag)
})))
function preceding(): Effect.Effect<number> { return Effect.gen(function* () { yield* Effect.provide(Effect.gen(function* () {}), Live); return 19 }) }
function only(): Effect.Effect<undefined> { return Effect.gen(function* () { yield* Effect.provide(Effect.gen(function* () {}), Live); return undefined }) }
function declaration(): Effect.Effect<number> { return Effect.gen(function* () { const local = 99; yield* Effect.provide(Effect.gen(function* () {}), Live); return 23 }) }
function nested(): Effect.Effect<number> { return Effect.gen(function* () { yield* Effect.provide(Effect.gen(function* () { yield* Effect.provide(Effect.gen(function* () {}), Live) }), Live); return 29 }) }
function labeled(): Effect.Effect<number> { return Effect.gen(function* () { yield* Effect.provide(Effect.gen(function* () { ; {} }), Live); return 31 }) }
function value(): Effect.Effect<number> { return Effect.gen(function* () { yield* Effect.provide(Effect.gen(function* () { 37 }), Live); return 37 }) }
function explicitUndefined(): Effect.Effect<undefined> { return Effect.gen(function* () { yield* Effect.provide(Effect.gen(function* () { void 0 }), Live); return undefined }) }
export function main() {
  return Effect.gen(function* () {
    const values = [yield* preceding(), yield* only(), yield* declaration(), yield* nested(), yield* labeled(), yield* value(), yield* explicitUndefined(), yield* preceding()]
    return { values, observed }
  })
}
