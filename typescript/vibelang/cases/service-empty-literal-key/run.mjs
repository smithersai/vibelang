import assert from "node:assert/strict"
import { spawnSync, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { Effect } from "effect"
import { Empty, key } from "./out/main.js"

assert.equal(key, "", "an explicit empty key is not a request to derive one")
assert.equal(Effect.runSync(Effect.provideService(Effect.service(Empty), Empty, {n:3})).n, 3)
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const consumer = ["-p", fileURLToPath(new URL("consumer/tsconfig.json", import.meta.url))]
execFileSync(compiler, consumer, {stdio:"inherit"})
const stock = resolve(process.env.EFFECT_NODE_MODULES ?? fileURLToPath(new URL("../../../../experiments/node_modules", import.meta.url)), "typescript/bin/tsc")
execFileSync(process.execPath, [stock, ...consumer], {stdio:"inherit"})
execFileSync(compiler, ["-p", fileURLToPath(new URL("input/reference/tsconfig.json", import.meta.url))], {stdio:"inherit"})
const {Reference} = await import("./input/reference/out/main.js")
assert.equal(Reference.key, "")
assert.equal(Effect.runSync(Effect.service(Reference)).n, 2)
const duplicate = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/duplicates/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(duplicate.error, undefined)
assert.notEqual(duplicate.status, 0, "two explicit empty keys collide")
const output = duplicate.stdout + duplicate.stderr
const diagnostics = [...output.matchAll(new RegExp("^.*[(]([0-9]+),[0-9]+[)]: error ([A-Z]+)([0-9]+):", "gm"))]
assert.equal(diagnostics.length, 2, output)
assert(diagnostics.every(m => m[2] === "EK" && Number(m[3]) === 3001), output)
console.log("empty literal key preserved")
