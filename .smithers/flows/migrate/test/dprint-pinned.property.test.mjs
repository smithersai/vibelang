import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-pinned-dprint-rerun.json", import.meta.url)))
const shipped = "npm:vibelang/dprint-plugin.json"
const raw = process.env.VIBELANG_DPRINT_PINNED_RAW === "1"
const quote = "Existing tools work."

function scenario(input) {
  const root = mkdtempSync(join(tmpdir(), "vibe-dprint-pins-"))
  try {
    const dir = input.directory
    const put = (file, value) => {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), JSON.stringify(value))
    }
    put("package.json", { name: "root", workspaces: ["packages/*"] })
    if (dir === ".") put("package.json", { name: "root", workspaces: ["packages/*"], scripts: { fmt: input.command } })
    else put(join(dir, "package.json"), { name: "app", scripts: { fmt: input.command } })
    const configFile = join(dir, "dprint.json")
    put(configFile, {
      plugins: [...input.plugins, ...(input.stale ? [shipped] : [])],
      includes: ["src/**/*.ts"], excludes: ["**/dist"], lineWidth: input.width,
    })
    const first = wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) })
    const config = JSON.parse(readFileSync(join(root, configFile)))
    const pkg = JSON.parse(readFileSync(join(root, dir, "package.json")))
    assert.deepEqual(config.plugins.slice(0, input.plugins.length), input.plugins, "native checksums and order survive")
    assert.equal(config.lineWidth, input.width)
    assert.ok(config.includes.includes("src/**/*.ts"))
    assert.ok(config.excludes.includes("**/dist"))
    assert.ok(config.excludes.includes("**/*.d.vibe.ts"))
    assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) }).changed, [], "rerunning setup is idempotent")
    const wanted = /dprint\s+check\b/.test(input.command) ? "--check" : "--write"
    if (input.stale && !raw) {
      assert.equal(corpus.pending.owner, "migfix-smithers")
      assert.equal(corpus.pending.key, "smithers:pinned-dprint:stale-own-plugin")
      const fallback = "https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a"
      const legacy = [...input.plugins, shipped, ...input.plugins.some(p => /typescript.*\.wasm/.test(p)) ? [] : [fallback]]
      assert.deepEqual(config.plugins, legacy, "XPASS: retire only the stale own-plugin gap")
      assert.equal(pkg.scripts.fmt, input.command, "only the exact stale classification gap is pending")
      assert.ok(!first.warnings.some(w => w.includes("pins every plugin by checksum")), "the pending failure is stale pinned-config recognition")
      return
    }
    assert.deepEqual(config.plugins, input.plugins, corpus.pending.key)
    const suffix = " && vibelang-format " + wanted
    assert.ok(pkg.scripts.fmt.endsWith(suffix))
    assert.ok([input.command, "(" + input.command + ")"].includes(pkg.scripts.fmt.slice(0, -suffix.length)), "original command remains grouped")
    assert.ok(first.warnings.some(w => w.includes("pins every plugin by checksum")))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("pinned dprint setup oracle quotes the tooling chapter", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})
test("Smithers minimized pinned plugin configuration covers fresh and earlier setup", () => {
  scenario({ ...corpus.input, stale: false })
  scenario(corpus.input)
})
test("pinned plugin neighbourhood retains checksums, scopes, format modes and rerun identity", () => {
  fc.assert(fc.property(fc.record({
    directory: fc.constantFrom(".", "packages/app", "packages/unicode-é"),
    command: fc.constantFrom("dprint check", "dprint fmt", "(dprint check)", "dprint fmt && echo done"),
    stale: fc.boolean(),
    width: fc.integer({ min: 60, max: 140 }),
    plugins: fc.uniqueArray(fc.tuple(fc.constantFrom("typescript", "json", "markdown"),
      fc.constantFrom("0.93.4", "0.95.0"), fc.constantFrom("a", "3", "f"))
      .map(([name, version, hash]) => "https://plugins.dprint.dev/" + name + "-" + version + ".wasm@" + hash.repeat(64)),
    { minLength: 1, maxLength: 4 }),
  }), scenario), { seed: 1221122, numRuns: Number(process.env.FC_RUNS ?? 120), endOnFailure: true })
})
