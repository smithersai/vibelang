import assert from "node:assert/strict"
import test from "node:test"
import { block, read, run } from "./spec-witness.mjs"

test("the public service decision states recursive shapes and generic capture admission", () => {
  const vip = read("docs/design/vips/0009-service-declarations.md")
  assert.ok(vip.includes("Inside that service's own shape, `S.Shape` denotes that alias directly"))
  assert.ok(vip.includes("both class services and defaulted `Context.Reference` services"))
  assert.ok(vip.includes("free type parameter from an enclosing scope"))
  assert.ok(vip.includes("callable thrown contracts"))
  assert.ok(vip.includes("A member's own generic parameters are allowed"))
  const result = run(block(vip, "const recursiveShapeExit") + `
import assert from "node:assert/strict"
assert.equal(recursiveShapeExit._tag, "Success")
assert.equal(recursiveShapeExit.value, true)
assert.equal(referenceShapeExit._tag, "Success")
assert.equal(referenceShapeExit.value, true)
assert.ok(refImplementation.next)
assert.equal(Object.hasOwn(NodeKey, "Shape"), false)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
