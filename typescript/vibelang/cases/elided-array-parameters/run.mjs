import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import * as calls from "./out/main.js"
import * as state from "./out/state.js"

const cases = [
  ["declaration", calls.declaration],
  ["expression", calls.expression],
  ["arrow", calls.arrow],
  ["method", value => calls.methods.one(value)],
  ["producer", calls.producer],
  ["producer-method", value => calls.methods.many(value)],
  ["nested", value => calls.nested({ a: value })],
  ["only", calls.only],
  ["rest", calls.rest]
]
let runs = 0
for (const [name, call] of cases) {
  for (const throwing of [false, true]) {
    const label = name + (throwing ? "/throw" : "/value")
    const marker = { original: label }
    const trace = { next: 0, values: [], closed: 0 }
    const input = {
      [Symbol.iterator]() {
        let index = 0
        return {
          next() {
            const current = index++
            trace.next++
            if (current === 3) return { done: true }
            return {
              done: false,
              get value() {
                trace.values.push(current)
                if (current === 0) throw new Error("an elision read its value")
                if (current === 1 && throwing) throw marker
                return current === 1 ? 7 : 9
              }
            }
          },
          return() { trace.closed++; return { done: true } }
        }
      }
    }
    state.reset()
    let program
    assert.doesNotThrow(() => { program = call(input) }, label)
    assert.equal(state.bodies, 0, label + ": body ran at the call")
    const expectedTrace = name === "only" ? { next: 1, values: [], closed: 1 }
      : name === "rest" && !throwing ? { next: 4, values: [1, 2], closed: 0 }
      : { next: 2, values: [1], closed: throwing ? 0 : 1 }
    assert.deepEqual(trace, expectedTrace, label + ": binding trace")
    const atCall = JSON.stringify(trace)
    const exits = []
    for (let run = 0; run < 2; run++) {
      const effect = Stream.isStream(program) ? Stream.runCollect(program) : program
      const exit = await Effect.runPromiseExit(effect)
      exits.push(exit)
      runs++
      if (throwing && name !== "only") {
        assert.ok(Exit.isFailure(exit), label)
        assert.equal(exit.cause.reasons.length, 1, label)
        assert.equal(exit.cause.reasons[0]._tag, "Die", label)
        assert.equal(exit.cause.reasons[0].defect, marker, label + ": defect identity")
        assert.equal(state.bodies, 0, label + ": failed binding ran its body")
      } else {
        assert.ok(Exit.isSuccess(exit), label)
        const expected = name === "only" ? 0 : name === "rest" ? [7, [9]]
          : name === "producer" || name === "producer-method" ? [7] : 7
        assert.deepEqual(exit.value, expected, label)
        assert.equal(state.bodies, run + 1, label + ": body coldness")
      }
      assert.equal(JSON.stringify(trace), atCall, label + ": rebound parameters during execution")
    }
    if (name === "rest" && !throwing) assert.equal(exits[0].value[1], exits[1].value[1], label + ": rest identity")
  }
}
console.log("elided parameters:", cases.length, "callables,", runs, "runs")
