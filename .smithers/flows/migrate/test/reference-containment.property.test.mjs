import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire, syncBuiltinESMExports } from "node:module"
import path, { dirname, join, relative, resolve, sep, isAbsolute } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { compileFunction } from "node:vm"
import { referenceRefreshPlan, refreshProjectReferences } from "../lib/reference-outputs.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-reference-output-containment.json", import.meta.url)))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), typeof text === "string" ? text : JSON.stringify(text)) }
function fixture(count = 1) {
  const root = mkdtempSync(join(tmpdir(), "reference-containment-"))
  put(root, "tsconfig.json", corpus.solution)
  put(root, "leaf/tsconfig.json", corpus.project)
  const tracked = ["tsconfig.json", "leaf/tsconfig.json"]
  for (let i = 0; i < count; i++) {
    const file = "leaf/src/f" + i + ".ts"
    put(root, file, corpus.source)
    tracked.push(file)
  }
  return { root, ts, configs: ["tsconfig.json"], changed: ["leaf/src/f0.ts"], tracked,
    cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
test("opencode reference-output containment grows with the source count rather than its square", t => {
  const samples = []
  for (const count of corpus.sizes) {
    const f = fixture(count), original = path.relative
    let comparisons = 0
    try {
      path.relative = (...args) => { comparisons++; return original(...args) }
      syncBuiltinESMExports()
      const plan = referenceRefreshPlan(f)
      samples.push({ count, comparisons })
      assert.equal(plan.outputs.length, 2 * count)
    } finally {
      path.relative = original
      syncBuiltinESMExports()
      f.cleanup()
    }
  }
  t.diagnostic(JSON.stringify(samples))
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].comparisons <= samples[i - 1].comparisons * 2.6 + 100,
      "doubling input must not quadruple containment comparisons: " + JSON.stringify(samples))
  }
})
const inside = (parent, child) => {
  const name = relative(parent, child)
  return name === "" || name !== ".." && !name.startsWith(".." + sep) && !isAbsolute(name)
}
const safePaths = ["leaf/out", "leaf/out/a.js", "leaf/out/deep/b.d.ts", "leaf/out2/a.js", "leaf/out.extra/a.js", "leaf/out/../other/a.js", "leaf/with space/雪.js", "leaf/dollar$sign/a.js", "leaf/with'apostrophe/a.js"]
test("indexed output ancestry agrees with the exhaustive path oracle", () => {
  fc.assert(fc.property(fc.subarray(safePaths, { minLength: 1 }), fc.integer({ min: 1, max: 5 }), (outputs, count) => {
    const f = fixture(count)
    try {
      const api = { ...ts, getOutputFileNames: () => outputs.map(name => resolve(f.root, name)) }
      const plan = referenceRefreshPlan({ ...f, ts: api })
      const paths = [...new Set(outputs.map(name => resolve(f.root, name)))]
      const expected = paths.filter(child => !paths.some(parent => parent !== child && inside(parent, child)))
        .sort().map(name => relative(f.root, name).split(sep).join("/"))
      assert.deepEqual(plan.outputs, expected)
      for (const file of f.tracked.filter(file => file.endsWith(".ts"))) assert.equal(readFileSync(join(f.root, file), "utf8"), corpus.source)
    } finally { f.cleanup() }
  }), { seed: 2026110743, numRuns: 160 })
})
test("source, configuration, root, external and protected-directory outputs are always refused before deletion", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(".", "leaf/src", "leaf/src/f0.ts", "leaf/tsconfig.json", ".jj/store", ".git/objects", "node_modules/cache", "../external"),
    fc.subarray(safePaths, { minLength: 1 }), async (unsafe, outputs) => {
      // A second input keeps the protected source in the candidate output set:
      // an emitter's source-to-itself pair is discarded before validation.
      const f = fixture(2)
      try {
        put(f.root, "leaf/out/stale.js", "keep")
        const api = { ...ts, getOutputFileNames: () => [...outputs, unsafe].map(name => resolve(f.root, name)) }
        await assert.rejects(refreshProjectReferences({ ...f, ts: api, compiler: "unused", log: join(f.root, "refresh.log"),
          execute: async () => assert.fail("unsafe plan executed") }), /unsafe project output/)
        assert.equal(readFileSync(join(f.root, "leaf/out/stale.js"), "utf8"), "keep")
        assert.equal(readFileSync(join(f.root, "leaf/src/f0.ts"), "utf8"), corpus.source)
        const receipt = JSON.parse(readFileSync(join(f.root, "refresh.log.json")))
        assert.equal(receipt.state, "planning-failed")
      } finally { f.cleanup() }
    }), { seed: 2026110744, numRuns: 96 })
})
test("reference planning records its stage before computing outputs and retains its elapsed time", async () => {
  const f = fixture()
  try {
    const log = join(f.root, "refresh.log")
    let observed = false
    const api = { ...ts, getOutputFileNames: (...args) => {
      assert.equal(existsSync(log + ".json"), true)
      const receipt = JSON.parse(readFileSync(log + ".json"))
      assert.equal(receipt.state, "planning")
      assert.equal(receipt.stage, "reference-planning")
      observed = true
      return ts.getOutputFileNames(...args)
    } }
    const result = await refreshProjectReferences({ ...f, ts: api, compiler: "unused", log, execute: async () => ({ code: 0 }) })
    assert.equal(observed, true)
    assert.equal(result.state, "complete")
    assert.ok(Number.isFinite(result.planningMs) && result.planningMs >= 0)
  } finally { f.cleanup() }
})

// Exercise the actual private indexes against Windows' exhaustive path oracle,
// including case aliases, on hosts whose filesystem uses different path rules.
test("Windows containment indexes preserve native case and separator boundaries", () => {
  const source = readFileSync(new URL("../lib/reference-outputs.mjs", import.meta.url), "utf8")
  const ast = ts.createSourceFile("reference-outputs.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const names = new Set(["pathKey", "descendantIndex", "outermostOutputs"])
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text) ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.getText(ast))))
  assert.equal(declarations.length, 3)
  const code = declarations.map(node => node.getFullText(ast)).join("\n") + "\nreturn { descendantIndex, outermostOutputs }"
  const api = path.win32
  const indexes = compileFunction(code, ["resolve", "dirname", "sep", "process"])(api.resolve, api.dirname, api.sep, { platform: "win32" })
  const base = "Z:" + api.sep + "fixture"
  const paths = ["build", "Build", "BUILD/a.js", "build/deep/b.d.ts", "build2/a.js", "build.extra/a.js", "build/deep/../c.js", "../outside/a.js"]
  const nativeInside = (parent, child) => {
    const name = api.relative(parent, child)
    return name === "" || name !== ".." && !name.startsWith(".." + api.sep) && !api.isAbsolute(name)
  }
  fc.assert(fc.property(fc.subarray(paths, { minLength: 1 }), fc.constantFrom(...paths), (selected, candidate) => {
    const absolute = [...new Set(selected.map(name => api.resolve(base, name)))]
    const parent = api.resolve(base, candidate)
    assert.equal(indexes.descendantIndex(absolute)(parent), absolute.some(child => nativeInside(parent, child)))
    assert.deepEqual(indexes.outermostOutputs(absolute), absolute.filter(child =>
      !absolute.some(other => other !== child && nativeInside(other, child))))
  }), { seed: 2026110745, numRuns: 200 })
})
