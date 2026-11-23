import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { Linter } from "eslint"
import unicorn from "eslint-plugin-unicorn"
import fc from "fast-check"
import parser from "../../eslint.mjs"
import { walk } from "./tree.mjs"

const rule = "unicorn/prevent-abbreviations"
const config = [{
  files: ["**/*.vibe", "**/*.vibex"],
  languageOptions: { parser },
  plugins: { unicorn },
  rules: {
    [rule]: ["error", {
      extendDefaultReplacements: false,
      replacements: { cfg: { configuration: true }, msg: { message: true } },
      checkFilenames: false,
    }],
  },
}]

// Keep the two bindings in separate declarations. An ESLint rule can merge
// all edits for one binding into a single fix spanning its references.
const forms = {
  schema: (id, name, value, variant) => `schema ${name} /* field type */ ${variant ? "= string[]" : "{ value: string }"}
export const entry${id} = [${name}, ${value}]`,
  data: (id, name, value, variant) => `data Choice${id} { None; Some { value: ${variant ? "number" : "string"} } }
export function read${id}(${name}: Choice${id}) { return [${name}._tag, ${value}] }`,
  service: (id, name, value, variant) => `service Store${id} { read(value: string): ${variant ? "string!!" : "string"} }
export effect function read${id}() { const ${name} = try Store${id}; return ${name}.read(${value}) }`,
  effect: (id, name, value, variant) => `export effect function read${id}(${name}: string) {
  const result = try ${variant ? "succeed" : "sync"}(${variant ? name : "() => " + name})
  return [result, ${value}]
}`,
  match: (id, name, value, variant) => `export function read${id}(${name}: string) {
  return match (${name}) { when ${value}: ${variant ? name : value}; default: ${name}; }
}`,
  jsx: (id, name, value, variant) => `export function View${id}(${name}: string) {
  return ${variant ? "<>" : ""}<span title={${value}}>{${name}}</span>${variant ? "</>" : ""}
}`,
}

const layout = fc.record({
  prefix: fc.constantFrom("", "// header\n", "/* 🙂 */\n"),
  newline: fc.constantFrom("\n", "\r\n"),
  indent: fc.constantFrom("  ", "\t", "    "),
  value: fc.string({ maxLength: 12 }),
  variant: fc.boolean(),
  reverse: fc.boolean(),
})

function program(form, input, fixed) {
  const names = fixed ? ["configuration", "message"] : ["cfg", "msg"]
  if (input.reverse) names.reverse()
  // Quote as JavaScript source, including line separators inside the value.
  const value = JSON.stringify(input.value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")
  return (input.prefix + form("One", names[0], value, input.variant) + "\n" +
    form("Two", names[1], value, !input.variant) + "\n")
    .replace(/^  /gm, input.indent).replaceAll("\n", input.newline)
}

function checkRanges({ ast, visitorKeys }, text) {
  walk(ast, (node, parent) => {
    const [start, end] = node.range
    assert.ok(Number.isInteger(start) && Number.isInteger(end) && start >= 0 &&
      start <= end && end <= text.length, `${node.type} has invalid range [${start}, ${end}]`)
    if (parent) {
      assert.ok(parent.range[0] <= start && end <= parent.range[1],
        `${parent.type} [${parent.range}] does not contain ${node.type} [${node.range}]`)
    }
  }, visitorKeys)
}

for (const [kind, form] of Object.entries(forms)) {
  const filename = fileURLToPath(new URL(kind === "jsx" ? "./view.vibex" : "./forms.vibe", import.meta.url))
  test(`${kind} nodes stay inside their parents`, () => {
    fc.assert(fc.property(layout, (input) => {
      const code = program(form, input, false)
      checkRanges(parser.parseForESLint(code, { filePath: filename }), code)
    }), { seed: 625, numRuns: 20 })
  })

  test(`${kind} ESLint renames apply in one pass to independent bindings`, () => {
    fc.assert(fc.property(layout, (input) => {
      const code = program(form, input, false)
      const linter = new Linter({ configType: "flat", cwd: "/" })
      const messages = linter.verify(code, config, { filename })
      assert.deepEqual(messages.map((message) => message.ruleId), [rule, rule], JSON.stringify(messages))
      const edits = messages.map((message) => message.fix).sort((a, b) => a.range[0] - b.range[0])
      let cursor = 0
      let fixed = ""
      for (const { range: [start, end], text } of edits) {
        assert.ok(cursor <= start && start < end && end <= code.length, `invalid or overlapping edit [${start}, ${end}]`)
        fixed += code.slice(cursor, start) + text
        cursor = end
      }
      fixed += code.slice(cursor)
      assert.equal(fixed, program(form, input, true))
      assert.deepEqual(linter.verify(fixed, config, { filename }), [])
    }), { seed: 625, numRuns: 20 })
  })
}

test("editing an unfinished form returns a tree or a located syntax diagnostic", () => {
  fc.assert(fc.property(fc.constantFrom(...Object.keys(forms)), layout, fc.nat(), (kind, input, offset) => {
    const filePath = fileURLToPath(new URL(kind === "jsx" ? "./view.vibex" : "./forms.vibe", import.meta.url))
    const complete = program(forms[kind], input, false)
    const text = complete.slice(0, offset % complete.length)
    let parsed
    try {
      parsed = parser.parseForESLint(text, { filePath })
    } catch (error) {
      assert.ok(error instanceof SyntaxError, String(error))
      assert.ok(Number.isInteger(error.index) && error.index >= 0 && error.index <= text.length,
        `invalid diagnostic offset ${error.index}`)
      return
    }
    checkRanges(parsed, text)
  }), { seed: 450, numRuns: 36 })
})
