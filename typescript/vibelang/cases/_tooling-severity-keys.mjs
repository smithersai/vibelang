// run-seconds: 150
// vibe.severities keys are whole printed codes. Only own warnings and
// assigned EK38xx codes are configurable: an own error code, an interim
// EK92xx code (EK9204 prints as a warning) or an unknown code is EK3006 for
// every value, "error" included, and changes nothing. A severity value that
// is not one of the four strings is EK3006 whatever its JSON type; any other
// wrong-typed or unknown vibe key, including a non-object severities, is
// EK3007.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import fc from "../../../docs/tools/node_modules/fast-check/lib/fast-check.js"
import { project, baseOptions } from "./_tooling-witness.mjs"

const appendix = readFileSync(new URL("../../../docs/design/src/900-appendices.md", import.meta.url), "utf8")
const ownWarnings = new Set([...appendix.matchAll(/^\| `(EK\d+)` \| (?:lint )?warning\b/gm)].map(m => m[1]))
const imported = new Set([...appendix.matchAll(/^\| `(EK38\d+)` \| `effecttsgo\//gm)].map(m => m[1]))
const configurable = new Set([...ownWarnings, ...imported])
const errorCodes = [...new Set([...appendix.matchAll(/^\| `(EK\d+)` \| /gm)].map(m => m[1]))].filter(c => !configurable.has(c) && !c.startsWith("EK38"))
const interim = [...appendix.matchAll(/^\| interim `(EK92\d\d)` \| (error|warning)\b/gm)].map(m => [m[1], m[2]])
assert.ok(configurable.has("EK0801") && configurable.has("EK3801") && configurable.has("EK38100"))
assert.ok(errorCodes.includes("EK4701") && errorCodes.includes("EK0101") && errorCodes.length >= 100, errorCodes.join())
assert.ok(interim.some(([c, k]) => c === "EK9204" && k === "warning") && interim.some(([, k]) => k === "error"), JSON.stringify(interim))

const values = ["error", "warning", "suggestion", "off"]
// main.vibe: EK4701 (error), EK9204 (interim, warning), EK0801 (own warning).
const own = `error NotFound { id: string }
error Timeout
effect function find(id: string): string!(NotFound | Timeout)! {
  if (id === "missing") throw new NotFound({ id })
  if (id === "slow") throw new Timeout()
  return id
}
export effect function partial(id: string) {
  return find(id) catch (e) => match (e) {
    when NotFound: "missing";
  }
}
export effect function constant() {
  return Effect.succeed(1) catch () => 2
}
export effect function f() {
  using x = { [Symbol.dispose]() {} }
  return 1
}
`
// lint.ts: EK3801 (floatingEffect) and EK38100 (redundantMapError).
const lint = 'import * as Effect from "effect/Effect"\nEffect.succeed(1)\nconst f = (e: string) => new Error(e)\n' +
  "export const g = Effect.gen(function* () {\n  const a = yield* Effect.fail(\"a\").pipe(Effect.mapError(f))\n" +
  "  const b = yield* Effect.fail(\"b\").pipe(Effect.mapError(f))\n  return [a, b]\n})\n"
const line = /^(\S+?)\((\d+),(\d+)\): (error|warning|suggestion) ((?:EK|TS)\d+): (.*)$/gm
const compileProject = vibe => project(({ put, invoke }) => {
  put("main.vibe", own)
  put("lint.ts", lint)
  const config = { compilerOptions: { ...baseOptions(), noEmit: true, plugins: [{ name: "@effect/language-service" }] }, files: ["main.vibe", "lint.ts"] }
  if (vibe !== undefined) config.vibe = vibe
  put("tsconfig.json", config)
  const r = invoke("-p", ".", "--pretty", "false")
  const all = [...r.text.matchAll(line)].map(m => ({ file: m[1], at: m[2] + "," + m[3], category: m[4], code: m[5], message: m[6] }))
  const config_ = all.filter(d => d.file === "tsconfig.json").map(d => d.category + " " + d.code + ": " + d.message)
  const source = all.filter(d => d.file !== "tsconfig.json").map(d => d.file + "(" + d.at + ") " + d.category + " " + d.code)
  return { status: r.status, config: config_, source, text: r.text }
})
const disallowed = code => code === "" ? "error EK3006: An empty diagnostic code cannot appear in vibe.severities; remove the entry." : "error EK3006: " + code + " cannot appear in vibe.severities; remove the entry. Only warning codes and assigned EK38 lint codes can be configured."
const badValue = code => "error EK3006: vibe.severities." + code + " must be error, warning, suggestion or off; replace this value."

// Each group keeps every original input and property run within an
// independent runner budget. The progress records identify a slow compile.
export function runSeverityKeys(group) {
  assert.ok(["codes", "ownership", "values", "options"].includes(group), group)
  let compiled = 0
  const compile = vibe => {
    const sequence = ++compiled
    const started = performance.now()
    console.error("[severity-keys] " + group + " compile " + sequence + " start")
    const result = compileProject(vibe)
    console.error("[severity-keys] " + group + " compile " + sequence + " finished in " + Math.round(performance.now() - started) + " ms")
    return result
  }
  const defaults = compile(undefined)
  assert.deepEqual(defaults.config, [], defaults.text)
  const pick = (r, codes) => r.source.filter(d => codes.some(c => d.endsWith(" " + c)))
  assert.deepEqual(pick(defaults, ["EK4701", "EK9204", "EK0801", "EK3801", "EK38100"]),
    ["lint.ts(2,1) error EK3801", "lint.ts(4,29) suggestion EK38100", "main.vibe(9,32) error EK4701", "main.vibe(14,28) warning EK9204", "main.vibe(17,3) warning EK0801"], defaults.text)
  const without = (r, code) => r.source.filter(d => !d.endsWith(" " + code))
  const recategorize = (r, code, category) => r.source.map(d => d.endsWith(" " + code) ? d.replace(/ (error|warning|suggestion) /, " " + category + " ") : d)

  if (group === "codes") {
    // Keys are whole codes: EK3801 and EK38100 name different rules.
    for (const [code, other] of [["EK3801", "EK38100"], ["EK38100", "EK3801"]]) {
      const off = compile({ severities: { [code]: "off" } })
      assert.deepEqual(off.config, [], off.text)
      assert.deepEqual(off.source, without(defaults, code), code + "\n" + off.text)
      assert.ok(off.source.some(d => d.endsWith(" " + other)), off.text)
      for (const value of ["error", "warning"]) {
        const r = compile({ severities: { [code]: value } })
        assert.deepEqual(r.source, recategorize(defaults, code, value), code + " " + value + "\n" + r.text)
      }
    }
    // A prefix, extension, padding or case variant of a code is not that code.
    // (Some digit variants, such as EK3810, are assigned codes of their own.)
    const nearMiss = ["EK380", "EK3810", "EK38010", "EK381000", "EK03801", "ek3801", "Ek38100", "EK3801 ", " EK38100", "3801", "EK38", "EK38xx", "EK38*", "TS3801", "EK3801,EK38100", "EK801", "EK08010", "EK0801x", "EK0801.", ""].filter(k => !configurable.has(k))
    assert.ok(nearMiss.length >= 18 && nearMiss.includes("EK381000") && nearMiss.includes("EK380"), nearMiss.join())
    for (const key of nearMiss) {
      const r = compile({ severities: { [key]: "off" } })
      assert.deepEqual(r.config, [disallowed(key)], JSON.stringify(key) + "\n" + r.text)
      assert.deepEqual(r.source, defaults.source, JSON.stringify(key) + "\n" + r.text)
    }

  }
  if (group === "ownership") {
    // EK0801 is configurable with every value; EK4701 is not with any.
    for (const value of values) {
      const ok = compile({ severities: { EK0801: value } })
      assert.deepEqual(ok.config, [], value + "\n" + ok.text)
      assert.deepEqual(ok.source, value === "error" || value === "warning" ? recategorize(defaults, "EK0801", value) : without(defaults, "EK0801"), value + "\n" + ok.text)
      const no = compile({ severities: { EK4701: value } })
      assert.deepEqual(no.config, [disallowed("EK4701")], value + "\n" + no.text)
      assert.deepEqual(no.source, defaults.source, value + "\n" + no.text)
      assert.notEqual(no.status, 0)
    }

    // Every own error code, every interim code (warnings included) and unknown
    // codes: EK3006 per entry, for each value, and no override takes effect.
    const unknown = ["EK0000", "EK9999", "EK99999", "EK38999", "EK1", "EK"]
    for (const code of unknown) assert.ok(!configurable.has(code) && !errorCodes.includes(code), code)
    for (const value of values) {
      const entries = [...errorCodes, ...interim.map(([c]) => c), ...unknown]
      const r = compile({ severities: Object.fromEntries(entries.map(c => [c, value])) })
      assert.deepEqual(r.config, entries.map(disallowed), value + "\n" + r.text.slice(0, 2000))
      assert.deepEqual(r.source, defaults.source, value + "\n" + r.text.slice(0, 2000))
    }
    // Generated unknown codes, alone or mixed with a valid entry that still applies.
    fc.assert(fc.property(fc.stringMatching(/^EK[0-9]{1,6}$/).filter(c => !configurable.has(c)), fc.constantFrom(...values), (code, value) => {
      const r = compile({ severities: { [code]: value, EK4609: "off" } })
      assert.deepEqual(r.config, [disallowed(code)], code + " " + value + "\n" + r.text)
      assert.deepEqual(r.source, without(defaults, "EK4609"), r.text)
    }), { numRuns: 15, seed: 7 })

  }
  if (group === "values") {
    // A value that is not one of the four strings is EK3006 whatever its JSON
    // type, never EK3007; the code keeps its default.
    for (const value of [1, 0, -1, 1.5, true, false, null, [], ["off"], {}, { severity: "off" }, "Error", "OFF", "Off", "", " off", "off ", "none", "warn", "info", "hint", "suggest", "0"]) {
      // An own code with every value; an assigned EK38xx code with a sample.
      for (const code of ["EK0801", ...(typeof value === "string" ? [] : ["EK3801"])]) {
        const r = compile({ severities: { [code]: value } })
        assert.deepEqual(r.config, [badValue(code)], code + " " + JSON.stringify(value) + "\n" + r.text)
        assert.deepEqual(r.source, defaults.source, code + " " + JSON.stringify(value) + "\n" + r.text)
      }
    }

  }
  if (group === "options") {
    // EK3007: an unknown vibe key or a wrong-typed non-severity value, including
    // a non-object severities and a non-object vibe section; never EK3006.
    for (const vibe of [
      { effectGlobal: false }, { Severities: {} }, { trusted: [] }, { effectModules: "no" }, { effectModules: 0 }, { effectGlobals: 1 }, { effectGlobals: null },
      { effectGlobals: "false" }, { sidecarDir: 1 }, { sidecarDir: true }, { sidecarDir: null }, { sidecarDir: [] },
      { severities: [] }, { severities: "off" }, { severities: null }, { severities: 1 }, { severities: true }, { severities: [["EK0801", "off"]] },
      [], null, "x", 1, true,
    ]) {
      const r = compile(vibe)
      assert.equal(r.config.length, 1, JSON.stringify(vibe) + "\n" + r.text)
      assert.match(r.config[0], /^error EK3007: /, JSON.stringify(vibe) + "\n" + r.text)
      assert.deepEqual(r.source, defaults.source, JSON.stringify(vibe) + "\n" + r.text)
    }
    // Both codes together: each problem keeps its own code.
    const both = compile({ effectGlobal: false, severities: { EK0801: 1, EK4609: "off" } })
    assert.deepEqual(both.config.map(d => d.split(":")[0]).sort(), ["error EK3006", "error EK3007"], both.text)
    assert.deepEqual(both.source, without(defaults, "EK4609"), both.text)
  }
  console.log("severity keys: whole codes, EK3006 for disallowed codes and values, EK3007 for other vibe types (" + group + ")")
}
