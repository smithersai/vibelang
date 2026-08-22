import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { SeededRandom } from "../platform/random.ts";
import { Chunk } from "./chunk.ts";
import { Data } from "./data.ts";
import { Equivalence } from "./equivalence.ts";
import { Hash } from "./hash.ts";
import { HashMap, HashMapValue } from "./hash-map.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

/** Everything collides: the worst case a bucketed map has to survive. */
const alwaysCollides = Hash.make<unknown>(() => 7);

describe("construction and lookup", () => {
  test("of, empty, make, and fromIterable agree", () => {
    const map = HashMap.of<string, number>(["a", 1], ["b", 2]);
    expect(map.size).toBe(2);
    expect(map.get("a").unwrapOr(-1)).toBe(1);
    expect(HashMap.empty<string, number>().size).toBe(0);
    expect(HashMap.empty<string, number>().isEmpty()).toBe(true);
    expect(HashMap.fromIterable([["a", 1] as const]).get("a").unwrapOr(-1)).toBe(1);
    expect(HashMap.make<string, number>(Equivalence.string, Hash.string, [["a", 1]]).get("a").unwrapOr(-1)).toBe(1);
    expect(
      HashMap.fromIterable([["a", 1] as const], { equivalence: Equivalence.string, hash: Hash.string })
        .get("a").unwrapOr(-1),
    ).toBe(1);
    // Later entries win.
    expect(HashMap.of<string, number>(["a", 1], ["a", 2]).get("a").unwrapOr(-1)).toBe(2);
    expect(HashMap.of<string, number>(["a", 1], ["a", 2]).size).toBe(1);
    expect(HashMap.isHashMap(map)).toBe(true);
    expect(HashMap.isHashMap(new Map())).toBe(false);
    expect(String(map)).toBe("HashMap(2)");
    expect(Object.prototype.toString.call(map)).toBe("[object HashMap]");
  });

  test("a miss is an Optional absence, never undefined", () => {
    const map = HashMap.of<string, number>(["a", 1]);
    expect(map.get("a").isSome()).toBe(true);
    expect(map.get("zzz").isNone()).toBe(true);
    expect(map.has("a")).toBe(true);
    expect(map.has("zzz")).toBe(false);
    expect(HashMap.empty<string, number>().get("a").isNone()).toBe(true);
    // A falsy bound value is still present, which is the point of the Optional.
    const falsy = HashMap.of<string, number | string | boolean>(["zero", 0], ["empty", ""], ["no", false]);
    expect(falsy.get("zero").isSome()).toBe(true);
    expect(falsy.get("zero").unwrapOr("miss")).toBe(0);
    expect(falsy.get("empty").isSome()).toBe(true);
    expect(falsy.get("no").isSome()).toBe(true);
  });

  test("bad arguments panic", () => {
    expect(panics(() => HashMap.make(null as never, Hash.string))).toBe(true);
    expect(panics(() => HashMap.make(Equivalence.string, null as never))).toBe(true);
    expect(panics(() => HashMap.fromIterable(7 as unknown as Iterable<readonly [string, number]>))).toBe(true);
    expect(panics(() => HashMap.of(["a"] as unknown as readonly [string, number]))).toBe(true);
    expect(panics(() => HashMap.empty<string, number>().set(null as unknown as string, 1))).toBe(true);
    expect(panics(() => HashMap.empty<string, number>().set("a", null as unknown as number))).toBe(true);
    expect(panics(() => HashMap.empty<string, number>().set("a", undefined as unknown as number))).toBe(true);
  });
});

