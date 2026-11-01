import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 3, OPUS-8 (decided detail 249).
test("chapter 4, Appendix B and VIP-7 place limit and catch-parameter bindings", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("A binding in a `for concurrent` limit belongs to the nearest home that encloses the loop, because the limit runs before the head environment exists"))
  assert.ok(match.includes("The same holds for a catch clause's parameter, whose environment is distinct from the catch Block ([VIP-7](../vips/0007-match.md#binding-homes-and-redeclarations))"))
  assert.ok(match.includes("| an `is` pattern binding in formal-parameter or catch-parameter initialization"))
  assert.ok(match.includes("catch ({ code = (1 is let c) }: any) {} } // EK0705"))
  const row = chapter("900-appendices").split("\n").find(line => line.startsWith("| `EK0705` |")) ?? ""
  assert.ok(row.includes("formal-parameter or catch-parameter initialization"))
  assert.ok(read("docs/design/vips/0007-match.md").includes("**Amended 2026-10-31: limit and catch-parameter homes.**"))
})

test("ECMAScript gives a catch parameter an environment apart from the catch Block", () => {
  const seen = []
  const c = "outer"
  try { throw {} } catch ({ a = () => c }) { let c = "body"; seen.push(a(), c) }
  assert.deepEqual(seen, ["outer", "body"])
})
