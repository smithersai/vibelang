import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { chapter, block, read, run } from "./spec-witness.mjs"
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("await parity names return assimilation and the explicit Effect return", () => {
  const text = running()
  const parity = text.slice(text.indexOf("They differ where"), text.indexOf("## §effect§ blocks".replaceAll("§", String.fromCharCode(96))))
  assert.match(parity, /return.*assimilates/)
  assert.match(parity, /return try e/)
  assert.match(parity, /Effect.gen.*return/)
  assert.match(parity, /returnEffectInGen/)
  assert.match(parity, /plain.*catch.*handler.*result/)
  assert.match(parity, /success value unchanged/)
  assert.match(text, /Success.*inner.*unrun/)
  assert.match(read("docs/design/vips/0005-try-runs-effects.md"), /return values.*unflattened/)
})

test("the printed boxed and unboxed returns preserve the real inner Effect", () => {
  const source = block(running(), "function boxedReturn(")
  const r = run(source + `
import assert from "node:assert/strict"
let runs = 0
const inner = Effect.sync(() => { runs++; return 7 })
const boxed = Effect.runSyncExit(boxedReturn(inner))
assert.equal(boxed._tag, "Success")
assert.equal(boxed.value, inner)
assert.equal(runs, 0)
const unboxed = Effect.runSyncExit(unboxedReturn(inner))
assert.equal(unboxed._tag, "Success")
assert.equal(unboxed.value, 7)
assert.equal(runs, 1)
`)
  assert.equal(r.status, 0, r.stderr)
})
