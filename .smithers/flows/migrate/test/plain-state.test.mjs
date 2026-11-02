// The plain marks run inside the codemod's durable state (migflow-foldkit's
// prepareState), so a resumed or reverted batch carries them like every other
// prepared edit. Before this, main's codemod wrote no `: infer _` at all and
// t3code's schema factories compiled as Effect functions (EK1001).
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { applyState, prepareState } from "../lib/codemod-state.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const tsconfig = JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: ["node"], skipLibCheck: true } })
const groups = [{ files: ["m.ts"], tsconfigs: ["tsconfig.json"] }]

function project(t, text, { privatePackage = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-plain-state-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  symlinkSync(join(runtime, "node_modules"), join(root, "node_modules"))
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", ...(privatePackage ? { private: true } : {}) }))
  writeFileSync(join(root, "tsconfig.json"), tsconfig)
  writeFileSync(join(root, "m.ts"), text)
  return root
}

test("t3code: prepareState marks a schema factory and applyState writes the mark into the .vibe module", (t) => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-pure-schema-factory.json", import.meta.url), "utf8"))
  const root = project(t, corpus.before)
  const state = prepareState(root, ["m.ts"], ["m.ts"], { ts, plainGroups: groups })
  assert.ok(state.plain["m.ts"]?.marked >= 1, JSON.stringify(state.plain))
  assert.equal(readFileSync(join(root, "m.ts"), "utf8"), corpus.before, "nothing is written before applyState")
  applyState(root, state)
  assert.equal(existsSync(join(root, "m.ts")), false)
  assert.equal(readFileSync(join(root, "m.vibe"), "utf8"), corpus.after, corpus.key)
})

test("the marks read the platform split's text, so they land on the functions that stay in the module", (t) => {
  const root = project(t, [
    'import { readFileSync } from "node:fs"',
    "export const load = (p: string): string => readFileSync(p, \"utf8\")",
    "export const twice = (n: number) => n * 2",
    ""
  ].join("\n"), { privatePackage: true })
  const state = prepareState(root, ["m.ts"], ["m.ts"], { ts, plainGroups: groups })
  applyState(root, state)
  const text = readFileSync(join(root, "m.vibe"), "utf8")
  assert.match(text, /export const twice = \(n: number\): infer _ => n \* 2/)
  assert.doesNotMatch(text, /readFileSync/, "the platform code moved to m.platform.ts")
  assert.equal(state.platform.splits.length, 1)
})

test("for generated plain helpers, the prepared module is the TypeScript with `: infer _` after each unannotated signature", (t) => {
  const helper = fc.record({ name: fc.constantFrom("a", "b", "c", "d"), arrow: fc.boolean(), body: fc.constantFrom("n + 1", "n * 2", "String(n)", "[n]") })
  fc.assert(fc.property(fc.uniqueArray(helper, { minLength: 1, maxLength: 4, selector: (h) => h.name }), (helpers) => {
    const line = (h, mark) => h.arrow
      ? `export const ${h.name} = (n: number)${mark} => ${h.body}`
      : `export function ${h.name}(n: number)${mark} { return ${h.body} }`
    const before = helpers.map((h) => line(h, "")).join("\n") + "\n"
    const root = project(t, before)
    const state = prepareState(root, ["m.ts"], ["m.ts"], { ts, plainGroups: groups })
    applyState(root, state)
    assert.equal(readFileSync(join(root, "m.vibe"), "utf8"), helpers.map((h) => line(h, ": infer _")).join("\n") + "\n")
    assert.equal(state.plain["m.ts"].marked, helpers.length)
  }), { seed: 1101, numRuns: 25 })
})

test("plain marks preserve a published package's platform-split refusal", (t) => {
  const source = 'import { readFileSync } from "node:fs"\nexport const load = (p: string): string => readFileSync(p, "utf8")\nexport const twice = (n: number) => n * 2\n'
  const root = project(t, source)
  const state = prepareState(root, ["m.ts"], ["m.ts"], { ts, plainGroups: groups })
  assert.equal(state.platform.splits.length, 0)
  assert.ok(state.platform.refused.some(reason => /published/.test(reason)), JSON.stringify(state.platform))
  assert.equal(existsSync(join(root, "m.platform.ts")), false)
  assert.equal(readFileSync(join(root, "m.ts"), "utf8"), source, "preparation remains read-only")
  const prepared = state.writes.find(write => write.file === "m.vibe").after
  assert.match(prepared, /readFileSync\(p, "utf8"\)/)
  assert.match(prepared, /twice = \(n: number\): infer _ => n \* 2/)
})
