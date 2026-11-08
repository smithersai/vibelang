// run-seconds: 480
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
import { project, check, nativeCheck, codes } from "../../tests/coverage-tooling.mjs"

const source = 'import { Effect } from "effect"\nexport const make = Effect.fn("make")(function*(input: Readonly<Record<string, string>>) { return new Headers(input) })\n'
const options = { compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", lib: ["ESNext", "DOM", "DOM.Iterable"], declaration: true } }
const twin = project(import.meta.url, "native", { "main.ts": source }, options)
const native = nativeCheck(twin)
assert.equal(native.status, 0, native.output)
const p = project(import.meta.url, "conversion", { "main.vibe": source }, options)
const fixed = check(p, ["--fix", "--noEmit", "--declaration", "--singleThreaded"])
assert.equal(fixed.status, 2, fixed.output)
assert.deepEqual(codes(fixed.output), ["EK4402"], fixed.output)
const text = p.read("main.vibe")
assert.ok(!text.includes("function*"), text)
assert.ok(text.includes("new globalThis.Headers(input)"), text)
const again = check(p, ["--fix", "--noEmit", "--singleThreaded"])
assert.deepEqual(codes(again.output), ["EK4402"], again.output)
assert.equal(p.read("main.vibe"), text)
const constructors = {
  Headers: "input",
  Request: '"https://example.test"',
  Response: '"body"',
  URL: '"https://example.test"',
  Blob: '["body"]',
  Event: '"ready"',
}
const forms = ["named", "fn", "untraced", "gen"]
const examples = Object.keys(constructors).flatMap(name => forms.map(form => [name, form, false]))
// Chapter 005's closed host allowlist admits URL; the other five retain EK4402.
// Check every constructor/API pair plus generated parenthesized spellings.
fc.assert(fc.property(
  fc.constantFrom(...Object.keys(constructors)),
  fc.constantFrom(...forms),
  fc.boolean(),
  (name, form, parens) => {
    const body = "return new " + (parens ? "(" + name + ")" : name) + "(" + constructors[name] + ")"
    const gen = "function*(input: Readonly<Record<string, string>>) { " + body + " }"
    const call = {
      named: 'Effect.fn("make")(' + gen + ")",
      fn: "Effect.fn(" + gen + ")",
      untraced: "Effect.fnUntraced(" + gen + ")",
      gen: "(input: Readonly<Record<string, string>>) => Effect.gen(function*() { " + body + " })",
    }[form]
    const input = 'import { Effect } from "effect"\nexport const make = ' + call + "\n"
    const twin = project(import.meta.url, "matrix-native", { "main.ts": input }, options)
    const native = nativeCheck(twin)
    assert.equal(native.status, 0, native.output)
    const p = project(import.meta.url, "matrix-vibe", { "main.vibe": input }, options)
    const fixed = check(p, ["--fix", "--noEmit", "--declaration", "--singleThreaded"])
    const banned = name !== "URL"
    assert.equal(fixed.status, banned ? 2 : 0, fixed.output)
    assert.deepEqual(codes(fixed.output), banned ? ["EK4402"] : [], fixed.output)
    const text = p.read("main.vibe")
    assert.ok(!text.includes("function*"), fixed.output + text)
    if (["Headers", "Response", "Event"].includes(name)) {
      assert.ok(text.includes("globalThis." + name), text)
      assert.ok(!text.includes("globalThis.globalThis"), text)
    }
  }
), { seed: 4402, numRuns: 12, examples, endOnFailure: true })
console.log("constructor preserved; host boundary retained")

