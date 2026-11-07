// rule-evidence: docs/design/src/008-runtime.md#runtime-guarantees | The runtime's `customMatcher` export and every generated or user-written matcher use that actual key; no runtime copy creates a fresh fallback symbol.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
// Node defines no Symbol.customMatcher; the runtime's initialization does.
assert.equal(Object.getOwnPropertyDescriptor(Symbol, "customMatcher"), undefined)
const program = await import(pathToFileURL(path.join(here, "out", "main.js")).href)
const runtime = await import("vibelang-runtime")
const key = Symbol.customMatcher
assert.equal(typeof key, "symbol")
assert.equal(Symbol.keyFor(key), "Symbol.customMatcher")
assert.equal(runtime.customMatcher, key, "the runtime export is the actual key")

// Generated matchers of both error kinds and the user-written one use the key,
// and no class carries another symbol with the protocol's description.
for (const [name, cls] of [["NotFound", program.NotFound], ["Invalid", program.Invalid], ["Even", program.Even]]) {
  assert.equal(typeof cls[key], "function", name + " has a matcher under Symbol.customMatcher")
  for (let o = cls; o !== null && o !== Function.prototype; o = Object.getPrototypeOf(o)) {
    for (const symbol of Object.getOwnPropertySymbols(o)) {
      if (symbol.description === "Symbol.customMatcher") assert.equal(symbol, key, name + " carries a fallback copy of the key")
    }
  }
}
assert.deepEqual(Object.getOwnPropertySymbols(program.Even), [key])
assert.equal(program.classify(new program.NotFound({ id: "1" })), "missing")
assert.equal(program.classify(new program.Invalid({ reason: "r" })), "invalid")
assert.equal(program.classify(2), "even")
assert.equal(program.classify(3), "other")

// A second, separately loaded copy of the runtime package exports the same key.
const source = fs.realpathSync(path.join(here, "node_modules", "vibelang-runtime"))
const copy = path.join(here, "out", "runtime-copy")
fs.rmSync(copy, { recursive: true, force: true })
fs.cpSync(source, copy, { recursive: true, dereference: true, filter: (p) => !p.slice(source.length).includes(path.sep + "node_modules") })
const manifest = JSON.parse(fs.readFileSync(path.join(copy, "package.json"), "utf8"))
const second = await import(pathToFileURL(path.join(copy, manifest.exports["."].import)).href)
assert.notEqual(second, runtime, "the copy is a separate module instance")
assert.equal(second.customMatcher, key, "a runtime copy reuses the actual key")
assert.equal(Symbol.customMatcher, key)
console.log("generated, schema and user-written matchers and a runtime copy share Symbol.customMatcher")
// Stable rule id: docs/design/src/008-runtime.md#36f4e4c68eaa657a
