import assert from "node:assert/strict"
import {execFileSync} from "node:child_process"
import {fileURLToPath} from "node:url"
import {resolve} from "node:path"
import { Effect } from "effect"
import { task, Missing, Service, Data } from "./out/main.js"
assert.equal(await Effect.runPromise(task()), 3)
assert.equal(new Missing({n:1}).n, 1)
assert.equal(typeof Service.key, "string")
assert.notEqual(Data, undefined)
const args = ["-p", fileURLToPath(new URL("consumer/tsconfig.json", import.meta.url))]
execFileSync(fileURLToPath(new URL("../../../built/local/tsc", import.meta.url)), args, {stdio:"inherit"})
const stock = resolve(process.env.EFFECT_NODE_MODULES ?? fileURLToPath(new URL("../../../../experiments/node_modules", import.meta.url)), "typescript/bin/tsc")
execFileSync(process.execPath, [stock,...args], {stdio:"inherit"})
console.log("language intrinsics preserved")
