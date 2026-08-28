import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import {
  arrayHoleIndex,
  denseArray,
  HOLE_HASH,
  isDenseArray,
  itemAt,
  NO_HOLE,
  requireDenseArray,
  sameArrayShape,
} from "./array-shape.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

/** A sparse array with holes at exactly `holes`, `length` long. */
function withHoles(length: number, holes: readonly number[]): unknown[] {
  const value = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    if (!holes.includes(index)) value[index] = index;
  }
  return value;
}

describe("arrayHoleIndex", () => {
  test("is the single rule: the first unowned index below length, or NO_HOLE", () => {
    expect(arrayHoleIndex([])).toBe(NO_HOLE);
    expect(arrayHoleIndex([1, 2, 3])).toBe(NO_HOLE);
    // The distinction the whole module exists for.
    expect(arrayHoleIndex([undefined])).toBe(NO_HOLE);
    expect(arrayHoleIndex(new Array(1))).toBe(0);
    expect(arrayHoleIndex(withHoles(4, [2]))).toBe(2);
    expect(arrayHoleIndex(withHoles(4, [1, 3]))).toBe(1);
  });

  test("sees a hole made by delete, not only one made by the Array constructor", () => {
    const value = [1, 2, 3];
    delete (value as unknown as Record<string, unknown>)["1"];
    expect(arrayHoleIndex(value)).toBe(1);
    expect(Object.keys(value)).toEqual(["0", "2"]);
  });

  test("a trailing hole counts: length outruns the last own index", () => {
    const value = [1];
    value.length = 3;
    expect(arrayHoleIndex(value)).toBe(1);
  });

  test("an inherited index is not an own index", () => {
    const value = new Array<number>(1);
    Object.setPrototypeOf(value, Object.assign(Object.create(Array.prototype), { 0: 7 }));
    expect(value[0]).toBe(7);
    expect(arrayHoleIndex(value)).toBe(0);
  });
});

describe("the gates", () => {
  test("isDenseArray answers instead of refusing", () => {
    expect(isDenseArray([undefined])).toBe(true);
    expect(isDenseArray(new Array(1))).toBe(false);
    expect(isDenseArray([])).toBe(true);
  });

  test("denseArray hands the first hole's index to reject and returns the array otherwise", () => {
    const dense = [1, 2];
    expect(denseArray(dense, () => { throw new Error("unreachable"); })).toBe(dense as never);
    expect(() => denseArray(withHoles(3, [2]), (index) => { throw new TypeError(`hole ${index}`); }))
      .toThrow("hole 2");
  });

  test("denseArray never brands a sparse array, even if reject returns", () => {
    // The brand is what makes every downstream walk safe without re-checking,
    // so obtaining one without passing the check has to be impossible at run
    // time too — not only rejected by `reject`'s `never` return type.
    const returning = (() => undefined) as unknown as (index: number) => never;
    expect(panics(() => denseArray(new Array(2), returning))).toBe(true);
    expect(denseArray([1, 2], returning)).toEqual([1, 2] as never);
  });

  test("requireDenseArray panics and names the index", () => {
    expect(panics(() => requireDenseArray(new Array(2), "Probe"))).toBe(true);
    expect(catchPanic(
      () => requireDenseArray(withHoles(3, [1]), "Probe"),
      (failure) => String((failure as { value?: unknown }).value ?? failure),
    )).toContain("hole at index 1");
    expect(panics(() => requireDenseArray([undefined, undefined], "Probe"))).toBe(false);
  });

  test("itemAt reads a gated array", () => {
    const gated = requireDenseArray(["a", "b"], "Probe");
    expect(itemAt(gated, 1)).toBe("b");
  });
});

describe("sameArrayShape", () => {
  test("compares index ownership, not just length", () => {
    expect(sameArrayShape([1, 2], [3, 4])).toBe(true);
    expect(sameArrayShape([1], [1, 2])).toBe(false);
    // The reviewer's pair: same length, same reads, different own keys.
    expect(sameArrayShape(new Array(1), [undefined])).toBe(false);
    expect(sameArrayShape([undefined], new Array(1))).toBe(false);
    expect(sameArrayShape(new Array(1), new Array(1))).toBe(true);
    expect(sameArrayShape(withHoles(3, [1]), withHoles(3, [1]))).toBe(true);
    expect(sameArrayShape(withHoles(3, [1]), withHoles(3, [2]))).toBe(false);
  });

  test("is symmetric and reflexive over sparse arrays", () => {
    const shapes = [[], [undefined], new Array(1), withHoles(3, [0, 2]), withHoles(3, [1]), [1, 2, 3]];
    for (const left of shapes) {
      expect(sameArrayShape(left, left)).toBe(true);
      for (const right of shapes) expect(sameArrayShape(left, right)).toBe(sameArrayShape(right, left));
    }
  });
});

describe("HOLE_HASH", () => {
  test("is a uint32 that is not the hash any member could produce for undefined", () => {
    expect(Number.isInteger(HOLE_HASH) && HOLE_HASH >= 0 && HOLE_HASH <= 0xffffffff).toBe(true);
    // `Hash.any.hash(undefined)` is 0xf0f0f0f0; a hole must not fold to it.
    expect(HOLE_HASH).not.toBe(0xf0f0f0f0);
  });
});
