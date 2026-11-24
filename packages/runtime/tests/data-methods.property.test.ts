// Property-based fuzzer for packages/runtime/src/data-methods.ts ($method).
//
// Universal invariants:
//   1. Own or inherited callable method wins over Effect candidates, binds
//      `this === receiver`, forwards exact arguments, and invokes getter
//      properties at most once.
//   2. Non-callable own/inherited fields (e.g. HashMap.size) do NOT shadow a
//      uniquely matching Effect TypeId candidate.
//   3. Exactly one matching candidate invokes `fn(value, ...args)` with
//      `this === undefined`.
//   4. Zero matching candidates OR >=2 ambiguous matching candidates throw
//      TypeError (never silently choosing an arbitrary candidate).
//   5. Null, undefined, primitives, and null-prototype objects behave safely.

import { describe, expect, test } from "bun:test"
import * as fc from "fast-check"
import { $method, type MethodCandidate } from "../src/data-methods.js"
import { dataMethodTypeIds } from "../src/data-methods-table.js"

const MODULES = Object.keys(dataMethodTypeIds).filter(
  (m) => (dataMethodTypeIds[m]?.length ?? 0) > 0,
)

describe("$method data-method dispatch fuzzing", () => {
  test("property: callable own/prototype members win, bind receiver, forward args, and read getters once", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MODULES),
        fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s !== "__proto__"),
        fc.array(fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)), {
          maxLength: 4,
        }),
        fc.boolean(),
        fc.boolean(),
        (mod, methodName, args, useGetter, onProto) => {
          const typeId = dataMethodTypeIds[mod]![0]!
          let getterReads = 0
          let candidateCalled = false
          let seenThis: unknown
          let seenArgs: unknown[] = []

          const impl = function (this: unknown, ...received: unknown[]) {
            seenThis = this
            seenArgs = received
            return "own-result"
          }

          const proto: Record<PropertyKey, unknown> = {}
          const receiver: Record<PropertyKey, unknown> = Object.create(onProto ? proto : Object.prototype)
          receiver[typeId] = true

          const host = onProto ? proto : receiver
          if (useGetter) {
            Object.defineProperty(host, methodName, {
              configurable: true,
              get() {
                getterReads++
                return impl
              },
            })
          } else {
            host[methodName] = impl
          }

          const candidates: MethodCandidate[] = [
            [
              mod,
              () => {
                candidateCalled = true
                return "candidate-result"
              },
            ],
          ]

          const out = $method(receiver, methodName, args, candidates)
          expect(out).toBe("own-result")
          expect(seenThis).toBe(receiver)
          expect(seenArgs).toEqual(args)
          expect(candidateCalled).toBe(false)
          if (useGetter) expect(getterReads).toBe(1)
        },
      ),
      { numRuns: 150, seed: 20261122 },
    )
  })

  test("property: single matching TypeId candidate wins over non-callable data fields, including null-prototype objects", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MODULES),
        fc.constantFrom("size", "map", "filter", "get", "value"),
        fc.oneof(fc.integer(), fc.string(), fc.constant(null), fc.constant(undefined), fc.boolean()),
        fc.array(fc.integer(), { maxLength: 4 }),
        fc.boolean(),
        (mod, propName, nonCallableField, args, nullProto) => {
          const typeIds = dataMethodTypeIds[mod]!
          const typeId = typeIds[0]!
          const receiver: Record<PropertyKey, unknown> = nullProto ? Object.create(null) : {}
          receiver[typeId] = true
          if (nonCallableField !== undefined) {
            receiver[propName] = nonCallableField
          }

          let seenThis: unknown = "sentinel"
          let seenArgs: unknown[] = []
          const matching: MethodCandidate = [
            mod,
            function (this: unknown, ...received: unknown[]) {
              seenThis = this
              seenArgs = received
              return "dispatched"
            },
          ]

          // Pick a distractor module whose TypeIds are disjoint from `typeId`.
          const distractorMod = MODULES.find(
            (other) => other !== mod && !dataMethodTypeIds[other]!.includes(typeId),
          )
          const candidates: MethodCandidate[] = distractorMod
            ? [
                [distractorMod, () => { throw new Error("wrong candidate called") }],
                matching,
              ]
            : [matching]

          const out = $method(receiver, propName, args, candidates)
          expect(out).toBe("dispatched")
          expect(seenThis).toBeUndefined()
          expect(seenArgs).toEqual([receiver, ...args])
        },
      ),
      { numRuns: 150, seed: 20261123 },
    )
  })

  test("property: zero or ambiguous (>=2) matching candidates always throw TypeError without calling any candidate", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MODULES),
        fc.constantFrom(...MODULES),
        fc.constantFrom("missingMethod", "size", "toString"),
        fc.boolean(),
        (modA, modB, propName, ambiguous) => {
          const idA = dataMethodTypeIds[modA]![0]!
          const idB = dataMethodTypeIds[modB]![0]!
          const receiver: Record<PropertyKey, unknown> = Object.create(null)
          if (ambiguous) {
            receiver[idA] = true
            receiver[idB] = true
          }
          let called = false
          const candidates: MethodCandidate[] = ambiguous
            ? [
                [modA, () => { called = true; return 1 }],
                [modB, () => { called = true; return 2 }],
              ]
            : [
                [modA, () => { called = true; return 1 }],
              ]

          expect(() => $method(receiver, propName, [1, 2], candidates)).toThrow(TypeError)
          expect(called).toBe(false)
        },
      ),
      { numRuns: 100, seed: 20261124 },
    )
  })

  test("property: null, undefined, and primitive receivers never mis-dispatch to candidates", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.string(),
          fc.boolean(),
        ),
        fc.constantFrom(...MODULES),
        (receiver, mod) => {
          let called = false
          const candidates: MethodCandidate[] = [
            [mod, () => { called = true; return "bad" }],
          ]
          expect(() => $method(receiver, "__definitelyNotAMethod__", [], candidates)).toThrow(TypeError)
          expect(called).toBe(false)
        },
      ),
      { numRuns: 80, seed: 20261125 },
    )
  })
})
