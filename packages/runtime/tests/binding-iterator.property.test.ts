// Property-based differential fuzzer for packages/runtime/src/binding-iterator.ts ($bindingIterators).
//
// Universal differential oracle:
//   $bindingIterators is the compiler ABI for statement-lowered array binding
//   destructuring with defaults. For ANY generated iterable (including holes,
//   undefined values, early exhaustion, throwing Symbol.iterator, non-object
//   iterators/results, throwing next/done/value/return getters/methods, and
//   throwing default expressions), `$bindingIterators` MUST match native
//   JavaScript array destructuring on:
//     1. Extracted binding values (including defaults and ...rest).
//     2. Exact IteratorClose (`return()`) call count and call trace.
//     3. Thrown error identity/type and exception precedence (an exception in
//        flight MUST win over a `return()` close error; on normal exit, a
//        `return()` close error MUST propagate).

import { describe, expect, test } from "bun:test"
import * as fc from "fast-check"
import { $bindingIterators } from "../src/binding-iterator.js"

type FaultKind =
  | "none"
  | "null-source"
  | "bad-symbol-iterator"
  | "throw-symbol-iterator"
  | "primitive-iterator"
  | "bad-next"
  | "throw-next"
  | "primitive-result"
  | "throw-done"
  | "throw-value"
  | "throw-return"
  | "bad-return"
  | "primitive-return"

interface Scenario {
  items: Array<number | undefined>
  fault: FaultKind
  faultAt: number
  pattern: "two-with-defaults" | "skip-and-value" | "value-and-rest" | "default-throws"
}

function makeIterable(scenario: Scenario) {
  const events: string[] = []
  let returnCalls = 0
  if (scenario.fault === "null-source") {
    return { source: null as unknown as Iterable<unknown>, events, getReturnCalls: () => returnCalls }
  }
  const source = {
    [Symbol.iterator]:
      scenario.fault === "bad-symbol-iterator"
        ? (42 as unknown)
        : function () {
            events.push("open")
            if (scenario.fault === "throw-symbol-iterator") {
              throw new RangeError("sym-iter-boom")
            }
            if (scenario.fault === "primitive-iterator") {
              return 123 as unknown as Iterator<unknown>
            }
            let idx = 0
            return {
              next:
                scenario.fault === "bad-next"
                  ? ("not-a-fn" as unknown)
                  : () => {
                      const step = idx++
                      events.push(`next:${step}`)
                      if (scenario.fault === "throw-next" && step === scenario.faultAt) {
                        throw new RangeError(`next-boom-${step}`)
                      }
                      if (scenario.fault === "primitive-result" && step === scenario.faultAt) {
                        return "bad-result" as unknown as IteratorResult<unknown>
                      }
                      const done = step >= scenario.items.length
                      const val = done ? undefined : scenario.items[step]
                      return {
                        get done() {
                          events.push(`done:${step}:${done}`)
                          if (scenario.fault === "throw-done" && step === scenario.faultAt) {
                            throw new RangeError(`done-boom-${step}`)
                          }
                          return done
                        },
                        get value() {
                          events.push(`value:${step}`)
                          if (scenario.fault === "throw-value" && step === scenario.faultAt) {
                            throw new RangeError(`value-boom-${step}`)
                          }
                          return val
                        },
                      }
                    },
              return:
                scenario.fault === "bad-return"
                  ? (99 as unknown)
                  : () => {
                      returnCalls++
                      events.push("return")
                      if (scenario.fault === "throw-return") {
                        throw new RangeError("return-boom")
                      }
                      if (scenario.fault === "primitive-return") {
                        return 7 as unknown as IteratorResult<unknown>
                      }
                      return { done: true, value: undefined }
                    },
            }
          },
  } as unknown as Iterable<unknown>

  return { source, events, getReturnCalls: () => returnCalls }
}

function runNative(scenario: Scenario) {
  const { source, events, getReturnCalls } = makeIterable(scenario)
  const def1 = () => -1
  const def2 = () => -2
  try {
    let result: unknown
    switch (scenario.pattern) {
      case "two-with-defaults": {
        const [a = def1(), b = def2()] = source as Iterable<number | undefined>
        result = [a, b]
        break
      }
      case "skip-and-value": {
        const [, b = def2()] = source as Iterable<number | undefined>
        result = [b]
        break
      }
      case "value-and-rest": {
        const [a = def1(), ...rest] = source as Iterable<number | undefined>
        result = [a, rest]
        break
      }
      case "default-throws": {
        const boom = () => {
          throw new URIError("default-boom")
        }
        const [a = boom(), b = def2()] = source as Iterable<number | undefined>
        result = [a, b]
        break
      }
    }
    return { ok: true as const, result, events, returnCalls: getReturnCalls() }
  } catch (err) {
    return {
      ok: false as const,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      events,
      returnCalls: getReturnCalls(),
    }
  }
}

