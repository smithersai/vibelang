// The corpus oracle must compare source identifier spellings with decoded AST
// names without exempting escaped identifiers from missing-node detection.
import assert from "node:assert/strict"
import fc from "fast-check"
import { test } from "node:test"
import { parseESTree } from "../eslint.mjs"
const { problems, walk } = await import(process.env.VIBELANG_ESLINT_TREE_MODULE ?? new URL("./eslint/tree.mjs", import.meta.url))

const keys = {
  Program: ["body"], VariableDeclaration: ["declarations"],
  VariableDeclarator: ["id", "init"], Identifier: [],
  FunctionDeclaration: ["id", "params", "body"], BlockStatement: ["body"],
  ReturnStatement: ["argument"], ObjectExpression: ["properties"],
  Property: ["key", "value"], MemberExpression: ["object", "property"],
  Literal: [], ClassDeclaration: ["id", "body"], ClassBody: ["body"],
  MethodDefinition: ["key", "value"], FunctionExpression: ["id", "params", "body"]
}
const forms = [
  (name) => `const ${name} = 1`,
  (name) => `function ${name}() { return 1 }`,
  (name) => `function read(${name}) { return ${name} }`,
  (name) => `const box = { ${name}: 1 }`,
  (name) => `const box = { ${name} }`,
  (name) => `class Box { ${name}() { return 1 } }`,
]
const spellings = [
  [String.raw`__pro\u0074o__`, "__proto__"],
  [String.raw`\u0061lpha`, "alpha"],
  [String.raw`caf\u00e9`, "café"],
  [String.raw`\u{10400}name`, "𐐀name"],
  [String.raw`\u006datch`, "match"],
  [String.raw`\u0065ffect`, "effect"],
  ["plain", "plain"],
]
function check(form, raw, name, prefix = "") {
  const code = prefix + form(raw)
  const ast = parseESTree(code, "/names.vibe")
  assert.deepEqual(problems(code, ast, keys), [], code)
  const identifiers = []
  walk(ast, (node) => {
    if (node.type === "Identifier" && node.name === name) identifiers.push(node)
  }, keys)
  assert.ok(identifiers.length, `missing decoded name ${name}: ${code}`)
  const start = identifiers[0].range[0]
  // Object shorthand may have two nodes at one position. Knock out every copy.
  for (const node of identifiers) if (node.range[0] === start) node.name = "knockedOut"
  assert.ok(problems(code, ast, keys).includes(`name ${raw} at ${start} has no node`), code)
}
for (const [index, form] of forms.entries()) {
  test(`escaped name oracle accepts decoded names and catches missing nodes, form ${index + 1}`, () => {
    for (const [raw, name] of spellings) check(form, raw, name, "// é😀\r\n")
  })
}
test("escaped name oracle: generated mixed Unicode spellings retain missing-node checks", () => {
  fc.assert(fc.property(
    fc.constantFrom(...forms),
    fc.array(fc.constantFrom("a", "b", "é", "λ", "𐐀"), { minLength: 1, maxLength: 12 }),
    fc.constantFrom("fixed", "braced", "mixed"),
    fc.constantFrom("", "// 😀\n", "\uFEFF\t"),
    (form, letters, style, prefix) => {
      const name = "user_" + letters.join("")
      const raw = [...name].map((letter, index) => {
        const point = letter.codePointAt(0)
        if (style === "mixed" && index % 2 === 0) return letter
        if (style === "braced" || point > 0xFFFF) return `\\u{${point.toString(16)}}`
        return `\\u${point.toString(16).padStart(4, "0")}`
      }).join("")
      check(form, raw, name, prefix)
    }
  ), { seed: 3497, numRuns: 80 })
})
