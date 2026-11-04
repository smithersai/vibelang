import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
import { input } from "./input.js"
function plain(x = input.value) { return x }
async function asyncCall(x = input.value) { return x }
function effectCall(x?: number): Effect.Effect<number> { try { return Effect.succeed(x === undefined ? input.value : x) } catch (e) { return Effect.die(e) } }
export function main() { return Effect.gen(function* () {
 const a = yield* Effect.exit(Effect.try(() => plain()))
 const b = yield* Effect.exit(Effect.tryPromise(() => asyncCall()))
 const c = yield* Effect.exit(effectCall())
 return [a._tag, b._tag, c._tag === "Failure" ? c.cause.reasons[0]._tag : "Success"]
}) }
