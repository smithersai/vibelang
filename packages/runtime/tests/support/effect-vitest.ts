// The subset of `@effect/vitest` the fuzz tests use, on `bun:test`. The tests
// are kept as close to the upstream Effect contribution copy as their imports
// allow, so a later sync stays a diff of imports. The fuzz engine reads wall
// time from `Date.now` and builds its own clock under simulation, so
// `it.effect` and `it.live` both run on the live services.
import { describe as bunDescribe, test } from "bun:test"
import * as nodeAssert from "node:assert/strict"
import { Effect } from "effect"

const runEffect = (name: string, self: () => Effect.Effect<unknown, unknown, never>, timeout?: number) =>
  test(name, () => Effect.runPromise(Effect.asVoid(Effect.suspend(self))), timeout ?? 5_000)

const effect = (name: string, self: () => Effect.Effect<unknown, unknown, never>, timeout?: number) =>
  runEffect(name, self, timeout)

export const it = Object.assign((name: string, self: () => unknown, timeout?: number) => test(name, self as any, timeout), {
  effect,
  live: effect
})

export const describe = bunDescribe

const message = (text: string | undefined, fallback: string) => text ?? fallback

export const assert = {
  strictEqual: <A>(actual: unknown, expected: A, text?: string) => nodeAssert.strictEqual(actual, expected, text),
  notStrictEqual: (actual: unknown, expected: unknown, text?: string) => nodeAssert.notStrictEqual(actual, expected, text),
  deepStrictEqual: (actual: unknown, expected: unknown, text?: string) => nodeAssert.deepStrictEqual(actual, expected, text),
  throws: (fn: () => unknown, expected?: RegExp | Function, text?: string) =>
    expected === undefined ? nodeAssert.throws(fn, text) : nodeAssert.throws(fn, expected as any, text),
  isTrue: (value: unknown, text?: string) => nodeAssert.strictEqual(value, true, text),
  isFalse: (value: unknown, text?: string) => nodeAssert.strictEqual(value, false, text),
  isUndefined: (value: unknown, text?: string) => nodeAssert.strictEqual(value, undefined, text),
  isString: (value: unknown, text?: string) =>
    nodeAssert.ok(typeof value === "string", message(text, `expected a string, got ${typeof value}`)),
  isBelow: (value: number, below: number, text?: string) =>
    nodeAssert.ok(value < below, message(text, `expected ${value} to be below ${below}`)),
  include: (haystack: unknown, needle: unknown, text?: string) =>
    nodeAssert.ok(includes(haystack, needle), message(text, `expected ${show(haystack)} to include ${show(needle)}`)),
  notInclude: (haystack: unknown, needle: unknown, text?: string) =>
    nodeAssert.ok(!includes(haystack, needle), message(text, `expected ${show(haystack)} not to include ${show(needle)}`))
}

const show = (value: unknown) => typeof value === "string" ? JSON.stringify(value) : String(value)

const includes = (haystack: unknown, needle: unknown): boolean => {
  if (typeof haystack === "string") return haystack.includes(needle as string)
  if (Array.isArray(haystack)) return haystack.includes(needle)
  if (haystack instanceof Set || haystack instanceof Map) return haystack.has(needle)
  if (typeof haystack === "object" && haystack !== null && typeof needle === "object" && needle !== null) {
    return Object.entries(needle).every(([key, value]) => Object.is((haystack as any)[key], value))
  }
  return false
}
