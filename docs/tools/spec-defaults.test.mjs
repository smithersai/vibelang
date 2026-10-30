import assert from "node:assert/strict"
import { test } from "node:test"
import { Cause, Effect, Exit } from "effect"
import { block, chapter, read, run } from "./spec-witness.mjs"

const iterable = (overrides = {}) => ({
  [Symbol.iterator]() { return this },
  next() { return { done: false, value: undefined } },
  return() { this.closed = (this.closed ?? 0) + 1; return {} },
  ...overrides,
})

const outcome = (exit) => {
  if (Exit.isSuccess(exit)) return ["Success", exit.value]
  const reason = exit.cause.reasons[0]
  const value = reason._tag === "Die" ? reason.defect : reason.error
  return [reason._tag, value instanceof Error ? value.name : value]
}

// The chapter's k and h, with each pattern written natively. A native default
// can hold a yield*, so these are what the compiled patterns must equal.
const k = (xs, bad) => Effect.gen(function* () {
  const [x = (yield* Effect.succeed(7), bad.value)] = xs
  return x
})
const h = (xs, b) => Effect.gen(function* () {
  const v = () => b.value
  const [x = (yield* Effect.succeed(7), v())] = xs
  return x
})

test("a throw wins over an error from closing; a bad close result is a TypeError", () => {
  const throwing = { get value() { throw "body" } }
  assert.deepEqual(outcome(Effect.runSyncExit(k(iterable({ return() { throw "close" } }), throwing))), ["Die", "body"])
  assert.deepEqual(outcome(Effect.runSyncExit(k(iterable({ return() { return 1 } }), { value: 7 }))), ["Die", "TypeError"])
})

test("a binding is initialized before the pattern's close", () => {
  let read
  const xs = iterable({ return() { read = closure(); return {} } })
  let closure
  const program = Effect.gen(function* () {
    closure = () => x
    const [x = (yield* Effect.succeed(7), 7)] = xs
    return x
  })
  assert.deepEqual(outcome(Effect.runSyncExit(program)), ["Success", 7])
  assert.equal(read, 7)
})

test("protocol errors are the host's own TypeErrors, in the host's order", () => {
  const cases = [
    { [Symbol.iterator]: () => 1 },
    { [Symbol.iterator]: () => null },
    { [Symbol.iterator]: () => ({ next: 1 }) },
    iterable({ return: 1 }),
    5,
  ]
  for (const xs of cases) assert.deepEqual(outcome(Effect.runSyncExit(h(xs, { value: 7 }))), ["Die", "TypeError"])
  Number.prototype.next = () => ({ done: true })
  try {
    assert.deepEqual(outcome(Effect.runSyncExit(h({ [Symbol.iterator]: () => 1 }, { value: 7 }))), ["Die", "TypeError"])
  } finally {
    delete Number.prototype.next
  }
})

// A generator resumed by return() delivers the completion a do { return 9 } in
// the default would. This is what JavaScript itself does with that completion.
function jump(xs) {
  function* pattern() { const [x = yield] = xs; return x }
  const it = pattern()
  it.next()
  return it.return(9)
}

test("a jump out of an array pattern's default closes the iterator, as for...of does", () => {
  const object = iterable()
  assert.deepEqual(jump(object), { value: 9, done: true })
  assert.equal(object.closed, 1)
  assert.throws(() => jump(iterable({ return() { throw "close" } })), (e) => e === "close")
  assert.throws(() => jump(iterable({ return() { return 1 } })), TypeError)
  const empty = iterable({ next() { return { done: true, value: undefined } } })
  assert.deepEqual(jump(empty), { value: 9, done: true })
  assert.equal(empty.closed, undefined)
})

test("a failure abandons the generator; a JavaScript throw unwinds it", () => {
  const failed = iterable()
  const failing = Effect.gen(function* () { const [x = (yield* Effect.fail("f"), 1)] = failed; return 0 })
  assert.deepEqual(outcome(Effect.runSyncExit(failing)), ["Fail", "f"])
  assert.equal(failed.closed, undefined)
  const thrown = iterable()
  const throwing = Effect.gen(function* () { const [x = (() => { throw "t" })()] = thrown; return 0 })
  assert.deepEqual(outcome(Effect.runSyncExit(throwing)), ["Die", "t"])
  assert.equal(thrown.closed, 1)
})

test("async functions: the reason the parameter table has a row of its own", async () => {
  const rejected = await (async (x = (() => { throw 7 })()) => 0)().catch(e => ["rejected", e])
  assert.deepEqual(rejected, ["rejected", 7])
  assert.match(read("docs/design/vips/tc39-do-expressions/README.md"), /EvaluateAsyncFunctionBody/)
})

test("return at the top of the body gives what the parameter table says", async () => {
  function* generator() { return 7 }
  assert.deepEqual(generator().next(), { value: 7, done: true })
  async function* stream() { return 7 }
  assert.deepEqual(await stream().next(), { value: 7, done: true })
  assert.equal(await (async () => { return 7 })(), 7)
  const running = chapter("002-running")
  const section = running.slice(running.indexOf('id="parameter-defaults"'), running.indexOf("## `fork` and `join`"))
  assert.doesNotMatch(section, /Undecided/)
})

test("chapter 8's counterparts run", () => {
  const runtime = chapter("008-runtime")
  for (const marker of ["function defaults()", "function eager("]) {
    const result = run(block(runtime, marker))
    assert.equal(result.status, 0, marker + "\n" + result.stderr)
  }
})

test("no recipe is left", () => {
  for (const name of ["000-intro", "001-functions", "002-running", "003-failures", "004-match", "008-runtime", "900-appendices"]) {
    const text = chapter(name)
    assert.doesNotMatch(text, /[Ee]xpression[- ]lowering/)
    assert.doesNotMatch(text, /moved (?:parameter )?default/)
    assert.doesNotMatch(text, /later parameter in its TDZ/)
    assert.doesNotMatch(text, /`while \(c\)` becomes/)
  }
})
