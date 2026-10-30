import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { Effect } from "effect"
import { chapter, block, read, run } from "./spec-witness.mjs"
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("await parity names return assimilation and the explicit Effect return", () => {
  const text = running()
  const parity = text.slice(text.indexOf("They differ where"), text.indexOf("## §effect§ blocks".replaceAll("§", String.fromCharCode(96))))
  assert.match(parity, /return.*assimilates/)
  assert.match(parity, /return try e/)
  assert.match(parity, /Effect.gen.*return/)
  assert.match(parity, /returnEffectInGen/)
  assert.match(parity, /plain.*catch.*handler.*result/)
  assert.match(parity, /success value unchanged/)
  assert.match(text, /Success.*inner.*unrun/)
  assert.match(read("docs/design/vips/0005-try-runs-effects.md"), /return values.*unflattened/)
})

test("the printed boxed and unboxed returns preserve the real inner Effect", () => {
  const source = block(running(), "function boxedReturn(")
  const r = run(source + `
import assert from "node:assert/strict"
let runs = 0
const inner = Effect.sync(() => { runs++; return 7 })
const boxed = Effect.runSyncExit(boxedReturn(inner))
assert.equal(boxed._tag, "Success")
assert.equal(boxed.value, inner)
assert.equal(runs, 0)
const unboxed = Effect.runSyncExit(unboxedReturn(inner))
assert.equal(unboxed._tag, "Success")
assert.equal(unboxed.value, 7)
assert.equal(runs, 1)
`)
  assert.equal(r.status, 0, r.stderr)
})

test("native async return assimilates a Promise and thenable, while Effect success keeps data", async () => {
  async function nativeReturn(value) { return value }
  assert.equal(await nativeReturn(Promise.resolve(7)), 7)
  assert.equal(await Promise.reject("source").catch(() => ({ then(resolve) { resolve(9) } })), 9)
  let calls = 0
  const thenable = { then(resolve) { calls++; resolve(8) } }
  const value = Effect.runSyncExit(Effect.gen(function* () { return thenable }))
  assert.equal(value._tag, "Success")
  assert.equal(value.value, thenable)
  assert.equal(calls, 0)
  assert.equal(await nativeReturn(thenable), 8)
  assert.equal(calls, 1)
})

test("native Promise resolution handles every return-value branch without inspecting Effect success data", async () => {
  async function adopt(value) { return value }
  const keep = value => {
    for (const program of [
      Effect.gen(function* () { return value }),
      Effect.gen(function* () { return yield* Effect.succeed(value) }),
      Effect.catch(Effect.fail("source"), () => Effect.succeed(value))
    ]) {
      const exit = Effect.runSyncExit(program)
      assert.equal(exit._tag, "Success")
      assert.equal(exit.value, value)
    }
  }
  let executions = 0
  const cold = Effect.sync(() => { executions++; return 7 })
  keep(cold)
  keep(Effect.fail("unrun failure"))
  assert.equal(executions, 0)
  for (const value of [undefined, null, false, -0, 0, NaN, 7, "x", Symbol("x"), 1n]) {
    keep(value)
    assert.equal(await adopt(value), value)
  }
  const ordinary = { then: 0 }
  keep(ordinary)
  assert.equal(await adopt(ordinary), ordinary)
  const error = { tag: "same-error" }
  const badGet = { get then() { throw error } }
  keep(badGet)
  await assert.rejects(adopt(badGet), value => value === error)
  let gets = 0, calls = 0
  const thenable = {
    get then() {
      gets++
      return function(resolve, reject) {
        assert.equal(this, thenable)
        calls++
        resolve(7)
        reject(error)
        throw error
      }
    }
  }
  keep(thenable)
  assert.equal(gets, 0)
  const adopted = adopt(thenable)
  assert.equal(gets, 1)
  assert.equal(calls, 0)
  assert.equal(await adopted, 7)
  assert.equal(gets, 1)
  assert.equal(calls, 1)
  for (const value of [
    { then(resolve, reject) { reject(error); resolve(7) } },
    { then() { throw error } }
  ]) {
    keep(value)
    await assert.rejects(adopt(value), reason => reason === error)
  }
  const revoked = Proxy.revocable(() => {}, {})
  revoked.revoke()
  const revokedThen = { then: revoked.proxy }
  keep(revokedThen)
  await assert.rejects(adopt(revokedThen), TypeError)
  const foreign = runInNewContext("(() => { const error = new Error('foreign'); return { error, value: { then() { throw error } } } })()")
  keep(foreign.value)
  await assert.rejects(adopt(foreign.value), reason => reason === foreign.error)
  let release
  const gate = new Promise(resolve => { release = resolve })
  let self
  self = (async () => { await gate; return self })()
  release()
  await assert.rejects(self, TypeError)
  let recursive
  recursive = Effect.gen(function* () { return recursive })
  const exit = Effect.runSyncExit(recursive)
  assert.equal(exit._tag, "Success")
  assert.equal(exit.value, recursive)
})
