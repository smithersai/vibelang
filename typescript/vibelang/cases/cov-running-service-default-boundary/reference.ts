// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
function fork(n: number) { return n + 1 }
function join(n: number) { return n + 2 }
export function main() { return Effect.gen(function* () {
 const Defaulted = Context.Reference<{ value: number }>("cov/Defaulted", { defaultValue: () => ({ value: fork(join(4)) }) })
 return (yield* Defaulted).value
}) }
