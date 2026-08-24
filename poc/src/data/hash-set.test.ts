import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { SeededRandom } from "../platform/random.ts";
import { Chunk } from "./chunk.ts";
import { Data } from "./data.ts";
import { Equivalence } from "./equivalence.ts";
import { Hash } from "./hash.ts";
import { HashSet, HashSetValue } from "./hash-set.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

describe("construction and membership", () => {
  test("of, empty, make, and fromIterable agree, and duplicates collapse", () => {
    const set = HashSet.of(1, 2, 3, 2, 1);
    expect(set.size).toBe(3);
    expect([...set]).toEqual([1, 2, 3]);
    expect(set.has(2)).toBe(true);
    expect(set.has(99)).toBe(false);
    expect(HashSet.empty<number>().size).toBe(0);
    expect(HashSet.empty<number>().isEmpty()).toBe(true);
    expect([...HashSet.fromIterable([3, 1, 3])]).toEqual([3, 1]);
    expect([...HashSet.make(Equivalence.number, Hash.number, [1, 2])]).toEqual([1, 2]);
    expect(
      [...HashSet.fromIterable([1, 2], { equivalence: Equivalence.number, hash: Hash.number })],
    ).toEqual([1, 2]);
    expect(HashSet.of(1).toArray()).toEqual([1]);
    expect(Object.isFrozen(HashSet.of(1).toArray())).toBe(true);
    expect(HashSet.isHashSet(set)).toBe(true);
    expect(HashSet.isHashSet(new Set())).toBe(false);
    expect(String(set)).toBe("HashSet(3)");
    expect(Object.prototype.toString.call(set)).toBe("[object HashSet]");
  });

  test("bad arguments panic, including the inherited null policy", () => {
    expect(panics(() => HashSet.make(null as never, Hash.number))).toBe(true);
    expect(panics(() => HashSet.make(Equivalence.number, null as never))).toBe(true);
    expect(panics(() => HashSet.fromIterable(7 as unknown as Iterable<number>))).toBe(true);
    expect(panics(() => HashSet.of(null as unknown as number))).toBe(true);
    expect(panics(() => HashSet.of(1).add(undefined as unknown as number))).toBe(true);
    expect(panics(() => HashSet.of(1).union([2] as unknown as HashSetValue<number>))).toBe(true);
    expect(panics(() => HashSet.of(1).intersection({} as never))).toBe(true);
    expect(panics(() => HashSet.of(1).difference({} as never))).toBe(true);
    expect(panics(() => HashSet.of(1).isSubsetOf({} as never))).toBe(true);
  });
});

describe("immutability and branding", () => {
  test("add and remove return new sets and leave the receiver untouched", () => {
    const base = HashSet.of("a", "b");
    expect(Object.isFrozen(base)).toBe(true);
    expect(() => {
      (base as unknown as { size: number }).size = 99;
    }).toThrow();

    const grown = base.add("c");
    const shrunk = base.remove("a");
    expect(grown.size).toBe(3);
    expect(shrunk.size).toBe(1);
    expect(base.size).toBe(2);
    expect([...base]).toEqual(["a", "b"]);

    // A no-op returns the receiver, all the way through the set wrapper.
    expect(base.add("a")).toBe(base);
    expect(base.remove("zzz")).toBe(base);
    expect(base.union(HashSet.of("a"))).toBe(base);
    expect(base.intersection(base)).toBe(base);
    expect(base.difference(HashSet.of("zzz"))).toBe(base);
  });

  test("a forged HashSet is rejected by every operation", () => {
    const forged = Object.create(HashSetValue.prototype) as HashSetValue<number>;
    expect(HashSet.isHashSet(forged)).toBe(false);
    expect(panics(() => forged.size)).toBe(true);
    expect(panics(() => forged.has(1))).toBe(true);
    expect(panics(() => forged.add(1))).toBe(true);
    expect(panics(() => forged.values())).toBe(true);
    expect(panics(() => forged.elementHash)).toBe(true);
    expect(panics(() => HashSet.of(1).union(forged))).toBe(true);
    expect(HashSet.of(1).equals(forged)).toBe(false);
    expect(HashSet.of(1).equals({ size: 1 } as never)).toBe(false);
  });
});

describe("set algebra", () => {
  const left = HashSet.of(1, 2, 3);
  const right = HashSet.of(3, 4, 5);

  test("union, intersection, and difference compute the expected members", () => {
    expect([...left.union(right)]).toEqual([1, 2, 3, 4, 5]);
    expect([...left.intersection(right)]).toEqual([3]);
    expect([...left.difference(right)]).toEqual([1, 2]);
    expect([...right.difference(left)]).toEqual([4, 5]);
    expect(left.union(HashSet.empty<number>()).equals(left)).toBe(true);
    expect(left.intersection(HashSet.empty<number>()).size).toBe(0);
    expect(left.difference(left).size).toBe(0);
  });

  test("the operations obey the usual identities on these samples", () => {
    // Commutativity of union and intersection, as sets rather than as orders.
    expect(left.union(right).equals(right.union(left))).toBe(true);
    expect(left.intersection(right).equals(right.intersection(left))).toBe(true);
    // Idempotence.
    expect(left.union(left).equals(left)).toBe(true);
    expect(left.intersection(left).equals(left)).toBe(true);
    // Absorption and the difference identity.
    expect(left.union(left.intersection(right)).equals(left)).toBe(true);
    expect(left.difference(right).union(left.intersection(right)).equals(left)).toBe(true);
    // Subsets.
    expect(left.intersection(right).isSubsetOf(left)).toBe(true);
    expect(left.isSubsetOf(left.union(right))).toBe(true);
    expect(left.isSubsetOf(right)).toBe(false);
    expect(HashSet.empty<number>().isSubsetOf(left)).toBe(true);
  });

  test("iteration order is insertion order: receiver first, then new arrivals", () => {
    expect([...HashSet.of(5, 1, 3)]).toEqual([5, 1, 3]);
    expect([...HashSet.of(5, 1).union(HashSet.of(9, 1, 7))]).toEqual([5, 1, 9, 7]);
    expect([...HashSet.of(5, 1, 9).intersection(HashSet.of(9, 5))]).toEqual([5, 9]);
    // Stable across repeated reads, and independent of hash values.
    const collides = HashSet.make<number>(Equivalence.number, Hash.make<number>(() => 7), [5, 1, 3]);
    expect([...collides]).toEqual([5, 1, 3]);
    expect([...collides.values()]).toEqual([...collides.values()]);
    expect(collides.has(1)).toBe(true);
    expect(collides.has(2)).toBe(false);
    expect([...collides.remove(1)]).toEqual([5, 3]);
  });
});

