import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import rolldownPlugin from "../src/rolldown.js"

const require = createRequire(new URL("../package.json", import.meta.url))
const fc = require("fast-check")
const glob = require("fast-glob")
const fixture = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-sidecar-entry-glob.json", import.meta.url), "utf8"))
const quote = "Type checkers work through " + String.fromCharCode(96) + ".d.vibe.ts" + String.fromCharCode(96) + ", and linters, Knip, bundlers and test runners each read " + String.fromCharCode(96) + ".vibe" + String.fromCharCode(96) + "."
test("the entry oracle keeps the published tool interoperability contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})

function probe(input, selectsSidecars) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-sidecar-entry-"))
  try {
    for (const name of input.names) {
      for (const ext of ["vibe", "d.vibe.ts"]) {
        const path = join(root, "src", name + "." + ext)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, ext === "vibe" ? "export const value = 1\n" : "export declare const value: 1\n")
      }
    }
    writeFileSync(join(root, "src", "ordinary.ts"), "export const ordinary = 1\n")
    // Exercise the real glob engine used for expanded build inputs. The raw
    // positive proves why declaration entry filtering is necessary.
    const expanded = glob.sync(input.patterns, { cwd: root, onlyFiles: true }).sort()
    const expected = ["src/ordinary.ts", ...input.names.map(name => "src/" + name + ".vibe")].sort()
    assert.ok(expected.every(name => expanded.includes(name)), "fixture must select all source entries")
    const sidecars = expanded.filter(name => name.endsWith(".d.vibe.ts"))
    assert.equal(sidecars.length, selectsSidecars ? input.names.length : 0)
    const plugin = rolldownPlugin({ root })
    assert.ok(!Array.isArray(plugin), "the real Rolldown integration is one plugin")
    const hook = typeof plugin.options === "function" ? plugin.options : plugin.options.handler
    const output = hook.call({}, { input: expanded, platform: "node" })
    const actual = (output?.input ?? expanded).slice().sort()
    assert.deepEqual(actual, expected, "alchemy-61: declaration sidecars are not bundler source entries")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
test(fixture.key, () => probe(fixture.input, true))
test("explicit exclusions preserve every source entry", () => probe({ ...fixture.input, patterns: [...fixture.input.patterns, "!**/*.d.vibe.ts"] }, false))
test("expanded entry inputs vary nesting, basename punctuation and source counts", () => {
  fc.assert(fc.property(fc.record({
    depth: fc.integer({ min: 0, max: 3 }),
    count: fc.integer({ min: 1, max: 5 }),
    punct: fc.constantFrom("Plugin", "RuntimeError.shared", "HttpServer", "RuntimeServices"),
  }), ({ depth, count, punct }) => {
    const names = Array.from({ length: count }, (_, i) => "nested/".repeat(depth) + punct + i)
    const input = { names, patterns: ["src/**/*.ts", "src/**/*.vibe"] }
    probe(input, true)
    probe({ ...input, patterns: [...input.patterns, "!**/*.d.vibe.ts"] }, false)
  }), { seed: 610127, numRuns: 36, endOnFailure: true })
})
