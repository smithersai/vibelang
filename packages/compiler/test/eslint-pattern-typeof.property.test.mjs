import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree, vibeVisitorKeys } from "../eslint.mjs"

const corpus = JSON.parse(readFileSync(new URL("./property-regressions/opencode-match-generated-typeof.json", import.meta.url)))
function nodes(tree) {
  const out = []
  const visit = value => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) return value.forEach(visit)
    if (value.type) out.push(value)
    for (const [key, child] of Object.entries(value)) if (!["tokens", "comments", "range", "loc"].includes(key)) visit(child)
  }
  visit(tree)
  return out
}
const operators = tree => nodes(tree).filter(node => node.type === "UnaryExpression" && node.operator === "typeof")

test("Opencode record matching exposes no generated typeof operators to source lint rules", () => {
  const tree = parseESTree(corpus.source, "/probe.vibe")
  assert.deepEqual(operators(tree), [])
  assert.ok(nodes(tree).some(node => node.type === "Identifier" && node.name === "ready" && node.synthesized !== true))
})

test("property: match and is patterns hide generated type tests while preserving written operators", () => {
  fc.assert(fc.property(
    fc.constantFrom("", "// café 😀\n", "/* 😀 */\r\n"),
    fc.constantFrom("vibe", "vibex"),
    fc.constantFrom('{ tag: "ok", let value }', '{ nested: { let value } }', "String(let value)", "Number(let value)", '{ [typeof subject]: let value }'),
    fc.boolean(), fc.boolean(),
    (prefix, extension, pattern, isExpression, explicit) => {
      const result = explicit ? "typeof value" : "value"
      const source = prefix + (isExpression
        ? "export function f(subject) { if (subject is " + pattern + ") return " + result + "; return null; }"
        : "export function f(subject) { return match (subject) { when " + pattern + ": " + result + "; default: null; } }")
      const tree = parseESTree(source, "/probe." + extension)
      const expected = Number(explicit) + Number(pattern.includes("typeof subject"))
      const written = operators(tree)
      assert.equal(written.length, expected, source)
      for (const node of written) assert.match(source.slice(...node.range), /^typeof\b/)
      const hidden = nodes(tree).filter(node => node.type === "VibePatternTypeTest")
      assert.ok(hidden.length > 0, source)
      assert.deepEqual(vibeVisitorKeys.VibePatternTypeTest, ["argument"])
      assert.ok(nodes(tree).some(node => node.type === "Identifier" && node.name === "value" && node.synthesized !== true))
    }
  ), { seed: 811085, numRuns: 100 })
})

test("ordinary TypeScript typeof remains a unary expression, including inside a module body", () => {
  const source = "export function f(value) { return typeof /* comment */ value }"
  for (const file of ["/probe.ts", "/probe.vibe", "/probe.vibex"]) {
    assert.equal(operators(parseESTree(source, file)).length, 1)
  }
  assert.equal(operators(parseESTree("module foreign { " + source + " }", "/probe.vibe")).length, 1)
})
