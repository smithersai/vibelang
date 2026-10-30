import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

// The draft's FinishMatch, with its one step as a parameter.
function finishMatch(completion, iterators, seeds) {
  const errors = []
  if (seeds(completion)) errors.push(completion.value)
  for (const iterator of iterators) {
    const closed = iteratorClose(iterator)
    if (closed) errors.push(closed.value)
  }
  if (errors.length === 1) return { type: "throw", value: errors[0] }
  if (errors.length > 1) return { type: "throw", value: new AggregateError(errors) }
  return completion
}

// ECMA-262 IteratorClose with a normal completion, as FinishMatch calls it.
function iteratorClose(iterator) {
  try {
    const result = iterator.return()
    return Object(result) === result ? undefined : { value: new TypeError("not an object") }
  } catch (value) {
    return { value }
  }
}

const closers = {
  "closes": () => ({}),
  "throws": () => { throw "close" },
  "gives 1": () => 1,
}

const source = (close) => ({
  [Symbol.iterator]() { return this },
  next() { return { done: false, value: 1 } },
  return: close,
})

// The same jump out of a real for...of body: the precedent the rule names.
function forOf(kind, close) {
  try {
    outer: for (const _ of [1]) {
      for (const _ of source(close)) {
        if (kind === "return") return { type: "return", value: 7 }
        if (kind === "break") break outer
        continue outer
      }
    }
    return { type: kind }
  } catch (value) {
    return { type: "throw", value }
  }
}

const shape = (c) => c.type === "throw"
  ? { type: "throw", value: c.value instanceof Error ? c.value.name : c.value }
  : { type: c.type }

const onlyThrows = (c) => c.type === "throw"
const everyAbrupt = (c) => c.type !== "normal"

for (const kind of ["return", "break", "continue"]) {
  for (const [name, close] of Object.entries(closers)) {
    test(`a ${kind} out of an arm matches for...of when return() ${name}`, () => {
      const pending = { type: kind, value: 7 }
      assert.deepEqual(shape(finishMatch(pending, [source(close)], onlyThrows)), shape(forOf(kind, close)))
    })
  }
}

test("the draft's literal step would turn a return into a throw, which is why it is reconciled", () => {
  assert.deepEqual(finishMatch({ type: "return", value: 7 }, [], everyAbrupt), { type: "throw", value: 7 })
  assert.deepEqual(finishMatch({ type: "return", value: 7 }, [], onlyThrows), { type: "return", value: 7 })
  assert.match(read("docs/design/vips/tc39-pattern-matching/spec.emu"), /If _matchCompletion_ is an abrupt completion, append _matchCompletion_\.\[\[Value\]\] to _errors_\./)
  assert.match(read("docs/design/vips/tc39-pattern-matching/README.md"), /\| `FinishMatch`, its error list \|/)
})

test("a throw with a closing error aggregates, in draft order", () => {
  const { value } = finishMatch({ type: "throw", value: "arm" }, [source(closers.throws)], onlyThrows)
  assert.ok(value instanceof AggregateError)
  assert.deepEqual(value.errors, ["arm", "close"])
})

test("the chapter's counterpart runs: jumps and throws close, failures abandon", () => {
  const result = run(block(chapter("004-match"), "function first(log"))
  assert.equal(result.status, 0, result.stderr)
})

test("abandonment is defined once, and each chapter links to it", () => {
  const runtime = chapter("008-runtime")
  assert.equal([...runtime.matchAll(/id="abandonment"/g)].length, 1)
  for (const name of ["002-running", "004-match"]) assert.match(chapter(name), /008-runtime\.md#abandonment/)
  for (const name of ["002-running", "003-failures", "004-match", "008-runtime"]) {
    assert.doesNotMatch(chapter(name), /typed `throw` in a guard or arm|source `throw` arm is|skips `FinishMatch`|before `FinishMatch`/)
  }
})

test("the no-match error has one spelling", () => {
  for (const name of ["000-intro", "001-functions", "002-running", "003-failures", "004-match", "006-data", "008-runtime"]) {
    assert.doesNotMatch(chapter(name), /new TypeError\("[^"]*(?:match|arm)[^"]*"\)/i)
  }
  assert.match(chapter("004-match"), /throws `new TypeError\(\)`/)
  assert.doesNotMatch(chapter("004-match"), /host.s default message/)
})
