import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

test("schema generic mappings require type bindings and preserve value-only shadowing", () => {
  const data = chapter("006-data")
  assert.ok(data.includes("selected by ordinary type lookup and alias resolution."))
  assert.ok(data.includes("a value-only binding does not by itself replace the separate library type binding"))
  assert.ok(data.includes("This does not expand arbitrary user type aliases or introduce generic Schema declarations."))
  assert.ok(read("docs/design/vips/0015-schema-declarations.md").includes("mapped generic bindings"))
  assert.ok(chapter("900-appendices").includes("including a shadowing type without a suitable Schema value"))
})
