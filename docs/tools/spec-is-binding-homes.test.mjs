import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("is bindings have a home in every head and initializer, and reads before assignment are checked", () => {
  const match = chapter("004-match")
  for (const text of [
    "These bindings take part in TypeScript's definite-assignment and use-before-declaration checks",
    "because short-circuiting skipped it or the pattern failed before reaching it, is `TS2454`",
    "a read before the binding's position in its scope is `TS2448`",
    "// @ts-expect-error: TS2454, short-circuiting skipped the binding's initialization",
    "// @ts-expect-error: TS2454, the successful condition skipped initialization",
    "Its direct reads precede the binding, so they are `TS2448`",
    "CreatePerIterationEnvironment copies a `let` binding into each iteration",
    "A binding from `test` or `update` is a fresh, uninitialized cell",
    "is copied into each iteration's binding environment; a skipped binding is copied uninitialized",
    "In a concise arrow body, a binding belongs to the arrow body's scope",
    "a binding belongs to that initializer's own scope",
  ]) assert.ok(match.includes(text), text)
  assert.ok(!match.includes("} // Die(ReferenceError): short-circuiting skipped"))
  assert.match(read("docs/design/vips/0007-match.md"), /the other binding homes, and use before assignment/)
  const guide = read("docs/user/src/vibelang-features/116-match-and-is.md")
  assert.ok(guide.includes("may not have run is TypeScript's `TS2454`"))
  assert.ok(!guide.includes("Reading it before then throws `ReferenceError`."))
  const result = run(block(match, "const loopHomesExit") + `
import { Exit } from "effect"
if (!Exit.isSuccess(loopHomesExit) || JSON.stringify(loopHomesExit.value) !== "[[1,2,3],[3,2,1]]") throw new Error("loop homes")
`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
