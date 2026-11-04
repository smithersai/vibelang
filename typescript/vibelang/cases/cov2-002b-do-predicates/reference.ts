import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 switch (0) {}; const value = 7
 switch (0) {}; const empty = undefined
 yield* Stream.runForEachWhile(Stream.make(1), () => Effect.succeed(true)); const first = 7
 yield* Effect.forEach([1], () => Effect.void, { concurrency: "unbounded", discard: true }); const second = 7
 yield* Effect.forEach([1], () => Effect.void, { concurrency: 1, discard: true }); const limited = 7
 return [value, empty === undefined, first, second, limited]
}) }
