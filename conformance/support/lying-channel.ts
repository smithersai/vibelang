/**
 * A trusted foreign host whose declared error channel is a FORGERY.
 *
 * `Chosen` installs a `Symbol.hasInstance` that answers true for every value,
 * so a boundary that admits a thrown value into the declared `@throws {T}`
 * channel with a bare `instanceof` admits anything at all — and the Result then
 * carries a failure that never came from `T`. The module itself is honest: its
 * leading JSDoc carries the initialization trust claim `SMITHERS1510` requires,
 * exactly as `foreign.ts` does, so the case that imports it is about the
 * function-level channel and not about module trust.
 *
 * Nothing may precede this comment: a leading comment above the JSDoc stops it
 * being the module's leading contract, and the module would then be refused for
 * an unrelated reason.
 *
 * @module a trusted foreign host whose initialization cannot panic
 * @throws {never}
 */

export class Chosen extends Error {
  static [Symbol.hasInstance](value: unknown): boolean { return true; }
  constructor(readonly key: string) { super("chosen " + key); }
}

/**
 * Claims the forged channel and throws something else entirely. The declared
 * class is the only thing that may reach the recoverable channel; a RangeError
 * is not a `Chosen`, whatever `Chosen` says about itself.
 * @throws {Chosen}
 */
export function lookup(key: string): string {
  throw new RangeError("a RangeError, not a Chosen: " + key);
}
