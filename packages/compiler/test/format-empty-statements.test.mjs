import assert from "node:assert/strict"
import { test } from "node:test"
import { formatSource } from "../format.mjs"

for (const comment of ["/** @internal */", "/** @throws {Error} */", "/** documentation */"]) {
  for (const scope of ["top", "block"]) {
    test(`formatting keeps ${comment} on the empty ${scope} statement`, () => {
      const body = `${comment} ;\nconst value = 1;\n`
      const source = scope === "top" ? body + "export { value }\n" : `function outer() {\n${body}return value\n}\n`
      const formatted = formatSource(source, "empty-statement-jsdoc.vibe")
      assert.ok(formatted.includes(comment))
      assert.match(formatted, /\*\/\s*;/)
      assert.equal(formatSource(formatted, "empty-statement-jsdoc.vibe"), formatted)
    })
  }
}
