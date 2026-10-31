// Rerunning setup on a repository an earlier release set up (opencode,
// Smithers): the earlier setup wrote `"vibelang": { "declarationSidecars": true }`,
// which the compiler now rejects (TS5023), and setup removes it again.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { removeVibeLangSetting } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const quote = "The retired `declarationSidecars` option is an error."
const cli = new URL("../../../../docs/user/src/setup/vibelang-cli.md", import.meta.url)

// The writer earlier setups ran, addVibeLangSetting in lib/wire.mjs before
// 537d4233dd58 retired the setting, verbatim.
function earlierSetupWrote(text, key, value) {
  const file = ts.parseJsonText("tsconfig.json", text)
  const root = file.statements[0]?.expression
  if (!root || !ts.isObjectLiteralExpression(root)) throw new Error("not a tsconfig object")
  const property = (object, name) => object.properties.find((p) => ts.isPropertyAssignment(p) && p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) && p.name.text === name)
  const options = property(root, "compilerOptions")
  const settings = property(root, "vibelang") ?? (options && ts.isObjectLiteralExpression(options.initializer) ? property(options.initializer, "vibelang") : undefined)
  const entry = `"${key}": ${JSON.stringify(value)}`
  if (settings) {
    const object = settings.initializer
    if (!ts.isObjectLiteralExpression(object)) throw new Error("the tsconfig's vibelang setting is not an object")
    if (property(object, key)) return text
    const at = object.getStart(file) + 1
    return text.slice(0, at) + (object.properties.length ? ` ${entry},` : ` ${entry} `) + text.slice(at)
  }
  const indent = /\n([ \t]+)\S/.exec(text.slice(root.getStart(file) + 1))?.[1] ?? "  "
  const last = root.properties.at(-1)
  if (!last) {
    const at = root.getStart(file) + 1
    return text.slice(0, at) + `\n${indent}"vibelang": { ${entry} }\n` + text.slice(at)
  }
  return text.slice(0, last.end) + `,\n${indent}"vibelang": { ${entry} }` + text.slice(last.end)
}

const parse = (text) => {
  const { config, error } = ts.parseConfigFileTextToJson("tsconfig.json", text)
  assert.equal(error, undefined, text)
  return config
}

const option = fc.constantFrom('"strict": true', '"module": "NodeNext"', '"outDir": "dist"', '"rewriteRelativeImportExtensions": true', '"paths": { "~/*": ["./src/*"] }')
const comment = fc.constantFrom("", " // keep", " /* block */")
const tsconfig = fc.record({
  indent: fc.constantFrom("  ", "    ", "\t"),
  options: fc.uniqueArray(option, { maxLength: 3 }),
  comment,
  include: fc.boolean(),
  extends: fc.boolean(),
  // An existing VibeLang object: none, top-level, or under compilerOptions, with other members.
  holder: fc.constantFrom("none", "top", "compilerOptions"),
  holderName: fc.constantFrom("vibelang", "vibe"),
  members: fc.uniqueArray(fc.constantFrom('"effectGlobals": false', '"tracing": "none"', '"severities": { "EK0801": "warning" }'), { minLength: 1, maxLength: 2 }),
  newline: fc.boolean()
})

function render(input) {
  const i = input.indent
  const holder = `"${input.holderName}": { ${input.members.join(", ")} }`
  const options = [...input.options, ...(input.holder === "compilerOptions" ? [holder] : [])]
  const top = [
    ...(input.extends ? ['"extends": "../../tsconfig.base.json"'] : []),
    `"compilerOptions": {${options.length ? `\n${options.map((o) => i + i + o).join(",\n")}${input.comment}\n${i}` : ""}}`,
    ...(input.include ? ['"include": ["src/**/*.ts", "src/**/*.vibe"]'] : []),
    ...(input.holder === "top" ? [holder] : [])
  ]
  return `{\n${top.map((t) => i + t).join(",\n")}\n}${input.newline ? "\n" : ""}`
}

test("opencode and Smithers: setup removes the setting an earlier setup wrote, byte for byte", () => {
  assert.ok(readFileSync(cli, "utf8").includes(quote), "update the quoted CLI rule")
  // opencode's packages/*/tsconfig.json after an earlier setup.
  const opencode = '{\n  "extends": "@tsconfig/bun/tsconfig.json",\n  "compilerOptions": {\n    "rewriteRelativeImportExtensions": true\n  },\n  "include": ["src/**/*.ts", "src/**/*.vibe"]\n}\n'
  const written = earlierSetupWrote(opencode, "declarationSidecars", true)
  assert.match(written, /"vibelang": \{ "declarationSidecars": true \}/)
  assert.equal(removeVibeLangSetting(written, ts, "declarationSidecars"), opencode)
  assert.equal(removeVibeLangSetting(opencode, ts, "declarationSidecars"), opencode)
  // Smithers' flows keep other settings beside it under compilerOptions.
  const smithers = '{\n  "compilerOptions": {\n    "strict": true,\n    "vibelang": { "declarationSidecars": true, "effectGlobals": false } // ours\n  }\n}\n'
  assert.equal(removeVibeLangSetting(smithers, ts, "declarationSidecars"), '{\n  "compilerOptions": {\n    "strict": true,\n    "vibelang": { "effectGlobals": false } // ours\n  }\n}\n')
  assert.equal(removeVibeLangSetting('{ "vibe": { "declarationSidecars": false } }', ts, "declarationSidecars"), "{}")
})

test("retired-setting-roundtrip: removing the setting undoes what an earlier setup wrote", () => {
  fc.assert(fc.property(tsconfig, (input) => {
    const before = render(input)
    parse(before)
    // The earlier writer adds only to a vibelang object; a vibe one it leaves for a new top-level vibelang.
    const written = earlierSetupWrote(before, "declarationSidecars", true)
    assert.notEqual(written, before)
    assert.equal(removeVibeLangSetting(written, ts, "declarationSidecars"), before, written)
  }), { seed: 23023, numRuns: 300 })
})

test("retired-setting-placements: the setting goes from any member position, and nothing else changes", () => {
  fc.assert(fc.property(tsconfig, fc.nat(), fc.boolean(), (input, slot, trailing) => {
    if (input.holder === "none") return
    const members = [...input.members]
    members.splice(slot % (members.length + 1), 0, '"declarationSidecars": ' + trailing)
    const text = render({ ...input, members })
    const removed = removeVibeLangSetting(text, ts, "declarationSidecars")
    const expected = parse(render(input))
    assert.deepEqual(parse(removed), expected, removed)
    assert.ok(!removed.includes("declarationSidecars"))
    assert.equal(removeVibeLangSetting(removed, ts, "declarationSidecars"), removed)
    // Comments survive.
    if (input.comment) assert.equal(removed.includes(input.comment.trim()), text.includes(input.comment.trim()))
  }), { seed: 23024, numRuns: 300 })
})
