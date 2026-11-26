// run-seconds: 210
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve,dirname } from "node:path"
import { fileURLToPath } from "node:url"
const here=dirname(fileURLToPath(import.meta.url))
const tsc=resolve(here,"../../../../docs/tools/node_modules/typescript/bin/tsc")
const native=spawnSync(process.execPath,[tsc,"-p",resolve(here,"reference")],{encoding:"utf8",timeout:180000})
assert.ifError(native.error)
assert.equal(native.status,0,native.stdout+native.stderr)
// Compare every public callable with the stock TypeScript twin through the re-exports.
const types = spawnSync(process.execPath, [tsc, "--strict", "--noEmit", "--skipLibCheck",
  "--target", "es2022", "--module", "nodenext", resolve(here, "contracts.ts")], {encoding:"utf8"})
assert.equal(types.status, 0, types.stdout + types.stderr)
const dts = readFileSync(new URL("./out/main.d.ts", import.meta.url), "utf8")
const foreign = readFileSync(new URL("./out/foreign.d.ts", import.meta.url), "utf8")
assert.match(dts, /@throws \{never\}\s*\*\/\s*export declare function fib/)
assert.match(dts, /@throws \{never\}\s*\*\/\s*export declare function asyncDefaulted/)
assert.match(foreign, /@throws \{Error\}\s*\*\/\s*export declare function bounded/)
assert.match(foreign, /@rethrows f\s*\*\/\s*export declare function defaulted/)
const actual = await import("./out/main.js")
assert.equal(actual.fib(6),8)
assert.equal(actual.defaulted(() => 7),7)
await assert.rejects(actual.asyncDefaulted(),/default/)
for (const name of ["walk","even","odd"]) assert.throws(() => actual[name](2), Error)
assert.throws(() => actual.bounded(true), /bound/)
assert.throws(() => actual.expand("failure",true), value => value === "failure")
console.log("local and foreign thrown contracts")
