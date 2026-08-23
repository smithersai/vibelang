/**
 * Trusted foreign TypeScript boundary for the conformance corpus.
 *
 * A statically imported foreign module must carry a leading JSDoc
 * initialization trust claim (`SMITHERS1510`) before any `.sm` module may import it,
 * because an ESM initializer can fail before a Result boundary exists. That
 * module tag never doubles as a function-level opt-out, so each export below
 * carries — or deliberately omits — its own `@throws` contract.
 *
 * @module
 * @throws {never}
 */

/** A total function: the call needs no Result wrapper at all.
 * @throws {never}
 */
export function double(value: number): number {
  return value * 2;
}

/** No `@throws` claim: every call must charge the distinguished Panic channel. */
export function parseIntegerUnchecked(text: string): number {
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) throw new RangeError(`${text} is not an integer`);
  return parsed;
}

/**
 * A declared, narrow foreign failure. The call exposes `RangeError | Panic`:
 * the declared error is trusted enough to be named, and a violated contract
 * still lands in Panic.
 * @throws {RangeError}
 */
export function parseInteger(text: string): number {
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) throw new RangeError(`${text} is not an integer`);
  return parsed;
}

/** A foreign object whose property read has no annotated adapter. */
export const settings = {
  get retries(): number {
    return 3;
  },
};

/** An async foreign boundary with no `@throws` claim: its rejection must become Panic. */
export async function fetchLength(text: string): Promise<number> {
  if (text === "boom") throw new RangeError("the host rejected");
  return text.length;
}

/**
 * A foreign function whose declared channel is a LIE: it claims RangeError and
 * throws a TypeError. The trust claim names the channel; a violated claim must
 * still land in Panic rather than escaping the declared contract.
 * @throws {RangeError}
 */
export function parseIntegerLying(text: string): number {
  if (text === "boom") throw new TypeError("the host violated its own contract");
  return Number.parseInt(text, 10);
}

/** A foreign class with no `@throws {never}` on its constructor. */
export class Counter {
  constructor(readonly start: number) {}
  next(): number {
    return this.start + 1;
  }
}

/** A higher-order foreign function: it invokes a callback the caller supplies. */
export function applyTwice(value: number, step: (input: number) => number): number {
  return step(step(value));
}
