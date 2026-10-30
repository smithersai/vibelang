import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { result } from "./out/main.js"
const args = ["-p", fileURLToPath(new URL("consumer/tsconfig.json", import.meta.url))]
execFileSync(fileURLToPath(new URL("../../../built/local/tsc", import.meta.url)), args, {stdio:"inherit"})
execFileSync(process.execPath, [resolve(process.env.EFFECT_NODE_MODULES ?? fileURLToPath(new URL("../../../../experiments/node_modules", import.meta.url)), "typescript/bin/tsc"), ...args], {stdio:"inherit"})
assert.deepEqual(result, [true,true,true,true,false,false,false,3])
console.log(JSON.stringify(result))
