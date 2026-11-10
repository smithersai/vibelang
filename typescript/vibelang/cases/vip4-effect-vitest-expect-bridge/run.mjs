import { Cause, Effect, Exit } from "effect"
import { tests } from "@effect/vitest"
import { same } from "./out/main.js"

const passed = await Effect.runPromise(same(2, 2))
const failed = await Effect.runPromise(Effect.flip(same(2, 3)))
const outcomes = []
for (const [name, test] of tests) {
  const exit = await Effect.runPromiseExit(test())
  outcomes.push([name, Exit.isSuccess(exit) ? "passed" : Cause.squash(exit.cause)._tag])
}
console.log(JSON.stringify([passed, failed._tag, failed.cause.name, outcomes]))
