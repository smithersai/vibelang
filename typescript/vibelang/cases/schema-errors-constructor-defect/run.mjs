// run-seconds: 125
import { assertProgramTypes } from "../../test/assert-coverage-twin.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { Effect, Exit } from "effect"
import { main } from "./out/main.js"

const require = createRequire(import.meta.url)
const tsc = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
const result = spawnSync(process.execPath, [tsc, "-p", "reference"], { encoding: "utf8", timeout: 60000 })
assert.equal(result.status, 0, result.stdout + result.stderr)
assertProgramTypes(import.meta.url, tsc, "reference")
const reference = await import("./reference/out/main.js")
const exit = Effect.runSyncExit(main())
assert.deepEqual(exit, Effect.runSyncExit(reference.main()))
// rule-evidence: docs/design/vips/0029-schema-errors.md#0e5ea29627b074f4 | A validation failure at construction (effect 4.1.1 throws a plain `Error`) is a defect, as any implicit throw inside `Effect.gen` is.
// Failure, every reason a Die, an Error, not the declared Invalid, and the
// same defect text as the Effect.gen reference.
assert.ok(Exit.isSuccess(exit))
assert.deepEqual(exit.value.slice(0, 4), [true, true, true, true])
assert.match(exit.value[4], /^Error: /)
console.log("types and Exit agree")
