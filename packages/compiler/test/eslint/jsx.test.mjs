import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Linter } from "eslint"
import tseslint from "typescript-eslint"
import react from "eslint-plugin-react"
import hooks from "eslint-plugin-react-hooks"
import solid from "eslint-plugin-solid"
import fc from "fast-check"
import vibelang, { parseForESLint } from "../../eslint.mjs"
import { compile } from "../../knip.mjs"
import { jsxFixtures } from "./jsx-fixtures.mjs"
import { jsxParts, reference } from "./jsx-golden.mjs"

const fixturePath = name => new URL("./" + name, import.meta.url).pathname

for (const [name, code] of Object.entries(jsxFixtures)) {
  test(`JSX tree, tokens and comments match the TSX oracle: ${name}`, () => {
    const expected = jsxParts(reference(code))
    for (const extension of ["vibex", "tsx"]) {
      const { ast, visitorKeys } = parseForESLint(code, { filePath: fixturePath(`fixture.${extension}`) })
      assert.deepEqual(jsxParts(ast), expected)
      for (const type of ["JSXElement", "JSXFragment", "JSXNamespacedName", "JSXSpreadChild"]) assert.ok(visitorKeys[type], type)
    }
  })
}

const lint = (code, extension, rules, parserOptions = {}) => new Linter({ cwd: "/" }).verify(code, [{
  files: ["**/*.{vibex,tsx}"],
  languageOptions: { parser: extension === "tsx" ? tseslint.parser : vibelang,
    parserOptions: { ecmaFeatures: { jsx: true }, ...parserOptions } },
  plugins: { react, "react-hooks": hooks, solid, "@typescript-eslint": tseslint.plugin },
  settings: { react: { version: "18.3" } },
  rules
}], { filename: fixturePath(`fixture.${extension}`) }).map(m => ({
  ruleId: m.ruleId, messageId: m.messageId, message: m.message, severity: m.severity,
  line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, fatal: m.fatal
}))

const lintFixtures = [
  ["classic factory", 'import React from "react"; export const View = () => <div/>;', { "@typescript-eslint/no-unused-vars": "error" }, 0],
  ["react/ jsx-key", "const el = [<li>one</li>, <li>two</li>];", { "react/jsx-key": "error" }, 2],
  ["hooks", "function View({ ok }) { if (ok) useState(0); return <div/> }", { "react-hooks/rules-of-hooks": "error" }, 1],
  ["solid props", "function View({ name }) { return <div>{name}</div> }", { "solid/no-destructure": "error" }, 1],
  ["tag references", 'import { Box } from "./box"; import * as UI from "./ui"; const View = () => <Box><UI.Button/></Box>; export default View;',
    { "@typescript-eslint/no-unused-vars": "error" }, 0],
  ["JSX disable comment", "const el = <ul>{\n// eslint-disable-next-line react/jsx-key\n[<li>one</li>]}</ul>;", { "react/jsx-key": "error" }, 0]
]
for (const [name, code, rules, count] of lintFixtures) {
  test(`JSX ESLint plugins match TSX: ${name}`, () => {
    const expected = lint(code, "tsx", rules)
    assert.equal(expected.length, count, JSON.stringify(expected))
    assert.ok(expected.every(m => !m.fatal && m.ruleId), JSON.stringify(expected))
    assert.deepEqual(lint(code, "vibex", rules), expected)
  })
}

test("Knip counts JSX tag references, including namespace members", () => {
  const code = 'import { Box } from "./box"; import * as UI from "./ui"; export const View = () => <Box><UI.Forms.Button/><div/></Box>;'
  const output = compile(code, "/View.vibex")
  assert.match(output, /\nBox\n/)
  assert.match(output, /\nUI.Forms.Button\n/)
  assert.doesNotMatch(output, /\ndiv\n/)
})

// VIP-39, "The file kind": "Renaming x.tsx to x.vibex changes nothing
// in its JSX" (inline code delimiters checked below). The independent TSX parser is
// the oracle; generated text, entities, names, spreads and nesting vary
// together. A fixed seed makes the regression reproducible.
test("generated JSX neighbourhood agrees with TypeScript-ESTree", () => {
  const quote = "Renaming " + String.fromCharCode(96) + "x.tsx" + String.fromCharCode(96) + " to " + String.fromCharCode(96) + "x.vibex" + String.fromCharCode(96) + " changes nothing in its JSX"
  assert.ok(readFileSync(new URL("../../../../docs/design/vips/0039-vibex.md", import.meta.url), "utf8").includes(quote), "VIP-39 oracle quote changed")
  const name = fc.constantFrom("Box", "UI.Box", "UI.Forms.Box", "div", "my-widget", "svg:path")
  const text = fc.constantFrom("", "  ", "\r\n é😀 &amp; text ", "/* text */ // text", "&copy; &#x1f600; &unknown;")
  const attribute = fc.constantFrom("", ' disabled data-name="&quot;😀"', ' value={x} {...props}', ' xml:lang="en"')
  fc.assert(fc.property(name, text, attribute, fc.boolean(), (tag, content, attributes, wrap) => {
    const element = `<${tag}${attributes}>${content}{/* comment */}{value}{...children}<b/></${tag}>`
    const code = `const el = ${wrap ? "<>" + element + "</>" : element};`
    assert.deepEqual(jsxParts(parseForESLint(code, { filePath: fixturePath("generated.vibex") }).ast), jsxParts(reference(code)))
  }), { seed: 3910, numRuns: 100 })
})

test("VibeLang forms in JSX retain ESLint traversal and scopes", () => {
  const code = "effect function View() { const value = 1; return <Box>{value |> % + 1}{try load()}</Box> }"
  const { ast, visitorKeys } = parseForESLint(code, { filePath: fixturePath("View.vibex") })
  const types = new Set()
  const walk = node => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type) types.add(node.type)
    for (const key of visitorKeys[node.type] ?? []) walk(node[key])
  }
  walk(ast)
  for (const type of ["JSXElement", "JSXExpressionContainer", "VibePipeExpression", "TopicReference", "CallExpression"]) assert.ok(types.has(type), type)
})

test("JSX pragma and fragment scope options match TypeScript", () => {
  const code = 'import { h, Fragment } from "runtime"; export const View = () => <><div/></>;'
  const rules = { "@typescript-eslint/no-unused-vars": "error" }
  const options = { jsxPragma: "h", jsxFragmentName: "Fragment" }
  assert.deepEqual(lint(code, "tsx", rules, options), [])
  assert.deepEqual(lint(code, "vibex", rules, options), [])
  const automatic = 'import React from "react"; export const View = () => <div/>;'
  const expected = lint(automatic, "tsx", rules, { jsxPragma: null })
  assert.equal(expected.length, 1)
  assert.deepEqual(lint(automatic, "vibex", rules, { jsxPragma: null }), expected)
})

test("generated JSX numeric and named entities preserve JavaScript strings", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 0x110020 }),
    fc.constantFrom("amp", "apos", "copy", "notin", "NotEqualTilde", "unknown"),
    fc.boolean(),
    (codePoint, name, hex) => {
      const entity = hex ? `&#x${codePoint.toString(16)};` : `&#${codePoint};`
      const code = `const el = <p title="${entity} &${name};">${entity} &${name}; &amp;lt;</p>;`
      assert.deepEqual(jsxParts(parseForESLint(code, { filePath: fixturePath("entities.vibex") }).ast), jsxParts(reference(code)))
    }
  ), { seed: 3911, numRuns: 100 })
})