describe("immutability and branding", () => {
  test("set and remove return new maps and leave the receiver untouched", () => {
    const base = HashMap.of<string, number>(["a", 1], ["b", 2]);
    expect(Object.isFrozen(base)).toBe(true);
    expect(() => {
      (base as unknown as { size: number }).size = 99;
    }).toThrow();

    const added = base.set("c", 3);
    const removed = base.remove("a");
    const replaced = base.set("a", 10);

    expect(added.size).toBe(3);
    expect(removed.size).toBe(1);
    expect(replaced.get("a").unwrapOr(-1)).toBe(10);
    expect(base.size).toBe(2);
    expect(base.get("a").unwrapOr(-1)).toBe(1);
    expect(base.has("c")).toBe(false);
    expect(added).not.toBe(base);
    expect(removed).not.toBe(base);
  });

  test("a no-op update returns the receiver, so callers can skip work on identity", () => {
    const base = HashMap.of<string, number>(["a", 1]);
    expect(base.set("a", 1)).toBe(base);
    expect(base.remove("zzz")).toBe(base);
    expect(base.set("a", 2)).not.toBe(base);
    // SameValueZero decides "unchanged", matching the equality policy elsewhere.
    const nan = HashMap.of<string, number>(["n", Number.NaN]);
    expect(nan.set("n", Number.NaN)).toBe(nan);
    const zero = HashMap.of<string, number>(["z", 0]);
    expect(zero.set("z", -0)).toBe(zero);
  });

  test("a forged HashMap is rejected by every operation", () => {
    const forged = Object.create(HashMapValue.prototype) as HashMapValue<string, number>;
    expect(HashMap.isHashMap(forged)).toBe(false);
    expect(panics(() => forged.size)).toBe(true);
    expect(panics(() => forged.get("a"))).toBe(true);
    expect(panics(() => forged.set("a", 1))).toBe(true);
    expect(panics(() => forged.entries())).toBe(true);
    expect(panics(() => forged.keyEquivalence)).toBe(true);
    expect(HashMap.of<string, number>(["a", 1]).equals(forged)).toBe(false);
    expect(HashMap.of<string, number>(["a", 1]).equals({ size: 1 } as never)).toBe(false);
  });
});

describe("iteration order", () => {
  test("entries, keys, and values are insertion order, and an overwrite keeps its place", () => {
    const map = HashMap.of<string, number>(["b", 1], ["a", 2], ["c", 3]);
    expect([...map.keys()]).toEqual(["b", "a", "c"]);
    expect([...map.values()]).toEqual([1, 2, 3]);
    expect([...map.entries()]).toEqual([["b", 1], ["a", 2], ["c", 3]]);
    expect([...map]).toEqual([["b", 1], ["a", 2], ["c", 3]]);

    // Overwriting "b" keeps it first; removing and re-adding sends it to the back.
    expect([...map.set("b", 9).keys()]).toEqual(["b", "a", "c"]);
    expect([...map.set("b", 9).values()]).toEqual([9, 2, 3]);
    expect([...map.remove("b").set("b", 9).keys()]).toEqual(["a", "c", "b"]);

    // Order does not depend on hashes: the same insertions collide here and
    // still come back in insertion order.
    const collided = HashMap.make<string, number>(Equivalence.string, alwaysCollides, [["b", 1], ["a", 2], ["c", 3]]);
    expect([...collided.keys()]).toEqual(["b", "a", "c"]);

    // Repeated iteration is stable.
    expect([...map.keys()]).toEqual([...map.keys()]);
    // The yielded entry pairs are frozen.
    expect(Object.isFrozen([...map.entries()][0])).toBe(true);
  });
});

