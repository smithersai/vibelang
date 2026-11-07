// The effective vibe.severities map is merged from extends before each entry
// is validated. An invalid effective entry reports EK3006 and contributes no
// override: its code falls back to the default, displacing an inherited
// value, while other valid entries and independent vibe options apply.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

// EK0801, EK4609 and EK0508 are own warnings; globals.vibe and modules.vibe
// need the prelude switches on.
const main = 'import type { Fiber } from "effect"\nerror Timeout\n' +
  "effect function slow(): never!Timeout { throw new Timeout() }\n" +
  "export effect function caught() { return slow() catch (e) => e }\n" +
  "export async function wait(fiber: Fiber.Fiber<number>) { return await fiber }\n" +
  "export effect function f() {\n  using x = { [Symbol.dispose]() {} }\n  return 1\n}\n"
const lint = 'import * as Effect from "effect/Effect"\nEffect.succeed(1)\nexport {}\n'
const line = /^(\S+?)\((\d+),(\d+)\): (error|warning|suggestion) ((?:EK|TS)\d+): (.*)$/gm
const files = ["main.vibe", "globals.vibe", "modules.vibe", "lint.ts"]
const compile = (configs) => project(({ put, invoke }) => {
  put("main.vibe", main)
  put("globals.vibe", "export const a = succeed(1)\n")
  put("modules.vibe", "export const b = Effect.succeed(1)\n")
  put("lint.ts", lint)
  for (const [name, config] of Object.entries(configs)) put(name, config)
  const r = invoke("-p", ".", "--pretty", "false")
  const all = [...r.text.matchAll(line)].map(m => m[1] + " " + m[4] + " " + m[5] + (m[5] === "EK3006" ? " " + m[6].split(" ")[0] : ""))
  return { status: r.status, all: all.filter(d => !/ EK38(?!01\b)\d+/.test(d)), text: r.text }
})
const compilerOptions = { ...baseOptions(), noEmit: true, plugins: [{ name: "@effect/language-service" }] }
const single = vibe => compile({ "tsconfig.json": { compilerOptions, files, vibe } })
const extended = (base, child) => compile({ "base.json": { compilerOptions, vibe: base }, "tsconfig.json": { extends: "./base.json", files, vibe: child } })
const sorted = list => [...list].sort()
const own = { EK0801: "main.vibe warning EK0801", EK4609: "main.vibe warning EK4609", EK0508: "main.vibe warning EK0508" }
const as = (code, category) => own[code].replace("warning", category)
const defaults = single({})
assert.deepEqual(sorted(defaults.all), sorted([...Object.values(own), "lint.ts error EK3801"]), defaults.text)
const expect = (r, want, label) => assert.deepEqual(sorted(r.all), sorted(want), label + "\n" + r.text)

// Merge before validation: a base entry the child replaces is never
// validated, in either direction of the replacement.
expect(extended({ severities: { EK0801: "bad" } }, { severities: { EK0801: "off" } }), [own.EK4609, own.EK0508, "lint.ts error EK3801"], "base bad, child off")
expect(extended({ severities: { EK0801: 1 } }, { severities: { EK0801: "error" } }), [as("EK0801", "error"), own.EK4609, own.EK0508, "lint.ts error EK3801"], "base 1, child error")
expect(extended({ severities: { EK3801: [] } }, { severities: { EK3801: "warning" } }), [...Object.values(own), "lint.ts warning EK3801"], "base [], child warning")
// An inherited entry the child leaves alone is validated where it was written.
expect(extended({ severities: { EK4701: "off", EK4609: "off" } }, {}), ["base.json error EK3006 EK4701", own.EK0801, own.EK0508, "lint.ts error EK3801"], "inherited disallowed")
expect(extended({ severities: { EK0801: "loud" } }, { severities: { EK4609: "off" } }), ["base.json error EK3006 vibe.severities.EK0801", own.EK0801, own.EK0508, "lint.ts error EK3801"], "inherited bad value")
// An invalid child entry displaces its inherited entry without restoring it.
expect(extended({ severities: { EK0801: "error", EK4609: "off" } }, { severities: { EK0801: "bad" } }), ["tsconfig.json error EK3006 vibe.severities.EK0801", own.EK0801, own.EK0508, "lint.ts error EK3801"], "child bad")
expect(extended({ severities: { EK3801: "off" } }, { severities: { EK3801: 1 } }), ["tsconfig.json error EK3006 vibe.severities.EK3801", ...Object.values(own), "lint.ts error EK3801"], "child bad EK38")
expect(extended({ severities: { EK0801: "off" } }, { severities: { EK0801: "error", EK4701: "error" } }), ["tsconfig.json error EK3006 EK4701", as("EK0801", "error"), own.EK4609, own.EK0508, "lint.ts error EK3801"], "child disallowed beside valid")

// The spec's recovery example: EK3006 on "bad"; EK0801 uses its default;
// EK4609 (inherited) and EK0508 (child) stay off; both independent options
// apply, effectGlobals from the base and effectModules from the child.
const example = extended(
  { effectGlobals: false, severities: { EK0801: "error", EK4609: "off" } },
  { effectModules: false, severities: { EK0801: "bad", EK0508: "off" } })
expect(example, ["tsconfig.json error EK3006 vibe.severities.EK0801", own.EK0801, "globals.vibe error TS2304", "modules.vibe error TS2304", "lint.ts error EK3801"], "spec example")
assert.match(example.text, /globals\.vibe\(1,18\): error TS2304: Cannot find name 'succeed'\./)
assert.match(example.text, /modules\.vibe\(1,18\): error TS2304: Cannot find name 'Effect'\./)
assert.notEqual(example.status, 0)

// Without extends: the invalid entry is inert, its neighbours apply.
expect(single({ effectGlobals: false, severities: { EK0801: "bad", EK4609: "off", EK0508: "error" } }),
  ["tsconfig.json error EK3006 vibe.severities.EK0801", own.EK0801, as("EK0508", "error"), "globals.vibe error TS2304", "lint.ts error EK3801"], "single")
// An extends array merges left to right before the child, then validates.
const array = (a, b, child) => compile({ "a.json": { compilerOptions, vibe: a }, "b.json": { vibe: b }, "tsconfig.json": { extends: ["./a.json", "./b.json"], files, vibe: child } })
expect(array({ severities: { EK0801: "bad", EK4609: "error" } }, { severities: { EK0801: "off" } }, {}), [as("EK4609", "error"), own.EK0508, "lint.ts error EK3801"], "array later wins")
expect(array({ severities: { EK0801: "error", EK4609: "error" } }, { severities: { EK0801: "bad" } }, { severities: { EK0508: "off" } }), ["b.json error EK3006 vibe.severities.EK0801", own.EK0801, as("EK4609", "error"), "lint.ts error EK3801"], "array bad later")
console.log("extends merges before validation; an invalid entry reports EK3006 and overrides nothing")
