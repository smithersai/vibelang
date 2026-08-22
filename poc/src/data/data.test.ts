import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { SeededRandom } from "../platform/random.ts";
import { Chunk } from "./chunk.ts";
import { Data } from "./data.ts";
import { Equivalence } from "./equivalence.ts";
import { Hash } from "./hash.ts";
import { HashMap } from "./hash-map.ts";
import { HashSet } from "./hash-set.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

describe("construction", () => {
  test("struct produces an ordinary object that is deeply frozen and branded", () => {
    const point = Data.struct({ x: 1, y: 2, label: "origin" });
    expect(point.x).toBe(1);
    expect(point.label).toBe("origin");
    expect(Object.isFrozen(point)).toBe(true);
    expect(Data.isData(point)).toBe(true);
    expect(Object.keys(point)).toEqual(["x", "y", "label"]);

    expect(() => {
      (point as unknown as { x: number }).x = 99;
    }).toThrow();
    expect(() => {
      (point as unknown as { z: number }).z = 1;
    }).toThrow();
    expect(point.x).toBe(1);
  });

  test("tuple produces a real, frozen array", () => {
    const pair = Data.tuple(1, "a");
    expect(Array.isArray(pair)).toBe(true);
    expect(pair[0]).toBe(1);
    expect(pair[1]).toBe("a");
    expect(pair.length).toBe(2);
    expect(Object.isFrozen(pair)).toBe(true);
    expect(Data.isData(pair)).toBe(true);
    expect([...pair]).toEqual([1, "a"]);
    expect(() => {
      (pair as unknown as unknown[])[0] = 99;
    }).toThrow();
    expect(() => {
      (pair as unknown as unknown[]).push(3);
    }).toThrow();
    expect(Data.tuple().length).toBe(0);
  });

  test("the input is copied, so the caller's object is neither frozen nor aliased", () => {
    const source = { x: 1 };
    const value = Data.struct(source);
    expect(value).not.toBe(source);
    expect(Object.isFrozen(source)).toBe(false);
    source.x = 2;
    expect(value.x).toBe(1);
  });

  test("nested plain objects and arrays are converted all the way down", () => {
    const value = Data.struct({ at: { x: 1, y: 2 }, tags: ["a", "b"], deep: { inner: [{ n: 1 }] } });
    expect(Data.isData(value.at)).toBe(true);
    expect(Data.isData(value.tags)).toBe(true);
    expect(Data.isData(value.deep.inner)).toBe(true);
    expect(Data.isData(value.deep.inner[0])).toBe(true);
    expect(Object.isFrozen(value.at)).toBe(true);
    expect(Object.isFrozen(value.deep.inner[0])).toBe(true);
    expect(() => {
      (value.at as unknown as { x: number }).x = 9;
    }).toThrow();
  });

  test("only own enumerable string keys take part", () => {
    const marker = Symbol("marker");
    const value = Data.struct({ visible: 1, [marker]: 2 } as Record<string, unknown>);
    expect(Object.getOwnPropertySymbols(value).length).toBe(0);
    expect(Data.equals(value, Data.struct({ visible: 1 }))).toBe(true);

    // A null-prototype record is plain enough; an object with some *other*
    // prototype is not, and says so rather than silently dropping what it
    // inherits.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.own = 2;
    expect(Object.keys(Data.struct(bare))).toEqual(["own"]);

    const inherited = Object.create({ fromPrototype: 1 }) as Record<string, unknown>;
    inherited.own = 2;
    expect(panics(() => Data.struct(inherited))).toBe(true);
  });

  test("a non-plain input and a cycle both panic", () => {
    expect(panics(() => Data.struct([1, 2] as unknown as Record<string, unknown>))).toBe(true);
    expect(panics(() => Data.struct(null as unknown as Record<string, unknown>))).toBe(true);
    expect(panics(() => Data.struct(7 as unknown as Record<string, unknown>))).toBe(true);
    expect(panics(() => Data.struct(new Date() as unknown as Record<string, unknown>))).toBe(true);

    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(panics(() => Data.struct(cyclic))).toBe(true);

    // A shared (but acyclic) subtree is fine and is converted twice.
    const shared = { n: 1 };
    const value = Data.struct({ left: shared, right: shared });
    expect(Data.equals(value.left, value.right)).toBe(true);
  });

  test("an already-converted value passes through unchanged", () => {
    const inner = Data.struct({ x: 1 });
    const outer = Data.struct({ inner });
    expect(outer.inner).toBe(inner);
    expect(Data.struct(inner)).toBe(inner);
  });
});

