import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const rule = "Unrelated native export paths stay as written."
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-unreachable-opaque-runtime.json", import.meta.url), "utf8"))
const put = (root, name, text) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text) }

function scenario({ edge = "dynamic", reachable = "none", depth = 1, pattern = false, reverse = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "opaque-runtime-reachability-"))
  try {
    const original = {
      name: "@fixture/opaque", type: "module",
      exports: pattern ? { "./*": "./src/*.ts", "./private": null } : {
        "./facade": "./src/facade.ts", "./shared": "./src/shared.ts",
        ...(reachable === "public" ? { "./private": "./src/private.ts" } : {})
      }
    }
    // A wildcard makes src/private.ts public unless an exact null entry masks it.
    if (pattern && reachable === "public") original.exports["./private"] = "./src/private.ts"
    put(root, "package.json", JSON.stringify(original))
    const outputs = {}
    const add = (name, source, emitted = source) => {
      put(root, "src/" + name, source)
      const output = "./.vibelang/js/src/" + name.replace(/\.(?:vibe|ts)$/, ".js")
      put(root, output, emitted)
      outputs["./src/" + name] = output
    }
    add("leaf.vibe", 'export { token } from "./shared.ts"\n',
      'export { token } from "./shared.js"\n' + (reachable === "vibe" ? 'import "./private.js"\n' : ""))
    add("shared.ts", "export const token = {}\n")
    add("facade.ts", "export const provided = 42\n")
    const opaque = edge === "dynamic" ? 'const name = "./shared.js"; import(name)\n'
      : edge === "require" ? 'const name = "./shared.js"; require(name)\n'
      : 'import "./absent.js"\n'
    add("private.ts", 'import "./shared.js"\n' + opaque)
    // An outgoing chain makes the opaque witness transitively reachable.
    for (let i = 0; i < depth; i++) {
      const next = i + 1 === depth ? "private" : "chain" + (i + 1)
      add("chain" + i + ".ts", 'import "./' + next + '.js"\n')
      if (pattern) original.exports["./chain" + i] = null
    }
    if (reachable === "transitive") {
      const text = 'import "./chain0.js"\nexport const provided = 42\n'
      put(root, "src/facade.ts", text); put(root, outputs["./src/facade.ts"], text)
    }
    put(root, "package.json", JSON.stringify(original))
    let graph
    const entries = Object.entries(outputs)
    routeEmittedExports(root, Object.fromEntries(reverse ? entries.reverse() : entries), { typescript: ts, onGraph: value => graph = value })
    const after = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    if (reachable === "none") {
      assert.equal(graph.mode, "component", JSON.stringify(graph))
      assert.equal(after.exports["./facade"] ?? after.exports["./*"], pattern ? "./src/*.ts" : "./src/facade.ts", "an unused private fixture cannot redirect the native facade")
      assert.equal(graph.selected, 2, "shared singleton and Vibe leaf remain on the emitted graph")
      assert.ok(graph.ignoredOpaque.includes("src/private.ts"))
    } else {
      assert.equal(graph.mode, "package", "reachable opaque imports keep conservative routing")
      assert.equal(graph.reason, "opaque runtime module edge")
      assert.equal(graph.source, "src/private.ts", "receipt names the first opaque source")
      assert.ok(graph.live >= 3)
    }
    assert.equal((after.exports["./shared"] ?? after.exports["./*"]).default.replace("*", "shared"), "./.vibelang/js/src/shared.js", "public singleton shares the Vibe graph")
    const once = readFileSync(join(root, "package.json"), "utf8")
    assert.equal(routeEmittedExports(root, outputs, { typescript: ts }), false)
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), once)
    routeEmittedExports(root, {}, { restore: true })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode: an unreachable opaque fixture preserves native export identity", () => scenario(corpus.input))
test("reachable opaque modules retain conservative package routing", () => {
  for (const reachable of ["vibe", "public", "transitive"]) scenario({ reachable })
})
test("opaque reachability oracle quotes the migration contract", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(rule))
})
test("property: opaque reachability preserves native entries and shared components", async () => checkProperty(fc, {
  name: "opaque-runtime-reachability", rule,
  command: "node --test .smithers/flows/migrate/test/opaque-runtime-reachability.property.test.mjs",
  regressions: new URL("./corpus/", import.meta.url), numRuns: 120,
  arbitrary: fc.record({
    edge: fc.constantFrom("dynamic", "require", "unresolved"),
    reachable: fc.constantFrom("none", "vibe", "public", "transitive"),
    depth: fc.integer({ min: 1, max: 5 }), pattern: fc.boolean(), reverse: fc.boolean()
  }),
  check: scenario
}))
