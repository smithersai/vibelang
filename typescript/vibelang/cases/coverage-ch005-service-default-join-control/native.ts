import { Context, Effect } from "effect"
const join = (n:number) => () => ({n})
export function f() { return Effect.gen(function* () {
 const S = Context.Reference<{n:number}>("coverage/DefaultJoin", {defaultValue:join(1)})
 return (yield* S).n
}) }