describe("hash collisions", () => {
  test("keys with equal hashes but unequal values stay distinct and reachable", () => {
    const map = HashMap.make<string, number>(Equivalence.string, alwaysCollides)
      .set("a", 1)
      .set("b", 2)
      .set("c", 3);

    expect(map.size).toBe(3);
    expect(map.get("a").unwrapOr(-1)).toBe(1);
    expect(map.get("b").unwrapOr(-1)).toBe(2);
    expect(map.get("c").unwrapOr(-1)).toBe(3);
    expect(map.get("d").isNone()).toBe(true);

    // Removing the middle of a shared bucket leaves the others alone.
    const smaller = map.remove("b");
    expect(smaller.size).toBe(2);
    expect(smaller.get("a").unwrapOr(-1)).toBe(1);
    expect(smaller.get("b").isNone()).toBe(true);
    expect(smaller.get("c").unwrapOr(-1)).toBe(3);
    // ...and the original still has it.
    expect(map.get("b").unwrapOr(-1)).toBe(2);

    // Overwriting inside a shared bucket touches only that key.
    const updated = map.set("b", 20);
    expect(updated.get("a").unwrapOr(-1)).toBe(1);
    expect(updated.get("b").unwrapOr(-1)).toBe(20);
    expect(updated.get("c").unwrapOr(-1)).toBe(3);

    // Emptying the bucket entirely.
    expect(map.remove("a").remove("b").remove("c").size).toBe(0);
    expect(map.remove("a").remove("b").remove("c").get("a").isNone()).toBe(true);
  });

  test("a partially colliding hash behaves the same as a perfect one", () => {
    const byRemainder = Hash.number.contramap((value: number) => value % 3);
    let map = HashMap.make<number, string>(Equivalence.number, byRemainder);
    for (let index = 0; index < 30; index += 1) map = map.set(index, `v${index}`);
    expect(map.size).toBe(30);
    for (let index = 0; index < 30; index += 1) expect(map.get(index).unwrapOr("miss")).toBe(`v${index}`);
    expect(map.get(30).isNone()).toBe(true);
    expect([...map.keys()]).toEqual(Array.from({ length: 30 }, (_, index) => index));
  });
});

describe("structural and custom keys", () => {
  test("Data values, Chunks, and nested collections work as keys with no ceremony", () => {
    const key = Data.struct({ region: "us-east", shard: 3 });
    const twin = Data.struct({ shard: 3, region: "us-east" });
    const map = HashMap.of<unknown, string>([key, "first"], [Chunk.of(1, 2), "second"]);

    expect(map.get(twin).unwrapOr("miss")).toBe("first");
    expect(map.get(Chunk.of(1).append(2)).unwrapOr("miss")).toBe("second");
    expect(map.get(Data.struct({ region: "us-west", shard: 3 })).isNone()).toBe(true);
    expect(map.set(twin, "replaced").size).toBe(2);
    expect(map.set(twin, "replaced").get(key).unwrapOr("miss")).toBe("replaced");

    // A plain object key is a reference key, per the documented boundary.
    const plain = { region: "us-east" };
    const plainMap = HashMap.of<unknown, string>([plain, "by reference"]);
    expect(plainMap.get(plain).unwrapOr("miss")).toBe("by reference");
    expect(plainMap.get({ region: "us-east" }).isNone()).toBe(true);
  });

  test("a custom Equivalence/Hash pair keys the map, and the pair must be lawful", () => {
    const caseInsensitive = Equivalence.make<string>((left, right) => left.toLowerCase() === right.toLowerCase());
    const caseInsensitiveHash = Hash.string.contramap((value: string) => value.toLowerCase());
    expect(Hash.checkLaws(caseInsensitive, caseInsensitiveHash, ["a", "A", "b"]).isNone()).toBe(true);

    const map = HashMap.make<string, number>(caseInsensitive, caseInsensitiveHash, [["Alpha", 1]]);
    expect(map.get("alpha").unwrapOr(-1)).toBe(1);
    expect(map.get("ALPHA").unwrapOr(-1)).toBe(1);
    expect(map.set("ALPHA", 2).size).toBe(1);
    expect(map.keyEquivalence).toBe(caseInsensitive);
    expect(map.keyHash).toBe(caseInsensitiveHash);

    // The law is not decoration: pairing that equality with the raw string hash
    // makes an equal key unreachable, which is exactly what checkLaws reports.
    expect(Hash.checkLaws(caseInsensitive, Hash.string, ["a", "A"]).isSome()).toBe(true);
    const broken = HashMap.make<string, number>(caseInsensitive, Hash.string, [["Alpha", 1]]);
    expect(broken.get("alpha").isNone()).toBe(true);
  });
});

