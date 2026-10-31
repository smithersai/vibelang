import assert from "node:assert/strict"
import { test } from "node:test"
import { formatSource } from "../format.mjs"

for (const [name, source] of [
  ["error", "error E { ;; get label() { return 1 } ;; }\n"],
  ["schema error", "schema error E { ;; id: string; ;; get label() { return this.id } ;; }\n"],
]) {
  test(`formatting drops harmless empty ${name} elements`, () => {
    const formatted = formatSource(source, "empty-members.vibe")
    assert.ok(!formatted.includes(";;"))
    assert.equal(formatSource(formatted, "empty-members.vibe"), formatted)
  })
}
for (const kind of ["class", "error", "schema error"]) {
  for (const comment of ["/** @internal */", "/** @throws {Error} */", "/** documentation */"]) {
    test(`formatting keeps ${comment} on the empty ${kind} member`, () => {
      const source = `${kind} E {\n${comment} ;\nvisible(): number { return 1 }\n}\n`
      const formatted = formatSource(source, "empty-member-jsdoc.vibe")
      assert.ok(formatted.includes(comment))
      assert.match(formatted, /\*\/\s*;/)
      assert.equal(formatSource(formatted, "empty-member-jsdoc.vibe"), formatted)
    })
  }
}
