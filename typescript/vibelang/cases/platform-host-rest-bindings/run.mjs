// run-seconds: 125
import { assertProgramTypes } from "../../test/assert-coverage-twin.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { main, copies } from "./out/main.js"

const require = createRequire(import.meta.url)
const tsc = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
const compiled = spawnSync(process.execPath, [tsc, "-p", "reference"], { encoding: "utf8", timeout: 60000 })
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
assertProgramTypes(import.meta.url, tsc, "reference")
const reference = await import("./reference/out/main.js")
const program = main()
assert.equal(copies, 0)
assert.equal(reference.copies, 0)
const actual = Effect.runSyncExit(program)
assert.equal(copies, 1)
assert.deepEqual(actual, Effect.runSyncExit(reference.main()))
assert.equal(actual._tag, "Success")
assert.deepEqual(actual.value, ["object", "object", "object"])
assert.deepEqual(Effect.runSyncExit(program), Effect.runSyncExit(reference.main()))
assert.equal(copies, 2)
assert.equal(reference.copies, 2)
console.log("types and Exit agree")
