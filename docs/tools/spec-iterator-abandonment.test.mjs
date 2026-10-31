import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect, Exit } from "effect"
import { block, chapter, read, run } from "./spec-witness.mjs"

const guide = () => read("docs/user/src/vibelang-features/112-producers.md")
const iterator = (events, overrides = {}) => ({
  [Symbol.iterator]() { return this },
  next() { return { done: false, value: undefined } },
  return() { events.push("close"); return {} },
  ...overrides,
})
const defect = (exit) => {
  assert.ok(Exit.isFailure(exit))
  const reason = exit.cause.reasons[0]
  assert.equal(reason._tag, "Die")
  return reason.defect
}

test("the guide distinguishes native unwinding from Effect abandonment", () => {
  const text = guide()
  assert.ok(text.includes("abandons the generator"), "the guide omits abandonment")
  assert.match(text, /native algorithm determines which completions close an iterator/, "next/result protocol failures cannot be blanket-described as closing")
  assert.match(text, /fails, dies or is interrupted/, "the rule includes defects as well as typed failure and interruption")
  assert.doesNotMatch(text, /a default that fails or is interrupted closes every live iterator/)
  assert.doesNotMatch(text, /a defect beside the original failure/)
})


test("failure, defect and interruption abandon both for-of and destructuring iterators", () => {
  for (const stop of [Effect.fail("failure"), Effect.die("defect"), Effect.interrupt]) {
    for (const pattern of [false, true]) {
      const events = []
      const source = iterator(events)
      const program = Effect.gen(function* () {
        using resource = { [Symbol.dispose]() { events.push("dispose") } }
        if (pattern) { const [x = yield* stop] = source }
        else { for (const x of source) { yield* stop; break } }
      })
      assert.ok(Exit.isFailure(Effect.runSyncExit(program)))
      assert.deepEqual(events, [])
    }
  }
})

test("ordinary loop exits close; exhausted iteration and next failures retain native behavior", () => {
  const events = []
  const source = iterator(events)
  for (const x of source) break
  assert.deepEqual(events, ["close"])
  events.length = 0
  const returning = () => { for (const x of source) return 7 }
  assert.equal(returning(), 7)
  assert.deepEqual(events, ["close"])
  events.length = 0
  for (const x of iterator(events, { next() { return { done: true } } })) {}
  assert.deepEqual(events, [])

  for (const overrides of [
    { next: 1 },
    { next() { throw "next" } },
    { next() { return 1 } },
    { next() { return { get done() { throw "done" } } } },
    { next() { return { done: false, get value() { throw "value" } } } },
  ]) {
    events.length = 0
    assert.throws(() => { for (const x of iterator(events, overrides)) break })
    assert.deepEqual(events, [])
  }
})

test("a pending JavaScript throw wins over every close failure", () => {
  for (const close of [
    { return() { throw "close" } },
    { return() { return 1 } },
    { return: 1 },
    { get return() { throw "return getter" } },
  ]) {
    const events = []
    const source = Object.defineProperties(iterator(events), Object.getOwnPropertyDescriptors(close))
    const program = Effect.gen(function* () { for (const x of source) throw "body" })
    assert.equal(defect(Effect.runSyncExit(program)), "body")
  }
})

test("a close failure replaces a nonthrow completion, while disposal precedes close", () => {
  for (const overrides of [
    { return() { throw "close" } },
    { return() { return 1 } },
    { return: 1 },
  ]) {
    const source = iterator([], overrides)
    const exit = Effect.runSyncExit(Effect.gen(function* () { for (const x of source) break }))
    const error = defect(exit)
    assert.ok(error === "close" || error instanceof TypeError)
  }
  const events = []
  for (const x of iterator(events)) {
    using resource = { [Symbol.dispose]() { events.push("dispose") } }
    break
  }
  assert.deepEqual(events, ["dispose", "close"])
})

test("nested destructuring unwinds inner first for a JS throw and not for an Effect failure", () => {
  for (const effectFailure of [false, true]) {
    const events = []
    const inner = iterator(events, { return() { events.push("inner"); return {} } })
    const outer = iterator(events, { next() { return { done: false, value: inner } }, return() { events.push("outer"); return {} } })
    const program = Effect.gen(function* () {
      const [[value = effectFailure ? yield* Effect.fail("failure") : (() => { throw "body" })()]] = outer
    })
    assert.ok(Exit.isFailure(Effect.runSyncExit(program)))
    assert.deepEqual(events, effectFailure ? [] : ["inner", "outer"])
  }
})

test("iterator acquisition failures never ask an unentered loop's iterator to close", () => {
  for (const phase of ["method-get", "method-call", "method-type", "iterator-type", "next-get"]) {
    const events = []
    const problem = { phase }
    const record = iterator(events)
    Object.defineProperty(record, "return", { get() { events.push("get return"); return () => ({}) } })
    if (phase === "next-get") Object.defineProperty(record, "next", { get() { throw problem } })
    const source = Object.defineProperty({}, Symbol.iterator, {
      get() {
        if (phase === "method-get") throw problem
        if (phase === "method-type") return 1
        return function () {
          if (phase === "method-call") throw problem
          return phase === "iterator-type" ? 1 : record
        }
      },
    })
    assert.throws(() => { for (const value of source) break }, error =>
      phase === "method-type" || phase === "iterator-type" ? error instanceof TypeError : error === problem)
    assert.deepEqual(events, [], phase)
  }
})

