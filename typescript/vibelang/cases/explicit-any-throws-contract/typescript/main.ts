import { Effect, Exit } from "effect"
import { sentinel, risky, invoke } from "./foreign.js"
import type { TextCallback } from "./foreign.js"
const selected: TextCallback = risky
function captured() {
  try { invoke(selected, true); return false }
  catch (e) { return e === sentinel }
}
function exact(value: Exit.Exit<unknown, unknown>) {
  if (value._tag !== "Failure") return false
  const reason = value.cause.reasons[0]
  return reason?._tag === "Fail" && reason.error === sentinel
}
export function main() { return Effect.gen(function*() {
const value = yield* Effect.try(() => invoke(selected, false))
const failure = yield* Effect.exit(Effect.try({ try: () => invoke(risky, true), catch: e => e }))
return [value, captured(), exact(failure)]
}) }
