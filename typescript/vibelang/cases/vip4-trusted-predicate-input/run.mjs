// run-seconds: 300
// rule-evidence: docs/design/vips/0004-throw.md#retirement-of-the-empty-legacy-trust-wrapper | The historical trusted(f, []) runtime wrapper is not an accepted VIP form.
// The retired wrapper reports EK0407, without inventing an incompatible
// callback contract for its input. TypeScript decides predicates and assertion
// narrowing. Declaration and runtime comparisons inspect the emitted legacy
// program without suppressing its retirement diagnostic or rewriting its source.
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const options = { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out", declaration: true, noEmitOnError: false, rewriteRelativeImportExtensions: true }
const head = `import * as Effect from "effect/Effect"\nimport { trusted } from "vibelang-runtime"\n`
const show = `const show = (exit: unknown) => JSON.stringify(exit, (_, v) => v instanceof Error ? v.name + ": " + v.message : v)`
const variants = {
  minimal: {
    foreign: `export function isNumber(value: unknown): value is number { return typeof value === "number" }\n`,
    wrapper: `import { isNumber } from "./foreign.ts"\nconst safe = trusted(isNumber, [])\n`,
    body: `if (safe(value)) return value + 1; return 0`,
    args: [`1`, `"x"`],
  },
  generic: {
    foreign: `export function isOf<T>(value: unknown, sample: T): value is T { return typeof value === typeof sample }\n`,
    wrapper: `import { isOf } from "./foreign.ts"\nconst safe = trusted(isOf, [])\n`,
    body: `if (safe(value, 0)) return value + 1; return 0`,
    args: [`1`, `"x"`],
  },
  genericInstantiated: {
    foreign: `export function isOf<T>(value: unknown, sample: T): value is T { return typeof value === typeof sample }\n`,
    wrapper: `import { isOf } from "./foreign.ts"\nconst safe = trusted(isOf<number>, [])\n`,
    body: `if (safe(value, 0)) return value + 1; return 0`,
    args: [`1`, `"x"`],
  },
  assertion: {
    foreign: `export function assertOf<T>(value: unknown, sample: T): asserts value is T { if (typeof value !== typeof sample) throw new TypeError("number required") }\n`,
    wrapper: `import { assertOf } from "./foreign.ts"\nconst safe: (value: unknown, sample: number) => asserts value is number = trusted(assertOf<number>, [])\n`,
    body: `safe(value, 0); return value + 1`,
    args: [`1`, `"x"`],
  },
  method: {
    foreign: `export const guards = { isNumber(value: unknown): value is number { return typeof value === "number" } }\n`,
    wrapper: `import { guards } from "./foreign.ts"\nconst safe = trusted(guards.isNumber, [])\n`,
    body: `if (safe(value)) return value + 1; return 0`,
    args: [`1`, `"x"`],
  },
  declaredThrows: {
    foreign: `/** @throws {TypeError} */\nexport function isNumber(value: unknown): value is number { if (value === null) throw new TypeError("null"); return typeof value === "number" }\n`,
    wrapper: `import { isNumber } from "./foreign.ts"\nconst safe = trusted(isNumber, [])\n`,
    body: `if (safe(value)) return value + 1; return 0`,
    args: [`1`, `"x"`, `null`],
  },
}
const source = (v, native) => head + v.wrapper +
  (native ? `export const program = (value: unknown) => Effect.gen(function* () { ${v.body} })\n` : `export const program = effect (value: unknown) => { ${v.body} }\n`) +
  show + "\n" +
  (native ? `export function main() { return Effect.gen(function* () { return [${v.args.map(a => `show(yield* Effect.exit(program(${a})))`).join(", ")}] }) }\n` : `export effect function main() { return [${v.args.map(a => `show(try Effect.exit(program(${a})))`).join(", ")}] }\n`)

for (const [name, v] of Object.entries(variants)) {
  const twin = withProject(here, { "foreign.ts": v.foreign, "main.ts": source(v, true) }, ({ tsc, read, run }) => {
    const result = tsc()
    assert.equal(result.status, 0, result.text)
    return { declarations: read("out/main.d.ts"), result: run() }
  }, { compilerOptions: options, include: ["*.ts"] })
  withProject(here, { "foreign.ts": v.foreign, "main.vibe": source(v, false) }, ({ tsc, read, run }) => {
    const result = tsc()
    assert.equal(result.status, 2, result.text)
    assert.deepEqual(codes(result.text), ["EK0407"], name + "\n" + result.text)
    assert.equal(read("out/main.d.ts"), twin.declarations, name + ": byte-identical declarations")
    assert.equal(run(), twin.result, name + ": identical runtime result")
  }, { compilerOptions: options, include: ["*.vibe"] })
  // The supported boundary puts the guarded operation in native Effect code.
  // Its exported program has the same public type and runtime behavior.
  const adapter = head + v.wrapper + `export const read = (value: unknown) => Effect.gen(function* () { ${v.body} })\n`
  const bridged = { ...v, wrapper: `import { read } from "./adapter.ts"\n`, body: `return try read(value)` }
  withProject(here, { "foreign.ts": v.foreign, "adapter.ts": adapter, "main.vibe": source(bridged, false) }, ({ tsc, read, run }) => {
    const checked = tsc()
    assert.equal(checked.status, 0, name + ": native Effect adapter\n" + checked.text)
    assert.equal(read("out/main.d.ts"), twin.declarations, name + ": adapter declarations")
    assert.equal(run(), twin.result, name + ": adapter runtime")
  }, { compilerOptions: options, include: ["*.vibe", "adapter.ts"] })
  console.log(name + ": EK0407 alone; native adapter, declarations and runtime match TypeScript")
}

// An unannotated assertion target is invalid in TypeScript too.
const assertion = { ...variants.assertion, wrapper: variants.assertion.wrapper.replace("safe: (value: unknown, sample: number) => asserts value is number", "safe") }
for (const native of [true, false]) {
  withProject(here, { "foreign.ts": assertion.foreign, [native ? "main.ts" : "main.vibe"]: source(assertion, native) }, ({ tsc }) => {
    assert.deepEqual(codes(tsc().text), native ? ["TS2775", "TS18046"] : ["EK0407", "TS2775", "TS18046"])
  }, { compilerOptions: options, include: native ? ["*.ts"] : ["*.vibe"] })
}
console.log("unannotated assertion: TypeScript diagnostics preserved")
