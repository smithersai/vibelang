import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { referenceRefreshPlan, refreshProjectReferences } from "../lib/reference-outputs.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-independent-reference-refresh.json", import.meta.url)))
assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(corpus.rule))
assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.flowRule))

function fixture({ count = 1, umbrella = false, protectedOutput = false, extension = "ts" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "independent-reference-refresh-"))
  const put = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value))
  }
  const configs = [], changed = [], tracked = []
  for (const [name, references] of [["producer", []], ["consumer", [{ path: "../producer" }]]]) {
    const base = "packages/" + name
    configs.push(base + "/tsconfig.json")
    put(configs.at(-1), { compilerOptions: { composite: true, declaration: true, rootDir: "src", outDir: "dist" },
      include: ["src"], references })
    put(base + "/src/main.ts", "export const value = 1")
    put(base + "/dist/main.js", "old output")
  }
  changed.push("packages/producer/src/main.ts")
  const independentOutputs = []
  for (let i = 0; i < count; i++) {
    const base = i ? "packages/independent" + i : corpus.project
    configs.push(base + "/tsconfig.json")
    put(configs.at(-1), { compilerOptions: { rootDir: "src", outDir: "dist", declaration: true }, include: ["src"] })
    const source = base + "/src/main." + extension
    put(source, "export const value = 1")
    changed.push(source)
    const output = base + "/dist/main.d.ts"
    put(output, "export declare const value: number")
    independentOutputs.push(output)
    if (protectedOutput) tracked.push(output)
  }
  if (umbrella) {
    configs.push("tsconfig.json")
    put("tsconfig.json", { compilerOptions: { noEmit: true }, include: ["packages/*/src"] })
  }
  return { root, configs, changed, tracked, independentOutputs, put,
    close: () => rmSync(root, { recursive: true, force: true }) }
}

test("changed independent packages are excluded from reference refresh", () => {
  const f = fixture()
  try {
    const plan = referenceRefreshPlan({ ...f, ts })
    assert.deepEqual(plan.projects, ["packages/consumer/tsconfig.json", "packages/producer/tsconfig.json"])
    assert.deepEqual(plan.roots, ["packages/consumer/tsconfig.json"])
    assert.ok(plan.outputs.every(file => !file.startsWith(corpus.project + "/")))
  } finally { f.close() }
})

test("independent declarations and overlapping source-only projects remain intact", async () => {
  const f = fixture({ protectedOutput: true, umbrella: true })
  try {
    const result = await refreshProjectReferences({ ...f, ts, compiler: "compiler", log: join(f.root, "refresh.log"),
      execute: async () => {
        for (const file of f.independentOutputs) assert.equal(readFileSync(join(f.root, file), "utf8"), "export declare const value: number")
        assert.equal(existsSync(join(f.root, "packages/producer/dist/main.js")), false)
        return { code: 0, stdout: "", stderr: "" }
      } })
    assert.equal(result.state, "complete")
  } finally { f.close() }
})

test("generated mixed project graphs preserve the independent output set", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.boolean(), fc.constantFrom("ts", "vibe", "vibex"),
    (count, umbrella, extension) => {
      const f = fixture({ count, umbrella, extension, protectedOutput: true })
      try {
        const plan = referenceRefreshPlan({ ...f, ts })
        assert.deepEqual(plan.projects, ["packages/consumer/tsconfig.json", "packages/producer/tsconfig.json"])
        assert.deepEqual(plan.roots, ["packages/consumer/tsconfig.json"])
        for (const file of f.independentOutputs) assert.ok(existsSync(join(f.root, file)))
      } finally { f.close() }
    }), { numRuns: 30, seed: 1066 })
})

test("tracked declarations in an affected reference output remain protected", () => {
  const f = fixture()
  try {
    const file = "packages/producer/dist/authored.d.ts"
    f.put(file, "export declare const authored: number")
    assert.throws(() => referenceRefreshPlan({ ...f, ts, tracked: [file] }), /unsafe project output/)
    assert.equal(readFileSync(join(f.root, file), "utf8"), "export declare const authored: number")
  } finally { f.close() }
})

test("an independent-only change needs no reference compiler", () => {
  const f = fixture()
  try { assert.deepEqual(referenceRefreshPlan({ ...f, ts, changed: f.changed.slice(1) }), { projects: [], roots: [], outputs: [] }) }
  finally { f.close() }
})

test("a refused output records its protected source before any cleanup", async () => {
  const f = fixture()
  try {
    const file = "packages/producer/dist/authored.d.ts", log = join(f.root, "refresh.log")
    f.put(file, "export declare const authored: number")
    await assert.rejects(refreshProjectReferences({ ...f, ts, tracked: [file], compiler: "compiler", log }), /unsafe project output/)
    const receipt = JSON.parse(readFileSync(log + ".json"))
    assert.equal(receipt.state, "planning-failed")
    assert.equal(receipt.stage, "reference-planning")
    assert.equal(receipt.details.output, "packages/producer/dist")
    assert.deepEqual(receipt.details.protectedSources, [file])
    assert.equal(existsSync(join(f.root, "packages/producer/dist/main.js")), true)
    assert.equal(readFileSync(join(f.root, file), "utf8"), "export declare const authored: number")
  } finally { f.close() }
})
