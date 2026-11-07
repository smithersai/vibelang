// vibe.severities is an object whose default is {}; it maps VibeLang's own
// warning codes and the assigned imported EK38xx codes to the four values.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { project, baseOptions } from "../_tooling-witness.mjs"

// The appendix is the source of truth for which codes are own warnings and
// which EK38xx codes are assigned.
const appendix = readFileSync(new URL("../../../../docs/design/src/900-appendices.md", import.meta.url), "utf8")
const ownWarnings = [...appendix.matchAll(/^\| `(EK\d+)` \| (?:lint )?warning\b/gm)].map(m => m[1])
const imported = [...appendix.matchAll(/^\| `(EK38\d+)` \| `effecttsgo\//gm)].map(m => m[1])
assert.ok(ownWarnings.includes("EK0801") && ownWarnings.includes("EK4609") && ownWarnings.length >= 20, ownWarnings.join())
assert.ok(imported.includes("EK3801") && imported.includes("EK38100") && imported.length >= 100, imported.join())

// Each printed diagnostic as "file category CODE".
const printed = text => [...text.matchAll(/^(\S+?)\(\d+,\d+\): (error|warning|suggestion) ((?:EK|TS)\d+)/gm)].map(m => m[1] + " " + m[2] + " " + m[3])
const own = 'import type { Fiber } from "effect"\n' +
  "export async function wait(fiber: Fiber.Fiber<number>) { return await fiber }\n" +
  "export effect function f() {\n  using x = { [Symbol.dispose]() {} }\n  return 1\n}\n"
const lint = 'import * as Effect from "effect/Effect"\nEffect.succeed(1)\nconst f = (e: string) => new Error(e)\n' +
  "export const g = Effect.gen(function* () {\n  const a = yield* Effect.fail(\"a\").pipe(Effect.mapError(f))\n" +
  "  const b = yield* Effect.fail(\"b\").pipe(Effect.mapError(f))\n  return [a, b]\n})\n"
const compile = vibe => project(({ put, invoke }) => {
  put("main.vibe", own)
  put("lint.ts", lint)
  const config = { compilerOptions: { ...baseOptions(), noEmit: true, plugins: [{ name: "@effect/language-service" }] }, files: ["main.vibe", "lint.ts"] }
  if (vibe !== undefined) config.vibe = vibe
  put("tsconfig.json", config)
  const r = invoke("-p", ".", "--pretty", "false")
  // The Effect plugin also lints main.vibe; keep the probed codes in view.
  const all = printed(r.text)
  return { status: r.status, all, printed: all.filter(d => / EK(?!38)\d+$/.test(d) && !d.startsWith("lint.ts") || / EK(?:3801|38100)$/.test(d) && d.startsWith("lint.ts")), text: r.text }
})

// Default {}: an absent section, an empty section and an empty map agree.
const defaults = compile(undefined)
assert.deepEqual(defaults.printed.filter(d => d.startsWith("main.vibe")).sort(), ["main.vibe warning EK0801", "main.vibe warning EK4609"])
for (const vibe of [{}, { severities: {} }]) {
  const r = compile(vibe)
  assert.deepEqual(r.printed, defaults.printed, JSON.stringify(vibe) + "\n" + r.text)
  assert.equal(r.status, defaults.status)
}
// Object: a non-object map is a config error, and the defaults still apply.
for (const severities of [[], "off", 1, true, null]) {
  const r = compile({ severities })
  assert.deepEqual(r.printed.filter(d => d.startsWith("tsconfig.json")), ["tsconfig.json error EK3007"], JSON.stringify(severities) + "\n" + r.text)
  assert.deepEqual(r.printed.filter(d => !d.startsWith("tsconfig.json")), defaults.printed, r.text)
}

let checks = 0
for (const value of ["error", "warning", "suggestion", "off"]) {
  // Every own warning code and every assigned EK38xx code accepts the value.
  const all = Object.fromEntries([...ownWarnings, ...imported].map(code => [code, value]))
  const r = compile({ severities: all })
  assert.deepEqual(r.printed.filter(d => d.startsWith("tsconfig.json")), [], value + "\n" + r.text)
  // And the value takes effect: own codes print in the CLI except suggestion
  // and off; imported codes follow the Effect host, which shows suggestions.
  const want = [
    ...(value === "error" || value === "warning" ? ["main.vibe " + value + " EK4609", "main.vibe " + value + " EK0801"] : []),
    ...(value === "off" ? [] : ["lint.ts " + value + " EK3801", "lint.ts " + value + " EK38100"]),
  ].sort()
  assert.deepEqual(r.printed.sort(), want, value + "\n" + r.text)
  if (value === "off") assert.deepEqual(r.all, [], r.text)
  // Own warnings never change the exit status. Imported codes follow the
  // compiler host rules: warnings and errors fail it, suggestions do not.
  assert.equal(r.status === 0, value === "suggestion" || value === "off", value + "\n" + r.text)
  checks++
}
assert.equal(checks, 4)
console.log("vibe.severities: object defaulting to {}, four values for own and EK38xx codes")
