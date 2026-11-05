import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { test } from "node:test"
import { planScope, onePassStep } from "../lib/onepass.mjs"
import { paths } from "../lib/steps.mjs"
import { must, writeJson } from "../lib/util.mjs"
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-routed-plan.json", import.meta.url)))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
function fixture(suffix = 0, depth = 1) {
  const root = mkdtempSync(join(tmpdir(), "migrate-routed-plan-"))
  const target = join(root, "repo"), run = join(root, "run")
  put(target, "package.json", JSON.stringify({ name: "fixture", type: "module", scripts: { test: "bun test" } }))
  put(target, "tsconfig.json", JSON.stringify({ include: ["src"] }))
  const chain = Array.from({ length: depth }, (_, i) => `src/leaf${suffix}_${i}.ts`)
  for (const [i, file] of chain.entries()) put(target, file, i + 1 < chain.length ? `export { value } from "./leaf${suffix}_${i + 1}.ts"\n` : "export const value = 42\n")
  put(target, "src/entry.ts", `export { value } from "./leaf${suffix}_0.ts"\n`)
  put(target, "src/unrelated.ts", "export const other = 1\n")
  put(target, "test/bundle.test.ts", corpus.test)
  return { root, target, run, selected: [...chain, "src/unrelated.ts"] }
}

test("routing-enabled scope keeps bundle dependencies while its native entry and test stay unchanged", () => {
  const f = fixture()
  try {
    const before = readFileSync(join(f.target, "test/bundle.test.ts"), "utf8")
    const plan = planScope(f.target, f.selected, { routeBundledImports: true })
    assert.deepEqual(plan.batches[0].files, f.selected)
    assert.deepEqual(plan.deferred, [])
    assert.equal(readFileSync(join(f.target, "test/bundle.test.ts"), "utf8"), before)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("one-pass plan forwards the configured bundle routing policy", async () => {
  const f = fixture()
  try {
    await must("jj git init", { cwd: f.target })
    writeJson(paths(f.run).config, { target: f.target, packages: [{ dir: ".", tsconfig: "tsconfig.json" }], routeBundledImports: true })
    put(f.run, "scope.txt", f.selected.join("\n") + "\n")
    const { plan } = await onePassStep("plan", { run: f.run, scope: join(f.run, "scope.txt") })
    assert.deepEqual(plan.batches[0].files, f.selected)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("property: routing admits reached dependencies; an unwired bundle still defers them", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("`--route-bundled-imports` permits planning modules in unchanged source bundle graphs"))
  fc.assert(fc.property(fc.nat(99), fc.integer({ min: 1, max: 6 }), fc.boolean(), (suffix, depth, routed) => {
    const f = fixture(suffix, depth)
    try {
      const plan = planScope(f.target, f.selected, { routeBundledImports: routed })
      assert.deepEqual(plan.batches[0].files, routed ? f.selected : ["src/unrelated.ts"])
      assert.deepEqual(plan.deferred.map(d => d.file).sort(), routed ? [] : f.selected.filter(f => f !== "src/unrelated.ts").sort())
      assert.equal(readFileSync(join(f.target, "test/bundle.test.ts"), "utf8"), corpus.test)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }), { seed: 106632, numRuns: 40 })
})
