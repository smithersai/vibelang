// VIP-34: rules read source expressions, not constant-true bookkeeping.
// This native-only property runs in compiler-test without optional ESLint deps.
import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree, vibeVisitorKeys } from "../eslint.mjs"

function nodes(tree) {
  const found = []
  const visit = (value) => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) return value.forEach(visit)
    if (value.type) found.push(value)
    for (const [key, child] of Object.entries(value)) {
      if (!["tokens", "comments", "loc", "range"].includes(key)) visit(child)
    }
  }
  visit(tree)
  return found
}

const patterns = [
  (name) => `Exit.Failure(let ${name})`,
  (name) => `[let ${name}]`,
  (name) => `{ reason: let ${name} }`
]

test("generated pattern assignments hide only synthetic truthiness and retain assignment children", () => {
  fc.assert(fc.property(
    fc.constantFrom(...patterns), fc.constantFrom("x", "getValue()"),
    fc.constantFrom("", "// pattern\n", "/* 😀 */\r\n"),
    fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 12 }).map((letters) => "bound_" + letters.join("")),
    (pattern, subject, prefix, name) => {
      const code = `${prefix}function f(x) { if (${subject} is ${pattern(name)}) return ${name}; return (x = 1, true) && x }`
      const tree = parseESTree(code, "/pattern.vibe")
      const all = nodes(tree)
      const wrappers = all.filter((node) => node.type === "VibePatternAssignment")
      assert.ok(wrappers.length > 0, code)
      assert.deepEqual(vibeVisitorKeys.VibePatternAssignment, ["expression"])
      for (const wrapper of wrappers) {
        assert.equal(wrapper.expression.type, "AssignmentExpression")
        assert.equal(wrapper.expression.operator, "=")
      }
      const sequences = all.filter((node) => node.type === "SequenceExpression")
      assert.equal(sequences.length, 1, code)
      assert.equal(sequences[0].expressions.at(-1).value, true)
      assert.ok(code.slice(...sequences[0].range).includes("x = 1, true"))
      assert.ok(all.some((node) => node.type === "Identifier" && node.name === name && node.synthesized !== true))
    }
  ), { seed: 94, numRuns: 80 })
})

test("ordinary TypeScript and VibeLang comma expressions keep their constant result", () => {
  for (const filePath of ["/ordinary.ts", "/ordinary.vibe"]) {
    const all = nodes(parseESTree("function f(x) { return (x = 1, true) && x }", filePath))
    assert.equal(all.filter((node) => node.type === "VibePatternAssignment").length, 0)
    const sequence = all.find((node) => node.type === "SequenceExpression")
    assert.equal(sequence.expressions.at(-1).value, true)
  }
})
