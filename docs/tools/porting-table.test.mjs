import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
const text = readFileSync(new URL("../user/src/vibelang-features/114-vibelang-for-effect-users.md", import.meta.url), "utf8")
test("porting table reads a service value member from the implementation", () => {
  const row = text.split("\n").find(line => line.startsWith("| `const users = yield* Users`"))
  assert.ok(row)
  assert.match(row, /const users = try Users/)
  assert.match(row, /users\.region/)
})
test("porting table distinguishes typed results from full causes", () => {
  const row = text.split("\n").find(line => line.startsWith("| `Effect.result(program)`"))
  assert.ok(row)
  assert.match(row, /try result\(program\)/)
  assert.match(text, /Defects and interruption propagate/)
  assert.match(text, /try exit\(program\)/)
  assert.match(text, /Exit\.Failure/)
})
