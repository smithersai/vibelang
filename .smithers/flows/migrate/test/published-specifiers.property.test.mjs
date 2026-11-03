// Published declarations preserve exported names, strict types and documentation.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const quote = "Equivalent formatting, quotes, alias expansion, member/import order and module-specifier spelling pass."
const manifest = { name: "@opencode/stats-core", types: "./index.d.ts" }

function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "migrate-published-specifiers-"))
  try {
    for (const [dir, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest))
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(root, dir, file, ".."), { recursive: true })
        writeFileSync(join(root, dir, file), text)
      }
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

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

// Generated published barrels: each module may be renamed (declared ./m.js
// after, ./m before) in any import form, and one mutation may change a byte
// elsewhere. Renamed spellings alone pass and are each listed; a mutation fails.
const forms = [
  (s, n) => `export * as M${n} from "${s}";`,
  (s, n) => `export { value as v${n} } from "${s}";`,
  (s, n) => `import type { Value as V${n} } from "${s}";\nexport type T${n} = V${n};`,
  (s, n) => `export declare const c${n}: import("${s}").Value;`
]
const barrel = fc.array(fc.record({ form: fc.nat(forms.length - 1), renamed: fc.boolean(), directory: fc.boolean() }), { minLength: 1, maxLength: 5 })

test("published-specifier-equivalence: renamed spellings pass and are listed; semantic or invalid-declaration mutations fail", () => {
  fc.assert(fc.property(barrel, fc.option(fc.constantFrom("value", "Value", "export", ";"), { nil: undefined }), (modules, mutate) => {
    const before = {}, after = {}
    const lines = { before: [], after: [] }
    let renamed = 0
    modules.forEach(({ form, renamed: rename, directory }, n) => {
      const file = directory ? `m${n}/index.d.ts` : `m${n}.d.ts`
      const text = "export declare const value: number;\nexport type Value = number;\n"
      before[file] = after[file] = text
      const base = directory ? `./m${n}/index` : `./m${n}`
      lines.before.push(forms[form](rename ? base : base + ".js", n))
      lines.after.push(forms[form](base + ".js", n))
      if (rename) renamed++
    })
    before["index.d.ts"] = lines.before.join("\n") + "\n"
    after["index.d.ts"] = lines.after.join("\n") + "\n"
    if (mutate !== undefined && after["index.d.ts"].includes(mutate)) {
      after["index.d.ts"] = after["index.d.ts"].replace(mutate, mutate + "X")
      assert.equal(compare(before, after).identical, false)
      return
    }
    const result = compare(before, after)
    assert.equal(result.identical, true, JSON.stringify(result.changed))
    assert.equal(result.excused.length, renamed)
    for (const pair of result.excused) assert.equal(pair.after, pair.before + ".js")
  }), { seed: 31031, numRuns: 150 })
})
