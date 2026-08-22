import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { SeededRandom } from "../platform/random.ts";
import { Equivalence, type EquivalenceValue } from "./equivalence.ts";
import { Hash, HashValue, registerStructuralHash } from "./hash.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

describe("Hash values", () => {
  test("are frozen, branded, and unforgeable", () => {
    const hash = Hash.make<number>((value) => value >>> 0);
    expect(Object.isFrozen(hash)).toBe(true);
    expect(Hash.isHash(hash)).toBe(true);
    expect(String(hash)).toBe("[object Hash]");

    const lookAlike = { hash: (value: number) => value };
    expect(Hash.isHash(lookAlike)).toBe(false);
    expect(panics(() => Hash.array(lookAlike as unknown as HashValue<number>))).toBe(true);

    const forged = Object.create(HashValue.prototype) as HashValue<number>;
    expect(Hash.isHash(forged)).toBe(false);
    expect(panics(() => forged.hash(1))).toBe(true);
    expect(panics(() => forged.contramap((value: string) => value.length))).toBe(true);
    expect(panics(() => Hash.tuple(forged))).toBe(true);
    expect(panics(() => Hash.struct({ a: forged }))).toBe(true);
  });

  test("a hash function that leaves the uint32 range panics at the call that produced it", () => {
    expect(panics(() => Hash.make(1 as unknown as (value: number) => number))).toBe(true);
    expect(panics(() => Hash.make<number>(() => -1).hash(0))).toBe(true);
    expect(panics(() => Hash.make<number>(() => 1.5).hash(0))).toBe(true);
    expect(panics(() => Hash.make<number>(() => 0x1_0000_0000).hash(0))).toBe(true);
    expect(panics(() => Hash.make<number>(() => Number.NaN).hash(0))).toBe(true);
    expect(panics(() => Hash.make<number>(() => "7" as unknown as number).hash(0))).toBe(true);
    expect(Hash.make<number>(() => 0xffffffff).hash(0)).toBe(0xffffffff);
  });
});

describe("built-in instances", () => {
  test("every built-in produces an unsigned 32-bit integer", () => {
    const numbers = [0, -0, 1, -1, 2 ** 31, 2 ** 53, -(2 ** 53), 0.1, -0.1, Number.NaN, Infinity, -Infinity];
    for (const value of numbers) expect(isUint32(Hash.number.hash(value))).toBe(true);
    for (const value of ["", "a", "vibelang", "\u{1f600}"]) expect(isUint32(Hash.string.hash(value))).toBe(true);
    for (const value of [true, false]) expect(isUint32(Hash.boolean.hash(value))).toBe(true);
    for (const value of [1, "a", true, undefined, null, 10n, Symbol("s"), {}, [], () => 0]) {
      expect(isUint32(Hash.any.hash(value))).toBe(true);
    }
  });

  test("the SameValueZero policy: -0 hashes as +0 and NaN hashes to a constant", () => {
    expect(Hash.number.hash(-0)).toBe(Hash.number.hash(0));
    expect(Hash.number.hash(Number.NaN)).toBe(Hash.number.hash(Number.NaN));
    expect(Hash.any.hash(-0)).toBe(Hash.any.hash(0));
    expect(Hash.any.hash(Number.NaN)).toBe(Hash.any.hash(Number.NaN));
    // Distinct values still land on distinct hashes here, collisions permitted in general.
    expect(Hash.number.hash(1)).not.toBe(Hash.number.hash(2));
    expect(Hash.number.hash(0.1)).not.toBe(Hash.number.hash(0.2));
    expect(Hash.number.hash(2 ** 53)).not.toBe(Hash.number.hash(2 ** 53 + 2));
  });

  test("a hash is deterministic across calls and instances", () => {
    expect(Hash.string.hash("vibelang")).toBe(Hash.string.hash("vibelang"));
    expect(Hash.any.hash("vibelang")).toBe(Hash.string.hash("vibelang"));
    expect(Hash.any.hash(42)).toBe(Hash.number.hash(42));
    expect(Hash.any.hash(true)).toBe(Hash.boolean.hash(true));
    expect(Hash.boolean.hash(true)).not.toBe(Hash.boolean.hash(false));
  });

  test("bigint and symbol hash by their string form, so equal values hash equal", () => {
    expect(Hash.any.hash(123n)).toBe(Hash.any.hash(123n));
    const symbol = Symbol("shared");
    expect(Hash.any.hash(symbol)).toBe(Hash.any.hash(symbol));
    expect(Hash.any.hash(1n)).not.toBe(Hash.any.hash(2n));
  });

  test("unregistered objects hash by identity, stably within the process", () => {
    const left = { x: 1 };
    const right = { x: 1 };
    expect(Hash.any.hash(left)).toBe(Hash.any.hash(left));
    expect(Hash.any.hash(left)).not.toBe(Hash.any.hash(right));
    const fn = (): number => 0;
    expect(Hash.any.hash(fn)).toBe(Hash.any.hash(fn));
    expect(Hash.reference.hash(left)).toBe(Hash.any.hash(left));
    // A primitive reaches the same answer through either instance.
    expect(Hash.reference.hash("a")).toBe(Hash.any.hash("a"));
  });
});

