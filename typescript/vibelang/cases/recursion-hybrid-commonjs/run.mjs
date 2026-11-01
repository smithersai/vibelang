import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as lib from "./out/lib.js"
const down = lib.default.default
import * as m from "./out/main.js"

// Each effect function is an Effect.gen (VIP-1): its recursion, direct, mutual
// across modules, through a try statement or a typed failure, with default and
// rest parameters, continues on Effect's heap frames at depth 100000. The
// retired $direct variants and the $eager depth budget (D412) are not part of
// the language after VIP-1, so nothing here reads them.
const receivers = await import("./out/receiver-a.js")
for (const n of [0, 1, 10, 11]) assert.equal(receivers.f(n), n % 2 === 0 ? 1 : 2)
assert.equal(Effect.runSync(down(100000)), 0)
assert.deepEqual(Effect.runSync(m.values()), [0, true, 7, 7, 9, 3, 5])
assert.equal(lib.defaultCount(), 1, "running complex binds its default once")
const lazy = lib.complex(100000)
assert.equal(lib.defaultCount(), 1, "constructing the Effect must stay lazy")
assert.equal(Effect.runSync(lazy), 3)
assert.equal(lib.defaultCount(), 2)
assert.deepEqual(Effect.runSync(m.mapped()), [0, 0])
// nested is plain (VIP-1), and its synchronous Array.map callback keeps
// JavaScript's native stack limit.
// Check shallow success and deep overflow, cold and warm, without assuming
// a V8-dependent depth near the native stack edge (spec Chapter 15).
function assertCallbackRecursion() {
  for (const depth of [0, 1, 2, 3, 10, 11, 100]) {
    assert.equal(m.nested(depth), 1, `callback recursion at depth ${depth}`)
  }
  assert.throws(() => m.nested(100000), RangeError,
    "synchronous callback recursion retains JavaScript's stack limit")
}
assertCallbackRecursion()
for (let i = 0; i < 1000; i++) assert.equal(m.nested(100), 1)
assertCallbackRecursion()
for (const depth of [1, 100000]) {
  const exit = Effect.runSyncExit(lib.boom(depth))
  assert.equal(exit._tag, "Failure", "a TypeError deep in the recursion is a defect")
}
for (let i = 0; i < 3; i++) {
  assert.deepEqual(await Effect.runPromise(m.concurrent()), [0, 0])
}
assert.equal(Effect.runSync(down(1000)), 0)
console.log("hybrid recursion: ok")
