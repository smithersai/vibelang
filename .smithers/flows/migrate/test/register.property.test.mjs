import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { addRegister, addVitePlugin } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const guide = readFileSync(new URL("../../../../docs/user/src/setup/vite.md", import.meta.url), "utf8")
// The plugin option setup turns on for the config the tests load.
const quote = "The plugin adds `vibelang/register` to the tests' `NODE_OPTIONS`, so that process imports `.vibe` modules too"

// The options object of each vibelang(...) call in text, as source text.
function registerOf(text, name = "vibelang") {
  const source = ts.createSourceFile("vite.config.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const calls = []
  const find = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) calls.push(node)
    ts.forEachChild(node, find)
  }
  find(source)
  return calls.map((call) => {
    const [options] = call.arguments
    if (!options || !ts.isObjectLiteralExpression(options)) return null
    return Object.fromEntries(options.properties.map((p) => [p.name.text, p.initializer.getText(source)]))
  })
}

// Smithers run 2, capability batch 01: test/Capability.test.ts:205 runs node
// on src/Capability.ts, whose graph reaches a .vibe module. 64 of Smithers'
// 65 Vitest configs already had vibelang({ project: "tsconfig.test.json" })
// from VibeLang 0.0.8.
test("smithers run 2: setup gives the tests' config register: true, keeping its options", () => {
  assert.ok(guide.includes(quote), "update the quoted register contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-vitest-register.json", import.meta.url), "utf8"))
  const out = addVitePlugin(corpus.config, ts, { register: true })
  assert.deepEqual(registerOf(out), [{ register: "true", project: '"tsconfig.test.json"' }])
  assert.equal(out.replace("register: true, ", ""), corpus.config)
  assert.equal(addVitePlugin(out, ts, { register: true }), out)
  assert.equal(addVitePlugin(corpus.config, ts), corpus.config)
})

// Any options object a config already passes, written on one line or several,
// gains register: true once, keeps every other property, and an explicit
// register is left as written.
test("addRegister adds register once to every shape of options", () => {
  const value = fc.constantFrom('"tsconfig.test.json"', "true", "false", "process.env.X", '"/bin/vibelang"')
  const key = fc.constantFrom("project", "compiler", "debug", "register")
  const options = fc.uniqueArray(fc.tuple(key, value), { selector: ([k]) => k, maxLength: 3 })
  const shape = fc.constantFrom("none", "inline", "multiline")
  fc.assert(fc.property(options, shape, fc.constantFrom("vibelang", "vibe"), fc.boolean(), (props, form, name, other) => {
    const args = form === "none" ? "" : form === "inline" ? `{ ${props.map(([k, v]) => `${k}: ${v}`).join(", ")} }` : `{\n      ${props.map(([k, v]) => `${k}: ${v}`).join(",\n      ")}\n    }`
    const call = `${name}(${form === "none" && props.length ? "" : args})`
    const text = `import { defineConfig } from "vitest/config"\nimport ${name} from "vibelang-vite"\n\nexport default defineConfig({\n  plugins: [${other ? "react(), " : ""}${call}],\n  test: { environment: "node" }\n})\n`
    const out = addRegister(text, ts, name)
    const explicit = form !== "none" && props.find(([k]) => k === "register")
    const expected = form === "none" ? { register: "true" } : Object.fromEntries([...(explicit ? [] : [["register", "true"]]), ...props])
    assert.deepEqual(registerOf(out, name), [expected])
    assert.equal(addRegister(out, ts, name), out)
    assert.equal(ts.transpileModule(out, { reportDiagnostics: true }).diagnostics.length, 0)
  }), { seed: 31106, numRuns: 300 })
})