describe("combine and the collection combinators", () => {
  test("combine is order-sensitive and demands uint32 inputs", () => {
    expect(Hash.combine(1, 2)).not.toBe(Hash.combine(2, 1));
    expect(Hash.combine(1, 2)).toBe(Hash.combine(1, 2));
    expect(isUint32(Hash.combine(0xffffffff, 0xffffffff))).toBe(true);
    expect(panics(() => Hash.combine(-1, 0))).toBe(true);
    expect(panics(() => Hash.combine(0, 1.5))).toBe(true);
  });

  test("array and tuple hashes depend on length and arrangement", () => {
    const numbers = Hash.array(Hash.number);
    expect(numbers.hash([1, 2, 3])).toBe(numbers.hash([1, 2, 3]));
    expect(numbers.hash([1, 2, 3])).not.toBe(numbers.hash([3, 2, 1]));
    expect(numbers.hash([1, 2])).not.toBe(numbers.hash([1, 2, 3]));
    expect(numbers.hash([])).toBe(numbers.hash([]));

    const pair = Hash.tuple(Hash.string, Hash.number);
    expect(pair.hash(["a", 1])).toBe(pair.hash(["a", 1]));
    expect(pair.hash(["a", 1])).not.toBe(pair.hash(["b", 1]));
  });

  test("struct hashing is independent of field declaration order", () => {
    const left = Hash.struct({ x: Hash.number, y: Hash.number });
    const right = Hash.struct({ y: Hash.number, x: Hash.number });
    expect(left.hash({ x: 1, y: 2 })).toBe(right.hash({ x: 1, y: 2 }));
    expect(left.hash({ x: 1, y: 2 })).not.toBe(left.hash({ x: 2, y: 1 }));
    expect(panics(() => Hash.struct(null as unknown as Record<string, HashValue<never>>))).toBe(true);
  });

  test("contramap hashes through a projection", () => {
    interface User {
      readonly id: number;
    }
    const byId = Hash.number.contramap((user: User) => user.id);
    expect(byId.hash({ id: 7 })).toBe(Hash.number.hash(7));
    expect(panics(() => Hash.number.contramap(0 as unknown as (value: number) => number))).toBe(true);
  });
});

