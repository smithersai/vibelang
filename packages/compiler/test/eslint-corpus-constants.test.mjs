// Native guard, run by compiler-test even without the optional ESLint install.
import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree } from "../eslint.mjs"
import { sourceLiteralAtNode } from "./eslint/tree.mjs"

function nodes(tree) {
  if (!tree || typeof tree !== "object") return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [...(tree.type ? [tree] : []), ...Object.entries(tree)
    .filter(([key]) => !["tokens", "comments", "range", "loc"].includes(key)).flatMap(([, value]) => nodes(value))]
}

const literal = fc.oneof(
  fc.boolean().map(String),
  fc.integer({ min: 0, max: 100_000 }).map(String),
  fc.integer({ min: 0, max: 100_000 }).map((n) => "0x" + n.toString(16)),
  fc.integer({ min: 0, max: 100_000 }).map((n) => n + "n"),
  fc.constantFrom("\"yes\"", "\"\"", "\"\\u0079es\"", "null", "/yes/u", "1e3", "0b10", "0o12")
)
const prefix = fc.constantFrom("", "// condition\n", "/* 😀 */\r\n", "\uFEFF\t", "/* é */\u2028")
const message = { nodeType: "Literal" }

function check(code) {
  const all = nodes(parseESTree(code, "/condition.vibe"))
  const condition = all.find((node) => node.type === "IfStatement").test
  assert.equal(sourceLiteralAtNode(message, condition, code), true, code)
  assert.equal(sourceLiteralAtNode(message, { ...condition, synthesized: true }, code), false)
  assert.equal(sourceLiteralAtNode(message, { ...condition, raw: "notWritten" }, code), false)
  assert.equal(sourceLiteralAtNode(message, { ...condition, range: [0, 0] }, code), false)
  assert.equal(sourceLiteralAtNode({ nodeType: "LogicalExpression" }, condition, code), false)
}

test("source literal conditions retain literal provenance at UTF-16 offsets", () => {
  for (const raw of ["true", "false", "0", "1n", "0xFF", "\"yes\"", "/yes/u"]) {
    check("/* 😀 */\r\nif (" + raw + ") { void 1 }")
  }
})

test("generated literal spellings never excuse synthesized or unwritten nodes", () => {
  fc.assert(fc.property(literal, prefix, (raw, before) => check(before + "if ((" + raw + ")) { void 1 }")), { seed: 102, numRuns: 100 })
})

test("synthetic pattern constants and unknown expression diagnostics remain failures", () => {
  const code = "const v = (x is let w) ? w : 0"
  const all = nodes(parseESTree(code, "/condition.vibe"))
  const condition = all.find((node) => node.type === "ConditionalExpression").test
  assert.equal(sourceLiteralAtNode({ nodeType: condition.type }, condition, code), false)
  // On main this is a generated true. A source-preserving exporter may remove
  // it entirely; any that remain must still be rejected by the oracle.
  for (const node of all.filter((node) => node.type === "Literal" && node.value === true)) {
    assert.equal(sourceLiteralAtNode(message, node, code), false)
  }
  for (const node of [undefined, {}, { type: "Literal", raw: "true", range: [0, 4] }]) {
    assert.equal(sourceLiteralAtNode(message, node, code), false)
  }
})
