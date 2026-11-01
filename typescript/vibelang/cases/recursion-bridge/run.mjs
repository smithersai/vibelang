import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import { defect } from "./out/fault.js"
import * as m from "./out/main.js"

// Each effect function is an Effect.gen (VIP-1), so its recursion continues on
// Effect's heap frames at any depth, and the plain helpers it calls on the way
// (bridge, a getter, map, Option.map, a setter, a nested function) stay
// shallow JavaScript calls. The retired $direct variants and the $eager depth
// budget (D412) are not part of the language after VIP-1.
for (const name of ["outer", "remote", "getter", "mapped", "dataMethod", "sequential", "complex", "writes", "references"]) {
  assert.equal(Effect.runSync(m[name](100)), name === "sequential" ? 200 : 100, name)
  assert.equal(Effect.runSync(m[name](100000)), name === "sequential" ? 200000 : 100000, name + " deep")
}
for (const n of [3, 100000]) {
  const exit = Effect.runSyncExit(m.broken(n))
  assert.equal(exit._tag, "Failure")
  assert.equal(Cause.squash(exit.cause), defect)
}
// after runs the plain localInner(n), which is JavaScript recursion on the
// native stack (VIP-1), beside the effect recursion inner(n): depth 1000.
assert.equal(Effect.runSync(m.after(1000)), 2)
assert.equal(Effect.runSync(m.main()), 100000)
assert.deepEqual(await Effect.runPromise(m.concurrent()), [100000, 100000])
console.log("bridge recursion: ok")