describe("structural equality", () => {
  test("equal maps share keying instances, size, and values, in any insertion order", () => {
    const left = HashMap.of<string, number>(["a", 1], ["b", 2]);
    const right = HashMap.of<string, number>(["b", 2], ["a", 1]);
    expect(left.equals(right)).toBe(true);
    expect(Equivalence.any.equals(left, right)).toBe(true);
    expect(Hash.any.hash(left)).toBe(Hash.any.hash(right));

    expect(left.equals(HashMap.of<string, number>(["a", 1]))).toBe(false);
    expect(left.equals(HashMap.of<string, number>(["a", 1], ["b", 3]))).toBe(false);
    expect(left.equals(HashMap.of<string, number>(["a", 1], ["c", 2]))).toBe(false);

    // Values compare structurally too.
    expect(
      HashMap.of<string, unknown>(["k", Data.struct({ x: 1 })])
        .equals(HashMap.of<string, unknown>(["k", Data.struct({ x: 1 })])),
    ).toBe(true);

    // Different keying instances are different maps, which is what keeps the
    // hash law intact: two maps that could be "equal" under two keyings would
    // have no lawful common hash.
    const custom = HashMap.make<string, number>(Equivalence.string, Hash.string, [["a", 1], ["b", 2]]);
    expect(left.equals(custom)).toBe(false);
    const alsoCustom = HashMap.make<string, number>(
      Equivalence.make<string>((a, b) => a === b),
      Hash.string,
      [["a", 1], ["b", 2]],
    );
    expect(custom.equals(alsoCustom)).toBe(false);
    // Sharing the instances — which every `HashMap.of` map does — is enough.
    expect(custom.equals(HashMap.make<string, number>(Equivalence.string, Hash.string, [["b", 2], ["a", 1]])))
      .toBe(true);
  });

  test("the map pairing is lawful over a sample set", () => {
    const samples = [
      HashMap.empty<string, number>(),
      HashMap.of<string, number>(["a", 1]),
      HashMap.of<string, number>(["a", 1]),
      HashMap.of<string, number>(["a", 1], ["b", 2]),
      HashMap.of<string, number>(["b", 2], ["a", 1]),
      HashMap.of<string, number>(["a", 2]),
    ];
    expect(Hash.checkLaws(Equivalence.any, Hash.any, samples).isNone()).toBe(true);
  });
});

describe("a seeded randomized round-trip", () => {
  test("a random insert/remove sequence matches the Map it models", () => {
    const random = SeededRandom.withSeed(0xfeedface);
    for (let trial = 0; trial < 20; trial += 1) {
      // A deliberately narrow hash so buckets collide constantly.
      const narrow = Hash.number.contramap((value: number) => value % 4);
      let map = HashMap.make<number, string>(Equivalence.number, narrow);
      const model = new Map<number, string>();

      const steps = random.int(0, 60);
      for (let step = 0; step < steps; step += 1) {
        const key = random.int(0, 20);
        if (random.int(0, 3) === 0) {
          map = map.remove(key);
          model.delete(key);
        } else {
          const value = `v${random.int(0, 1000)}`;
          map = map.set(key, value);
          model.set(key, value);
        }
      }

      expect(map.size).toBe(model.size);
      expect([...map.entries()]).toEqual([...model.entries()]);
      for (const [key, value] of model) expect(map.get(key).unwrapOr("miss")).toBe(value);
      for (let key = 0; key < 20; key += 1) {
        expect(map.has(key)).toBe(model.has(key));
        if (!model.has(key)) expect(map.get(key).isNone()).toBe(true);
      }
      // Rebuilding from the same entries lands on an equal map with an equal hash.
      const rebuilt = HashMap.make<number, string>(Equivalence.number, narrow, model.entries());
      expect(map.equals(rebuilt)).toBe(true);
      expect(Hash.any.hash(map)).toBe(Hash.any.hash(rebuilt));
    }
  });
});
