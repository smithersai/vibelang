import assert from "node:assert/strict"
import { test } from "node:test"
import { formatSource } from "../format.mjs"

for (const kind of ["error", "schema error"]) {
  for (const [name, body] of [
    ["fields", "id: string, code: number"],
    ["getter", "id: string, get label() { return this.id }"],
    ["tuple", "pair: [string, number], code: number"],
    ["comments", "id: string /* keep */, /* next */ get label() { return this.id }"],
  ]) {
    test("formatting comma-separated " + kind + " " + name + " preserves separators", () => {
      const source = kind + " E { " + body + " }\n"
      const formatted = formatSource(source, "comma-fields.vibe")
      assert.equal(formatted.split(",").length, source.split(",").length)
      for (const comment of ["/* keep */", "/* next */"]) {
        if (source.includes(comment)) assert.ok(formatted.includes(comment))
      }
      assert.equal(formatSource(formatted, "comma-fields.vibe"), formatted)
    })
  }
}
