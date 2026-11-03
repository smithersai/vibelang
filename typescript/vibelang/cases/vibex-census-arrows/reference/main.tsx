const id = <T,>(x: T) => x
const constrained = <T extends string>(x: T) => x
const defaulted = <T = string>(x: T) => x
const asyncId = async <T,>(x: T) => x
const lift = <T,>(x: T) => Effect.gen(function*(){ return x })
function recover() { return Effect.gen(function*(){ return yield* Effect.catch(input, <E,>(e: E) => Effect.succeed(1)) }) }
