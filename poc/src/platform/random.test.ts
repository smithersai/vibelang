import { describe, expect, test } from "bun:test";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { Random, SeededRandom, SystemRandom } from "./random.ts";

/** Contract every Random implementation must satisfy, exercised through the abstract type. */
function assertRandomContract(random: Random): void {
  for (let index = 0; index < 200; index++) {
    const value = random.next();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  }
  for (let index = 0; index < 200; index++) {
    const value = random.int(10, 15);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(10);
    expect(value).toBeLessThan(15);
  }
  expect(random.int(-3, -2)).toBe(-3);
  expect(random.bytes(0)).toEqual(new Uint8Array(0));
  expect(random.bytes(37).length).toBe(37);
  expect(random.bytes(37)).toBeInstanceOf(Uint8Array);
}

function assertContractViolationsPanic(random: Random): void {
  const violations: Array<() => unknown> = [
    () => random.int(5, 5),
    () => random.int(5, 4),
    () => random.int(0.5, 4),
    () => random.bytes(-1),
    () => random.bytes(1.5),
  ];
  for (const violation of violations) {
    expect(isPanic(catchPanic(violation, (error) => error))).toBe(true);
  }
}

describe("Random", () => {
  test("SystemRandom satisfies the contract over host randomness", () => {
    const random: Random = SystemRandom.make();
    assertRandomContract(random);
    assertContractViolationsPanic(random);
    // Sanity only: a CSPRNG must not replay the same 32 bytes twice.
    expect(random.bytes(32)).not.toEqual(random.bytes(32));
    const draws = new Set<number>();
    for (let index = 0; index < 100; index++) draws.add(random.int(0, 1_000_000));
    expect(draws.size).toBeGreaterThan(90);
  });

  test("SeededRandom satisfies the contract and replays exactly", () => {
    const random: Random = SeededRandom.withSeed(42);
    assertRandomContract(random);
    assertContractViolationsPanic(random);

    const first = SeededRandom.withSeed(42);
    const second = SeededRandom.withSeed(42);
    const third = SeededRandom.withSeed(43);
    const draw = (source: Random): readonly unknown[] => [
      source.next(),
      source.int(0, 1_000),
      [...source.bytes(8)],
    ];
    expect(draw(first)).toEqual(draw(second));
    expect(draw(SeededRandom.withSeed(43))).not.toEqual(draw(SeededRandom.withSeed(42)));
    expect(third.seed).toBe(43);
  });

  test("SeededRandom.reset replays the stream from the seed", () => {
    const random = SeededRandom.withSeed(7);
    const before = [random.next(), random.next(), random.next()];
    expect(random.next()).not.toEqual(before[0]);
    random.reset();
    expect([random.next(), random.next(), random.next()]).toEqual(before);
  });

  test("a seeded int stream stays inside its range across wide spans", () => {
    const random = SeededRandom.withSeed(1234);
    // A span wider than 2^32 exercises the 53-bit draw path.
    for (let index = 0; index < 500; index++) {
      const value = random.int(0, 2 ** 40);
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 40);
    }
  });

  test("Random resolves through a Layer under its nominal key", () => {
    const random = SeededRandom.withSeed(99);
    const roll = (): number => Random.context().int(1, 7);
    const layer = Layer.succeed(Random, random);
    const rolled = Layer.provide(layer, roll);
    expect(rolled).toBeGreaterThanOrEqual(1);
    expect(rolled).toBeLessThan(7);
    // A Layer supplies the very instance it was given, so rewinding it rewinds the roll.
    random.reset();
    expect(Layer.provide(layer, roll)).toBe(rolled);
    expect(isPanic(catchPanic(roll, (error) => error))).toBe(true);
  });
});