function runLowered(scenario: Scenario) {
  const { source, events, getReturnCalls } = makeIterable(scenario)
  const iterators = $bindingIterators()
  let throwing = false
  let ok = false
  let result: unknown
  let caught: unknown
  try {
    const it = iterators.open(source)
    switch (scenario.pattern) {
      case "two-with-defaults": {
        let a = it.value(0, true)
        if (a === undefined) a = -1
        let b = it.value(1, true)
        if (b === undefined) b = -2
        result = [a, b]
        break
      }
      case "skip-and-value": {
        it.skip()
        let b = it.value(1, true)
        if (b === undefined) b = -2
        result = [b]
        break
      }
      case "value-and-rest": {
        let a = it.value(0, true)
        if (a === undefined) a = -1
        const rest = it.rest()
        result = [a, rest]
        break
      }
      case "default-throws": {
        let a = it.value(0, true)
        if (a === undefined) throw new URIError("default-boom")
        let b = it.value(1, true)
        if (b === undefined) b = -2
        result = [a, b]
        break
      }
    }
    iterators.close()
    ok = true
  } catch (err) {
    throwing = true
    caught = err
  } finally {
    try {
      iterators.finish(throwing)
    } catch (finishErr) {
      if (!throwing) {
        ok = false
        caught = finishErr
      }
    }
  }
  if (ok) {
    return { ok: true as const, result, events, returnCalls: getReturnCalls() }
  }
  return {
    ok: false as const,
    errorName: caught instanceof Error ? caught.name : typeof caught,
    errorMessage: caught instanceof Error ? caught.message : String(caught),
    events,
    returnCalls: getReturnCalls(),
  }
}

const FAULTS: FaultKind[] = [
  "none",
  "null-source",
  "bad-symbol-iterator",
  "throw-symbol-iterator",
  "primitive-iterator",
  "bad-next",
  "throw-next",
  "primitive-result",
  "throw-done",
  "throw-value",
  "throw-return",
  "bad-return",
  "primitive-return",
]

describe("$bindingIterators differential fuzzing against native JS destructuring", () => {
  test("property: lowered array binding matches native JS destructuring across faults, defaults, skips, rest, and IteratorClose", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.integer({ min: 0, max: 99 }), fc.constant(undefined)), {
          minLength: 0,
          maxLength: 5,
        }),
        fc.constantFrom(...FAULTS),
        fc.integer({ min: 0, max: 3 }),
        fc.constantFrom<Scenario["pattern"]>(
          "two-with-defaults",
          "skip-and-value",
          "value-and-rest",
          "default-throws",
        ),
        (items, fault, faultAt, pattern) => {
          const scenario: Scenario = { items, fault, faultAt, pattern }
          const expected = runNative(scenario)
          const actual = runLowered(scenario)

          expect(actual.ok).toBe(expected.ok)
          // Note: JSC (Bun) has two known divergences from ES2025 IteratorStep /
          // IteratorStepValue that V8/Node and $bindingIterators follow:
          //   1. JSC reads `.value` on array elisions (`[, b]`), whereas ES2025
          //      and $bindingIterators skip `.value` (`read === false`).
          //   2. JSC calls `return()` when `.value` throws inside `[...rest]`,
          //      whereas ES2025 IteratorStepValue / V8 / $bindingIterators mark
          //      the iterator done and do NOT call `return()`.
          const jscRestValueThrow =
            typeof Bun !== "undefined" &&
            scenario.pattern === "value-and-rest" &&
            scenario.fault === "throw-value" &&
            scenario.faultAt >= 1 &&
            scenario.faultAt < scenario.items.length
          if (jscRestValueThrow) {
            expect(actual.returnCalls).toBe(0)
          } else {
            expect(actual.returnCalls).toBe(expected.returnCalls)
          }
          const normalizeEvents = (ev: string[]) => {
            let out = scenario.pattern === "skip-and-value" ? ev.filter((e) => e !== "value:0") : ev
            if (jscRestValueThrow) out = out.filter((e) => e !== "return")
            return out
          }
          expect(normalizeEvents(actual.events)).toEqual(normalizeEvents(expected.events))
          if (expected.ok && actual.ok) {
            expect(actual.result).toEqual(expected.result)
          } else if (!expected.ok && !actual.ok) {
            expect(actual.errorName).toBe(expected.errorName)
            if (expected.errorName !== "TypeError") {
              expect(actual.errorMessage).toBe(expected.errorMessage)
            }
          }
        },
      ),
      { numRuns: 300, seed: 20261122 },
    )
  })

  test("property: nested open iterators close in LIFO order even when inner close throws", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        (depth, throwAtIndex, inFlightThrow) => {
          const closed: number[] = []
          const iterators = $bindingIterators()
          for (let i = 0; i < depth; i++) {
            const idx = i
            iterators.open({
              [Symbol.iterator]() {
                return {
                  next: () => ({ done: false, value: idx }),
                  return() {
                    closed.push(idx)
                    if (idx === throwAtIndex) throw new RangeError(`close-${idx}`)
                    return { done: true, value: undefined }
                  },
                }
              },
            })
          }

          let caught: unknown
          try {
            iterators.finish(inFlightThrow)
          } catch (err) {
            caught = err
          }

          // Every open iterator MUST be closed in LIFO order regardless of close failures.
          const expectedOrder = Array.from({ length: depth }, (_, k) => depth - 1 - k)
          expect(closed).toEqual(expectedOrder)

          if (inFlightThrow) {
            // An exception already in flight suppresses closing errors.
            expect(caught).toBeUndefined()
          } else if (throwAtIndex < depth) {
            expect(caught).toBeInstanceOf(RangeError)
            expect((caught as Error).message).toBe(`close-${throwAtIndex}`)
          } else {
            expect(caught).toBeUndefined()
          }
        },
      ),
      { numRuns: 100, seed: 20261123 },
    )
  })
})
