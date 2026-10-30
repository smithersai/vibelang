import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("matching states one complete source-order and iterator protocol rule", () => {
  const match = chapter("004-match")
  for (const required of [
    "a cached pattern getter runs at most once", "Object-rest copying is separate",
    "Read every selected/default arm expression's value once before iterator finishing",
    "retain the original subject as receiver", "same private cached Iterator Records",
    "an iterator marked done by an iteration error is not closed again",
    "Each `Elision` consumes its full number of commas", "An absent optional element consumes zero values",
    "other subject types fail before bound evaluation", "required-to-total position interval",
  ]) assert.ok(match.includes(required), required)
  const snapshot = read("docs/design/vips/tc39-pattern-matching/README.md")
  for (const row of ["Iterator inputs and registry", "Primitive array subjects", "Elision cardinality", "Absent optional elements", "Expression values", "Object property order", "Object rest and caching", "Inclusive relations"]) {
    assert.ok(snapshot.includes("| " + row + " |"))
  }
  const result = run(block(match, "const evaluationExit") + `
import assert from "node:assert/strict"
assert.equal(evaluationExit._tag, "Success")
assert.deepEqual(evaluationExit.value, { copied: 2, reads: 2, short: "miss", full: "hit", absent: "hit", present: "miss", primitive: "word", guarded: "miss", lower: "small", upper: "small" })
assert.equal(sourceOrderExit._tag, "Success")
assert.equal(sourceOrderExit.value, true)
assert.deepEqual(sourceOrder, ["first", "second"])
assert.equal(armValueExit._tag, "Success")
assert.equal(armValueExit.value, 7)
assert.deepEqual(armOrder, ["arm", "close"])
// Native reads distinguish absence from a present undefined value.
assert.equal([].values().next().done, true)
assert.equal([undefined].values().next().done, false)
let guardReads = 0
const flag = { get value() { guardReads++; return false } }
assert.equal(flag.value ? "hit" : "miss", "miss")
assert.equal(guardReads, 1)
for (const n of [NaN]) { assert.equal(n <= 2, false); assert.equal(n >= 2, false) }
const coerced = []
const bound = { [Symbol.toPrimitive](hint) { coerced.push(hint); return 2 } }
assert.equal(1 <= bound, true)
assert.deepEqual(coerced, ["number"])
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test("the native iterator precedent covers every acquisition, step and close boundary", () => {
  const result = run(`
import assert from "node:assert/strict"
import { Effect } from "effect"
for (const phase of ["iterator-get", "iterator-call", "iterator-result", "next-get", "next-callable", "next-call", "step-result", "done-get", "value-get", "done", "normal"]) {
  let closes = 0, nextReads = 0, valueReads = 0
  let iterator
  const source = { get [Symbol.iterator]() {
    if (phase === "iterator-get") throw "iterator-get"
    return function() {
      assert.equal(this, source)
      if (phase === "iterator-call") throw "iterator-call"
      if (phase === "iterator-result") return 1
      iterator = {
        get next() {
          nextReads++
          if (phase === "next-get") throw "next-get"
          if (phase === "next-callable") return 1
          return function() {
            assert.equal(this, iterator)
            if (phase === "next-call") throw "next-call"
            if (phase === "step-result") return 1
            return {
              get done() { if (phase === "done-get") throw "done-get"; return phase === "done" },
              get value() { valueReads++; if (phase === "value-get") throw "value-get"; return 1 }
            }
          }
        },
        return() { assert.equal(this, iterator); closes++; return {} }
      }
      return iterator
    }
  } }
  const exit = Effect.runSyncExit(Effect.sync(() => { for (const value of source) break; return "ok" }))
  assert.equal(exit._tag, phase === "normal" || phase === "done" ? "Success" : "Failure", phase)
  if (exit._tag === "Failure") {
    const reason = exit.cause.reasons[0]
    assert.equal(reason._tag, "Die")
    if (["iterator-result", "next-callable", "step-result"].includes(phase)) assert.ok(reason.defect instanceof TypeError)
    else assert.equal(reason.defect, phase)
  }
  assert.equal(closes, phase === "normal" ? 1 : 0, phase + " close")
  if (phase === "done") assert.equal(valueReads, 0)
  if (iterator) assert.equal(nextReads, 1)
}
for (const mode of ["absent", "null", "noncallable", "getter", "call", "primitive", "object"]) {
  let iterator
  const source = { [Symbol.iterator]() { iterator = {
    next() { return { done: false, value: 1 } },
    get return() {
      if (mode === "absent") return undefined
      if (mode === "null") return null
      if (mode === "noncallable") return 1
      if (mode === "getter") throw "return-getter"
      return function() {
        assert.equal(this, iterator)
        if (mode === "call") throw "return-call"
        return mode === "primitive" ? 1 : {}
      }
    }
  }; return iterator } }
  const exit = Effect.runSyncExit(Effect.sync(() => { for (const value of source) break }))
  assert.equal(exit._tag, ["absent", "null", "object"].includes(mode) ? "Success" : "Failure", mode)
}
const descriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator)
const native = descriptor.value
let receiver
try {
  Object.defineProperty(String.prototype, Symbol.iterator, { configurable: true, get() {
    receiver = this
    return native
  } })
  assert.deepEqual([..."ab"], ["a", "b"])
  assert.equal(receiver, "ab")
} finally { Object.defineProperty(String.prototype, Symbol.iterator, descriptor) }
for (const returned of [1, null, undefined]) {
  const source = { [Symbol.iterator]() { return { next() { return { done: false, value: 1 } }, return() { return returned } } } }
  assert.equal(Effect.runSyncExit(Effect.sync(() => { for (const value of source) break }))._tag, "Failure")
}
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
