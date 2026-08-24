/**
 * `HashMap<K, V>`: the keyed collection from the standard library's "Core Data"
 * list (docs/src/pages/reference/standard-library.mdx).
 *
 * A HashMap is an immutable, frozen, WeakSet-branded value. `set` and `remove`
 * return new maps and never touch the receiver, and a lookup that can miss —
 * `get` — returns `V | undefined`. Because `undefined` is refused as a value
 * (see the policy below), an absent key and a key bound to a falsy value stay
 * distinguishable; `has` answers the membership question directly.
 *
 * **Keying is explicit.** A map carries an `Equivalence<K>` and a matching
 * `Hash<K>`, the pair whose law (`equals` implies equal hashes) is what makes a
 * key findable at all. `HashMap.of` and `HashMap.empty` use the structural
 * defaults — `Equivalence.any` and `Hash.any` — which cover primitives, `Data`
 * values, `Chunk`s, and nested collections, so structural keys work with no
 * ceremony. `HashMap.make(equivalence, hash)` supplies a custom pair, which is
 * how a case-insensitive or field-projected key gets its own map.
 *
 * **Representation.** Copy-on-write, which at POC scale is the honest choice:
 *
 * - a `Map` from key hash to a frozen bucket array, giving expected O(1)
 *   lookup and O(b) inside a bucket when hashes collide, and
 * - a frozen insertion-order array of the same entry objects.
 *
 * `set` and `remove` copy both, so an update is **O(n)** in the map's size,
 * while `get`/`has` are expected O(1) and `size` is O(1). A persistent HAMT
 * would make updates O(log32 n); replacing the representation with one changes
 * nothing about this API. Two cheap escapes exist and are documented on the
 * methods: `set` with an unchanged value and `remove` of an absent key both
 * return the receiver.
 *
 * **Iteration order is insertion order**, deterministically, for `entries`,
 * `keys`, `values`, and the map itself — never hash order, which would leak the
 * hash function into observable behaviour. Overwriting an existing key keeps
 * that key's original position, matching JavaScript's own `Map`.
 *
 * **Structural equality.** Two HashMaps are equal under `Equivalence.any` when
 * they share the same key `Equivalence` and `Hash` instances, have the same
 * size, and bind equal keys to equal values. Requiring the shared instances is
 * what keeps the hash law intact: a map's own key `Hash` is what hashes its
 * keys, so two maps that could be "equal" under different keyings would have no
 * lawful common hash. Maps built by `HashMap.of`/`empty` share the default
 * instances, so the common case just works.
 *
 * **No `null`, no `undefined`**, for keys or values — the same policy `Chunk`
 * states, for the same reason: `get` answers with `V | undefined`, so a stored
 * `undefined` would make a miss and a hit indistinguishable. A rejected entry
 * panics at `set`, where the mistake is, rather than at the lookup that trips
 * over it.
 */

import { panic } from "../runtime/panic.ts";
import {
  type Equivalence,
  Equivalence as EquivalenceNamespace,
  registerStructuralEquivalence,
  sameValueZero,
} from "./equivalence.ts";
import { type Hash, Hash as HashNamespace, registerStructuralHash } from "./hash.ts";

const MAP_SEED = 0x6a09e667;

interface Entry<K, V> {
  readonly key: K;
  readonly value: V;
}

interface MapState<K, V> {
  readonly equivalence: Equivalence<K>;
  readonly hash: Hash<K>;
  readonly buckets: ReadonlyMap<number, readonly Entry<K, V>[]>;
  readonly order: readonly Entry<K, V>[];
}

const states = new WeakMap<object, MapState<unknown, unknown>>();
const localMaps = new WeakSet<object>();

function stateOf<K, V>(map: HashMap<K, V>): MapState<K, V> {
  const state = states.get(map as object);
  if (state === undefined || !localMaps.has(map as object)) panic("forged HashMap value");
  return state as MapState<K, V>;
}

function locate<K, V>(state: MapState<K, V>, key: K): { readonly hash: number; readonly entry: Entry<K, V> | undefined } {
  const hash = state.hash.hash(key);
  const bucket = state.buckets.get(hash);
  if (bucket === undefined) return { hash, entry: undefined };
  for (const entry of bucket) {
    if (state.equivalence.equals(entry.key, key)) return { hash, entry };
  }
  return { hash, entry: undefined };
}

export abstract class HashMapValue<K, V> {
  /** O(1). */
  get size(): number {
    return stateOf(this).order.length;
  }

