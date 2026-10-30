import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")
const vip = () => process.env.SPEC_VIP22 ? readFileSync(process.env.SPEC_VIP22, "utf8") : read("docs/design/vips/0022-interruption-blocks.md")

test("VIP-22 states every independent source activation and local-mask permission", () => {
  const text = vip()
  assert.match(text, /function declaration or expression, arrow, method, producer or/)
  assert.match(text, /own .*uninterruptible.* mask/)
  assert.match(running(), /captures an outer mask across/)
  assert.match(running(), /any .*for concurrent.* body/)
})

test("the printed local-mask control remains cold and works after its enclosing mask ends", () => {
  const result = run(block(running(), "const delayedOwnMask =") + `
import assert from "node:assert/strict"
const delayed = Effect.runSync(delayedOwnMask)
assert.equal(delayed, ownMask)
assert.equal(Effect.runSync(delayed()), 7)
assert.equal(Effect.runSync(delayed()), 7)
`)
  assert.equal(result.status, 0, result.stderr)
})
