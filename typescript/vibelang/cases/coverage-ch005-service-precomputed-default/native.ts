import { Context, Effect } from "effect"
export function f() { return Effect.gen(function* () {
 const factory = yield* Effect.succeed(() => ({n:1}))
 const S = Context.Reference<{n:number}>("coverage/Precomputed", {defaultValue:factory})
 return (yield* S).n
}) }