  isEmpty(): boolean {
    return stateOf(this).order.length === 0;
  }

  /** The `Equivalence` this map keys by; part of its identity under structural equality. */
  get keyEquivalence(): Equivalence<K> {
    return stateOf(this).equivalence;
  }

  /** The `Hash` this map keys by; part of its identity under structural equality. */
  get keyHash(): Hash<K> {
    return stateOf(this).hash;
  }

  /** `undefined` when the key is not bound. Expected O(1). */
  get(key: K): V | undefined {
    const { entry } = locate(stateOf(this), key);
    return entry?.value;
  }

  has(key: K): boolean {
    return locate(stateOf(this), key).entry !== undefined;
  }

  /**
   * A new map with `key` bound to `value`. O(n), except when the key is already
   * bound to the same value under SameValueZero, which returns the receiver.
   * An overwrite keeps the key's original iteration position.
   */
  set(key: K, value: V): HashMap<K, V> {
    if (key === null || key === undefined) panic("a HashMap key cannot be null or undefined");
    if (value === null || value === undefined) panic("a HashMap value cannot be null or undefined");
    const state = stateOf<K, V>(this);
    const { hash, entry } = locate(state, key);
    const next: Entry<K, V> = Object.freeze({ key, value });

    if (entry !== undefined) {
      if (sameValueZero(entry.value, value)) return this as HashMap<K, V>;
      const bucket = state.buckets.get(hash) as readonly Entry<K, V>[];
      const buckets = new Map(state.buckets);
      buckets.set(hash, Object.freeze(bucket.map((candidate) => (candidate === entry ? next : candidate))));
      return makeMap({
        ...state,
        buckets,
        order: Object.freeze(state.order.map((candidate) => (candidate === entry ? next : candidate))),
      });
    }

    const bucket = state.buckets.get(hash);
    const buckets = new Map(state.buckets);
    buckets.set(hash, Object.freeze(bucket === undefined ? [next] : [...bucket, next]));
    return makeMap({ ...state, buckets, order: Object.freeze([...state.order, next]) });
  }

  /** A new map without `key`. O(n), except that removing an absent key returns the receiver. */
  remove(key: K): HashMap<K, V> {
    const state = stateOf<K, V>(this);
    const { hash, entry } = locate(state, key);
    if (entry === undefined) return this as HashMap<K, V>;

    const bucket = state.buckets.get(hash) as readonly Entry<K, V>[];
    const remaining = bucket.filter((candidate) => candidate !== entry);
    const buckets = new Map(state.buckets);
    if (remaining.length === 0) buckets.delete(hash);
    else buckets.set(hash, Object.freeze(remaining));

    return makeMap({
      ...state,
      buckets,
      order: Object.freeze(state.order.filter((candidate) => candidate !== entry)),
    });
  }

  /** Entries in insertion order. */
  entries(): IterableIterator<readonly [K, V]> {
    return stateOf<K, V>(this).order.map((entry) => Object.freeze([entry.key, entry.value] as const))[Symbol.iterator]();
  }

  /** Keys in insertion order. */
  keys(): IterableIterator<K> {
    return stateOf<K, V>(this).order.map((entry) => entry.key)[Symbol.iterator]();
  }

  /** Values in insertion order. */
  values(): IterableIterator<V> {
    return stateOf<K, V>(this).order.map((entry) => entry.value)[Symbol.iterator]();
  }

  /** Same size, same keying instances, equal values under `Equivalence.any`. */
  equals(other: HashMap<K, V>): boolean {
    if (!isHashMap(other)) return false;
    return mapEquals(this as unknown as HashMap<unknown, unknown>, other as HashMap<unknown, unknown>, anyEquals);
  }

  [Symbol.iterator](): IterableIterator<readonly [K, V]> {
    return this.entries();
  }

  toString(): string {
    return `HashMap(${stateOf(this).order.length})`;
  }

  get [Symbol.toStringTag](): string {
    return "HashMap";
  }
}

export type HashMap<K, V> = HashMapValue<K, V>;

class LocalHashMap<K, V> extends HashMapValue<K, V> {
  constructor(state: MapState<K, V>) {
    super();
    states.set(this, Object.freeze(state) as MapState<unknown, unknown>);
    localMaps.add(this);
    Object.freeze(this);
  }
}

function makeMap<K, V>(state: MapState<K, V>): HashMap<K, V> {
  return new LocalHashMap(state);
}

