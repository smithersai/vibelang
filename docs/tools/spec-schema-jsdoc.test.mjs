import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

const schemaDocClauses = [
  "One written, nongeneric `type X = typeof X.Type` in the same scope replaces the synthesized alias of `schema X`",
  "in either order, each declaration keeping its own JSDoc and export status",
  "Without one, the same bare alias is synthesized and the declaration's JSDoc belongs to its constant only",
]
function checkSchemaDocumentation(text) {
  for (const clause of schemaDocClauses) assert.ok(text.includes(clause), "missing schema documentation contract: " + clause)
}

test("schema declaration documentation belongs to its constant", () => {
  checkSchemaDocumentation(chapter("006-data"))
  const vip = read("docs/design/vips/0027-declaration-output.md")
  assert.ok(vip.includes("documented schemas"))
  assert.ok(vip.includes("its synthesized `typeof Name.Type` alias has no comment"))
})
