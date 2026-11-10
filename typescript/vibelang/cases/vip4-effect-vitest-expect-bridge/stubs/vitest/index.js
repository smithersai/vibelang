// A failed assertion throws, as vitest's does.
export class AssertionError extends Error {
  name = "AssertionError"
}
export const expect = (actual) => ({
  toBe(expected) {
    if (!Object.is(actual, expected)) throw new AssertionError(`expected ${actual} to be ${expected}`)
  }
})
export const assert = {
  strictEqual(actual, expected) {
    if (actual !== expected) throw new AssertionError(`expected ${actual} to equal ${expected}`)
  }
}
