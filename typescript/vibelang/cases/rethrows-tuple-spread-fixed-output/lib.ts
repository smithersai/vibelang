/** @throws {RangeError} */
export function risky(n: number): number { throw new RangeError(String(n)) }
/**
 * @throws {never}
 * @rethrows cb
 */
export function invoke(cb: (n: number) => number): number { return cb(7) }
