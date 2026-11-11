// Published declarations preserve exported names, strict types and documentation.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compare, check, forms } from "./published-specifiers-oracle.mjs"
import { assertParallelProperty } from "../../../../scripts/testing/parallel-property.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const quote = "Equivalent formatting, quotes, alias expansion, member/import order and module-specifier spelling pass."

test("opencode-19: a published barrel's ./runtime declared as ./runtime.js is excused and listed", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote), "update the quoted verify rule")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-published-extensionless-barrel.json", import.meta.url), "utf8"))
  const result = compare(corpus.before, corpus.after)
  assert.equal(result.identical, true, JSON.stringify(result.changed))
  assert.deepEqual(result.excused, corpus.excused)
})

test("published specifiers: equivalent structural targets pass while missing targets and semantic changes fail", () => {
  const runtime = { "runtime.d.ts": "export declare const value: number;\n" }
  const barrel = (specifier, rest = "") => ({ "index.d.ts": `export * as Runtime from "${specifier}";\n${rest}` })
  // ./runtime is runtime/index.d.ts before; ./runtime.js is runtime.d.ts after.
  assert.equal(compare({ ...barrel("./runtime"), "runtime/index.d.ts": "export declare const value: number;\n" },
    { ...barrel("./runtime.js"), ...runtime }).identical, true)
  // A target that is not there.
  assert.equal(compare(barrel("./runtime"), barrel("./runtime.js")).identical, false)
  // A directory index spelled out names the same file and is excused; with runtime.d.ts beside it, ./runtime is that file instead.
  assert.equal(compare({ ...barrel("./runtime"), "runtime/index.d.ts": "export {};\n" },
    { ...barrel("./runtime/index.js"), "runtime/index.d.ts": "export {};\n" }).identical, true)
  assert.equal(compare({ ...barrel("./runtime"), ...runtime, "runtime/index.d.ts": "export {};\n" },
    { ...barrel("./runtime/index.js"), ...runtime, "runtime/index.d.ts": "export {};\n" }).identical, false)
  // A bare specifier, a type change beside an excused one, and a reordering.
  assert.equal(compare({ "index.d.ts": 'export * from "effect";\n' }, { "index.d.ts": 'export * from "effect/index";\n' }).identical, false)
  assert.equal(compare({ ...barrel("./runtime", "export type A = string;\n"), ...runtime },
    { ...barrel("./runtime.js", "export type A = number;\n"), ...runtime }).identical, false)
  assert.equal(compare({ "index.d.ts": 'export * from "./a";\nexport * from "./b";\n', "a.d.ts": "export {};\n", "b.d.ts": "export {};\n" },
    { "index.d.ts": 'export * from "./b.js";\nexport * from "./a.js";\n', "a.d.ts": "export {};\n", "b.d.ts": "export {};\n" }).identical, true)
})

const barrel = fc.array(fc.record({ form: fc.nat(forms.length - 1), renamed: fc.boolean(), directory: fc.boolean() }), { minLength: 1, maxLength: 5 })

test("published-specifier-equivalence: renamed spellings pass and are listed; semantic or invalid-declaration mutations fail", async () => {
  await assertParallelProperty(fc, {
    arbitraries: [barrel, fc.option(fc.constantFrom("value", "Value", "export", ";"), { nil: undefined })],
    oracle: check, module: new URL("./published-specifiers-oracle.mjs", import.meta.url),
    seed: 31031, numRuns: 150
  })
})
