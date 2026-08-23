/**
 * `Data`: structural value semantics for ordinary records and tuples.
 *
 * `Data.struct` and `Data.tuple` take a plain object or a list of items and
 * return a deeply frozen, WeakSet-branded value whose equality and hash come
 * from its *shape* rather than its address. The result is still an ordinary
 * object — `point.x` and `pair[0]` read exactly as before, `Array.isArray` is
 * still true for a tuple — so a Data value is a Smithers value, not a wrapper
 * that has to be unwrapped before use.
 *
 * **This is the target the compiler will aim at.** The standard library lists
 * `Equivalence` and `Hash` as artifacts *derived at comptime where possible*
 * (docs/src/pages/reference/standard-library.mdx, "Schema and Encoding"). When
 * the compiler derives an `Equivalence`/`Hash` pair from a declared type, what
 * it derives is this: a shape-driven comparison over frozen fields, plugged
 * into the same `registerStructuralEquivalence`/`registerStructuralHash` seam
 * these functions use. `Data.struct` is the hand-written stand-in for that
 * derivation, and it is deliberately built on the public seam so the derived
 * instances can replace it without a single call site changing.
 *
 * **The reference/structural boundary**, the policy that matters most here:
 *
 * - Plain objects and arrays — prototype `Object.prototype`, `null`, or
 *   `Array.prototype` — are **converted**: copied, converted member by member,
 *   frozen, and branded. So `Data.struct({ at: { x: 1 } })` gives a Data value
 *   whose `at` is itself a Data value, and nesting is structural all the way
 *   down without the author naming `Data` at every level.
 * - `Chunk`, `HashMap`, `HashSet`, and existing `Data` values pass through
 *   untouched. They are already immutable, already branded, and already
 *   structural, so `Equivalence.any` compares them structurally as members.
 * - **Everything else compares by reference**: class instances, `Date`, `Map`,
 *   `Set`, `RegExp`, functions, promises. They are stored as they are — not
 *   copied and not frozen, because freezing a host object breaks it without
 *   making it immutable — and two of them are equal only when they are the same
 *   object. A `Data` value containing one is therefore only as structural as
 *   that member is.
 * - Only own enumerable **string** keys participate. Symbol-keyed properties
 *   are not copied and take no part in equality or hashing.
 *
 * A cyclic input has no structural equality worth defining, so it panics at
 * construction rather than recursing forever.
 *
 * Unlike `Chunk` and `HashMap`, a Data value may hold `null` or `undefined`: no
 * accessor on it returns an `Optional`, so there is no ambiguity to protect.
 */

import { panic } from "../runtime/panic.ts";
import { Equivalence as EquivalenceNamespace, registerStructuralEquivalence } from "./equivalence.ts";
import { Hash as HashNamespace, registerStructuralHash } from "./hash.ts";

const STRUCT_SEED = 0x3c6ef372;
const TUPLE_SEED = 0xa54ff53a;

const dataValues = new WeakSet<object>();
const hashCache = new WeakMap<object, number>();

export function isData(value: unknown): boolean {
  return typeof value === "object" && value !== null && dataValues.has(value);
}

function isPlainObject(value: object): boolean {
  if (Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/**
 * The deep conversion pass. `pending` holds the objects currently being
 * converted, which is how a cycle is caught: meeting one again means the input
 * contains itself.
 */
function convert(value: unknown, pending: Set<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (dataValues.has(value)) return value;
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) return value;

  if (pending.has(value)) panic("Data values must be acyclic");
  pending.add(value);
  try {
    if (isArray) {
      const items = (value as readonly unknown[]).map((item) => convert(item, pending));
      return brand(Object.freeze(items));
    }
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source)) target[key] = convert(source[key], pending);
    return brand(Object.freeze(target));
  } finally {
    pending.delete(value);
  }
}

function brand<T extends object>(value: T): T {
  dataValues.add(value);
  return value;
}

function dataEquals(left: unknown, right: unknown, recurse: (left: unknown, right: unknown) => boolean): boolean {
  if (left === right) return true;
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;

  if (leftIsArray) {
    const leftItems = left as readonly unknown[];
    const rightItems = right as readonly unknown[];
    if (leftItems.length !== rightItems.length) return false;
    for (let index = 0; index < leftItems.length; index += 1) {
      if (!recurse(leftItems[index], rightItems[index])) return false;
    }
    return true;
  }

  const leftFields = left as Record<string, unknown>;
  const rightFields = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftFields);
  if (leftKeys.length !== Object.keys(rightFields).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightFields, key)) return false;
    if (!recurse(leftFields[key], rightFields[key])) return false;
  }
  return true;
}

function dataHash(value: unknown, recurse: (value: unknown) => number): number {
  const target = value as object;
  const cached = hashCache.get(target);
  if (cached !== undefined) return cached;

  let accumulator: number;
  if (Array.isArray(value)) {
    accumulator = HashNamespace.combine(TUPLE_SEED, HashNamespace.number.hash(value.length));
    for (const item of value) accumulator = HashNamespace.combine(accumulator, recurse(item));
  } else {
    const fields = value as Record<string, unknown>;
    const keys = Object.keys(fields).sort();
    accumulator = HashNamespace.combine(STRUCT_SEED, HashNamespace.number.hash(keys.length));
    for (const key of keys) {
      accumulator = HashNamespace.combine(
        HashNamespace.combine(accumulator, HashNamespace.string.hash(key)),
        recurse(fields[key]),
      );
    }
  }
  hashCache.set(target, accumulator);
  return accumulator;
}

registerStructuralEquivalence({
  name: "Data",
  matches: isData,
  equals: dataEquals,
});

registerStructuralHash({
  name: "Data",
  matches: isData,
  hash: dataHash,
});

type DataStruct<Fields> = { readonly [Key in keyof Fields]: Fields[Key] };

/** A deeply frozen record with structural equality. Nested plain objects and arrays are converted too. */
function struct<Fields extends Record<string, unknown>>(fields: Fields): DataStruct<Fields> {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields) || !isPlainObject(fields)) {
    panic("Data.struct requires a plain object");
  }
  return convert(fields, new Set()) as DataStruct<Fields>;
}

/** A deeply frozen tuple with structural equality. Still a real array. */
function tuple<const Items extends readonly unknown[]>(...items: Items): Readonly<Items> {
  return convert(items.slice(), new Set()) as Readonly<Items>;
}

/**
 * Structural equality across everything this package knows about: `Data`
 * values, `Chunk`, `HashMap`, `HashSet`, and primitives under SameValueZero.
 * Anything else compares by reference. This is `Equivalence.any` under a name
 * that says what it is for.
 */
function equals(left: unknown, right: unknown): boolean {
  return EquivalenceNamespace.any.equals(left, right);
}

/** The hash matching `Data.equals`, i.e. `Hash.any`. Equal values hash equal. */
function hash(value: unknown): number {
  return HashNamespace.any.hash(value);
}

export const Data = Object.freeze({
  struct,
  tuple,
  isData,
  equals,
  hash,
});
