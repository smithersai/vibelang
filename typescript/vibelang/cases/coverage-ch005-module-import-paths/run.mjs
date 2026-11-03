// run-seconds: 180
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.deepEqual(actual.namespace,native.namespace)
assert.deepEqual(actual.fn,native.fn)
assert.deepEqual(actual.locals,native.locals)
assert.deepEqual(actual.locals,[17, 18])

const {readFileSync}=await import("node:fs")
const emitted=readFileSync(new URL("./out/main.js",import.meta.url),"utf8")
assert.match(emitted,/from\s+["']effect\/Schema["']/)
assert.match(emitted,/from\s+["']effect\/Function["']/)
console.log("coverage-ok")
