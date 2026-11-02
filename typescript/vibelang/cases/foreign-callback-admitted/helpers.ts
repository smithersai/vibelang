/** @throws {Error} */
export function risky(): number {
  throw new Error("risky")
}

/** @throws {never} @rethrows f */
export function twice(f: () => number): number {
  return f() + f()
}

export interface Loud {
  /** @throws {unknown} */
  (): number
}

export interface Erroring {
  /** @throws {Error} */
  (): number
}
