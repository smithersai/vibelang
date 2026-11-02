import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as actual from "./out/main.js"
import * as expected from "./out/reference.js"
import { modes, makeValue } from "./out/foreign.js"
function shape(exit, sentinel) {
  if (Exit.isSuccess(exit)) return { tag: "Success", value: exit.value }
  return { tag: "Failure", reasons: exit.cause.reasons.map(r => r._tag === "Die"
    ? { tag: "Die", name: r.defect?.constructor?.name, sentinel: r.defect === sentinel }
    : { tag: r._tag }) }
}
function observe(module, form, mode) {
  module.events.length = 0
  const item = makeValue(mode, s => module.events.push(s))
  const fn = form === "object" ? module.object.run.bind(module.object) : form === "method" ? new module.Handler().run : module[form]
  const effect = fn(item.value)
  assert.deepEqual(module.events, [], "body or iterator ran at call")
  const first = shape(Effect.runSyncExit(effect), item.sentinel)
  const firstTrace = module.events.slice()
  const second = shape(Effect.runSyncExit(effect), item.sentinel)
  return { first, firstTrace, second, allTrace: module.events.slice() }
}
const mismatches = []
for (const form of ["plain", "conditional", "comma", "arrow", "expression", "object", "method", "known"]) {
  for (const mode of modes) {
    if (form === "known" && mode !== "effect") continue
    const got = observe(actual, form, mode), want = observe(expected, form, mode)
    if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push({ form, mode, got, want })
  }
}
assert.deepEqual(mismatches, [], "tail delegation changed the native Exit, identity, coldness, rerun or iterator trace")
for (const [key, name, prototype, arity] of [["arrow", "arrow", false, 1], ["expression", "expression", true, 1], ["named", "inner", true, 1], ["mixed", "mixed", false, 2]]) {
  const fn = actual[key]
  assert.equal(fn.name, name, key + " name")
  assert.equal(Object.hasOwn(fn, "prototype"), prototype, key + " constructability")
  assert.equal(fn.length, arity, key + " arity")
}
assert.equal(Effect.runSync(actual.mixed(false, null)).name, "")
const klass = Effect.runSync(actual.mixedClass(false, null))
assert.equal(klass.name, "")
assert.equal(klass.seen, "")
console.log("tail try preserves native delegation")
