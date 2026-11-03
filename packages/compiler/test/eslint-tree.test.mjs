// The name oracle must distinguish contextual effect syntax from a user name.
// These cases use the native exporter without the optional ESLint install, so
// this check runs in compiler-test even while unrelated ESLint defects remain.
import assert from "node:assert/strict"
import fc from "fast-check"
import { test } from "node:test"
import { parseESTree } from "../eslint.mjs"
import { problems, walk } from "./eslint/tree.mjs"

// The typescript-eslint visitor keys for the small grammar generated below.
const keys = {
  Program: ["body"], ExportNamedDeclaration: ["declaration", "specifiers"],
  ExportDefaultDeclaration: ["declaration"],
  FunctionDeclaration: ["id", "params", "body"], FunctionExpression: ["id", "params", "body"],
  ArrowFunctionExpression: ["params", "body"], BlockStatement: ["body"],
  ReturnStatement: ["argument"], Identifier: [], Literal: [],
  VariableDeclaration: ["declarations"], VariableDeclarator: ["id", "init"],
  ObjectExpression: ["properties"], Property: ["key", "value"],
  ClassDeclaration: ["id", "body"], ClassBody: ["body"], MethodDefinition: ["key", "value"],
  // An effect block is a program value: the synthesized $effect builder call
  // around its lexical arrow (23723b612c20, VIP-2).
  CallExpression: ["callee", "arguments"]
}
const forms = [
  (name) => `effect function ${name}() { return 1 }`,
  (name) => `export effect function ${name}() { return 1 }`,
  (name) => `export default effect function ${name}() { return 1 }`,
  (name) => `const ${name} = effect function () { return 1 }`,
  (name) => `const ${name} = effect () => 1`,
  (name) => `const ${name} = effect { return 1 }`,
  (name) => `const box = { effect ${name}() { return 1 } }`,
  (name) => `class Box { effect ${name}() { return 1 } }`,
  (name) => `class Box { static effect ${name}() { return 1 } }`,
  (name) => `const ${name} = 1`,
  (name) => `function ${name}() { return 1 }`,
  (name) => `const load = (${name}) => ${name}`
]
const prefixes = ["", "// modifier neighbour\n", "/* 😀 */\r\n", "\uFEFF\t"]

for (const [index, form] of forms.entries()) {
  test(`effect name oracle: form ${index + 1} preserves syntax and detects a missing user name`, () => {
    for (const prefix of prefixes) {
      for (const name of ["load", "effect", "éclair"]) {
        const code = prefix + form(name)
        const ast = parseESTree(code, "/oracle.vibe")
        assert.deepEqual(problems(code, ast, keys), [], code)
        // Knock out all copies at one written name (shorthand can share a range).
        const identifiers = []
        walk(ast, (node) => {
          if (node.type === "Identifier" && node.name === name) identifiers.push(node)
        }, keys)
        assert.ok(identifiers.length, code)
        const start = identifiers[0].range[0]
        for (const node of identifiers) if (node.range[0] === start) node.name = "knockedOut"
        assert.ok(problems(code, ast, keys).includes(`name ${name} at ${start} has no node`), code)
      }
    }
  })
}

test("effect name oracle: generated modifiers never hide missing ordinary names", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: forms.length - 1 }),
    fc.constantFrom(...prefixes),
    fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 16 }).map((letters) => "user_" + letters.join("")),
    (index, prefix, name) => {
      const code = prefix + forms[index](name)
      const ast = parseESTree(code, "/generated.vibe")
      assert.deepEqual(problems(code, ast, keys), [], code)
      walk(ast, (node) => { if (node.type === "Identifier" && node.name === name) node.name = "knockedOut" }, keys)
      assert.ok(problems(code, ast, keys).some((problem) => problem.startsWith(`name ${name} at `)), code)
    }
  ), { seed: 93, numRuns: 80 })
})
