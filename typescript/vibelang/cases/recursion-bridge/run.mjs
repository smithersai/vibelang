import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import { defect } from "./out/fault.js"
import { $eager } from "vibelang-runtime"
import * as m from "./out/main.js"

let heapEntries = 0
const original = $eager.getHeap
$eager.getHeap = function(fn) {
  heapEntries++
  return original(fn)
}
try {
  for (const name of ["outer", "remote", "getter", "mapped", "dataMethod", "sequential", "complex", "writes", "references"]) {
    heapEntries = 0
    assert.equal(m[name + "$direct"](100), name === "sequential" ? 200 : 100)
    assert.equal(heapEntries, 0, name + ": shallow helpers must leave the inner recursion native")
    assert.equal($eager.depth, 0, name + ": reservation restored")
  }
  for (const name of ["outer", "remote", "getter", "mapped", "dataMethod", "sequential", "complex", "writes", "references"]) {
    assert.equal(m[name + "$direct"](100000), name === "sequential" ? 200000 : 100000)
    assert.equal($eager.depth, 0, name + ": deep fallback restores budget")
  }
  for (const n of [3, 100000]) {
    const exit = Effect.runSyncExit(m.broken(n))
    assert.equal(exit._tag, "Failure")
    assert.equal(Cause.squash(exit.cause), defect)
    assert.equal($eager.depth, 0, "defect restores published budget")
  }
  heapEntries = 0
  assert.equal(m.after$direct(1000), 2)
  assert.equal(heapEntries, 0, "independent recursions release their budget")
  assert.equal($eager.depth, 0)
  assert.equal(m.after$direct(100000), 2)
  heapEntries = 0
  assert.equal(Effect.runSync(m.main()), 100000)
  assert.ok(heapEntries > 0, "deep bridge recursion must use heap frames")
  assert.equal($eager.depth, 0)
  assert.deepEqual(await Effect.runPromise(m.concurrent()), [100000, 100000])
  assert.equal($eager.depth, 0, "no reservation survives a fiber switch")
} finally {
  $eager.getHeap = original
}
console.log("bridge recursion: ok")
