// The part of vitest 5's declarations the case calls. Like vitest's own,
// they carry no @throws.
export interface Assertion<T> {
  toBe(expected: T): void
}
export declare const expect: <T>(actual: T) => Assertion<T>
export declare const assert: {
  strictEqual<T>(actual: T, expected: T): void
}