describe("structural and custom elements", () => {
  test("Data values and Chunks are members by shape", () => {
    const set = HashSet.of<unknown>(Data.struct({ id: 1 }), Chunk.of("a", "b"));
    expect(set.has(Data.struct({ id: 1 }))).toBe(true);
    expect(set.has(Chunk.of("a").append("b"))).toBe(true);
    expect(set.has(Data.struct({ id: 2 }))).toBe(false);
    expect(set.add(Data.struct({ id: 1 })).size).toBe(2);
    // A plain object is a reference member.
    expect(HashSet.of<unknown>({ id: 1 }).has({ id: 1 })).toBe(false);
  });

  test("a custom pair keys the set and is reported on the value", () => {
    const caseInsensitive = Equivalence.make<string>((a, b) => a.toLowerCase() === b.toLowerCase());
    const caseInsensitiveHash = Hash.string.contramap((value: string) => value.toLowerCase());
    const set = HashSet.make(caseInsensitive, caseInsensitiveHash, ["Alpha", "BETA"]);

    expect(set.has("alpha")).toBe(true);
    expect(set.has("beta")).toBe(true);
    expect(set.add("ALPHA").size).toBe(2);
    expect(set.elementEquivalence).toBe(caseInsensitive);
    expect(set.elementHash).toBe(caseInsensitiveHash);
    // Operations keep the receiver's keying.
    expect(set.union(HashSet.make(caseInsensitive, caseInsensitiveHash, ["gamma"])).elementEquivalence)
      .toBe(caseInsensitive);
  });
});

describe("structural equality", () => {
  test("equal sets share keying instances, size, and members, in any order", () => {
    expect(HashSet.of(1, 2, 3).equals(HashSet.of(3, 2, 1))).toBe(true);
    expect(Equivalence.any.equals(HashSet.of(1, 2), HashSet.of(2, 1))).toBe(true);
    expect(Hash.any.hash(HashSet.of(1, 2))).toBe(Hash.any.hash(HashSet.of(2, 1)));
    expect(HashSet.of(1, 2).equals(HashSet.of(1, 2, 3))).toBe(false);
    expect(HashSet.of(1, 2).equals(HashSet.of(1, 3))).toBe(false);
    expect(HashSet.empty<number>().equals(HashSet.empty<number>())).toBe(true);

    const custom = HashSet.make(Equivalence.make<number>((a, b) => a === b), Hash.number, [1, 2]);
    expect(HashSet.of(1, 2).equals(custom)).toBe(false);
  });

  test("the set pairing is lawful over a sample set", () => {
    const samples = [
      HashSet.empty<number>(),
      HashSet.of(1),
      HashSet.of(1),
      HashSet.of(1, 2),
      HashSet.of(2, 1),
      HashSet.of(1, 2, 3),
    ];
    expect(Hash.checkLaws(Equivalence.any, Hash.any, samples)).toBeUndefined();
  });

  test("sets nest inside Data values and inside each other", () => {
    const left = Data.struct({ tags: HashSet.of("a", "b") });
    const right = Data.struct({ tags: HashSet.of("b", "a") });
    expect(Data.equals(left, right)).toBe(true);
    expect(Data.hash(left)).toBe(Data.hash(right));
    expect(HashSet.of<unknown>(HashSet.of(1)).has(HashSet.of(1))).toBe(true);
  });
});

describe("a seeded randomized round-trip", () => {
  test("a random add/remove sequence matches the Set it models", () => {
    const random = SeededRandom.withSeed(0x0dd1e5);
    for (let trial = 0; trial < 20; trial += 1) {
      const narrow = Hash.number.contramap((value: number) => value % 3);
      let set = HashSet.make<number>(Equivalence.number, narrow);
      const model = new Set<number>();

      const steps = random.int(0, 50);
      for (let step = 0; step < steps; step += 1) {
        const element = random.int(0, 15);
        if (random.int(0, 3) === 0) {
          set = set.remove(element);
          model.delete(element);
        } else {
          set = set.add(element);
          model.add(element);
        }
      }

      expect(set.size).toBe(model.size);
      expect([...set]).toEqual([...model]);
      for (let element = 0; element < 15; element += 1) expect(set.has(element)).toBe(model.has(element));

      const rebuilt = HashSet.make<number>(Equivalence.number, narrow, model);
      expect(set.equals(rebuilt)).toBe(true);
      expect(Hash.any.hash(set)).toBe(Hash.any.hash(rebuilt));

      // Union with the difference to a random other set reconstructs the whole.
      const other = HashSet.make<number>(Equivalence.number, narrow, [random.int(0, 15), random.int(0, 15)]);
      expect(set.difference(other).union(set.intersection(other)).equals(set)).toBe(true);
    }
  });
});
