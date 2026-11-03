export const token: unique symbol = Symbol("risky")
export const handlers = {
  /** @throws {Error} */
  risky(): number { throw new Error("risky") },
  /** @throws {Error} */
  0(): number { throw new Error("numeric") },
  /** @throws {Error} */
  [token](): number { throw new Error("symbol") },
  /** @throws {never} */
  safe(): number { return 1 }
}
/** @throws {never} */
export declare function call(f: () => number): void
/** @throws {never} */
export declare function take(value: { onCall: () => number }): void
export interface Throwing {
  /** @throws {unknown} */
  (): number
}
/** @throws {never} */
export declare function allow(f: Throwing): void
