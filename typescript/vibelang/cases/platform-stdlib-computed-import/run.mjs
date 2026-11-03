// run-seconds: 125
import { assertProgramTypes } from "../../test/assert-coverage-twin.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { main } from "./out/main.js"

const require = createRequire(import.meta.url)
const tsc = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
const result = spawnSync(process.execPath, [tsc, "-p", "reference"], { encoding: "utf8", timeout: 60000 })
assert.equal(result.status, 0, result.stdout + result.stderr)
assertProgramTypes(import.meta.url, tsc, "reference")
const reference = await import("./reference/out/main.js")
assert.deepEqual(await Effect.runPromiseExit(main()), await Effect.runPromiseExit(reference.main()))
console.log("types and Exit agree")
