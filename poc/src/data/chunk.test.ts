import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { SeededRandom } from "../platform/random.ts";
import { Chunk, ChunkValue } from "./chunk.ts";
import { Equivalence } from "./equivalence.ts";
import { Hash } from "./hash.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

describe("construction and reading", () => {
  test("of, from, and empty agree on contents, size, and order", () => {
    expect([...Chunk.of(1, 2, 3)]).toEqual([1, 2, 3]);
    expect(Chunk.of(1, 2, 3).size).toBe(3);
    expect([...Chunk.from([1, 2, 3])]).toEqual([1, 2, 3]);
    expect([...Chunk.from(new Set([1, 2, 2, 3]))]).toEqual([1, 2, 3]);
    expect([...Chunk.from("abc")]).toEqual(["a", "b", "c"]);
    expect(Chunk.empty<number>().size).toBe(0);
    expect(Chunk.empty<number>().isEmpty()).toBe(true);
    expect(Chunk.of(1).isEmpty()).toBe(false);
    // `from` on a Chunk is the identity: it is already the value asked for.
    const existing = Chunk.of(1, 2);
    expect(Chunk.from(existing)).toBe(existing);
    expect(panics(() => Chunk.from(7 as unknown as Iterable<number>))).toBe(true);
    expect(Chunk.isChunk(Chunk.of(1))).toBe(true);
    expect(Chunk.isChunk([1])).toBe(false);
    expect(String(Chunk.of(1))).toBe("Chunk(1)");
    expect(Object.prototype.toString.call(Chunk.of(1))).toBe("[object Chunk]");
  });

  test("a miss is `undefined`, read by ordinary narrowing, `?.`, and `??`", () => {
    const chunk = Chunk.of("a", "b", "c");
    const first = chunk.get(0);
    if (first === undefined) throw new Error("expected an element");
    expect(first.toUpperCase()).toBe("A"); // narrowed to string
    expect(chunk.get(0) ?? "miss").toBe("a");
    expect(chunk.get(2) ?? "miss").toBe("c");
    expect(chunk.get(3)).toBeUndefined();
    expect(chunk.get(-1)).toBeUndefined();
    expect(chunk.head() ?? "miss").toBe("a");
    expect(chunk.last() ?? "miss").toBe("c");

    const empty = Chunk.empty<string>();
    expect(empty.get(0)).toBeUndefined();
    expect(empty.head()).toBeUndefined();
    expect(empty.last()).toBeUndefined();

    // A non-integer index is a programming error, not a miss.
    expect(panics(() => chunk.get(1.5))).toBe(true);
    expect(panics(() => chunk.get(Number.NaN))).toBe(true);
    expect(panics(() => chunk.get("0" as unknown as number))).toBe(true);

    // `?.` and `??` keep their ordinary nullish meaning on a miss.
    expect(chunk.get(0)?.length).toBe(1);
    expect(chunk.get(3)?.length).toBeUndefined();
    expect(chunk.get(3) ?? "miss").toBe("miss");
  });

  test("null and undefined are rejected where they enter", () => {
    expect(panics(() => Chunk.of(1, null as unknown as number))).toBe(true);
    expect(panics(() => Chunk.from([undefined as unknown as number]))).toBe(true);
    expect(panics(() => Chunk.of(1).append(null as unknown as number))).toBe(true);
    expect(panics(() => Chunk.of(1).prepend(undefined as unknown as number))).toBe(true);
    expect(panics(() => Chunk.of(1).map(() => null as unknown as number))).toBe(true);
  });
});

describe("immutability and branding", () => {
  test("a Chunk is frozen and every operation leaves the receiver untouched", () => {
    const base = Chunk.of(1, 2, 3);
    expect(Object.isFrozen(base)).toBe(true);
    expect(() => {
      (base as unknown as { size: number }).size = 99;
    }).toThrow();

    const grown = base.append(4).prepend(0).concat(Chunk.of(5));
    expect([...grown]).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...base]).toEqual([1, 2, 3]);
    expect(base.size).toBe(3);

    expect([...base.map((value) => value * 2)]).toEqual([2, 4, 6]);
    expect([...base.filter((value) => value > 1)]).toEqual([2, 3]);
    expect([...base.take(1)]).toEqual([1]);
    expect([...base.drop(2)]).toEqual([3]);
    expect([...base]).toEqual([1, 2, 3]);
  });

  test("toArray hands back a frozen array, so a caller cannot edit the Chunk through it", () => {
    const chunk = Chunk.of(1, 2, 3);
    const items = chunk.toArray();
    expect(Object.isFrozen(items)).toBe(true);
    expect(() => {
      (items as number[])[0] = 99;
    }).toThrow();
    expect([...chunk]).toEqual([1, 2, 3]);
    // Materialization is cached, so the same frozen array comes back.
    expect(chunk.toArray()).toBe(items);
  });

  test("a forged Chunk is rejected by every operation", () => {
    const forged = Object.create(ChunkValue.prototype) as ChunkValue<number>;
    expect(Chunk.isChunk(forged)).toBe(false);
    expect(panics(() => forged.size)).toBe(true);
    expect(panics(() => forged.get(0))).toBe(true);
    expect(panics(() => forged.append(1))).toBe(true);
    expect(panics(() => forged.toArray())).toBe(true);
    expect(panics(() => [...forged])).toBe(true);
    expect(panics(() => Chunk.of(1).concat(forged))).toBe(true);
    expect(Chunk.of(1).equals(forged)).toBe(false);

    const lookAlike = { size: 1, toArray: () => [1] };
    expect(Chunk.isChunk(lookAlike)).toBe(false);
    expect(Chunk.of(1).equals(lookAlike as unknown as ChunkValue<number>)).toBe(false);
  });
});

