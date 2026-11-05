import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import * as C from "../lib/codemod.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-sidecar-layout-checkpoints.json", import.meta.url), "utf8"))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
function fixture(t, { inherited = false, inferred = true, source = "src", directory = "types" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sidecar-layout-checkpoint-"))
  t?.after(() => rmSync(root, { recursive: true, force: true }))
  put(root, "package.json", JSON.stringify({ type: "module", imports: { "#first": { types: "./first/" + source + "/main.d.vibe.ts" }, "#second": { types: "./second/" + source + "/main.d.vibe.ts" } } }))
  const tracked = ["package.json"], configs = []
  if (inherited) put(root, "base.json", JSON.stringify({ vibe: { sidecarDir: directory } }))
  for (const name of ["first", "second"]) {
    put(root, name + "/package.json", JSON.stringify({ name, exports: {
      "./main": { types: "./" + source + "/main.d.vibe.ts", default: "./" + source + "/main.vibe" },
      "./*": { types: "./" + source + "/*.d.vibe.ts", default: "./" + source + "/*.vibe" }
    } }))
    put(root, name + "/" + source + "/main.vibe", "export const value = 1\n")
    put(root, name + "/" + source + "/main.d.vibe.ts", "export declare const value: 1\n")
    put(root, name + "/tsconfig.json", JSON.stringify({
      ...(inherited ? { extends: "../base.json" } : { vibe: { sidecarDir: directory } }),
      compilerOptions: inferred ? {} : { rootDir: source }, files: [source + "/main.vibe"]
    }))
    tracked.push(name + "/package.json", name + "/" + source + "/main.vibe", name + "/" + source + "/main.d.vibe.ts")
    configs.push(name + "/tsconfig.json")
  }
  return { root, tracked, configs }
}
const manifests = f => [".", "first", "second"].map(name => readFileSync(join(f.root, name, "package.json"), "utf8"))
const reset = (f, saved) => [".", "first", "second"].forEach((name, i) => put(f.root, name + "/package.json", saved[i]))
function blockPrograms(root) {
  put(root, "node_modules/typescript/package.json", '{"name":"typescript","main":"index.cjs"}')
  put(root, "node_modules/typescript/index.cjs", "const ts=require(" + JSON.stringify(require.resolve("typescript")) + ");module.exports=new Proxy(ts,{get(target,key){if(key==='createProgram')return()=>{throw Error('checkpoint reloaded the import graph')};return Reflect.get(target,key)}})")
}
const plansFor = () => new Map([
  ["first", { owner: "first", sourceRoot: "src", directory: "types" }],
  ["second", { owner: "second", sourceRoot: "src", directory: "types" }]
])
test("restored inferred layouts refresh all routes without rereading source programs", t => {
  const f = fixture(t); blockPrograms(f.root)
  const changed = C.refreshSidecarExports(f.root, f.tracked, f.configs, { plans: plansFor() })
  assert.equal(changed.length, 6)
  for (const name of ["first", "second"]) {
    const pkg = JSON.parse(readFileSync(join(f.root, name, "package.json"), "utf8"))
    assert.equal(pkg.exports["./main"].types, "./types/main.d.vibe.ts")
    assert.equal(pkg.exports["./*"].types, "./types/*.d.vibe.ts")
  }
})
test("a completed owner layout can be saved before a later interruption", t => {
  const f = fixture(t), saved = manifests(f), plans = new Map()
  assert.throws(() => C.refreshSidecarExports(f.root, f.tracked, f.configs, {
    onPlan(owner, plan) { plans.set(owner, plan); throw Error("connection interrupted") }
  }), /connection interrupted/)
  assert.deepEqual([...plans.keys()], ["first"])
  assert.deepEqual(manifests(f), saved)
  assert.deepEqual(plans.get("first"), { owner: "first", sourceRoot: "src", directory: "types" })
})
test("cached owners skip planning while missing owners still receive a complete plan", t => {
  const f = fixture(t), planned = []
  const changes = C.refreshSidecarExports(f.root, f.tracked, f.configs, {
    plans: new Map([["first", plansFor().get("first")]]),
    onPlan(owner, plan) { planned.push([owner, plan]) }
  })
  assert.equal(changes.length, 6)
  assert.deepEqual(planned, [["second", plansFor().get("second")]])
})
test("a layout cannot be replayed for another package", t => {
  const f = fixture(t), saved = manifests(f)
  assert.throws(() => C.refreshSidecarExports(f.root, f.tracked, f.configs, {
    plans: new Map([["first", plansFor().get("second")]])
  }), /layout.*owner|owner.*layout/i)
  assert.deepEqual(manifests(f), saved)
})
test("ordinary refresh remains idempotent without saved layouts", t => {
  const f = fixture(t)
  assert.equal(C.refreshSidecarExports(f.root, f.tracked, f.configs).length, 6)
  assert.deepEqual(C.refreshSidecarExports(f.root, f.tracked, f.configs), [])
})
test("property: serialized checkpoints preserve the complete selected route result", () => {
  fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.constantFrom("src", "deep/src", "source.with.dot"), fc.constantFrom("types", ".hidden/decl", "generated/types"), (inherited, inferred, source, directory) => {
    const f = fixture(null, { inherited, inferred, source, directory })
    try {
      const saved = manifests(f), plans = new Map()
      const expected = C.refreshSidecarExports(f.root, f.tracked, f.configs, { onPlan(owner, plan) { plans.set(owner, plan) } })
      const result = manifests(f)
      reset(f, saved)
      const replay = new Map(JSON.parse(JSON.stringify([...plans])))
      assert.equal(replay.size, 2)
      const actual = C.refreshSidecarExports(f.root, f.tracked, f.configs, {
        plans: replay, onPlan() { throw Error("replanned a completed layout") }
      })
      assert.deepEqual(actual, expected)
      assert.deepEqual(manifests(f), result)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }), { examples: [[corpus.input.inherited, corpus.input.inferred, corpus.input.source, corpus.input.directory]], seed: corpus.seed, numRuns: Number(process.env.FC_RUNS || 64) })
})

test("layout plans contain portable paths for the owning package", t => {
  const f = fixture(t)
  const plan = C.sidecarPlanOf(f.root, "first")
  assert.deepEqual(plan, plansFor().get("first"))
  assert.equal(JSON.stringify(plan).includes(f.root), false)
})
test("the checkpoint corpus quotes the declaration root rule", () => {
  const chapter = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
  assert.ok(chapter.includes(corpus.quote))
})

test("a restored beside layout keeps its selected declaration while another owner moves", t => {
  const f = fixture(t)
  const file = join(f.root, "second/tsconfig.json")
  const config = JSON.parse(readFileSync(file, "utf8"))
  delete config.vibe
  writeFileSync(file, JSON.stringify(config))
  blockPrograms(f.root)
  const plans = new Map([["first", plansFor().get("first")], ["second", null]])
  const changes = C.refreshSidecarExports(f.root, f.tracked, f.configs, { plans })
  assert.equal(changes.length, 3)
  const root = JSON.parse(readFileSync(join(f.root, "package.json"), "utf8"))
  assert.equal(root.imports["#first"].types, "./first/types/main.d.vibe.ts")
  assert.equal(root.imports["#second"].types, "./second/src/main.d.vibe.ts")
  const second = JSON.parse(readFileSync(join(f.root, "second/package.json"), "utf8"))
  assert.equal(second.exports["./main"].types, "./src/main.d.vibe.ts")
})
