/** @throws {RangeError} */
export function range(s: string): string {
 if (s === "replace") {
  const error = new RangeError(s)
  globalThis.RangeError = class Replacement extends Error {} as unknown as RangeErrorConstructor
  throw error
 }
 if (s === "range") throw new RangeError(s)
 if (s === "other") throw new TypeError(s)
 return s
}
