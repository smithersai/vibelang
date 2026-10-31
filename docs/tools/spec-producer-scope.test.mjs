import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("producer inference subtracts only the callback-supplied Scope", () => {
  const text = chapter("002-running").split("## Producers")[1]
  assert.ok(text.includes("Exclude<RBody, Scope.Scope>"), "producer inference omits the callback's Scope subtraction")
  assert.ok(text.includes("Stream.callback<A, E, RBody>"), "callback receives the body requirements")
  assert.ok(text.includes("other service requirements"), "unrelated services must remain")
})

test("the VIP, declarations and user producer guide retain the environment rule", () => {
  for (const path of ["docs/design/vips/0021-producers.md", "docs/design/src/001-functions.md",
    "docs/user/src/vibelang-features/112-producers.md"]) {
    const text = read(path)
    assert.ok(text.includes("Exclude<RBody, Scope.Scope>"), path + " omits producer environment inference")
  }
})

test("the printed producer needs no external Scope and gets fresh callback lifetimes", () => {
  const source = block(chapter("008-runtime"), "Producer Scope witness")
  const result = run(source)
  assert.equal(result.status, 0, result.stderr + result.stdout)
})
