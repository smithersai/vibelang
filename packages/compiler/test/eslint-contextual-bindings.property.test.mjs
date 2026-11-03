// A form word used as an ordinary variable name still needs a written node.
import assert from "node:assert/strict"
import fc from "fast-check"
import { test } from "node:test"
import { parseESTree } from "../eslint.mjs"
const { problems, walk } = await import(process.env.VIBELANG_ESLINT_TREE_MODULE ?? new URL("./eslint/tree.mjs", import.meta.url))

const keys = {
  Program: ["body"], ExportNamedDeclaration: ["declaration", "specifiers"],
  VariableDeclaration: ["declarations"], VariableDeclarator: ["id", "init"],
  Identifier: [], Literal: [], TSTypeAnnotation: ["typeAnnotation"], TSNumberKeyword: [],
  FunctionDeclaration: ["id", "params", "body"], BlockStatement: ["body"],
  ForStatement: ["init", "test", "update", "body"], EmptyStatement: [],
  ForOfStatement: ["left", "right", "body"], ArrayExpression: ["elements"],
  CallExpression: ["callee", "arguments"], ArrowFunctionExpression: ["params", "body"],
  BinaryExpression: ["left", "right"], IfStatement: ["test", "consequent", "alternate"],
  ReturnStatement: ["argument"],
}
const words = [
  "error", "service", "control", "schema", "data", "layer", "mutable", "match", "when", "and", "or", "not",
  "provide", "fork", "join", "is", "handle", "uninterruptible", "restore", "interruptible",
  "concurrent", "all", "allSettled", "any", "race", "select",
  "async", "get", "type", "from", "String", "Number", "Cause",
]
const forms = [
  (name) => "const " + name + " = 1",
  (name) => "let " + name + " = 1",
  (name) => "var " + name + " = 1",
  (name) => "export const " + name + " = 1",
  (name) => "declare const " + name + ": number",
  (name) => "const first = 0, " + name + " = 1",
  (name) => "function read() { const " + name + " = 1 }",
  (name) => "for (let " + name + " = 1; false;) ;",
  (name) => "for (const " + name + " of []) ;",
  (name) => "const " + name + " = match (value) { when 1: 2; default: 0; }",
  (name) => "const " + name + " = effect { return 1 }",
]
const prefixes = ["", "// contextual neighbour\n", "/* 😀 */\r\n", "\uFEFF\t"]

function check(form, name, prefix = "") {
  const code = prefix + form(name)
  const ast = parseESTree(code, "/bindings.vibe")
  assert.deepEqual(problems(code, ast, keys), [], code)
  const declarations = []
  walk(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id?.name === name) declarations.push(node)
  }, keys)
  assert.equal(declarations.length, 1, code)
  const declaration = declarations[0]
  const identifier = declaration.id
  const start = identifier.range[0]
  const expected = "name " + name + " at " + start + " has no node"
  identifier.name = "knockedOut"
  assert.ok(problems(code, ast, keys).includes(expected), "renamed identifier: " + code)
  identifier.name = name
  declaration.id = null
  assert.ok(problems(code, ast, keys).includes(expected), "removed identifier: " + code)
}

for (const [index, form] of forms.entries()) {
  test("contextual binding oracle catches renamed and removed nodes, form " + (index + 1), () => {
    for (const word of words) for (const prefix of prefixes) check(form, word, prefix)
  })
}
test("generated contextual declaration neighbours retain their missing-node checks", () => {
  fc.assert(fc.property(
    fc.constantFrom(...forms), fc.constantFrom(...words), fc.constantFrom(...prefixes),
    fc.constantFrom("", "/* binding */ ", "// binding\n"),
    (form, word, prefix, comment) => check((name) => form(comment + name), word, prefix)
  ), { seed: 147, numRuns: 120 })
})

test("lowered match temporaries retain syntax-word exemptions", () => {
  for (const prefix of prefixes) {
    const code = prefix + "const result = match (value) { when 1: 2; default: 0; }"
    const ast = parseESTree(code, "/match.vibe")
    const lowered = []
    walk(ast, (node) => {
      if (node.type === "VariableDeclarator" && code.slice(...node.range).startsWith("match")) lowered.push(node)
    }, keys)
    assert.ok(lowered.length, "the native fixture must exercise the lowered temporary")
    assert.deepEqual(problems(code, ast, keys), [], code)
  }
})