test("IteratorClose keeps nullish absence, getter failures and the iterator receiver", () => {
  for (const value of [undefined, null]) {
    const events = []
    const source = iterator(events)
    Object.defineProperty(source, "return", { get() { events.push("get"); return value } })
    for (const item of source) break
    assert.deepEqual(events, ["get"])
  }
  const problem = { phase: "return-get" }
  const source = iterator([])
  Object.defineProperty(source, "return", { get() { throw problem } })
  assert.throws(() => { for (const item of source) break }, error => error === problem)
  const events = []
  const receiver = iterator(events, { return() { assert.equal(this, receiver); events.push("close"); return {} } })
  for (const item of receiver) break
  assert.deepEqual(events, ["close"])
})

test("runtime, destructuring and VIP rules require only native completion-specific closing", () => {
  const runtime = chapter("008-runtime")
  assert.match(runtime, /Cleanup follows the applicable JavaScript or matching algorithm/)
  assert.doesNotMatch(runtime, /runs that cleanup/)
  assert.match(chapter("002-running"), /IteratorClose. runs only when that algorithm requires it/)
  assert.doesNotMatch(read("docs/design/vips/0002-effect-blocks-and-do.md"), /IteratorClose on every completion/)
  assert.ok(read("docs/design/vips/0002-effect-blocks-and-do.md").includes("when "+String.fromCharCode(96)+"bad.value"+String.fromCharCode(96)+" completes normally and"), "primitive close-result TypeError needs normal default completion")
})

test("the printed native iterator witness retains its Die value and distinct closing traces", () => {
  const result = run(block(chapter("008-runtime"), "Native iterator completion witness"))
  assert.equal(result.status, 0, result.stderr + result.stdout)
})

test("raw advancement errors skip iterator close while unwinding outer JavaScript disposal", () => {
  for (const pattern of ["loop", "binding", "assignment"]) {
    for (const phase of ["method", "next", "result", "done", "value"]) {
      const events = []
      const problem = { phase }
      const overrides = phase === "method" ? { next: 1 } : {
        next() {
          if (phase === "next") throw problem
          if (phase === "result") return 1
          if (phase === "done") return { get done() { throw problem } }
          return { done: false, get value() { throw problem } }
        },
      }
      const source = iterator(events, overrides)
      const exit = Effect.runSyncExit(Effect.gen(function* () {
        using outer = { [Symbol.dispose]() { events.push("dispose") } }
        if (pattern === "binding") { const [value] = source }
        else if (pattern === "assignment") { let value; [value] = source }
        else { for (const value of source) throw new Error("unexpected body") }
      }))
      const error = defect(exit)
      if (phase === "method" || phase === "result") assert.ok(error instanceof TypeError)
      else assert.equal(error, problem)
      assert.deepEqual(events, ["dispose"], phase + "/" + pattern)
    }
  }
})

test("exhaustion suppresses closing even when a later binding or assignment default throws", () => {
  for (const assignment of [false, true]) {
    for (const done of [false, true]) {
      const events = []
      const problem = { done, assignment }
      const box = { get value() { throw problem } }
      const source = iterator(events, { next() { return { done, value: undefined } } })
      const exit = Effect.runSyncExit(Effect.gen(function* () {
        if (assignment) { let value; [value = box.value] = source }
        else { const [value = box.value] = source }
      }))
      assert.equal(defect(exit), problem)
      assert.deepEqual(events, done ? [] : ["close"])
    }
  }
})

test("binding and assignment preserve pending throws while normal completion checks close results", () => {
  for (const assignment of [false, true]) {
    for (const throwsDefault of [false, true]) {
      for (const closing of ["absent", "null", "object", "throw", "primitive", "noncallable", "getter"]) {
        const problem = { label: "default" }, closeProblem = { label: "close" }
        const source = iterator([])
        if (closing === "absent") source.return = undefined
        if (closing === "null") source.return = null
        if (closing === "throw") source.return = () => { throw closeProblem }
        if (closing === "primitive") source.return = () => 1
        if (closing === "noncallable") source.return = 1
        if (closing === "getter") Object.defineProperty(source, "return", { get() { throw closeProblem } })
        const box = { get value() { if (throwsDefault) throw problem; return 7 } }
        const exit = Effect.runSyncExit(Effect.gen(function* () {
          if (assignment) { let value; [value = box.value] = source; return value }
          const [value = box.value] = source
          return value
        }))
        if (throwsDefault) assert.equal(defect(exit), problem)
        else if (closing === "throw" || closing === "getter") assert.equal(defect(exit), closeProblem)
        else if (closing === "primitive" || closing === "noncallable") assert.ok(defect(exit) instanceof TypeError)
        else { assert.ok(Exit.isSuccess(exit)); assert.equal(exit.value, 7) }
      }
    }
  }
})
