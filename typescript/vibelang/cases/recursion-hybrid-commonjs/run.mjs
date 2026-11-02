import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import { $eager, $direct } from "vibelang-runtime"
import * as lib from "./out/lib.js"
const down = lib.default.default
import * as m from "./out/main.js"

assert.equal(lib.complex$direct.length, 1)
assert.equal(lib.args$direct.length, 1)
const receivers = await import("./out/receiver-a.js")
for (const n of [0, 1, 10, 11]) assert.equal(receivers.f(n), n % 2 === 0 ? 1 : 2)
assert.equal(lib.default$direct, down[$direct])
assert.equal(down.length, 0, "preserve the plain public Effect wrapper arity")
const publicKeys = Reflect.ownKeys(down)
const directKeys = Reflect.ownKeys(lib.default$direct)
assert.deepEqual(Object.keys(down), [])
assert.deepEqual(Object.keys(lib.default$direct), [])
Object.freeze(down)
Object.freeze(lib.default$direct)
assert.equal(lib.default$direct(100000), 0)
assert.deepEqual(Effect.runSync(m.values()), [0, true, 7, 7, 9, 3, 5])
assert.equal(lib.defaultCount(), 1, "fallback must not bind defaults twice")
const lazy = lib.complex(100000)
assert.equal(lib.defaultCount(), 1, "constructing the public Effect must stay lazy")
assert.equal(Effect.runSync(lazy), 3)
assert.equal(lib.defaultCount(), 2)
assert.deepEqual(Effect.runSync(m.mapped()), [0, 0])
// A synchronous Array.map callback keeps JavaScript's native stack limit.
// Check shallow success and deep overflow, cold and warm, without assuming
// a V8-dependent depth near the native stack edge (spec Chapter 15).
function assertCallbackRecursion() {
  for (const depth of [0, 1, 2, 3, 10, 11, 100]) {
    assert.equal(Effect.runSync(m.nested(depth)), 1, `callback recursion at depth ${depth}`)
  }
  assert.throws(() => Effect.runSync(m.nested(100000)), RangeError,
    "synchronous callback recursion retains JavaScript's stack limit")
  assert.equal($eager.depth, 0, "callback overflow must release the budget")
}
assertCallbackRecursion()
for (let i = 0; i < 1000; i++) assert.equal(Effect.runSync(m.nested(100)), 1)
assertCallbackRecursion()
for (const depth of [1, 100000]) {
  assert.throws(() => lib.boom$direct(depth), TypeError)
  assert.equal($eager.depth, 0, "defects must release the budget")
}
for (let i = 0; i < 3; i++) {
  assert.deepEqual(await Effect.runPromise(m.concurrent()), [0, 0])
  assert.equal($eager.depth, 0, "no reservation may survive a fiber switch")
}
assert.equal(lib.default$direct(1000), 0)
assert.equal($eager.depth, 0)
assert.deepEqual(Reflect.ownKeys(down), publicKeys)
assert.deepEqual(Reflect.ownKeys(lib.default$direct), directKeys)
console.log("hybrid recursion: ok")
