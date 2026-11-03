import { test } from "node:test"
import assert from "node:assert/strict"
import fc from "fast-check"
import { $bindingIterators } from "../dist/binding-iterator.js"

const source = (trace, mode, present) => ({
  [Symbol.iterator]() {
    trace.push("open")
    return {
      next() {
        trace.push("next")
        if (mode === 1) throw "next"
        if (mode === 7) return 1
        return {
          get done() { trace.push("done"); if (mode === 2) throw "done"; return mode === 4 },
          get value() { trace.push("value"); if (mode === 3) throw "value"; return present ? 4 : undefined }
        }
      },
      get return() {
        trace.push("get return")
        if (mode === 5) throw "get return"
        if (mode === 8) return 1
        return function() { trace.push("return"); if (mode === 6) throw "return"; return mode === 9 ? 1 : {} }
      }
    }
  }
})

test("array binding protocol, error classes and exception precedence match native Node destructuring", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 9 }), fc.boolean(), fc.boolean(), (mode, present, fail) => {
    const nativeTrace = [], loweredTrace = []
    const fallback = (trace) => { trace.push("default"); if (fail) throw "source"; return 7 }
    const observe = (f) => { try { return ["return", f()] } catch (e) { return ["throw", e instanceof Error ? [e.name] : e] } }
    const native = observe(() => { const [x = fallback(nativeTrace)] = source(nativeTrace, mode, present); return x })
    const lowered = observe(() => {
      const bindings = $bindingIterators()
      let throwing = false
      try {
        const iterator = bindings.open(source(loweredTrace, mode, present))
        const value = iterator.value(0, true)
        const x = value === undefined ? fallback(loweredTrace) : value
        bindings.close()
        return x
      } catch (error) { throwing = true; throw error }
      finally { bindings.finish(throwing) }
    })
    assert.deepEqual(lowered, native)
    assert.deepEqual(loweredTrace, nativeTrace)
  }), { numRuns: 200 })
})

for (const throwing of [false, true]) {
  test(`outward completion closes inner to outer; throwing=${throwing}`, () => {
    const trace = []
    const bindings = $bindingIterators()
    bindings.open(source(trace, 0, false)).value(0)
    bindings.open(source(trace, 6, false)).value(0)
    if (throwing) bindings.finish(true)
    else assert.throws(() => bindings.finish(false), (error) => error === "return")
    assert.deepEqual(trace.slice(-4), ["get return", "return", "get return", "return"])
    bindings.finish(false)
  })
}

test("elisions do not read value and rest exhausts without closing", () => {
  const trace = []
  const bindings = $bindingIterators()
  const iterator = bindings.open(source(trace, 3, false))
  iterator.skip()
  bindings.close()
  assert.deepEqual(trace, ["open", "next", "done", "get return", "return"])
  const rest = bindings.open([1, 2, 3])
  assert.equal(rest.value(0), 1)
  assert.deepEqual(rest.rest(), [2, 3])
  bindings.close()
})

// Invalid iterator-result messages are host diagnostics independent of the
// source expression; compare these verbatim as well as the protocol above.
for (const mode of [7, 9]) {
  test(`invalid iterator-result message matches the host; mode=${mode}`, () => {
    const observe = (run) => { try { run() } catch (error) { return [error.name, error.message] } }
    const native = observe(() => { const [x] = source([], mode, true) })
    const lowered = observe(() => {
      const state = $bindingIterators()
      let throwing = false
      try { state.open(source([], mode, true)).value(0); state.close() }
      catch (error) { throwing = true; throw error }
      finally { state.finish(throwing) }
    })
    assert.deepEqual(lowered, native)
  })
}

test("source mutations cannot replace generated protocol intrinsics", () => {
  const savedApply = Reflect.apply, savedObject = globalThis.Object, savedPush = Array.prototype.push
  let actual
  try {
    Reflect.apply = () => { throw "wrong apply" }
    globalThis.Object = () => { throw "wrong Object" }
    Array.prototype.push = () => { throw "wrong push" }
    const bindings = $bindingIterators()
    const iterator = bindings.open([1, 2, 3])
    actual = [iterator.value(0), iterator.rest()]
    bindings.close()
  } finally {
    Reflect.apply = savedApply
    globalThis.Object = savedObject
    Array.prototype.push = savedPush
  }
  assert.deepEqual(actual, [1, [2, 3]])
})

// Rest uses IteratorToList, whose error/close behavior can differ from a
// SingleNameBinding. Start with a present value so a lifted default is skipped.
test("rest reads and abrupt iterator results match native destructuring", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 9 }), fc.boolean(), (mode, present) => {
    const finite = (trace) => ({
      [Symbol.iterator]() {
        const iterator = source(trace, mode, present)[Symbol.iterator]()
        let reads = 0
        return {
          next() {
            if (++reads === 1) return { done: false, value: 4 }
            if (reads > 3) return { done: true }
            return iterator.next()
          },
          get return() { return iterator.return }
        }
      }
    })
    const observe = (run) => { try { return ["return", run()] } catch (e) { return ["throw", e instanceof Error ? e.name : e] } }
    const nativeTrace = [], loweredTrace = []
    const native = observe(() => { const [x, ...rest] = finite(nativeTrace); return [x, rest] })
    const lowered = observe(() => {
      const bindings = $bindingIterators()
      let throwing = false
      try {
        const iterator = bindings.open(finite(loweredTrace))
        const x = iterator.value(0)
        const rest = iterator.rest()
        bindings.close()
        return [x, rest]
      } catch (error) { throwing = true; throw error }
      finally { bindings.finish(throwing) }
    })
    assert.deepEqual(lowered, native)
    assert.deepEqual(loweredTrace, nativeTrace)
  }), { numRuns: 200 })
})
