import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")

import { spawnSync } from "node:child_process"
import { addBunPreload, addBunTestPreload, bunProgramDirs } from "../lib/wire.mjs"
function check(input) {
  const modules = input.modules
  const before = "telemetry = false\n" + (modules.length ? "preload = " + JSON.stringify(modules) + "\n" : "") + "[test]\npreload = [\"./test-only.ts\"]\n[test.env]\nMODE = \"test\"\n"
  const program = addBunPreload(before)
  const both = addBunTestPreload(program)
  assert.equal(addBunPreload(program), program)
  assert.equal(addBunTestPreload(both), both)
  assert.equal(addBunPreload(both), both)
  const run = spawnSync("bun", ["-e", "console.log(JSON.stringify(Bun.TOML.parse(process.argv[1])))", both], { encoding: "utf8", timeout: 10000 })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stderr)
  const parsed = JSON.parse(run.stdout)
  assert.deepEqual(parsed.preload, ["vibelang/bun", ...modules.filter((m) => m !== "vibelang/bun")])
  assert.deepEqual(parsed.test.preload, ["vibelang/bun", "./test-only.ts"])
  assert.equal(parsed.telemetry, false)
  assert.deepEqual(parsed.test.env, { MODE: "test" })
  const dir = input.directory
  for (const prefix of ["bun ", "bun run ", "bun --bun "]) {
    assert.deepEqual(bunProgramDirs("cd " + dir + " && " + prefix + "alchemy-test --flag"), [dir])
  }
  assert.deepEqual(bunProgramDirs("cd " + dir + " && bun alchemy-test", () => ({ "alchemy-test": "bun test" })), [])
}
test("alchemy: program preload and test preload stay in their own TOML scopes", () => {
  assert.ok(contract.includes("at the top level of the"))
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-program-preload.json", import.meta.url), "utf8"))
  check(corpus.input)
  const part = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/)
  const directory = fc.array(part, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"))
  const module = part.map((part) => "./" + part + ".ts")
  fc.assert(fc.property(fc.record({ directory, modules: fc.uniqueArray(module, { maxLength: 6 }) }), check), { seed: 170017, numRuns: 150 })
})
