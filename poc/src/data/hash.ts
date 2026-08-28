/**
 * `Hash<T>`: the hashing half of the `Equivalence`/`Hash` seam.
 *
 * A `Hash` is an immutable, frozen, WeakSet-branded value wrapping a function
 * from a `T` to an **unsigned 32-bit integer** (`0 … 4294967295`), built the
 * same way `Equivalence` and `Duration` are. Every operation panics on a
 * forgery, and a hash function that returns anything other than a uint32
 * panics at the call that produced it rather than silently corrupting a bucket.
 *
 * **The law.** For a given pair of instances, `equivalence.equals(a, b)` implies
 * `hash.hash(a) === hash.hash(b)`. The converse is not required: unequal values
 * may collide, and `HashMap` is written to survive that. Every hashed
 * collection in this package depends on the forward direction — a violation
 * makes a key silently unreachable, not merely slow — so `Hash.checkLaws`
 * exists to assert it against a sample set, and every built-in pairing in this
 * module is checked that way in the tests.
 *
 * Policies, all deliberate and all tested:
 *
 * - **SameValueZero, matching `Equivalence`.** `-0` hashes as `+0` and `NaN`
 *   hashes to a fixed constant, because SameValueZero calls each of those pairs
 *   equal and the law then forces their hashes to agree.
 * - **The pipeline is bigint-free.** Every mix is `Math.imul`/shift arithmetic
 *   on 32-bit words; no `BigInt` is constructed anywhere. There is deliberately
 *   no `Hash.bigint` primitive instance for the same reason. `Hash.any` still
 *   accepts a `bigint` (and a `symbol`) by hashing its string form, so a `Data`
 *   value holding one works and the law still holds — equal bigints have equal
 *   string forms.
 * - **Doubles are hashed from their bits.** The two 32-bit words of the IEEE-754
 *   representation are mixed. Word order follows host endianness, so a hash is
 *   stable within a process and must not be persisted or sent over a wire.
 * - **Unregistered objects hash by identity.** An identity hash is assigned on
 *   first observation and remembered in a `WeakMap`. It is stable within a
 *   process and meaningless across processes — again, never persist one. This
 *   is the hashing side of the reference-equality fallback documented on
 *   `Equivalence.any`.
 *
 * `registerStructuralHash` is the counterpart of `registerStructuralEquivalence`
 * and carries the same rules: library-construction API, never re-exported into
 * an authoring namespace, one self-registration per module that defines a
 * branded structural type.
 */

import { panic } from "../runtime/panic.ts";
import { HOLE_HASH, requireDenseArray } from "./array-shape.ts";
import { type Equivalence, Equivalence as EquivalenceNamespace } from "./equivalence.ts";

const UINT32_MAX = 0xffffffff;

type HashFn = (value: unknown) => number;

const hashByInstance = new WeakMap<object, HashFn>();
const localHashes = new WeakSet<object>();

function hashOf<T>(instance: Hash<T>): HashFn {
  const hash = hashByInstance.get(instance as object);
  if (hash === undefined || !localHashes.has(instance as object)) panic("forged Hash value");
  return hash;
}

/** The single gate every hash result passes through. */
function checkedHash(value: number, caller: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    panic(`${caller} must produce an unsigned 32-bit integer`);
  }
  return value;
}

/** MurmurHash3's finalizer: spreads a 32-bit word's entropy across all its bits. */
function avalanche(word: number): number {
  let mixed = word | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

/**
 * Fold one hash into another. Order-sensitive on purpose: `combine(a, b)` and
 * `combine(b, a)` differ, so a tuple's hash depends on its arrangement.
 */
function combine(left: number, right: number): number {
  checkedHash(left, "Hash.combine");
  checkedHash(right, "Hash.combine");
  return avalanche((Math.imul(left, 0x27220a95) + right) | 0);
}

function hashString(text: string): number {
  // FNV-1a, 32-bit.
  let accumulator = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    accumulator ^= text.charCodeAt(index);
    accumulator = Math.imul(accumulator, 0x01000193);
  }
  return accumulator >>> 0;
}

const numberBuffer = new ArrayBuffer(8);
const numberFloats = new Float64Array(numberBuffer);
const numberWords = new Uint32Array(numberBuffer);

const NAN_HASH = 0x7ff80000;
const TRUE_HASH = 0x42108421;
const FALSE_HASH = 0x21084210;
const NULL_HASH = 0x0f0f0f0f;
const UNDEFINED_HASH = 0xf0f0f0f0;
const BIGINT_SEED = 0x1b873593;
const SYMBOL_SEED = 0xcc9e2d51;
const ARRAY_SEED = 0x9e3779b1;
const STRUCT_SEED = 0x85ebca6b;