describe("transformations", () => {
  test("map and filter behave like the functor and predicate they look like", () => {
    const chunk = Chunk.of(1, 2, 3, 4);
    const identity = <T>(value: T): T => value;
    const double = (value: number): number => value * 2;
    const increment = (value: number): number => value + 1;

    // map(id) == id
    expect(chunk.map(identity).toArray()).toEqual(chunk.toArray());
    // map(f).map(g) == map(g . f)
    expect(chunk.map(double).map(increment).toArray()).toEqual(chunk.map((value) => increment(double(value))).toArray());
    // filter(true) == id, filter(false) == empty
    expect(chunk.filter(() => true).toArray()).toEqual(chunk.toArray());
    expect(chunk.filter(() => false).size).toBe(0);
    // filter(p).filter(q) == filter(p && q)
    const even = (value: number): boolean => value % 2 === 0;
    const big = (value: number): boolean => value > 2;
    expect(chunk.filter(even).filter(big).toArray()).toEqual(chunk.filter((value) => even(value) && big(value)).toArray());

    // Both callbacks see the index.
    expect(chunk.map((value, index) => value * index).toArray()).toEqual([0, 2, 6, 12]);
    expect(chunk.filter((_, index) => index < 2).toArray()).toEqual([1, 2]);
  });

  test("flatMap concatenates and demands a Chunk back", () => {
    const chunk = Chunk.of(1, 2, 3);
    expect(chunk.flatMap((value) => Chunk.of(value, value)).toArray()).toEqual([1, 1, 2, 2, 3, 3]);
    expect(chunk.flatMap(() => Chunk.empty<number>()).size).toBe(0);
    // flatMap with a single-element Chunk is map.
    expect(chunk.flatMap((value) => Chunk.of(value * 2)).toArray()).toEqual(chunk.map((value) => value * 2).toArray());
    expect(panics(() => chunk.flatMap(() => [1] as unknown as Chunk<number>))).toBe(true);
    expect(panics(() => chunk.flatMap(7 as unknown as () => Chunk<number>))).toBe(true);
  });

  test("reduce folds left with an index", () => {
    const chunk = Chunk.of(1, 2, 3, 4);
    expect(chunk.reduce((total, value) => total + value, 0)).toBe(10);
    expect(chunk.reduce((parts, value, index) => `${parts}${index}:${value} `, "")).toBe("0:1 1:2 2:3 3:4 ");
    expect(Chunk.empty<number>().reduce((total, value) => total + value, 100)).toBe(100);
    expect(panics(() => chunk.reduce(7 as unknown as (a: number, b: number) => number, 0))).toBe(true);
  });

  test("take, drop, and slice clamp instead of failing", () => {
    const chunk = Chunk.of(1, 2, 3, 4, 5);
    expect(chunk.take(2).toArray()).toEqual([1, 2]);
    expect(chunk.take(0).size).toBe(0);
    expect(chunk.take(99).toArray()).toEqual([1, 2, 3, 4, 5]);
    expect(chunk.take(-3).size).toBe(0);
    expect(chunk.drop(3).toArray()).toEqual([4, 5]);
    expect(chunk.drop(99).size).toBe(0);
    expect(chunk.drop(-3).toArray()).toEqual([1, 2, 3, 4, 5]);
    expect(chunk.slice(1, 3).toArray()).toEqual([2, 3]);
    expect(chunk.slice(-2).toArray()).toEqual([4, 5]);
    expect(panics(() => chunk.take(1.5))).toBe(true);
    expect(panics(() => chunk.drop(Number.NaN))).toBe(true);
    // take(n) ++ drop(n) == the original, for every n.
    for (let index = 0; index <= chunk.size; index += 1) {
      expect(chunk.take(index).concat(chunk.drop(index)).toArray()).toEqual(chunk.toArray());
    }
  });
});

