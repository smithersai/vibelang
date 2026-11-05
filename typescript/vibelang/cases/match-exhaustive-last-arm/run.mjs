import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Option } from "effect"
import { main } from "./out/main.js"
import { Denied, NotFound, Timeout, describe, greeting, phaseLabel, record, width } from "./out/arms.js"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
fc.assert(fc.property(fc.constantFrom("draft", "review", "published"), fc.string(), (phase, payload) => {
  const labels = { draft: "Draft", review: "Review", published: "Published" }
  assert.equal(phaseLabel(phase), labels[phase])
  assert.equal(width(phase), labels[phase].length)
  const log = []
  record(phase, log)
  assert.deepEqual(log, [phase])
  assert.equal(describe(new NotFound({ id: payload })), "no user " + payload)
  assert.equal(describe(new Timeout()), "retry")
  assert.equal(describe(new Denied({ user: payload })), "denied " + payload)
  assert.equal(greeting(Option.some(payload)), "Hello, " + payload)
  assert.equal(greeting(Option.none()), "Hello")
}), { seed: 209405, numRuns: 100 })
console.log("@@result " + JSON.stringify(await Effect.runPromise(main())))
