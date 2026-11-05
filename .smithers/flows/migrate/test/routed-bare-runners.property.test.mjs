import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { bareRunnerDeferrals } from "../lib/bare-runners.mjs"
import { routeBundledImports } from "../lib/bundled-imports.mjs"
import { buildInventory } from "../lib/inventory.mjs"
import { planScope } from "../lib/onepass.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const ts = loadTypeScript([join(repo, "packages/runtime"), join(repo, "packages/compiler/test/eslint"), join(repo, ".smithers")])
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-routed-bare-runner.json", import.meta.url)))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const packages = [{ dir: ".", sources: ["src"] }]
function fixture(depth = 1, protectedEntry = false) {
  const root = mkdtempSync(join(tmpdir(), "routed-bare-runner-"))
  const entry = protectedEntry ? "test/run.ts" : corpus.entry
  put(root, "package.json", JSON.stringify({ name: "fixture", type: "module", exports: { "./leaf": "./src/leaf.ts" }, scripts: { [protectedEntry ? "test" : "start"]: "node " + entry } }))
  put(root, "tsconfig.json", JSON.stringify({ include: ["src"] }))
  put(root, entry, corpus.body.replace("./leaf.ts", protectedEntry ? "../src/leaf.ts" : "./leaf.ts"))
  const chain = Array.from({ length: depth }, (_, i) => i ? `src/leaf${i}.ts` : corpus.dependency)
  for (const [i, file] of chain.entries()) put(root, file, i + 1 < depth ? `export { value } from "./leaf${i + 1}.ts"\n` : `export const value = ${corpus.value}\n`)
  put(root, "src/free.ts", "export const unrelated = 1\n")
  return { root, entry, chain, selected: [entry, ...chain, "src/free.ts"] }
}
test("routed planning retains a bare entry but admits its library dependencies", () => {
  const f = fixture()
  try {
    const plan = planScope(f.root, f.selected, { routeBundledImports: true })
    assert.deepEqual(plan.batches[0].files, [...f.chain, "src/free.ts"])
    assert.deepEqual(plan.deferred.map(d => d.file), [f.entry])
    const inventory = buildInventory({ root: f.root, packages, routedBundles: true })
    assert.equal(inventory.files.find(f => f.path === corpus.dependency).bareRunReason, undefined)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
test("protected native entry keeps its directly imported source native", () => {
  const f = fixture(3, true)
  try {
    const before = readFileSync(join(f.root, f.entry), "utf8")
    const result = bareRunnerDeferrals(f.root, f.selected, { routed: true })
    assert.deepEqual(result.deferred.map(d => d.file), [f.chain[0], f.entry].sort())
    assert.equal(readFileSync(join(f.root, f.entry), "utf8"), before)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
test("native routing executes the unchanged bare command after the dependency migrates", () => {
  const f = fixture()
  try {
    renameSync(join(f.root, corpus.dependency), join(f.root, "src/leaf.vibe"))
    put(f.root, f.entry, corpus.body.replace("./leaf.ts", "./leaf.vibe"))
    put(f.root, ".vibelang/js/src/leaf.js", "export const value = 42\n")
    const execute = () => spawnSync(process.execPath, [f.entry], { cwd: f.root, encoding: "utf8" })
    assert.notEqual(execute().status, 0)
    const routed = routeBundledImports({ root: f.root, packages, ts, native: true })
    assert.deepEqual(routed.modules, ["src/leaf.vibe"])
    const result = execute()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), "42")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
test("property: routed native edges cut dependency holds while direct protected entries stay native", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("planning retains bare entrypoints and direct protected test imports"))
  fc.assert(fc.property(fc.integer({ min: 1, max: 7 }), fc.boolean(), fc.boolean(), (depth, protectedEntry, routed) => {
    const f = fixture(depth, protectedEntry)
    try {
      const result = bareRunnerDeferrals(f.root, f.selected, { routed })
      const expected = !routed ? [f.entry, ...f.chain] : protectedEntry ? [f.entry, f.chain[0]] : [f.entry]
      assert.deepEqual(result.deferred.map(d => d.file), expected.sort())
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }), { seed: 1066699, numRuns: 40 })
})
