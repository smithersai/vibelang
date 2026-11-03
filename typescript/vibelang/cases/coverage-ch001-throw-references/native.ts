import { Effect } from "effect"
import { each,callback,summary } from "./foreign.js"
const wrapped=()=>Effect.gen(function* () { return yield* Effect.try(()=>each(callback)) })
export const main=()=>Effect.gen(function* () { return summary(yield* Effect.exit(wrapped())) })
function hidden(): Effect.Effect<number> { throw "boom" }
export const references=()=>Effect.gen(function* () {
 const boom=yield* Effect.exit(Effect.gen(function* () { return yield* hidden() }))
 const callbackDie=yield* Effect.exit(Effect.gen(function* () { return each(callback) }))
 const callbackFail=yield* Effect.exit(wrapped())
 return [summary(boom),summary(callbackDie),summary(callbackFail)]
})
