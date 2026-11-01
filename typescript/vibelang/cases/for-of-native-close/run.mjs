import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
execFileSync(process.execPath, [resolve(process.env.EFFECT_NODE_MODULES, "typescript/bin/tsc"), "-p", fileURLToPath(new URL("./reference", import.meta.url)), "--pretty", "false"], { stdio: "inherit" })
const reference = await import("./reference/out/main.js")
const actual = { ...await import("./out/main.js"), ...await import("./out/lowered.js") }
const variants = [
  [new Error("body"), new Error("inner"), new Error("outer")],
  [{ source: "body" }, { source: "inner" }, { source: "outer" }],
  [undefined, null, 0],
  [null, false, "outer"]
]
let checks = 0
const failures = []
function run(fn, errors, close) {
  const events = []
  try { return { events, value: fn(events, errors, close), threw: false } }
  catch (error) { return { events, error, threw: true } }
}
for (const name of Object.keys(reference)) {
  for (const close of ["ok", "throw", "getter", "primitive"]) {
    for (const errors of variants) {
      const want = run(reference[name], errors, close)
      const got = run(actual[name], errors, close)
      try {
        assert.deepEqual(got.events, want.events, name + " trace")
        assert.equal(got.threw, want.threw, name + " completion")
        if (want.error instanceof TypeError) {
          assert.equal(got.error?.constructor, TypeError, name + " native error")
          assert.equal(got.error.message, want.error.message, name + " native message")
        } else {
          assert.equal(got.error, want.error, name + " error identity")
        }
        assert.equal(got.value, want.value, name + " return")
      } catch (error) { failures.push(name + "/" + close + ": " + error.message) }
      checks++
    }
  }
}
assert.deepEqual(failures, [])
console.log("native for-of close: " + checks + " comparisons passed")
