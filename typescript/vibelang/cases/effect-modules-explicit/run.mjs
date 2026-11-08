// run-seconds: 120
import assert from "node:assert/strict"
import { cpSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { result, task } from "./out/main.js"
assert.deepEqual(result, [true,"41",true,true,3])
assert.equal(await Effect.runPromise(task()), 3)
console.log("explicit module imports preserved")
