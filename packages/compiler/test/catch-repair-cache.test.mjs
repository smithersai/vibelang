import assert from "node:assert/strict"
import cp from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { callableSource, checkRepair, skip } from "./catch-repair-helpers.mjs"

// Observe real executions without substituting a process or its result.
async function observe(t) {
  const calls = []
  const original = cp.spawnSync
  cp.spawnSync = function (file, args, options) {
    const result = original.call(this, file, args, options)
    if (file === process.execPath) calls.push({
      pid: result.pid, cache: options?.env?.NODE_COMPILE_CACHE,
      output: result.status === 0 ? JSON.parse(result.stdout) : result.stdout, status: result.status
    })
    return result
  }
  syncBuiltinESMExports()
  try {
    const handler = "make(e,error,failure,$e)"
    await checkRepair(t, callableSource(handler), callableSource("(caught) => (" + handler + ")(caught)"))
    return calls
  } finally {
    cp.spawnSync = original
    syncBuiltinESMExports()
  }
}

test("handler repair shares compiled code while every runtime execution stays isolated", {
  skip: skip || ((process.env.NODE_V8_COVERAGE || process.env.NODE_DISABLE_COMPILE_CACHE) && "compile cache explicitly disabled")
}, async t => {
  let cache
  await t.test("real CLI, editor and control outputs", async inner => {
    const calls = await observe(inner)
    assert.equal(calls.length, 3)
    assert.equal(new Set(calls.map(call => call.pid)).size, 3, "each output must come from a fresh Node process")
    assert.deepEqual(calls.map(call => call.status), [0, 0, 0])
    assert.deepEqual(calls.map(call => call.output), Array(3).fill({ _id: "Exit", _tag: "Success", value: "E/R/F/outer" }))
    cache = calls[0].cache
    assert.equal(typeof cache, "string", "runtime children must use a private compile cache")
    assert.deepEqual(calls.map(call => call.cache), [cache, cache, cache])
    const files = readdirSync(cache, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    assert.ok(files.length > 0, "Node must actually publish compiled code")
  })
  if (cache) assert.equal(existsSync(cache), false, "the test must remove its private cache")
})

for (const name of ["NODE_DISABLE_COMPILE_CACHE", "NODE_V8_COVERAGE"]) {
  test("handler repair respects " + name, { skip }, async t => {
    const root = mkdtempSync(join(tmpdir(), "catch-repair-cache-optout-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const previous = process.env[name]
    const previousCache = process.env.NODE_COMPILE_CACHE
    process.env[name] = name === "NODE_V8_COVERAGE" ? join(root, "coverage") : "1"
    delete process.env.NODE_COMPILE_CACHE
    try {
      const calls = await observe(t)
      assert.equal(calls.length, 3)
      assert.ok(calls.every(call => call.cache === undefined), "an opted-out child must not receive a compile cache")
    } finally {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
      if (previousCache === undefined) delete process.env.NODE_COMPILE_CACHE
      else process.env.NODE_COMPILE_CACHE = previousCache
    }
  })
}
