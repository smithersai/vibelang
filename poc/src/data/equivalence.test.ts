import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { SeededRandom } from "../platform/random.ts";
import {
  Equivalence,
  EquivalenceValue,
  registerStructuralEquivalence,
  sameValueZero,
} from "./equivalence.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

describe("sameValueZero", () => {
  test("is the documented primitive equality: NaN equals itself, the zeroes are one value", () => {
    expect(sameValueZero(Number.NaN, Number.NaN)).toBe(true);
    expect(sameValueZero(0, -0)).toBe(true);
    expect(sameValueZero(1, 1)).toBe(true);
    expect(sameValueZero(1, 2)).toBe(false);
    expect(sameValueZero("a", "a")).toBe(true);
    expect(sameValueZero(null, undefined)).toBe(false);
    // Reflexive where `===` is not, which is the whole reason it is the default.
    expect(Number.NaN === Number.NaN).toBe(false);
  });
});

describe("Equivalence values", () => {
  test("are frozen, branded, and unforgeable", () => {
    const equivalence = Equivalence.make<number>((left, right) => left === right);
    expect(Object.isFrozen(equivalence)).toBe(true);
    expect(Equivalence.isEquivalence(equivalence)).toBe(true);
    expect(String(equivalence)).toBe("[object Equivalence]");

    // A structural look-alike is not an Equivalence...
    const lookAlike = { equals: (left: number, right: number) => left === right };
    expect(Equivalence.isEquivalence(lookAlike)).toBe(false);
    expect(panics(() => Equivalence.array(lookAlike as unknown as EquivalenceValue<number>))).toBe(true);

    // ...and neither is a bare instance of the exported abstract class.
    const forged = Object.create(EquivalenceValue.prototype) as EquivalenceValue<number>;
    expect(Equivalence.isEquivalence(forged)).toBe(false);
    expect(panics(() => forged.equals(1, 1))).toBe(true);
    expect(panics(() => forged.contramap((value: string) => value.length))).toBe(true);
    expect(panics(() => Equivalence.tuple(forged))).toBe(true);
    expect(panics(() => Equivalence.struct({ a: forged }))).toBe(true);
  });

  test("reject a non-function and a non-boolean verdict", () => {
    expect(panics(() => Equivalence.make(42 as unknown as (a: number, b: number) => boolean))).toBe(true);
    const sloppy = Equivalence.make<number>(((left: number, right: number) => left - right) as unknown as (
      left: number,
      right: number,
    ) => boolean);
    expect(panics(() => sloppy.equals(1, 1))).toBe(true);
  });
});

describe("built-in instances", () => {
  test("number uses SameValueZero and reference uses Object.is", () => {
    expect(Equivalence.number.equals(Number.NaN, Number.NaN)).toBe(true);
    expect(Equivalence.number.equals(0, -0)).toBe(true);
    expect(Equivalence.number.equals(1, 1)).toBe(true);
    expect(Equivalence.number.equals(1, 2)).toBe(false);

    expect(Equivalence.reference.equals(0, -0)).toBe(false);
    expect(Equivalence.reference.equals(Number.NaN, Number.NaN)).toBe(true);
  });

  test("string and boolean compare by value", () => {
    expect(Equivalence.string.equals("smithers", "smithers")).toBe(true);
    expect(Equivalence.string.equals("smithers", "lang")).toBe(false);
    expect(Equivalence.boolean.equals(true, true)).toBe(true);
    expect(Equivalence.boolean.equals(true, false)).toBe(false);
  });

  test("any compares primitives by value and unregistered objects by reference", () => {
    expect(Equivalence.any.equals(1, 1)).toBe(true);
    expect(Equivalence.any.equals(Number.NaN, Number.NaN)).toBe(true);
    expect(Equivalence.any.equals(0, -0)).toBe(true);
    expect(Equivalence.any.equals("a", "a")).toBe(true);
    expect(Equivalence.any.equals(1, "1")).toBe(false);
    expect(Equivalence.any.equals(null, undefined)).toBe(false);
    expect(Equivalence.any.equals(10n, 10n)).toBe(true);

    // The documented reference boundary: same shape, different object.
    const left = { x: 1 };
    expect(Equivalence.any.equals(left, { x: 1 })).toBe(false);
    expect(Equivalence.any.equals(left, left)).toBe(true);
    expect(Equivalence.any.equals([1, 2], [1, 2])).toBe(false);
    expect(Equivalence.any.equals(new Date(0), new Date(0))).toBe(false);
  });
});

