import { webcrypto } from "node:crypto";
import { Context } from "../runtime/layer.ts";
import { panic } from "../runtime/panic.ts";

const MAX_BYTES = 1 << 20;
const GET_RANDOM_VALUES_QUOTA = 65_536;
const UINT32_SPAN = 2 ** 32;
const DOUBLE_SPAN = 2 ** 53;

/** Integer in `[0, 2^53)`: exactly the mantissa width of a double. */
function uniform53(nextUint32: () => number): number {
  return (nextUint32() >>> 5) * 2 ** 26 + (nextUint32() >>> 6);
}

/**
 * Randomness is host-sensitive even though `Math.random` is a universal global,
 * so it is reached through a capability. Contract violations (bad bounds, a
 * negative length) are programmer errors and panic rather than returning a
 * Result: they are not recoverable conditions the caller can branch on.
 */
export abstract class Random extends Context {
  /** Uniform float in `[0, 1)`. */
  abstract next(): number;

  /** Uniform integer in `[minInclusive, maxExclusive)`. */
  abstract int(minInclusive: number, maxExclusive: number): number;

  /** `length` uniform bytes. */
  abstract bytes(length: number): Uint8Array;
}

function assertBounds(minInclusive: number, maxExclusive: number): number {
  if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive)) {
    panic("Random.int bounds must be safe integers");
  }
  if (maxExclusive <= minInclusive) panic("Random.int requires minInclusive < maxExclusive");
  const span = maxExclusive - minInclusive;
  if (!Number.isSafeInteger(span)) panic("Random.int range exceeds the safe integer span");
  return span;
}

function assertLength(length: number): void {
  if (!Number.isSafeInteger(length) || length < 0) {
    panic("Random.bytes requires a non-negative integer length");
  }
  if (length > MAX_BYTES) panic(`Random.bytes length exceeds the ${MAX_BYTES} byte limit`);
}

/**
 * Uniform integer from a stream of uint32 draws. Rejection sampling keeps the
 * distribution exact; a plain modulo would bias the low values of the range.
 */
function uniformBelow(span: number, nextUint32: () => number): number {
  if (span > UINT32_SPAN) {
    // Ranges wider than 2^32 draw the full 53-bit mantissa instead.
    const limit = Math.floor(DOUBLE_SPAN / span) * span;
    for (;;) {
      const draw = uniform53(nextUint32);
      if (draw < limit) return draw % span;
    }
  }
  const limit = UINT32_SPAN - (UINT32_SPAN % span);
  for (;;) {
    const draw = nextUint32();
    if (draw < limit) return draw % span;
  }
}

/** Node/Bun live implementation backed by the host CSPRNG. */
export class SystemRandom extends Random {
  static make(): SystemRandom {
    return new SystemRandom();
  }

  #uint32(): number {
    const buffer = new Uint32Array(1);
    webcrypto.getRandomValues(buffer);
    return buffer[0] as number;
  }

  next(): number {
    return uniform53(() => this.#uint32()) / DOUBLE_SPAN;
  }

  int(minInclusive: number, maxExclusive: number): number {
    const span = assertBounds(minInclusive, maxExclusive);
    return minInclusive + uniformBelow(span, () => this.#uint32());
  }

  bytes(length: number): Uint8Array {
    assertLength(length);
    const output = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += GET_RANDOM_VALUES_QUOTA) {
      // getRandomValues rejects requests above its per-call quota.
      webcrypto.getRandomValues(output.subarray(offset, Math.min(offset + GET_RANDOM_VALUES_QUOTA, length)));
    }
    return output;
  }
}

/**
 * Deterministic mulberry32 generator. The same seed always replays the same
 * stream, which is what makes a randomized code path assertable.
 */
export class SeededRandom extends Random {
  #state: number;
  readonly #seed: number;

  private constructor(seed: number) {
    super();
    this.#seed = seed;
    this.#state = seed;
  }

  static withSeed(seed: number): SeededRandom {
    if (!Number.isSafeInteger(seed)) panic("SeededRandom.withSeed requires a safe integer seed");
    return new SeededRandom(seed | 0);
  }

  get seed(): number {
    return this.#seed;
  }

  /** Replay the stream from the original seed. */
  reset(): this {
    this.#state = this.#seed;
    return this;
  }

  #uint32(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  next(): number {
    return this.#uint32() / UINT32_SPAN;
  }

  int(minInclusive: number, maxExclusive: number): number {
    const span = assertBounds(minInclusive, maxExclusive);
    return minInclusive + uniformBelow(span, () => this.#uint32());
  }

  bytes(length: number): Uint8Array {
    assertLength(length);
    const output = new Uint8Array(length);
    for (let index = 0; index < length; index += 4) {
      const draw = this.#uint32();
      for (let byte = 0; byte < 4 && index + byte < length; byte++) {
        output[index + byte] = (draw >>> (byte * 8)) & 0xff;
      }
    }
    return output;
  }
}