function hashNumber(value: number): number {
  if (Number.isNaN(value)) return NAN_HASH;
  // Small integers take a cheap path; the ranges are disjoint, so a given
  // number always reaches exactly one of the two.
  if (Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) return avalanche(value | 0);
  numberFloats[0] = value === 0 ? 0 : value;
  return combine(numberWords[0] as number, numberWords[1] as number);
}

const identityHashes = new WeakMap<object, number>();
let identityCounter = 0x2f6e2b1;

function identityHash(value: object): number {
  const existing = identityHashes.get(value);
  if (existing !== undefined) return existing;
  identityCounter = avalanche(identityCounter + 1);
  identityHashes.set(value, identityCounter);
  return identityCounter;
}

export abstract class HashValue<T> {
  hash(value: T): number {
    return checkedHash(hashOf(this)(value), "a Hash");
  }

  /** Hash `B` values by the `T` they project to. */
  contramap<B>(project: (value: B) => T): Hash<B> {
    if (typeof project !== "function") panic("Hash.contramap requires a function");
    const hash = hashOf(this);
    return make<B>((value) => hash(project(value)));
  }

  get [Symbol.toStringTag](): string {
    return "Hash";
  }
}

export type Hash<T> = HashValue<T>;

class LocalHash<T> extends HashValue<T> {
  constructor(hash: HashFn) {
    super();
    hashByInstance.set(this, hash);
    localHashes.add(this);
    Object.freeze(this);
  }
}

function make<T>(hash: (value: T) => number): Hash<T> {
  if (typeof hash !== "function") panic("Hash.make requires a function");
  return new LocalHash<T>(((value: unknown) => checkedHash(hash(value as T), "a Hash")) as HashFn);
}

function isHash(value: unknown): value is Hash<unknown> {
  return typeof value === "object" && value !== null && localHashes.has(value);
}

function requireHash(value: unknown, caller: string): HashFn {
  if (!isHash(value)) panic(`${caller} requires a Hash value`);
  return hashOf(value);
}

// ---------------------------------------------------------------------------
// The structural seam
// ---------------------------------------------------------------------------

/**
 * How one branded structural type answers `Hash.any`. `matches` must be the
 * type's brand check, and `hash` receives `Hash.any`'s function for members.
 */
export interface StructuralHashRule {
  readonly name: string;
  readonly matches: (value: unknown) => boolean;
  readonly hash: (value: unknown, recurse: (value: unknown) => number) => number;
}

const structuralRules: StructuralHashRule[] = [];

/** Library-construction API. See `registerStructuralEquivalence`. */
export function registerStructuralHash(rule: StructuralHashRule): void {
  if (typeof rule?.name !== "string" || typeof rule.matches !== "function" || typeof rule.hash !== "function") {
    panic("registerStructuralHash requires a { name, matches, hash } rule");
  }
  if (structuralRules.some((existing) => existing.name === rule.name)) {
    panic(`structural Hash rule "${rule.name}" is already registered`);
  }
  structuralRules.push(Object.freeze({ ...rule }));
}

function anyHash(value: unknown): number {
  switch (typeof value) {
    case "number":
      return hashNumber(value);
    case "string":
      return hashString(value);
    case "boolean":
      return value ? TRUE_HASH : FALSE_HASH;
    case "undefined":
      return UNDEFINED_HASH;
    case "bigint":
      return combine(BIGINT_SEED, hashString(value.toString()));
    case "symbol":
      return combine(SYMBOL_SEED, hashString(value.toString()));
    case "function":
      return identityHash(value as unknown as object);
    default: {
      if (value === null) return NULL_HASH;
      for (const rule of structuralRules) {
        if (rule.matches(value)) return checkedHash(rule.hash(value, anyHash), `structural Hash rule "${rule.name}"`);
      }
      return identityHash(value as object);
    }
  }
}

// ---------------------------------------------------------------------------
// Built-in instances and combinators
// ---------------------------------------------------------------------------

const numberHash = make<number>(hashNumber);
const stringHash = make<string>(hashString);
const booleanHash = make<boolean>((value) => (value ? TRUE_HASH : FALSE_HASH));
const referenceHash = make<unknown>((value) =>
  value !== null && (typeof value === "object" || typeof value === "function")
    ? identityHash(value as object)
    : anyHash(value)
);
const anyHashInstance = make<unknown>(anyHash);

type HashOf<H> = H extends HashValue<infer A> ? A : never;