describe("combinators", () => {
  test("tuple compares position by position and rejects a wrong arity", () => {
    const pair = Equivalence.tuple(Equivalence.string, Equivalence.number);
    expect(pair.equals(["a", 1], ["a", 1])).toBe(true);
    expect(pair.equals(["a", 1], ["a", 2])).toBe(false);
    expect(pair.equals(["a", 1], ["b", 1])).toBe(false);
    expect(pair.equals(["a", 1] as unknown as [string, number], ["a"] as unknown as [string, number])).toBe(false);
  });

  test("array compares length then elements", () => {
    const numbers = Equivalence.array(Equivalence.number);
    expect(numbers.equals([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(numbers.equals([1, 2], [1, 2, 3])).toBe(false);
    expect(numbers.equals([1, Number.NaN], [1, Number.NaN])).toBe(true);
    expect(numbers.equals([], [])).toBe(true);
  });

  test("struct compares exactly the declared fields and ignores the rest", () => {
    const point = Equivalence.struct({ x: Equivalence.number, y: Equivalence.number });
    expect(point.equals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(point.equals({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    // An undeclared property takes no part.
    expect(point.equals({ x: 1, y: 2, label: "a" } as { x: number; y: number }, { x: 1, y: 2 })).toBe(true);
    expect(panics(() => Equivalence.struct(null as unknown as Record<string, EquivalenceValue<never>>))).toBe(true);
  });

  test("contramap projects and `and` refines", () => {
    interface User {
      readonly id: number;
      readonly name: string;
    }
    const byId = Equivalence.number.contramap((user: User) => user.id);
    const byName = Equivalence.string.contramap((user: User) => user.name);
    const both = byId.and(byName);

    expect(byId.equals({ id: 1, name: "a" }, { id: 1, name: "b" })).toBe(true);
    expect(both.equals({ id: 1, name: "a" }, { id: 1, name: "b" })).toBe(false);
    expect(both.equals({ id: 1, name: "a" }, { id: 1, name: "a" })).toBe(true);
    expect(panics(() => Equivalence.number.contramap(7 as unknown as (value: number) => number))).toBe(true);
  });
});

describe("the equivalence laws", () => {
  const samples = [0, -0, 1, 2, Number.NaN, 3];

  test("every built-in instance is lawful over a mixed sample set", () => {
    expect(Equivalence.checkLaws(Equivalence.number, samples).isNone()).toBe(true);
    expect(Equivalence.checkLaws(Equivalence.string, ["a", "b", "a", ""]).isNone()).toBe(true);
    expect(Equivalence.checkLaws(Equivalence.boolean, [true, false, true]).isNone()).toBe(true);
    expect(Equivalence.checkLaws(Equivalence.any, [1, "1", true, Number.NaN, { x: 1 }, [1]]).isNone()).toBe(true);
    expect(Equivalence.checkLaws(Equivalence.reference, samples).isNone()).toBe(true);
  });

  test("checkLaws names the law that broke", () => {
    const notReflexive = Equivalence.make<number>((left, right) => left !== right);
    expect(Equivalence.checkLaws(notReflexive, [1, 2]).unwrapOr("")).toContain("reflexive");

    const notSymmetric = Equivalence.make<number>((left, right) => left <= right);
    expect(Equivalence.checkLaws(notSymmetric, [1, 2]).unwrapOr("")).toContain("symmetric");

    // "within one" is reflexive and symmetric, but 0 ~ 1 and 1 ~ 2 without 0 ~ 2.
    const notTransitive = Equivalence.make<number>((left, right) => Math.abs(left - right) <= 1);
    expect(Equivalence.checkLaws(notTransitive, [0, 1, 2]).unwrapOr("")).toContain("transitive");
  });

  test("checkLaws demands real arguments", () => {
    expect(panics(() => Equivalence.checkLaws({} as unknown as EquivalenceValue<number>, [1]))).toBe(true);
    expect(panics(() => Equivalence.checkLaws(Equivalence.number, 1 as unknown as readonly number[]))).toBe(true);
  });

  test("a seeded random sample set finds no violation in the structural default", () => {
    const random = SeededRandom.withSeed(0x5eed);
    const pool = ["alpha", "beta", "gamma", 1, 2, Number.NaN, true, false, -0, 0];
    const samples: unknown[] = [];
    for (let index = 0; index < 40; index += 1) samples.push(pool[random.int(0, pool.length)]);
    expect(Equivalence.checkLaws(Equivalence.any, samples).isNone()).toBe(true);
  });
});

describe("the structural seam", () => {
  test("rejects a malformed rule and a duplicate registration", () => {
    expect(panics(() => registerStructuralEquivalence({} as never))).toBe(true);
    expect(
      panics(() =>
        registerStructuralEquivalence({
          name: "probe",
          matches: "no" as unknown as (value: unknown) => boolean,
          equals: () => false,
        })
      ),
    ).toBe(true);

    // A rule that matches nothing is inert, so registering one twice is a safe
    // way to prove the duplicate-name guard fires.
    const inert = { name: "test:equivalence-duplicate-probe", matches: () => false, equals: () => false };
    registerStructuralEquivalence(inert);
    expect(panics(() => registerStructuralEquivalence(inert))).toBe(true);
  });
});
