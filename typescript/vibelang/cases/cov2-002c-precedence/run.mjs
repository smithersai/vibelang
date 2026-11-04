import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
const modules = process.env.EFFECT_NODE_MODULES ?? fileURLToPath(new URL("../../../../experiments/node_modules",import.meta.url))
assert.equal(JSON.parse(readFileSync(join(modules,"typescript/package.json"))).version,"5.9.3")
assert.equal(JSON.parse(readFileSync(join(modules,"effect/package.json"))).version,"4.1.1")
const checked=spawnSync(process.execPath,[join(modules,"typescript/bin/tsc"),"-p",fileURLToPath(new URL("./typescript",import.meta.url)),"--outDir",fileURLToPath(new URL("./typescript/.cache/stock",import.meta.url))],{encoding:"utf8",timeout:60000})
assert.equal(checked.error,undefined)
assert.equal(checked.status,0,checked.stdout+checked.stderr)
const { main: native }=await import("./typescript/.cache/stock/main.js")
const actual = await Effect.runPromiseExit(main())
assert.deepEqual(actual, await Effect.runPromiseExit(native()))
assert.equal(actual._tag, "Success")
assert.deepEqual(actual.value, [3, 1, 2, 4, 5, 6, 7])
console.log("cov2-002c twins agree")
