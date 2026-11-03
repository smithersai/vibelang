import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

// VIP-4, amended 2026-10-31 (Will: "If you throw in vibelang itself in a sync function that's an error"):
// a .vibe callable has thrown type never, so overloads, declaration output and callbacks carry no inferred contract.
test("a local .vibe implementation throws never, so its body sets no overload bound", () => {
  const failures = chapter("003-failures")
  assert.match(failures, /A callable declared in VibeLang \(`\.vibe` or `\.vibex`, outside a `module` body\) has thrown type `never`\. Nothing is inferred from a body\./)
  assert.match(failures, /A `throw` statement is `EK0401`, even when a `try` statement in the same function catches it\./)
  assert.doesNotMatch(chapter("001-functions"), /A written `@throws \{T\}` is a checked upper bound/)
})

test("declaration output writes @throws {never} on .vibe call signatures and no @rethrows", () => {
  const text = chapter("001-functions")
  assert.match(text, /\*\*Thrown types\.\*\* A `\.vibe` callable throws `never` \(\[Thrown types\]\(003-failures\.md#thrown-types\)\), so the output states the same on every call signature it emits other than an effectful one/)
  assert.doesNotMatch(text, /A written `@throws \{T\}` is a checked upper bound/)
  assert.doesNotMatch(text, /admitted thrown bound of `unknown`/)
  // A `module` body is TypeScript (VIP-40), so its tags are foreign contracts.
  for (const m of text.matchAll(/```vibe es\n([\s\S]*?)```/g)) {
    assert.doesNotMatch(m[1].replace(/^\s*(export\s+)?module\s+[\w$]+\s*\{[\s\S]*?^\}/gm, ""), /@throws|@rethrows/)
  }
  assert.match(chapter("003-failures"), /A written `@throws` or `@rethrows` tag there, on a function, service member or function-type signature, is `EK0406`/)
})

test("the printed references distinguish a hidden synchronous throw, an unwrapped callback defect and a wrapped failure", () => {
  const result = run(block(chapter("001-functions"), "// Callable-contract reference witnesses"))
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [["Die", "boom"], ["Die", "callback"], ["Fail", "callback"]])
})
