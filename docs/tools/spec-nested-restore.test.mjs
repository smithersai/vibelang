import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")
const vip = () => process.env.SPEC_VIP22 ? readFileSync(process.env.SPEC_VIP22, "utf8") : read("docs/design/vips/0022-interruption-blocks.md")

test("restore selects the innermost lexical uninterruptible mask, including masked entry", () => {
  for (const text of [running(), vip()]) {
    assert.match(text, /innermost enclosing .*uninterruptible/)
    assert.match(text, /entry state may already be uninterruptible/)
  }
})

test("the printed pending-interruption witness distinguishes inner and outer restoration", () => {
  const vibe = block(running(), "effect function nestedRestore(events:", "vibe es")
  assert.ok(vibe.includes("try orDie(Effect.try(() => self.interruptUnsafe()))"),
    "bridge the foreign scalar method instead of assuming a never-throw contract")
  const source = block(running(), "function nestedRestore(events:")
  const wrong = source.replace("yield* restoreInner(", "yield* restoreOuter(")
  assert.notEqual(wrong, source)
  for (const [program, expected] of [[source, ["inner", "after inner"]], [wrong, []]]) {
    const result = run(program + `
import assert from "node:assert/strict"
const events: string[] = []
const exit = Effect.runSyncExit(Effect.interruptible(nestedRestore(events)))
assert.equal(exit._tag, "Failure")
assert.deepEqual(exit.cause.reasons.map(reason => reason._tag), ["Interrupt"])
assert.deepEqual(events, ` + JSON.stringify(expected) + `)
`)
    assert.equal(result.status, 0, result.stderr)
  }
})
