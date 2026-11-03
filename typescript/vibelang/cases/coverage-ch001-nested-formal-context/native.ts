import { Effect } from "effect"
export function f(a = async () => await Promise.resolve(1), b = function* () { yield 2 }) {
 return Effect.gen(function* () { return [yield* Effect.tryPromise(a), b().next().value] })
}
