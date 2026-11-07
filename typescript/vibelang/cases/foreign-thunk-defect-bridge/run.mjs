import assert from "node:assert/strict"
import { Cause, Effect, Exit } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
import { failure as actualFailure } from "./out/foreign.js"
import { failure as referenceFailure } from "./typescript/out/foreign.js"
const seen = []
for (const name of ["rejected", "thrownFirst", "thrown"]) {
  const a = await Effect.runPromiseExit(actual[name])
  const b = await Effect.runPromiseExit(reference[name])
  for (const [exit, failure] of [[a, actualFailure], [b, referenceFailure]]) {
    assert.ok(Exit.isFailure(exit))
    assert.ok(Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause))
    assert.equal(Cause.squash(exit.cause), failure)
  }
  seen.push(name + ":die")
}
const a = await Effect.runPromiseExit(actual.loaded)
assert.deepEqual(a, await Effect.runPromiseExit(reference.loaded))
seen.push("loaded:" + a.value)
console.log(seen.join(" "))
