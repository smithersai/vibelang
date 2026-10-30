import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("recursive service Shapes name the written member type directly", () => {
  const services = chapter("005-services")
  assert.ok(services.includes("type Shape = $Users$Shape"))
  assert.ok(services.includes("type Shape = $Clock$Shape"))
  assert.ok(services.includes("type Shape = $Flags$Shape"))
  assert.ok(!services.includes("type Shape = Context.Service.Shape<typeof"))
  const result = run(block(services, "const recursiveShapeExit") + `
import assert from "node:assert/strict"
assert.equal(recursiveShapeExit._tag, "Success")
assert.equal(recursiveShapeExit.value, 7)
assert.equal(impl.next(), impl)
assert.equal(impl.peer().read(), impl)
assert.equal(polymorphicShapeExit._tag, "Success")
assert.deepEqual(polymorphicShapeExit.value, [7, "ok"])
function localShape() {
  type LocalShape = { value: number }
  class Local extends Context.Service<Local, LocalShape>()("test/Local") {}
  return Effect.provideService(Effect.gen(function* () { return (yield* Local).value }), Local, { value: 9 })
}
assert.equal(Effect.runSyncExit(localShape()).value, 9)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test("EK3005 rejects outer type capture while permitting one fixed polymorphic contract", () => {
  const services = chapter("005-services")
  assert.ok(services.includes("cannot capture a type parameter from an enclosing scope (`EK3005`)"))
  assert.ok(services.includes("aliases, constraints, defaulted type arguments and callable throw metadata"))
  assert.ok(services.includes("A member-local generic parameter is allowed"))
  assert.ok(services.includes("a concrete service inside a generic function is also allowed"))
  assert.ok(chapter("900-appendices").includes("service whose resolved member contracts capture an outer type parameter"))
})
