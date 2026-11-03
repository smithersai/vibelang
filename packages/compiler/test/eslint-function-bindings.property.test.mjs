// Written function bindings must not inherit contextual syntax exemptions.
import assert from "node:assert/strict"
import fc from "fast-check"
import { test } from "node:test"
import { parseESTree } from "../eslint.mjs"
const { problems, walk } = await import(process.env.VIBELANG_ESLINT_TREE_MODULE ?? new URL("./eslint/tree.mjs", import.meta.url))

// Fall back to walking native node fields; explicitly list leaf node types too.
function keysFor(ast) {
  const keys = {}
  walk(ast, (node) => { keys[node.type] = [...new Set([
    ...(keys[node.type] ?? []), ...Object.keys(node).filter((key) =>
      !["parent", "loc", "range"].includes(key))
  ])] }, {})
  return keys
}
const forms = [
  (name) => `function ${name}() { return 1 }`,
  (name) => `export default effect function ${name}() { return 1 }`,
  (name) => `const f = function* ${name}() { yield 1 }`,
  (name) => `declare function ${name}(value: number): number`,
  (name) => `function read(${name}: number, other: string) { return 1 }`,
  (name) => `effect function read(other: number, ${name} = 1) { return 1 }`,
  (name) => `const f = (${name}: number) => 1`,
  (name) => `const f = ${name} => 1`,
  (name) => `const f = effect (other: number, ${name}: number) => 1`,
  (name) => `const box = { effect read(${name}: number) { return 1 } }`,
  (name) => `class Box { static effect read(${name}: number) { return 1 } }`,
  (name) => `function read({ value: ${name} }, [other], ...rest) { return 1 }`,
]
const names = ["match", "service", "when", "is", "async", "type", "String", "effect"]
const prefixes = ["", "/* 😀 */\r\n\uFEFF"]
function check(form, name, prefix = "", comment = "") {
  const code = prefix + form(comment + name)
  const ast = parseESTree(code, "/function-bindings.vibe")
  const keys = keysFor(ast)
  assert.deepEqual(problems(code, ast, keys), [], code)
  const bindings = []
  walk(ast, (node, parent) => {
    if (node.type === "Identifier" && node.name === name) bindings.push([node, parent])
  }, keys)
  assert.equal(bindings.length, 1, code)
  const [identifier, parent] = bindings[0]
  const start = identifier.range[0]
  const expected = `name ${name} at ${start} has no node`
  identifier.name = "knockedOut"
  assert.ok(problems(code, ast, keys).includes(expected), "renamed: " + code)
  identifier.name = name
  // Remove the whole child, including a sole or final parameter.
  for (const key of Object.keys(parent)) {
    if (parent[key] === identifier) parent[key] = null
    else if (Array.isArray(parent[key])) parent[key] = parent[key].filter((child) => child !== identifier)
  }
  assert.ok(problems(code, ast, keys).includes(expected), "removed: " + code)
}
for (const [index, form] of forms.entries()) {
  test("function binding oracle detects renamed and removed nodes, form " + (index + 1), () => {
    for (const name of names) for (const prefix of prefixes) check(form, name, prefix)
  })
}
test("generated contextual function bindings retain missing-node checks", () => {
  fc.assert(fc.property(
    fc.constantFrom(...forms), fc.constantFrom(...names), fc.constantFrom(...prefixes),
    fc.constantFrom("", "/* binding */ ", "// binding\n"),
    (form, name, prefix, comment) => check(form, name, prefix, comment)
  ), { seed: 150, numRuns: 160 })
})
test("type syntax, default expressions and lowered forms keep their exemptions", () => {
  for (const code of [
    "function read(value: readonly number[] = []) { return 1 }",
    "function read<T extends (value: number) => string>(value: T) { return 1 }",
    "function read(value: Map<string, number>, other = match (value) { when 1: 2; default: 0; }) { return 1 }",
    "function read(value = effect { return 1 }) { return 1 }",
    "function read(value: { [key: string]: number }) { return 1 }",
    "const f = async (value: number) => value",
    "const f = async => 1",
    "const f = effect { return 1 }",
    "const result = match (value) { when 1: 2; default: 0; }",
    "const result = value is { count: let count }",
    "effect function read() { for concurrent (const value of [1]) { try succeed(value) } }",
    "effect function read() { for concurrent (const value of (read = (): number => 1, [1])) {} }",
    "effect function read() { for concurrent (const value of ((0 is let n), [1])) {} }",
    "effect function read() { for try (const value of stream) { try succeed(value) } }",
    "const box = { get value() { return 1 }, set value(service: number) {} }",
    "class Box { constructor(public service: number, readonly match = 1) {} }",
  ]) {
    const ast = parseESTree(code, "/function-controls.vibe")
    assert.deepEqual(problems(code, ast, keysFor(ast)), [], code)
  }
})
