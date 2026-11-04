import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { referenceRefreshPlan, refreshProjectReferences } from "../lib/reference-outputs.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-dependent-project-outputs.json", import.meta.url)))

function fixture(count = 3) {
  const root = mkdtempSync(join(tmpdir(), "reference-outputs-"))
  const put = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value))
  }
  put("base.json", { compilerOptions: { composite: true, declaration: true, target: "ESNext", module: "ESNext" } })
  const configs = []
  for (let i = 0; i < count; i++) {
    const name = "p" + i
    configs.push(name + "/tsconfig.json")
    put(configs.at(-1), { extends: "../base.json", compilerOptions: {
      rootDir: "src", outDir: "lib", declarationDir: "types", tsBuildInfoFile: "cache/build.tsbuildinfo" },
      include: ["src"], references: i ? [{ path: "../p" + (i - 1) }] : [] })
    put(name + "/src/main.ts", "export const value = 1\n")
    for (const output of corpus.outputs) put(name + "/" + output, "stale")
  }
  return { root, put, configs, close: () => rmSync(root, { recursive: true, force: true }) }
}

test("renames and reverts clear effective outputs through reverse project references", async () => {
  const f = fixture()
  try {
    for (const extension of ["vibe", "ts"]) {
      rmSync(join(f.root, "p0/src/main.ts"), { force: true })
      rmSync(join(f.root, "p0/src/main.vibe"), { force: true })
      f.put("p0/src/main." + extension, "export const value = 2\n")
      let calls = 0
      const receipt = await refreshProjectReferences({ ...f, ts, changed: ["p0/src/main." + extension],
        compiler: "vibelang", log: join(f.root, "refresh.log"), execute: async (command) => {
          calls++
          for (let i = 0; i < 3; i++) for (const output of corpus.outputs) assert.equal(existsSync(join(f.root, "p" + i, output)), false)
          assert.match(command, /--build --force --pretty false 'p2\/tsconfig.json'/)
          assert.equal(JSON.parse(readFileSync(join(f.root, "refresh.log.json"))).state, "outputs-cleared")
          return { code: 0, stdout: "", stderr: "" }
        } })
      assert.equal(calls, 1)
      assert.equal(receipt.state, "complete")
      assert.deepEqual(receipt.projects, f.configs)
      assert.equal(existsSync(join(f.root, "p0/src/main." + extension)), true)
    }
  } finally { f.close() }
})

test("reference invalidation follows generated chain lengths and changed owners", () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 7 }), fc.nat(), (count, index) => {
    const f = fixture(count)
    try {
      index %= count
      const plan = referenceRefreshPlan({ ...f, ts, changed: ["p" + index + "/src/main.ts"] })
      assert.deepEqual(plan.projects, f.configs.slice(index))
      assert.deepEqual(plan.roots, [f.configs.at(-1)])
      assert.equal(plan.outputs.length, 3 * (count - index))
    } finally { f.close() }
  }), { numRuns: 30 })
})

test("unsafe effective output directories are refused before any deletion", async () => {
  const f = fixture()
  try {
    f.put("p1/tsconfig.json", { extends: "../base.json", compilerOptions: { outDir: "../", declarationDir: "types" },
      files: ["src/main.ts"], references: [{ path: "../p0" }] })
    await assert.rejects(refreshProjectReferences({ ...f, ts, changed: ["p0/src/main.ts"],
      compiler: "vibelang", log: join(f.root, "refresh.log") }), /unsafe project output/)
    assert.equal(existsSync(join(f.root, "p0/lib/main.js")), true)
  } finally { f.close() }
})

test("independent source projects preserve their existing outputs", () => {
  const f = fixture(1)
  try { assert.deepEqual(referenceRefreshPlan({ ...f, ts, changed: ["p0/src/main.ts"] }), { projects: [], roots: [], outputs: [] }) }
  finally { f.close() }
})

test("inherited output paths and default build-info names are effective project inputs", () => {
  const f = fixture(2)
  try {
    f.put("p0/options.json", { extends: "../base.json", compilerOptions: { rootDir: "src", outDir: "compiled", declarationDir: "declarations" } })
    f.put("p0/tsconfig.json", { extends: "./options.json", include: ["src"] })
    const plan = referenceRefreshPlan({ ...f, ts, changed: ["p0/src/main.ts"] })
    assert.ok(plan.outputs.includes("p0/compiled"))
    assert.ok(plan.outputs.includes("p0/declarations"))
    assert.ok(plan.outputs.includes("p0/tsconfig.tsbuildinfo"))
  } finally { f.close() }
})

test("failed rebuilds remain failed in the durable progress receipt", async () => {
  const f = fixture(2)
  try {
    const log = join(f.root, "failed.log")
    await assert.rejects(refreshProjectReferences({ ...f, ts, changed: ["p0/src/main.ts"], compiler: "vibelang", log,
      execute: async () => ({ code: 1, stdout: "error TS6305: referenced output missing\n", stderr: "" }) }), /reference rebuild failed/)
    assert.equal(JSON.parse(readFileSync(log + ".json")).state, "failed")
  } finally { f.close() }
})