describe("equality and hashing", () => {
  test("Chunks compare element-wise and nest inside one another", () => {
    expect(Chunk.of(1, 2, 3).equals(Chunk.of(1, 2, 3))).toBe(true);
    expect(Chunk.of(1, 2).equals(Chunk.of(1, 2, 3))).toBe(false);
    expect(Chunk.of(1, 2, 3).equals(Chunk.of(3, 2, 1))).toBe(false);
    expect(Chunk.empty<number>().equals(Chunk.empty<number>())).toBe(true);
    // Built two different ways, still the same value.
    expect(Chunk.of(1).append(2).prepend(0).equals(Chunk.of(0, 1, 2))).toBe(true);
    expect(Equivalence.any.equals(Chunk.of(1, 2), Chunk.of(1, 2))).toBe(true);
    expect(Equivalence.any.equals(Chunk.of(Chunk.of(1)), Chunk.of(Chunk.of(1)))).toBe(true);
    expect(Equivalence.any.equals(Chunk.of(1), [1])).toBe(false);
    expect(Hash.any.hash(Chunk.of(1, 2))).toBe(Hash.any.hash(Chunk.of(1).append(2)));
    expect(Hash.any.hash(Chunk.of(1, 2))).not.toBe(Hash.any.hash(Chunk.of(2, 1)));
  });

  test("the built-in pairing and a custom element pairing are both lawful", () => {
    const samples = [Chunk.empty<number>(), Chunk.of(1), Chunk.of(1), Chunk.of(1, 2), Chunk.of(2, 1), Chunk.of(1).append(2)];
    expect(Hash.checkLaws(Equivalence.any, Hash.any, samples)).toBeUndefined();
    expect(Hash.checkLaws(Chunk.equivalence<number>(), Chunk.hash<number>(), samples)).toBeUndefined();

    const caseInsensitive = Equivalence.make<string>((left, right) => left.toLowerCase() === right.toLowerCase());
    const caseInsensitiveHash = Hash.string.contramap((value: string) => value.toLowerCase());
    const words = [Chunk.of("a", "b"), Chunk.of("A", "B"), Chunk.of("c")];
    expect(
      Hash.checkLaws(Chunk.equivalence(caseInsensitive), Chunk.hash(caseInsensitiveHash), words),
    ).toBeUndefined();
    expect(Chunk.equivalence(caseInsensitive).equals(Chunk.of("a"), Chunk.of("A"))).toBe(true);
    expect(Chunk.equivalence<string>().equals(Chunk.of("a"), Chunk.of("A"))).toBe(false);

    expect(panics(() => Chunk.equivalence({} as never))).toBe(true);
    expect(panics(() => Chunk.hash({} as never))).toBe(true);
    expect(panics(() => Chunk.equivalence<number>().equals(1 as never, Chunk.of(1)))).toBe(true);
  });
});

describe("the representation", () => {
  test("a long append chain materializes without exhausting the call stack", () => {
    let chunk = Chunk.empty<number>();
    for (let index = 0; index < 20_000; index += 1) chunk = chunk.append(index);
    expect(chunk.size).toBe(20_000);
    expect(chunk.get(0) ?? -1).toBe(0);
    expect(chunk.get(19_999) ?? -1).toBe(19_999);
    expect(chunk.reduce((total, value) => total + value, 0)).toBe((19_999 * 20_000) / 2);
  });

  test("a prepend chain and a concat tree both read back in order", () => {
    let chunk = Chunk.empty<number>();
    for (let index = 0; index < 1_000; index += 1) chunk = chunk.prepend(index);
    expect(chunk.get(0) ?? -1).toBe(999);
    expect(chunk.get(999) ?? -1).toBe(0);

    let tree = Chunk.empty<number>();
    for (let index = 0; index < 100; index += 1) tree = tree.concat(Chunk.of(index, index));
    expect(tree.size).toBe(200);
    expect(tree.toArray().slice(0, 4)).toEqual([0, 0, 1, 1]);
  });
});

describe("a seeded randomized round-trip", () => {
  test("a random build sequence matches the array it models", () => {
    const random = SeededRandom.withSeed(0x1234abcd);
    for (let trial = 0; trial < 25; trial += 1) {
      let chunk = Chunk.empty<number>();
      let model: number[] = [];
      const steps = random.int(0, 40);
      for (let step = 0; step < steps; step += 1) {
        const value = random.int(0, 100);
        switch (random.int(0, 5)) {
          case 0:
            chunk = chunk.append(value);
            model = [...model, value];
            break;
          case 1:
            chunk = chunk.prepend(value);
            model = [value, ...model];
            break;
          case 2: {
            const other = [random.int(0, 100), random.int(0, 100)];
            chunk = chunk.concat(Chunk.from(other));
            model = [...model, ...other];
            break;
          }
          case 3: {
            const count = random.int(0, 5);
            chunk = chunk.drop(count);
            model = model.slice(count);
            break;
          }
          default:
            chunk = chunk.filter((item) => item % 2 === 0);
            model = model.filter((item) => item % 2 === 0);
        }
      }

      expect(chunk.size).toBe(model.length);
      expect(chunk.toArray()).toEqual(model);
      expect(chunk.equals(Chunk.from(model))).toBe(true);
      expect(Hash.any.hash(chunk)).toBe(Hash.any.hash(Chunk.from(model)));
      for (let index = 0; index < model.length; index += 1) {
        expect(chunk.get(index) ?? -1).toBe(model[index] as number);
      }
      expect(chunk.get(model.length)).toBeUndefined();
    }
  });
});
