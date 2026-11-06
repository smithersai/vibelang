import { Effect, Exit } from "effect"
import { events, sentinel, risky, invoke } from "./foreign.js"
function plainSync() {
  try { invoke(function*(x = risky()) { events.push("body"); yield x }); return false }
  catch (e) { return e === sentinel }
}
function plainAsync() {
  try { invoke(async function*(x = risky()) { events.push("body"); yield x }); return false }
  catch (e) { return e === sentinel }
}
function exact(value: Exit.Exit<unknown, unknown>) {
  if (value._tag !== "Failure") return false
  const reason = value.cause.reasons[0]
  return reason?._tag === "Fail" && reason.error === sentinel
}

export function main(){return Effect.gen(function*(){
const before = events.length
const first = yield* Effect.exit(Effect.try({ try: () => invoke(function*(x = risky()) { events.push("body"); yield x }), catch: e => e }))
const second = yield* Effect.exit(Effect.try({ try: () => invoke(async function*(x = risky()) { events.push("body"); yield x }), catch: e => e }))
return [before, plainSync(), plainAsync(), exact(first), exact(second), events.slice()]
})}
