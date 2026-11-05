import assert from "node:assert/strict"
import { Cause, Effect, Exit } from "effect"
import { erased, untyped, optional } from "./out/main.js"
for (const call of [erased, untyped, optional]) {
  let calls = 0
  const ok = call(() => { calls++; return 7 })
  assert.equal(calls, 0)
  assert.equal(await Effect.runPromise(ok), 7)
  assert.equal(calls, 1)
  const thrown = { marker: "same exception" }
  const failure = await Effect.runPromise(Effect.exit(Effect.catch(call(() => { throw thrown }), () => Effect.succeed("handled"))))
  assert.ok(Exit.isFailure(failure))
  assert.equal(failure.cause.reasons.find(Cause.isDieReason)?.defect, thrown)
}
assert.equal(await Effect.runPromise(optional(undefined)), undefined)
console.log("lazy success, defect identity and optional absence preserved")