export function isHashMap(value: unknown): value is HashMap<unknown, unknown> {
  return typeof value === "object" && value !== null && localMaps.has(value);
}

function anyEquals(left: unknown, right: unknown): boolean {
  return EquivalenceNamespace.any.equals(left, right);
}

function mapEquals(
  left: HashMap<unknown, unknown>,
  right: HashMap<unknown, unknown>,
  recurse: (left: unknown, right: unknown) => boolean,
): boolean {
  if (left === right) return true;
  const leftState = stateOf(left);
  const rightState = stateOf(right);
  if (leftState.equivalence !== rightState.equivalence || leftState.hash !== rightState.hash) return false;
  if (leftState.order.length !== rightState.order.length) return false;
  for (const entry of leftState.order) {
    const found = locate(rightState, entry.key).entry;
    if (found === undefined || !recurse(entry.value, found.value)) return false;
  }
  return true;
}

function mapHash(map: HashMap<unknown, unknown>, recurse: (value: unknown) => number): number {
  const state = stateOf(map);
  // Commutative, because insertion order is observable but not part of equality.
  let accumulator = 0;
  for (const entry of state.order) {
    accumulator = (accumulator + HashNamespace.combine(state.hash.hash(entry.key), recurse(entry.value))) >>> 0;
  }
  return HashNamespace.combine(MAP_SEED, HashNamespace.combine(HashNamespace.number.hash(state.order.length), accumulator));
}

registerStructuralEquivalence({
  name: "HashMap",
  matches: isHashMap,
  equals: (left, right, recurse) =>
    mapEquals(left as HashMap<unknown, unknown>, right as HashMap<unknown, unknown>, recurse),
});

registerStructuralHash({
  name: "HashMap",
  matches: isHashMap,
  hash: (value, recurse) => mapHash(value as HashMap<unknown, unknown>, recurse),
});

function emptyState<K, V>(equivalence: Equivalence<K>, hash: Hash<K>): MapState<K, V> {
  return { equivalence, hash, buckets: new Map(), order: Object.freeze([]) };
}

const DEFAULT_EQUIVALENCE = EquivalenceNamespace.any as Equivalence<never>;
const DEFAULT_HASH = HashNamespace.any as Hash<never>;
const EMPTY_MAP = makeMap(emptyState(DEFAULT_EQUIVALENCE, DEFAULT_HASH));

/** An empty map keyed structurally: primitives, `Data` values, `Chunk`s, and nested collections. */
function empty<K, V>(): HashMap<K, V> {
  return EMPTY_MAP as unknown as HashMap<K, V>;
}

/**
 * An empty map keyed by an explicit `Equivalence`/`Hash` pair. The two must
 * obey the hash law — `Hash.checkLaws` will tell you whether they do — because
 * a key whose hash disagrees with its equality is simply unreachable.
 */
function make<K, V>(equivalence: Equivalence<K>, hash: Hash<K>, entries?: Iterable<readonly [K, V]>): HashMap<K, V> {
  if (!EquivalenceNamespace.isEquivalence(equivalence)) panic("HashMap.make requires an Equivalence value");
  if (!HashNamespace.isHash(hash)) panic("HashMap.make requires a Hash value");
  const map = makeMap<K, V>(emptyState(equivalence, hash));
  return entries === undefined ? map : insertAll(map, entries);
}

function insertAll<K, V>(map: HashMap<K, V>, entries: Iterable<readonly [K, V]>): HashMap<K, V> {
  if (entries === null || entries === undefined || typeof (entries as Iterable<readonly [K, V]>)[Symbol.iterator] !== "function") {
    panic("HashMap requires an iterable of [key, value] entries");
  }
  let result = map;
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) panic("HashMap requires [key, value] entries");
    result = result.set(entry[0] as K, entry[1] as V);
  }
  return result;
}

/** A structurally keyed map from literal entries. Later entries win. */
function of<K, V>(...entries: readonly (readonly [K, V])[]): HashMap<K, V> {
  return insertAll(empty<K, V>(), entries);
}

/** A map from any iterable of entries; pass `options` to key it explicitly. */
function fromIterable<K, V>(
  entries: Iterable<readonly [K, V]>,
  options?: { readonly equivalence: Equivalence<K>; readonly hash: Hash<K> },
): HashMap<K, V> {
  if (options === undefined) return insertAll(empty<K, V>(), entries);
  return make<K, V>(options.equivalence, options.hash, entries);
}

export const HashMap = Object.freeze({
  empty,
  make,
  of,
  fromIterable,
  isHashMap,
});
