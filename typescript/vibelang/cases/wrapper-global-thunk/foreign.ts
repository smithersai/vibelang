/** @throws {TypeError} */
export function later(fail: boolean): Promise<number> {
  if (fail) throw new TypeError("sync")
  return Promise.resolve(1)
}
/** @throws {RangeError} */
export function now(): number { return 2 }
