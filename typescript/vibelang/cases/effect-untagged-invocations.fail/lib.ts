export class Known {
  /** @throws {RangeError} */
  constructor(n: number) { if (n < 0) throw new RangeError("n") }
}
/** @throws {RangeError} */
export function knownTag(_parts: TemplateStringsArray): number { return 1 }
export class Implicit { value = 1 }
export class Explicit { constructor(readonly n: number) {} }
export class Safe {
  /** @throws {never} */
  constructor() {}
}
export function untaggedTag(_parts: TemplateStringsArray): number { return 1 }
