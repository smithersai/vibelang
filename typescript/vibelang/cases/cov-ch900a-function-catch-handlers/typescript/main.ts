import { Effect } from "effect"
export function main() { return Effect.gen(function* () {
 const a = yield* Effect.catch(Effect.fail(1), e => Effect.succeed(e + 1))
 const b = yield* Effect.catch(Effect.fail(1), e => Effect.gen(function* () { return yield* Effect.succeed(e + 2) }))
 const c = yield* Effect.catch(Effect.fail(1), e => Effect.succeed(e + 1))
 const d = yield* Effect.catch(Effect.fail(1), e => Effect.gen(function* () { return yield* Effect.succeed(e + 2) }))
 return [a,b,c,d]
}) }