describe("the reference/structural boundary", () => {
  test("Data values compare by shape", () => {
    expect(Data.equals(Data.struct({ x: 1 }), Data.struct({ x: 1 }))).toBe(true);
    expect(Data.equals(Data.struct({ x: 1 }), Data.struct({ x: 2 }))).toBe(false);
    expect(Data.equals(Data.struct({ x: 1 }), Data.struct({ x: 1, y: 2 }))).toBe(false);
    expect(Data.equals(Data.struct({ x: 1, y: 2 }), Data.struct({ y: 2, x: 1 }))).toBe(true);
    expect(Data.equals(Data.tuple(1, 2), Data.tuple(1, 2))).toBe(true);
    expect(Data.equals(Data.tuple(1, 2), Data.tuple(2, 1))).toBe(false);
    // A tuple and a struct are never equal, whatever their contents.
    expect(Data.equals(Data.tuple(1), Data.struct({ 0: 1 }))).toBe(false);
    expect(Data.equals(Data.struct({}), Data.struct({}))).toBe(true);
    // Field order in the literal does not change the hash either.
    expect(Data.hash(Data.struct({ x: 1, y: 2 }))).toBe(Data.hash(Data.struct({ y: 2, x: 1 })));
  });

  test("everything that is not converted compares by reference", () => {
    class Point {
      constructor(readonly x: number) {}
    }
    const instance = new Point(1);
    const date = new Date(0);
    const map = new Map([["a", 1]]);
    const fn = (): number => 1;

    const left = Data.struct({ instance, date, map, fn });
    expect(left.instance).toBe(instance);
    expect(left.date).toBe(date);
    // Host objects are stored as they are, not frozen: freezing one breaks it
    // without making it immutable.
    expect(Object.isFrozen(date)).toBe(false);
    expect(Object.isFrozen(map)).toBe(false);

    expect(Data.equals(left, Data.struct({ instance, date, map, fn }))).toBe(true);
    expect(Data.equals(left, Data.struct({ instance: new Point(1), date, map, fn }))).toBe(false);
    expect(Data.equals(left, Data.struct({ instance, date: new Date(0), map, fn }))).toBe(false);
    expect(Data.equals(new Point(1), new Point(1))).toBe(false);
    expect(Data.equals(date, new Date(0))).toBe(false);
  });

  test("an unbranded look-alike is never equal to a Data value", () => {
    const value = Data.struct({ x: 1 });
    const lookAlike = Object.freeze({ x: 1 });
    expect(Data.isData(lookAlike)).toBe(false);
    expect(Data.equals(value, lookAlike)).toBe(false);
    expect(Data.equals(lookAlike, value)).toBe(false);
    expect(Data.equals(lookAlike, Object.freeze({ x: 1 }))).toBe(false);
    expect(Equivalence.any.equals(value, lookAlike)).toBe(false);
    // Nor can a look-alike be found in a structurally keyed map.
    expect(HashMap.of<unknown, number>([value, 1]).get(lookAlike).isNone()).toBe(true);
  });
});

