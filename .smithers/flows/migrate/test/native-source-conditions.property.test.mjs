import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-bun-source-native-root.json", import.meta.url), "utf8"))
const rule = "A rewrite that can't preserve types, behavior and declaration output refuses at that site"
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

test("native source condition oracle quotes the tooling specification", () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(rule))
})

function scenario({ nodeSource = false, field = "exports", nested = false, array = false, shadowed = false, condition = "bun", query = true, runtime = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "native-source-condition-"))
  try {
    const entry = field === "exports" ? "./Git" : "#Git"
    const source = "./src/Git.ts", compiled = "./.vibelang/js/src/Git.js"
    let selection = nodeSource ? { import: "./lib/Git.js", require: source, default: "./lib/Git.js" }
      : { [condition]: source, default: "./lib/Git.js" }
    if (shadowed) selection = { default: "./lib/Git.js", ...Object.fromEntries(Object.entries(selection).filter(([key]) => key !== "default")) }
    if (nested) selection = { types: "./lib/Git.d.ts", node: selection, default: "./lib/Git.js" }
    if (array) selection = [selection, "./lib/fallback.js"]
    const original = { name: "@fixture/mixed", type: "module", [field]: { [entry]: selection } }
    put(root, "package.json", JSON.stringify(original))
    const outputs = { "./src/effect.vibe": "./.vibelang/js/src/effect.js", "./src/Git.ts": compiled, "./src/WorkerLoader.ts": "./.vibelang/js/src/WorkerLoader.js" }
    const body = query ? corpus.source : corpus.source.replace("?worker", "")
    put(root, corpus.module, body)
    put(root, corpus.worker, corpus.workerSource)
    put(root, "src/effect.vibe", "export const answer = 42\n")
    put(root, ".vibelang/js/src/effect.js", "export const answer = 42\n")
    put(root, compiled, body)
    put(root, ".vibelang/js/src/WorkerLoader.js", corpus.workerSource)
    const host = [
      'import assert from "node:assert/strict";',
      'import { plugin } from "bun";',
      'plugin({name:"worker-source-context",setup(build){',
      'build.onResolve({filter:/\\?worker$/},args=>{',
      'assert.equal(args.importer,' + JSON.stringify(join(root, corpus.module)) + ');',
      'return {path:"loader",namespace:"worker-resource"};',
      '});',
      'build.onLoad({filter:/.*/,namespace:"worker-resource"},()=>({contents:"export default class WorkerLoader {}",loader:"js"}));',
      '}});',
      'const result=await import("@fixture/mixed/Git");',
      'assert.equal(result.loader.name,"WorkerLoader");',
    ].join("\n")
    const run = () => {
      put(root, "host.mjs", host)
      const result = spawnSync("bun", ["host.mjs"], { cwd: root, encoding: "utf8", timeout: 30000 })
      assert.equal(result.status, 0, (result.stdout ?? "") + (result.stderr ?? ""))
    }
    if (runtime) run()
    let graph
    routeEmittedExports(root, outputs, { typescript: ts, onGraph: value => graph = value })
    const actual = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    assert.equal(graph.mode, "component")
    assert.equal(graph.nativeRuntimeRoots, nodeSource && !shadowed ? 1 : 0)
    assert.equal(graph.selected, nodeSource && !shadowed ? 3 : 1)
    if (!nodeSource || shadowed) assert.deepEqual(actual[field], original[field], "a source condition unused by Node keeps its authored target")
    else assert.ok(JSON.stringify(actual[field]).includes(compiled), "a Node source branch still gets its emitted dependency graph")
    if (runtime) run()
    const once = readFileSync(join(root, "package.json"), "utf8")
    assert.equal(routeEmittedExports(root, outputs, { typescript: ts }), false)
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), once)
    routeEmittedExports(root, {}, { restore: true })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("alchemy: a Bun worker source entry keeps its original plugin context", () => scenario({ runtime: true }))
test("Node require source branches still route while earlier defaults stay authoritative", () => {
  for (const shadowed of [false, true]) scenario({ nodeSource: true, shadowed })
})
test("property: native source routing follows each runtime's ordered conditions", async () => checkProperty(fc, {
  name: "native-source-runtime-conditions", rule,
  command: "node --test .smithers/flows/migrate/test/native-source-conditions.property.test.mjs",
  arbitrary: fc.record({ nodeSource: fc.boolean(), field: fc.constantFrom("exports", "imports"), nested: fc.boolean(), array: fc.boolean(), shadowed: fc.boolean(), condition: fc.constantFrom("bun", "worker", "browser", "development"), query: fc.boolean() }),
  numRuns: 160, check: scenario
}))

