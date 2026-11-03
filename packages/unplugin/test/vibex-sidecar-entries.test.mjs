import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import plugin from "../src/rolldown.js"

const sidecarRule = "Type checkers work through " + String.fromCharCode(96) + ".d.vibe.ts" + String.fromCharCode(96) + ", and linters, Knip, bundlers and test runners each read " + String.fromCharCode(96) + ".vibe" + String.fromCharCode(96) + "."
const vibexRule = "This includes " + String.fromCharCode(96) + ".d.vibex.ts" + String.fromCharCode(96) + " and mapped sidecar locations."
test("VIP-39 sidecar entry oracle quotes the tooling contract", () => {
  const chapter = readFileSync(SpecPath("007-tooling.md"), "utf8")
  assert.ok(chapter.includes(sidecarRule))
  const declarations = readFileSync(SpecPath("../vips/0027-declaration-output.md"), "utf8")
  assert.ok(declarations.includes(vibexRule))
})
function entries(input) {
  const hook = plugin({ root: process.cwd() }).options
  return (typeof hook === "function" ? hook : hook.handler).call({}, { input }).input
}

test("VIP-39 Rolldown excludes vibex declaration entries and retains JSX sources", () => {
  assert.deepEqual(entries(["App.vibex", "App.d.vibex.ts", "Twin.tsx"]), ["App.vibex", "Twin.tsx"])
  assert.deepEqual(entries("App.d.vibex.ts?raw"), [])
})

test("VIP-39 generated entry shapes preserve sources, aliases and declaration lookalikes", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.constantFrom("App", "nested/Panel", "雪", "has space", "Runtime.shared"), { minLength: 1 }),
    fc.constantFrom("array", "map", "single"), fc.constantFrom("", "?import", "?raw"),
    (names, shape, query) => {
      const sources = names.map(name => name + ".vibex" + query)
      const sidecars = names.map(name => name + ".d.vibex.ts" + query)
      const lookalikes = names.flatMap(name => [name + ".d.ts", name + ".d.vibex.ts.js", name + ".d.vibex.ts.vibex"])
      const all = [...sources, ...sidecars, ...lookalikes]
      const retained = [...sources, ...lookalikes]
      if (shape === "single") {
        for (const file of sidecars) assert.deepEqual(entries(file), [])
        for (const file of retained) assert.equal(entries(file), file)
      } else {
        const input = shape === "array" ? all : Object.fromEntries(all.map((file, i) => ["entry" + i, file]))
        const expected = shape === "array" ? retained : Object.fromEntries(Object.entries(input).filter(([, file]) => retained.includes(file)))
        const original = structuredClone(input)
        assert.deepEqual(entries(Object.freeze(input)), expected)
        assert.deepEqual(input, original)
      }
    }
  ), { numRuns: 80, seed: 391212 })
})