describe("the hash law", () => {
  test("every built-in pairing is lawful over a mixed sample set", () => {
    const numbers = [0, -0, 1, 2, Number.NaN, 0.5, 2 ** 40];
    expect(Hash.checkLaws(Equivalence.number, Hash.number, numbers).isNone()).toBe(true);
    expect(Hash.checkLaws(Equivalence.string, Hash.string, ["", "a", "a", "vibelang"]).isNone()).toBe(true);
    expect(Hash.checkLaws(Equivalence.boolean, Hash.boolean, [true, false, true]).isNone()).toBe(true);

    const mixed: unknown[] = [1, -0, 0, Number.NaN, "a", "a", true, null, undefined, 5n, { x: 1 }, [1]];
    expect(Hash.checkLaws(Equivalence.any, Hash.any, mixed).isNone()).toBe(true);
    expect(
      Hash.checkLaws(
        Equivalence.array(Equivalence.number),
        Hash.array(Hash.number),
        [[1, 2], [1, 2], [2, 1], []],
      ).isNone(),
    ).toBe(true);
  });

  test("checkLaws catches a pairing where equal values hash differently", () => {
    // "Equal if within one" is a broken equivalence and is caught first.
    const withinOne = Equivalence.make<number>((left, right) => Math.abs(left - right) <= 1);
    expect(Hash.checkLaws(withinOne, Hash.number, [0, 1, 2]).unwrapOr("")).toContain("transitive");

    // A genuine hash-law violation: equality ignores case, the hash does not.
    const caseInsensitive = Equivalence.make<string>((left, right) => left.toLowerCase() === right.toLowerCase());
    const violation = Hash.checkLaws(caseInsensitive, Hash.string, ["a", "A"]);
    expect(violation.unwrapOr("")).toContain("different hashes");

    // Pairing it with the matching hash restores the law.
    const caseInsensitiveHash = Hash.string.contramap((value: string) => value.toLowerCase());
    expect(Hash.checkLaws(caseInsensitive, caseInsensitiveHash, ["a", "A", "b"]).isNone()).toBe(true);
  });

  test("checkLaws catches a non-deterministic hash and demands real arguments", () => {
    let counter = 0;
    const drifting = Hash.make<number>(() => {
      counter += 1;
      return counter;
    });
    expect(Hash.checkLaws(Equivalence.number, drifting, [1]).unwrapOr("")).toContain("deterministic");
    expect(panics(() => Hash.checkLaws({} as unknown as EquivalenceValue<number>, Hash.number, [1]))).toBe(true);
    expect(panics(() => Hash.checkLaws(Equivalence.number, {} as unknown as HashValue<number>, [1]))).toBe(true);
    expect(panics(() => Hash.checkLaws(Equivalence.number, Hash.number, 1 as unknown as number[]))).toBe(true);
  });

  test("a seeded random sample set finds no violation and stays in range", () => {
    const random = SeededRandom.withSeed(0xc0ffee);
    const samples: unknown[] = [];
    for (let index = 0; index < 60; index += 1) {
      switch (random.int(0, 4)) {
        case 0:
          samples.push(random.int(-1000, 1000));
          break;
        case 1:
          samples.push(random.next() * 1000);
          break;
        case 2:
          samples.push(String.fromCharCode(97 + random.int(0, 26)).repeat(1 + random.int(0, 8)));
          break;
        default:
          samples.push(random.int(0, 2) === 0);
      }
    }
    expect(Hash.checkLaws(Equivalence.any, Hash.any, samples).isNone()).toBe(true);
    for (const sample of samples) expect(isUint32(Hash.any.hash(sample))).toBe(true);
  });
});

describe("the structural seam", () => {
  test("rejects a malformed rule and a duplicate registration", () => {
    expect(panics(() => registerStructuralHash({} as never))).toBe(true);
    const inert = { name: "test:hash-duplicate-probe", matches: () => false, hash: () => 0 };
    registerStructuralHash(inert);
    expect(panics(() => registerStructuralHash(inert))).toBe(true);
  });

  test("a rule that returns a non-uint32 panics rather than corrupting a bucket", () => {
    const marker = { probe: true };
    registerStructuralHash({
      name: "test:hash-out-of-range-probe",
      matches: (value) => value === marker,
      hash: () => -5,
    });
    expect(panics(() => Hash.any.hash(marker))).toBe(true);
  });
});