function tuple<const Parts extends readonly HashValue<never>[]>(
  ...parts: Parts
): Hash<{ readonly [Index in keyof Parts]: HashOf<Parts[Index]> }> {
  const hashes = parts.map((part, index) => requireHash(part, `Hash.tuple[${index}]`));
  return make<readonly unknown[]>((value) => {
    let accumulator = combine(ARRAY_SEED, hashNumber(hashes.length));
    for (let index = 0; index < hashes.length; index += 1) {
      // A hole has no member to hash; folding in `HOLE_HASH` is what keeps this
      // agreeing with `Equivalence.tuple`. See `./array-shape.ts`.
      accumulator = combine(
        accumulator,
        Object.hasOwn(value, index) ? (hashes[index] as HashFn)(value[index]) : HOLE_HASH,
      );
    }
    return accumulator;
  }) as Hash<{ readonly [Index in keyof Parts]: HashOf<Parts[Index]> }>;
}

function array<T>(item: Hash<T>): Hash<readonly T[]> {
  const hash = requireHash(item, "Hash.array");
  return make<readonly T[]>((value) => {
    let accumulator = combine(ARRAY_SEED, hashNumber(value.length));
    for (let index = 0; index < value.length; index += 1) {
      accumulator = combine(accumulator, Object.hasOwn(value, index) ? hash(value[index]) : HOLE_HASH);
    }
    return accumulator;
  });
}

/**
 * Field order does not matter: keys are sorted before folding, so a struct
 * Hash agrees with a struct `Equivalence` that names the same fields in a
 * different literal order.
 */
function struct<const Fields extends Readonly<Record<string, HashValue<never>>>>(
  fields: Fields,
): Hash<{ readonly [Key in keyof Fields]: HashOf<Fields[Key]> }> {
  if (fields === null || typeof fields !== "object") panic("Hash.struct requires a record of Hash values");
  const entries = Object.keys(fields)
    .sort()
    .map((key) => [key, requireHash(fields[key], `Hash.struct.${key}`)] as const);
  return make<Record<string, unknown>>((value) => {
    let accumulator = combine(STRUCT_SEED, hashNumber(entries.length));
    for (const [key, hash] of entries) {
      accumulator = combine(combine(accumulator, hashString(key)), hash(value?.[key]));
    }
    return accumulator;
  }) as unknown as Hash<{ readonly [Key in keyof Fields]: HashOf<Fields[Key]> }>;
}

/**
 * The `Equivalence`/`Hash` laws, checked against a sample set.
 *
 * Runs `Equivalence.checkLaws` first — a broken equivalence relation makes the
 * hash law meaningless — then asserts that the hash is deterministic and that
 * **equal values hash equal**. `undefined` means the pairing is lawful over
 * these samples; a string describes the first violation.
 */
function checkLaws<T>(equivalence: Equivalence<T>, hash: Hash<T>, samples: readonly T[]): string | undefined {
  if (!EquivalenceNamespace.isEquivalence(equivalence)) panic("Hash.checkLaws requires an Equivalence value");
  const equals = (left: T, right: T): boolean => equivalence.equals(left, right);
  const hashValue = requireHash(hash, "Hash.checkLaws");
  if (!Array.isArray(samples)) panic("Hash.checkLaws requires an array of samples");
  requireDenseArray(samples, "Hash.checkLaws samples");

  const equivalenceViolation = EquivalenceNamespace.checkLaws(equivalence, samples);
  if (equivalenceViolation !== undefined) return equivalenceViolation;

  for (let index = 0; index < samples.length; index += 1) {
    if (hashValue(samples[index]) !== hashValue(samples[index])) {
      return `hash is not deterministic at sample ${index}`;
    }
  }
  for (let left = 0; left < samples.length; left += 1) {
    for (let right = left + 1; right < samples.length; right += 1) {
      if (equals(samples[left] as T, samples[right] as T) && hashValue(samples[left]) !== hashValue(samples[right])) {
        return `equal samples ${left} and ${right} have different hashes`;
      }
    }
  }
  return undefined;
}

export const Hash = Object.freeze({
  make,
  isHash,
  /** SameValueZero: `-0` hashes as `+0`, `NaN` hashes to a fixed constant. */
  number: numberHash,
  string: stringHash,
  boolean: booleanHash,
  /** Identity hashing for objects, matching `Equivalence.reference`. */
  reference: referenceHash,
  /** Structural where a registered rule matches, primitive otherwise, identity as a last resort. */
  any: anyHashInstance,
  tuple,
  array,
  struct,
  combine,
  checkLaws,
});
