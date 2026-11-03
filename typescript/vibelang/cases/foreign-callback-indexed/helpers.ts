export const handlers = {
  /** @throws {Error} */
  risky(): number { throw new Error("risky") },
  /** @throws {never} */
  safe(): number { return 1 }
}
export interface Throwing {
  /** @throws {unknown} */
  (): number
}
/** @throws {never} */
export function call(f: () => number) { return f() }
/** @throws {never} */
export function allow(f: Throwing) { return f }
