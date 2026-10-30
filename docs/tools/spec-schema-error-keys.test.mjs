import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("schema-error keys prove runtime-domain exclusion rather than nominal assignability", () => {
  const failures = chapter("003-failures")
  assert.ok(failures.includes('runtime property-key domain is proved to exclude `"_tag"`'))
  assert.ok(failures.includes("Resolve effective generic constraints recursively"))
  assert.ok(failures.includes("Use enum members' underlying string values"))
  assert.ok(failures.includes("an opaque brand or refinement marker does not exclude the underlying string"))
  assert.ok(failures.includes("Every possible union component must exclude it"))
  assert.ok(failures.includes("`never` has no possible key"))
  assert.ok(failures.includes("no runtime tag guard is added"))
  assert.ok(read("docs/design/vips/0029-schema-errors.md").includes("computed keys preserve the discriminant"))
  assert.ok(chapter("006-data").includes("A nominal brand alone grants no exception"))
  const result = run(block(failures, "const admittedKeyExit") + `
import assert from "node:assert/strict"
assert.equal(admittedKeyExit._tag, "Success")
assert.equal(admittedKeyExit.value._tag, "Good")
assert.equal(admittedKeyExit.value.count, 1)
assert.equal(brandedKey, "_tag")
assert.equal(rawBrandAssignable, false)
assert.equal(rawEnumAssignable, false)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test("the admitted Dynamic counterpart keeps the generated tag and required literal field", () => {
  const failures = chapter("003-failures")
  const source = block(failures, "class Dynamic extends Schema.TaggedError")
  assert.ok(source.includes('const field = "actual"'))
  const result = run(source + `
import assert from "node:assert/strict"
const valid = decode({ _tag: "Dynamic", actual: 1 })
assert.equal(valid._tag, "Success")
assert.equal(valid.value._tag, "Dynamic")
assert.equal(decode({ _tag: 42, actual: 1 })._tag, "Failure")
assert.equal(decode({ _tag: "Dynamic", other: 1 })._tag, "Failure")
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