describe("equals and hash across the package", () => {
  test("primitives, Data, Chunk, HashMap, and HashSet all nest", () => {
    const build = (): unknown =>
      Data.struct({
        id: 7,
        name: "runner",
        flags: Data.tuple(true, false),
        history: Chunk.of(1, 2, 3),
        index: HashMap.of<string, unknown>(["a", Data.struct({ n: 1 })]),
        tags: HashSet.of("x", "y"),
        nothing: null,
        missing: undefined,
      });

    expect(Data.equals(build(), build())).toBe(true);
    expect(Data.hash(build())).toBe(Data.hash(build()));
    expect(Data.equals(build(), Data.struct({ id: 7 }))).toBe(false);

    // Primitives go through the same door.
    expect(Data.equals(1, 1)).toBe(true);
    expect(Data.equals(Number.NaN, Number.NaN)).toBe(true);
    expect(Data.equals(0, -0)).toBe(true);
    expect(Data.equals("a", "a")).toBe(true);
    expect(Data.equals(1, "1")).toBe(false);
    expect(Data.hash(0)).toBe(Data.hash(-0));
    expect(Data.hash("a")).toBe(Hash.any.hash("a"));
  });

  test("a Data value is a usable key in every hashed collection", () => {
    const key = Data.struct({ region: "eu", shard: Data.tuple(1, 2) });
    const twin = Data.struct({ shard: Data.tuple(1, 2), region: "eu" });
    expect(HashMap.of<unknown, string>([key, "v"]).get(twin).unwrapOr("miss")).toBe("v");
    expect(HashSet.of<unknown>(key).has(twin)).toBe(true);
    expect(HashSet.of<unknown>(key).add(twin).size).toBe(1);
  });

  test("the Data pairing is lawful over a mixed sample set", () => {
    const samples: unknown[] = [
      Data.struct({ x: 1 }),
      Data.struct({ x: 1 }),
      Data.struct({ y: 1, x: 1 }),
      Data.struct({ x: 1, y: 1 }),
      Data.tuple(1),
      Data.tuple(1, 2),
      Data.struct({ nested: { a: [1, 2] } }),
      Data.struct({ nested: { a: [1, 2] } }),
      Data.struct({ chunk: Chunk.of(1) }),
      Data.struct({ chunk: Chunk.of(1) }),
      1,
      "1",
      null,
      undefined,
    ];
    expect(Hash.checkLaws(Equivalence.any, Hash.any, samples).isNone()).toBe(true);
  });
});

describe("a seeded randomized round-trip", () => {
  test("independently built values of the same shape are equal, hash equal, and key alike", () => {
    const random = SeededRandom.withSeed(0xda7ada7a);

    // One shape is drawn from a seed, then rendered twice into two independent
    // values; equality has to come from the shape, never from identity.
    for (let trial = 0; trial < 30; trial += 1) {
      const seed = SeededRandom.withSeed(0x1000 + trial);
      const render = (): { readonly value: unknown } => {
        seed.reset();
        return Data.struct({ value: scriptedDraw(seed, 0) });
      };
      const left = render();
      const right = render();

      expect(left).not.toBe(right);
      expect(Data.equals(left, right)).toBe(true);
      expect(Data.hash(left)).toBe(Data.hash(right));
      expect(HashMap.of<unknown, string>([left, "hit"]).get(right).unwrapOr("miss")).toBe("hit");
      expect(HashSet.of<unknown>(left).add(right).size).toBe(1);
      expect(Chunk.of(left).equals(Chunk.of(right))).toBe(true);
    }

    // Changing one field of an otherwise identical shape breaks equality.
    const original = Data.struct({ value: scriptedDraw(random, 0), marker: 1 });
    expect(Data.equals(original, Data.struct({ value: original.value, marker: 2 }))).toBe(false);
    expect(Data.equals(original, Data.struct({ value: original.value, marker: 1 }))).toBe(true);
  });
});

/** Deterministic redraw of one shape: the same seed always renders the same tree. */
function scriptedDraw(random: SeededRandom, depth: number): unknown {
  switch (random.int(0, depth > 2 ? 3 : 6)) {
    case 0:
      return random.int(0, 100);
    case 1:
      return String.fromCharCode(97 + random.int(0, 26));
    case 2:
      return random.int(0, 2) === 0;
    case 3:
      return [scriptedDraw(random, depth + 1), scriptedDraw(random, depth + 1)];
    case 4:
      return { a: scriptedDraw(random, depth + 1), b: scriptedDraw(random, depth + 1) };
    default:
      return { list: [scriptedDraw(random, depth + 1)] };
  }
}
