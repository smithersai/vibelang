import { describe, expect, test } from "bun:test";
import type { NominalError } from "../runtime/errors.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { Chunk } from "./chunk.ts";
import { Data } from "./data.ts";
import { HashMap } from "./hash-map.ts";
import { Match, MatcherValue } from "./match.ts";

const { success, failure } = RuntimeValues;

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

function panicMessage(body: () => unknown): string {
  return catchPanic(body, (error) => error.message) as string;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Circle = { readonly kind: "circle"; readonly radius: number };
type Square = { readonly kind: "square"; readonly side: number };
type Shape = Circle | Square;

const circle: Shape = { kind: "circle", radius: 2 };
const square: Shape = { kind: "square", side: 3 };

type Event =
  | { readonly _tag: "opened"; readonly at: number }
  | { readonly _tag: "closed"; readonly at: number; readonly reason: string };

/** A union whose discriminant sits one level down, for the nested-leaf assertions. */
type Placed =
  | { readonly at: { readonly x: 1 }; readonly tag: "one" }
  | { readonly at: { readonly x: 2 }; readonly tag: "two" };

/**
 * Two Error classes with *identical* shape. Only the nominal brand tells them
 * apart to TypeScript, and only the constructor tells them apart at runtime —
 * which is exactly the pair `whenInstanceOf` has to get right.
 */
class LeftFault extends Error {}
interface LeftFault extends NominalError<"test:match/LeftFault@1"> {}
class RightFault extends Error {}
interface RightFault extends NominalError<"test:match/RightFault@1"> {}

class Box {
  constructor(readonly weight: number) {}
}

// ===========================================================================
// Type-level assertions
//
// The `@ts-expect-error` directives below are the assertions: `tsc --noEmit`
// fails if a marked line stops erroring, and fails if an unmarked line starts
// erroring. Nothing here runs; the `describe` blocks that follow prove the
// runtime agrees.
// ===========================================================================

declare const shape: Shape;
declare const event: Event;
declare const level: "low" | "high";
declare const mixed: string | number | boolean;
declare const flag: boolean;
declare const maybe: number | undefined;
declare const attempt: Result<number, TypeError>;
declare const fault: LeftFault | RightFault;
declare const anything: unknown;
declare const placed: Placed;
declare const pair: readonly [1, 2] | readonly [3, 4];

function tagArmsProveCoverage(): number {
  return Match.value(shape)
    .whenTag("circle", (found) => found.radius)
    .whenTag("square", (found) => found.side)
    .exhaustive();
}

function aMissingTagArmMakesExhaustiveUncallable(): void {
  const partial = Match.value(shape).whenTag("circle", (found) => found.radius);
  // @ts-expect-error `square` is still unhandled, so `.exhaustive` has no call signature
  partial.exhaustive();
  // ... and the same builder is fine once the case is covered.
  const total: number = partial.whenTag("square", (found) => found.side).exhaustive();
  void total;
}

function runRequiresAFallback(): void {
  const partial = Match.value(shape).whenTag("circle", (found) => found.radius);
  // @ts-expect-error `.run()` is unavailable until `.orElse` supplies a fallback
  partial.run();
  const total: number = partial.orElse(() => 0).run();
  void total;
}

function handlerParametersNarrow(): void {
  Match.value(shape).whenTag("circle", (found) => {
    const narrowed: Circle = found;
    // @ts-expect-error the circle arm never sees a Square
    const wrong: Square = found;
    void narrowed;
    void wrong;
    return 0;
  });
  // @ts-expect-error a handler declared over the wrong member is rejected outright
  Match.value(shape).whenTag("circle", (found: Square) => found.side);
}

function literalArmsProveCoverage(): number {
  return Match.value(level).when("low", () => 1).when("high", () => 2).exhaustive();
}

function aLiteralOutsideTheUnionIsADeadArm(): void {
  // @ts-expect-error "mid" is not one of the outstanding cases
  Match.value(level).when("mid", () => 0);
}

function booleanIsTwoLiteralCases(): string {
  return Match.value(flag).when(true, () => "yes").when(false, () => "no").exhaustive();
}

function typeGuardsNarrowAndSubtract(): string {
  return Match.value(mixed)
    .when(Match.string, (found) => found.toUpperCase())
    .when(Match.number, (found) => found.toFixed(2))
    .when(Match.boolean, (found) => String(found))
    .exhaustive();
}

function theWildcardClosesWhateverIsLeft(): string {
  const closed: string = Match.value(mixed).when(Match.any, () => "anything").exhaustive();
  const fromUnknown: string = Match.value(anything).when(Match.any, () => "anything").exhaustive();
  void fromUnknown;
  return closed;
}

function aBarePredicateProvesNothing(): void {
  const probe = Match.value(mixed).when((found) => typeof found === "object", () => "object");
  // @ts-expect-error a predicate that is not a type guard cannot subtract a case
  probe.exhaustive();
}

function literalTemplatesNarrowAndProveCoverage(): number {
  return Match.value(shape)
    .when({ kind: "circle" }, (found) => found.radius)
    .when({ kind: "square" }, (found) => found.side)
    .exhaustive();
}

function aTemplateWithAPredicateLeafProvesNothing(): void {
  const probe = Match.value(shape).when({ radius: Match.number }, (found) => {
    // the *handler* still narrows: only Circle has a `radius`
    const narrowed: Circle = found;
    return narrowed.radius;
  });
  // @ts-expect-error a predicate leaf cannot prove the case is covered
  probe.exhaustive();
}

function aWidenedPatternNeverSubtracts(): void {
  // The soundness guard: a pattern whose leaves are not single literals matches
  // one value at runtime but *looks* assignable-from every member, so it must
  // not be allowed to prove coverage.
  const byTag = Match.value(shape).whenTag(level as unknown as "circle" | "square", () => 0);
  // @ts-expect-error a union-typed tag proves nothing
  byTag.exhaustive();

  const byShape = Match.value(shape).when({ kind: level } as { kind: string }, () => 0);
  // @ts-expect-error a widened template leaf proves nothing
  byShape.exhaustive();

  const byLiteral = Match.value(level).when(level, () => 0);
  // @ts-expect-error a union-typed literal pattern proves nothing
  byLiteral.exhaustive();
}

function aDataPatternNeverSubtracts(): void {
  // The same soundness guard, for the one pattern kind the *runtime* treats
  // differently from every other object. `Data.struct(...)` is a value, matched
  // in whole with `Data.equals`, so it covers exactly the subjects structurally
  // equal to it — never a whole union member. `as const` defeats the widening
  // guard above (every leaf here really is a single literal), so what keeps this
  // sound is the nominal brand, which no `as const` can mint.
  const byData = Match.value(shape)
    .when(Data.struct({ kind: "circle" } as const), () => "c")
    .when(Data.struct({ kind: "square" } as const), () => "s");
  // @ts-expect-error a Data value is a whole-value pattern and proves nothing
  byData.exhaustive();

  // ... and it is still perfectly usable, with `.run()` as the honest terminal.
  const answered: string = byData.orElse(() => "other").run();
  void answered;

  // A Data *tuple* is the same story.
  const byTuple = Match.value(pair).when(Data.tuple(1, 2), () => "a").when(Data.tuple(3, 4), () => "b");
  // @ts-expect-error a Data tuple is a whole-value pattern and proves nothing
  byTuple.exhaustive();
}

function aDataLeafNeverSubtracts(): void {
  // One level down, where the Data value is a *leaf* of a plain template. The
  // enclosing template is still a template; the leaf inside it is still a value.
  const nested = Match.value(placed)
    .when({ at: Data.struct({ x: 1 } as const) }, (found) => {
      // The leaf is passed through unrefined rather than dropping the member:
      // no over-refusal, so the arm stays writable.
      const whole: Placed = found;
      return whole.tag;
    })
    .when({ at: Data.struct({ x: 2 } as const) }, () => "two");
  // @ts-expect-error a Data leaf cannot prove the case is covered
  nested.exhaustive();

  // The plain-template twin of the same match *does* prove coverage, which is
  // the negative control: the brand refuses Data values, not templates.
  const proved: string = Match.value(placed)
    .when({ at: { x: 1 } }, (found) => found.tag)
    .when({ at: { x: 2 } }, (found) => found.tag)
    .exhaustive();
  void proved;
}

function absenceIsAnOrdinaryUnionAndProvesCoverage(): string {
  // `T | undefined` is not a variant scrutinee: an ordinary guard covers the
  // present case and an ordinary `undefined` literal covers the absent one.
  const partial = Match.value(maybe).when(
    (value): value is number => value !== undefined,
    (found) => found.toFixed(0),
  );
  // @ts-expect-error the absent case is still unhandled
  partial.exhaustive();
  return partial.when(undefined, () => "none").exhaustive();
}

function resultVariantsProveCoverage(): string {
  const partial = Match.value(attempt).whenOk((found) => found.toFixed(0));
  // @ts-expect-error the failure case is still unhandled
  partial.exhaustive();
  return partial.whenError((found) => found.message).exhaustive();
}

function nominalErrorArmsNarrowAndSubtract(): string {
  return Match.value(fault)
    .whenInstanceOf(LeftFault, (found) => {
      const narrowed: LeftFault = found;
      // @ts-expect-error the two classes are nominally distinct
      const wrong: RightFault = found;
      void wrong;
      return narrowed.message;
    })
    .whenInstanceOf(RightFault, (found) => found.message)
    .exhaustive();
}

function theOutputIsTheUnionOfEveryHandlersResult(): void {
  const out = Match.value(level).when("low", () => 1).when("high", () => "high").exhaustive();
  const widened: number | string = out;
  // @ts-expect-error the output is `number | string`, not `number`
  const narrowed: number = out;
  void widened;
  void narrowed;
}

function orElseSeesWhatIsLeft(): number {
  return Match.value(shape).whenTag("circle", () => 0).orElse((rest) => {
    const remaining: Square = rest;
    return remaining.side;
  }).run();
}

function tagOnReadsAnyDiscriminant(): number {
  return Match.value(event)
    .whenTagOn("_tag", "opened", (found) => found.at)
    .whenTagOn("_tag", "closed", (found) => found.reason.length)
    .exhaustive();
}

// ===========================================================================
// Runtime behavior
// ===========================================================================

describe("literal patterns", () => {
  test("primitives compare with SameValueZero", () => {
    const classify = (input: number): string =>
      Match.value(input)
        .when(Number.NaN, () => "nan")
        .when(0, () => "zero")
        .when(1, () => "one")
        .orElse(() => "other")
        .run();

    expect(classify(Number.NaN)).toBe("nan");
    expect(classify(0)).toBe("zero");
    // SameValueZero: -0 and +0 are the same value, the way Map keys already are.
    expect(classify(-0)).toBe("zero");
    expect(classify(1)).toBe("one");
    expect(classify(2)).toBe("other");
  });

  test("strings, booleans, null, undefined, bigint, and symbols all work", () => {
    const marker = Symbol("marker");
    const label = (input: unknown): string =>
      Match.value(input)
        .when("a", () => "string a")
        .when(true, () => "true")
        .when(null, () => "null")
        .when(undefined, () => "undefined")
        .when(10n, () => "bigint")
        .when(marker, () => "symbol")
        .orElse(() => "other")
        .run();

    expect(label("a")).toBe("string a");
    expect(label(true)).toBe("true");
    expect(label(false)).toBe("other");
    expect(label(null)).toBe("null");
    expect(label(undefined)).toBe("undefined");
    expect(label(10n)).toBe("bigint");
    expect(label(marker)).toBe("symbol");
    expect(label(Symbol("marker"))).toBe("other");
    // No coercion: "1" is not 1.
    expect(label("1")).toBe("other");
  });

  test("a branded structural value is matched by shape, an unbranded look-alike by reference", () => {
    const target = Data.struct({ region: "eu", shard: Data.tuple(1, 2) });
    const twin = Data.struct({ shard: Data.tuple(1, 2), region: "eu" });
    const hit = (input: unknown): boolean =>
      Match.value(input).when(target, () => true).orElse(() => false).run();

    expect(hit(twin)).toBe(true);
    expect(hit(Data.struct({ region: "us", shard: Data.tuple(1, 2) }))).toBe(false);

    // Chunk and HashMap go through the same `Data.equals` door.
    expect(Match.value(Chunk.of(1, 2, 3)).when(Chunk.of(1).append(2).append(3), () => "same").orElse(() => "different").run())
      .toBe("same");
    expect(Match.value(HashMap.of(["a", 1])).when(HashMap.of(["a", 1]), () => "same").orElse(() => "different").run())
      .toBe("same");

    // A class instance is neither plain nor branded, so it compares by reference.
    const box = new Box(1);
    expect(Match.value<unknown>(box).when(box, () => "same").orElse(() => "different").run()).toBe("same");
    expect(Match.value<unknown>(box).when(new Box(1), () => "same").orElse(() => "different").run()).toBe("different");
  });
});

describe("predicate patterns", () => {
  test("a predicate filters and a type guard narrows", () => {
    const describe_ = (input: string | number): string =>
      Match.value(input)
        .when(Match.number, (found) => `number ${found.toFixed(1)}`)
        .when((found) => found.length > 3, () => "long string")
        .orElse(() => "short string")
        .run();

    expect(describe_(2)).toBe("number 2.0");
    expect(describe_("abcd")).toBe("long string");
    expect(describe_("ab")).toBe("short string");
  });

  test("the built-in guards cover the primitives they name", () => {
    const kind = (input: unknown): string =>
      Match.value(input)
        .when(Match.string, () => "string")
        .when(Match.number, () => "number")
        .when(Match.boolean, () => "boolean")
        .when(Match.any, () => "other")
        .exhaustive();

    expect(kind("a")).toBe("string");
    expect(kind(1)).toBe("number");
    expect(kind(Number.NaN)).toBe("number");
    expect(kind(false)).toBe("boolean");
    expect(kind(null)).toBe("other");
    expect(kind({})).toBe("other");
  });

  test("a predicate that does not return a boolean is a programming error", () => {
    const built = Match.value<unknown>(1).when((() => "yes") as unknown as (value: unknown) => boolean, () => 1);
    expect(panics(() => built.orElse(() => 0).run())).toBe(true);
    expect(panicMessage(() => built.orElse(() => 0).run())).toContain("must return a boolean");
  });
});

describe("structural templates", () => {
  test("object templates match subsets: extra keys on the subject are ignored", () => {
    const matched = (input: unknown): boolean =>
      Match.value(input).when({ kind: "circle" }, () => true).orElse(() => false).run();

    expect(matched({ kind: "circle", radius: 2 })).toBe(true);
    expect(matched({ kind: "circle", radius: 2, extra: "ignored" })).toBe(true);
    expect(matched({ kind: "square", side: 2 })).toBe(false);
    // A named key must be present, not merely undefined-valued by absence.
    expect(matched({ radius: 2 })).toBe(false);
    // The empty template constrains nothing, so it matches every object.
    expect(Match.value<unknown>({ a: 1 }).when({}, () => true).orElse(() => false).run()).toBe(true);
    expect(Match.value<unknown>("text").when({}, () => true).orElse(() => false).run()).toBe(false);
  });

  test("leaves may be literals, predicates, guards, the wildcard, or nested templates", () => {
    const template = {
      kind: "point",
      at: { x: 0, y: Match.number },
      label: Match.any,
      weight: (value: unknown) => typeof value === "number" && value > 10,
    };
    const matched = (input: unknown): boolean =>
      Match.value(input).when(template, () => true).orElse(() => false).run();

    expect(matched({ kind: "point", at: { x: 0, y: 5 }, label: null, weight: 11 })).toBe(true);
    expect(matched({ kind: "point", at: { x: 0, y: 5 }, label: "anything", weight: 11 })).toBe(true);
    // Each leaf is load-bearing.
    expect(matched({ kind: "line", at: { x: 0, y: 5 }, label: null, weight: 11 })).toBe(false);
    expect(matched({ kind: "point", at: { x: 1, y: 5 }, label: null, weight: 11 })).toBe(false);
    expect(matched({ kind: "point", at: { x: 0, y: "5" }, label: null, weight: 11 })).toBe(false);
    expect(matched({ kind: "point", at: { x: 0, y: 5 }, label: null, weight: 9 })).toBe(false);
    // The wildcard still requires the key to exist.
    expect(matched({ kind: "point", at: { x: 0, y: 5 }, weight: 11 })).toBe(false);
  });

  test("array templates match exactly, in position and in length", () => {
    const matched = (input: unknown): boolean =>
      Match.value(input).when([1, Match.number, "z"], () => true).orElse(() => false).run();

    expect(matched([1, 2, "z"])).toBe(true);
    expect(matched([1, 99, "z"])).toBe(true);
    expect(matched([1, 2, "z", "extra"])).toBe(false);
    expect(matched([1, 2])).toBe(false);
    expect(matched([2, 2, "z"])).toBe(false);
    expect(matched({ 0: 1, 1: 2, 2: "z" })).toBe(false);
    // A Data tuple is a real array, so an array template reads it too.
    expect(matched(Data.tuple(1, 2, "z"))).toBe(true);
  });

  test("an array template compares index ownership, so a hole is not an own undefined", () => {
    // `subject[index]` reads a hole as `undefined`, so a sparse subject used to
    // match a template that named `undefined` in that position — the same
    // hole/own-`undefined` conflation the rest of this package refuses.
    const matched = (input: unknown): boolean =>
      Match.value(input).when([1, undefined, 3], () => true).orElse(() => false).run();

    expect(matched([1, undefined, 3])).toBe(true);
    expect(matched([1, , 3] as unknown[])).toBe(false);

    const holed = (input: unknown): boolean =>
      Match.value(input).when([1, , 3] as unknown[] as never, () => true).orElse(() => false).run();
    expect(holed([1, , 3] as unknown[])).toBe(true);
    expect(holed([1, undefined, 3])).toBe(false);
  });

  test("a Data value used as a pattern is a value, not a template", () => {
    // The rule worth remembering: plain means template, branded means value.
    const subset = Match.value<unknown>({ x: 1, y: 2 }).when({ x: 1 }, () => "template").orElse(() => "no").run();
    expect(subset).toBe("template");

    const whole = Match.value<unknown>(Data.struct({ x: 1, y: 2 }))
      .when(Data.struct({ x: 1 }), () => "value")
      .orElse(() => "no")
      .run();
    expect(whole).toBe("no");
  });

  test("a Data pattern does not cover a union member, and the types say so", () => {
    // The runtime half of `aDataPatternNeverSubtracts`. Arms that look like they
    // spell out both members of `Shape` cover *neither*: each demands whole-value
    // equality with a two-key Data value, and a `Shape` has two keys of its own.
    const arms = <T>(input: T) =>
      Match.value(input)
        .when(Data.struct({ kind: "circle" } as const), () => "c")
        .when(Data.struct({ kind: "square" } as const), () => "s");

    expect(arms(circle).orElse(() => "no arm").run()).toBe("no arm");
    expect(arms(square).orElse(() => "no arm").run()).toBe("no arm");
    // Only a subject equal in whole is claimed.
    expect(arms(Data.struct({ kind: "circle" })).orElse(() => "no arm").run()).toBe("c");

    // `.exhaustive()` on those arms is a compile error (see the type-level
    // assertion above); the cast is what it would take to reach the terminal
    // anyway, and it shows the panic the type system now prevents.
    const forced = arms(circle) as unknown as { exhaustive: () => string };
    expect(panics(() => forced.exhaustive())).toBe(true);
    expect(panicMessage(() => forced.exhaustive())).toContain("non-exhaustive Match");

    // The negative control: the plain-template twin is genuinely exhaustive, and
    // both the proof and the answer survive.
    const area = (input: Shape): number =>
      Match.value(input)
        .when({ kind: "circle" }, (found) => found.radius)
        .when({ kind: "square" }, (found) => found.side)
        .exhaustive();
    expect(area(circle)).toBe(2);
    expect(area(square)).toBe(3);
  });

  test("a Data leaf inside a template is a value, not a nested template", () => {
    const matched = (input: unknown): string =>
      Match.value(input)
        .when({ at: Data.struct({ x: 1 } as const) }, () => "one")
        .orElse(() => "no arm")
        .run();

    // A plain `{ x: 1 }` field is not `Data.equals` to a Data value...
    expect(matched({ at: { x: 1 }, tag: "one" })).toBe("no arm");
    // ...and neither is a Data value with an extra key, because the comparison is
    // whole-value rather than subset.
    expect(matched({ at: Data.struct({ x: 1, y: 9 }) })).toBe("no arm");
    // Equal in whole, so it matches.
    expect(matched({ at: Data.struct({ x: 1 }), tag: "one" })).toBe("one");
  });

  test("templates read through the prototype chain and into class instances", () => {
    expect(Match.value<unknown>(new Box(5)).when({ weight: 5 }, () => true).orElse(() => false).run()).toBe(true);
    expect(Match.value<unknown>(new Box(6)).when({ weight: 5 }, () => true).orElse(() => false).run()).toBe(false);
    expect(Match.value<unknown>(new TypeError("boom")).when({ message: "boom" }, () => true).orElse(() => false).run())
      .toBe(true);
  });

  test("a cyclic or absurdly deep template is rejected at the call site", () => {
    const cyclic: Record<string, unknown> = { kind: "loop" };
    cyclic.self = cyclic;
    expect(panics(() => Match.value<unknown>(1).when(cyclic, () => 0))).toBe(true);
    expect(panicMessage(() => Match.value<unknown>(1).when(cyclic, () => 0))).toContain("acyclic");

    let deep: Record<string, unknown> = { end: true };
    for (let level_ = 0; level_ < 40; level_ += 1) deep = { next: deep };
    expect(panics(() => Match.value<unknown>(1).when(deep, () => 0))).toBe(true);

    // A shared but acyclic subtree is fine.
    const shared = { n: 1 };
    expect(Match.value<unknown>({ a: { n: 1 }, b: { n: 1 } }).when({ a: shared, b: shared }, () => true).orElse(() => false).run())
      .toBe(true);
  });
});

describe("discriminated unions", () => {
  test("whenTag reads `kind` and whenTagOn reads anything else", () => {
    const area = (input: Shape): number =>
      Match.value(input)
        .whenTag("circle", (found) => Math.PI * found.radius ** 2)
        .whenTag("square", (found) => found.side ** 2)
        .exhaustive();

    expect(area(circle)).toBeCloseTo(Math.PI * 4);
    expect(area(square)).toBe(9);

    const summary = (input: Event): string =>
      Match.value(input)
        .whenTagOn("_tag", "opened", (found) => `opened at ${found.at}`)
        .whenTagOn("_tag", "closed", (found) => `closed: ${found.reason}`)
        .exhaustive();

    expect(summary({ _tag: "opened", at: 7 })).toBe("opened at 7");
    expect(summary({ _tag: "closed", at: 9, reason: "done" })).toBe("closed: done");
  });

  test("a tag arm ignores non-objects and objects without the discriminant", () => {
    const hit = (input: unknown): boolean =>
      Match.value(input).whenTag("circle", () => true).orElse(() => false).run();

    expect(hit({ kind: "circle" })).toBe(true);
    expect(hit({ kind: "square" })).toBe(false);
    expect(hit({ tag: "circle" })).toBe(false);
    expect(hit("circle")).toBe(false);
    expect(hit(null)).toBe(false);
  });

  test("a non-string discriminant key is a programming error", () => {
    expect(panics(() => Match.value<unknown>({}).whenTagOn(1 as unknown as string, "x", () => 0))).toBe(true);
  });
});

describe("nominal Error arms", () => {
  test("two same-shaped Error classes are told apart by identity, not by shape", () => {
    const which = (input: unknown): string =>
      Match.value(input)
        .whenInstanceOf(LeftFault, (found) => `left: ${found.message}`)
        .whenInstanceOf(RightFault, (found) => `right: ${found.message}`)
        .orElse(() => "neither")
        .run();

    expect(which(new LeftFault("a"))).toBe("left: a");
    expect(which(new RightFault("a"))).toBe("right: a");
    // Same message, same own properties, same prototype *shape* — only the
    // constructor differs, and that is what decides.
    expect(which(new Error("a"))).toBe("neither");
    expect(which({ name: "LeftFault", message: "a" })).toBe("neither");
  });

  test("a base class matches its subclasses, and ordinary classes work too", () => {
    expect(Match.value<unknown>(new LeftFault("x")).whenInstanceOf(Error, () => "error").orElse(() => "no").run())
      .toBe("error");
    expect(Match.value<unknown>(new Box(1)).whenInstanceOf(Box, (found) => found.weight).orElse(() => -1).run())
      .toBe(1);
    expect(Match.value<unknown>({ weight: 1 }).whenInstanceOf(Box, (found) => found.weight).orElse(() => -1).run())
      .toBe(-1);
    expect(Match.value<unknown>(new Date(0)).whenInstanceOf(Date, (found) => found.getTime()).orElse(() => -1).run())
      .toBe(0);
  });

  test("a non-class is a programming error", () => {
    expect(panics(() => Match.value<unknown>(1).whenInstanceOf({} as unknown as typeof Box, () => 0))).toBe(true);
  });
});

describe("`T | undefined` and Result scrutinees", () => {
  test("an ordinary guard and an `undefined` arm cover a union between them", () => {
    const render = (input: number | undefined): string =>
      Match.value(input)
        .when((value): value is number => value !== undefined, (found) => `got ${found}`)
        .when(undefined, () => "nothing")
        .exhaustive();

    expect(render(7)).toBe("got 7");
    expect(render(undefined)).toBe("nothing");
    // A falsy *present* value is present. Absence is `undefined`, not falsiness.
    expect(render(0)).toBe("got 0");
  });

  test("whenOk and whenError cover a Result between them", () => {
    const render = (input: Result<number, TypeError>): string =>
      Match.value(input)
        .whenOk((found) => `ok ${found}`)
        .whenError((found) => `failed: ${found.message}`)
        .exhaustive();

    expect(render(success(7))).toBe("ok 7");
    expect(render(failure(new TypeError("bad")))).toBe("failed: bad");
  });

  test("arm order does not matter, and the arms are exclusive", () => {
    expect(
      Match.value<number | undefined>(undefined)
        .when(undefined, () => "none")
        .when((value): value is number => typeof value === "number", () => "some")
        .exhaustive(),
    ).toBe("none");
    expect(
      Match.value(failure(new TypeError("x")) as Result<number, TypeError>)
        .whenError(() => "error")
        .whenOk(() => "ok")
        .exhaustive(),
    ).toBe("error");
  });

  test("a variant arm on the wrong kind of scrutinee is caught at the call site", () => {
    expect(panics(() => Match.value<unknown>(1).whenOk(() => 0))).toBe(true);
    expect(panics(() => Match.value<unknown>(1).whenError(() => 0))).toBe(true);
    expect(panicMessage(() => Match.value<unknown>(undefined).whenOk(() => 0))).toContain("Result scrutinee");
    // The variant arms that used to exist for the withdrawn container are gone.
    for (const withdrawn of ["whenSome", "whenNone"]) {
      expect(withdrawn in (Match.value<unknown>(1) as object)).toBe(false);
    }
  });
});

describe("evaluation order and laziness", () => {
  test("the first matching arm wins, and later arms never run", () => {
    const calls: string[] = [];
    const result = Match.value<unknown>(1)
      .when(Match.number, () => {
        calls.push("number");
        return "number";
      })
      .when(1, () => {
        calls.push("one");
        return "one";
      })
      .orElse(() => {
        calls.push("fallback");
        return "fallback";
      })
      .run();

    expect(result).toBe("number");
    expect(calls).toEqual(["number"]);
  });

  test("no handler runs until a terminal is called", () => {
    const calls: string[] = [];
    const built = Match.value<unknown>(1)
      .when(2, () => calls.push("two"))
      .when(1, () => calls.push("one"))
      .orElse(() => calls.push("fallback"));

    expect(calls).toEqual([]);
    built.run();
    expect(calls).toEqual(["one"]);
    // A terminal is not a consumer: calling it again evaluates again.
    built.run();
    expect(calls).toEqual(["one", "one"]);
  });

  test("the fallback runs only when nothing else claimed the value", () => {
    const value = Match.value<unknown>("x").when(1, () => "one").orElse((found) => `fallback ${String(found)}`).run();
    expect(value).toBe("fallback x");
  });
});

describe("the builder is an immutable value", () => {
  test("every arm returns a new matcher and leaves the receiver alone", () => {
    const base = Match.value<unknown>(circle).when(Match.string, () => "string");
    const asCircle = base.whenTag("circle", () => "circle");
    const asSquare = base.whenTag("square", () => "square");

    expect(asCircle).not.toBe(base);
    expect(asCircle).not.toBe(asSquare);
    expect(asCircle.orElse(() => "none").run()).toBe("circle");
    expect(asSquare.orElse(() => "none").run()).toBe("none");
    // The shared prefix is untouched by either branch.
    expect(base.orElse(() => "none").run()).toBe("none");
  });

  test("a matcher is frozen and carries a readable tag", () => {
    const built = Match.value<unknown>(1);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.prototype.toString.call(built)).toBe("[object Match]");
    expect(Match.isMatcher(built)).toBe(true);
    expect(Match.isMatcher({})).toBe(false);
    expect(Match.isMatcher(null)).toBe(false);
  });

  test("orElse must be the last arm", () => {
    const withFallback = Match.value<unknown>(1).orElse(() => "fallback");
    expect(panics(() => withFallback.when(1, () => "one"))).toBe(true);
    expect(panicMessage(() => withFallback.orElse(() => "again"))).toContain("last arm");
  });

  test("a forged look-alike is rejected everywhere", () => {
    const forged = Object.create(MatcherValue.prototype) as MatcherValue<unknown, unknown, unknown, false>;
    expect(Match.isMatcher(forged)).toBe(false);
    expect(panics(() => (forged as unknown as { when: (a: unknown, b: unknown) => unknown }).when(1, () => 0))).toBe(true);
    expect(panics(() => (forged as unknown as { run: () => unknown }).run())).toBe(true);
    expect(panics(() => (forged as unknown as { exhaustive: () => unknown }).exhaustive())).toBe(true);
    expect(panicMessage(() => (forged as unknown as { run: () => unknown }).run())).toContain("forged Match value");
  });

  test("a missing handler is a programming error, on every arm", () => {
    const built = Match.value<unknown>(1) as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const arm of ["when", "whenTag", "whenOk", "whenError", "orElse"]) {
      expect(panics(() => built[arm]?.(1, undefined))).toBe(true);
    }
    expect(panics(() => Match.value<unknown>(1).whenInstanceOf(Box, undefined as unknown as () => number))).toBe(true);
  });
});

describe("the terminals", () => {
  test("exhaustive panics when the proof was wrong at runtime", () => {
    // A type guard that always answers `false` still subtracts its type, which
    // is the standard (and standardly unsound) TypeScript convention. The
    // runtime keeps the last word.
    const lying = (value: Shape): value is Shape => {
      void value;
      return false;
    };
    const built = Match.value<Shape>(circle).when(lying, () => "matched");
    expect(panics(() => built.exhaustive())).toBe(true);
    expect(panicMessage(() => built.exhaustive())).toContain("non-exhaustive Match");
  });

  test("run panics when a fallback was cast away", () => {
    const built = Match.value<unknown>(1).when(2, () => "two") as unknown as { run: () => unknown };
    expect(panics(() => built.run())).toBe(true);
    expect(panicMessage(() => built.run())).toContain("no arm and no fallback");
  });

  test("a terminal answers with the matching handler's value, whatever its type", () => {
    const answer = (input: "low" | "high"): number | "high" =>
      Match.value(input).when("low", () => 1).when("high", () => "high" as const).exhaustive();
    expect(answer("low")).toBe(1);
    expect(answer("high")).toBe("high");
  });
});

// The type-level assertions above are proofs for `tsc`, not tests for `bun`.
void tagArmsProveCoverage;
void aMissingTagArmMakesExhaustiveUncallable;
void runRequiresAFallback;
void handlerParametersNarrow;
void literalArmsProveCoverage;
void aLiteralOutsideTheUnionIsADeadArm;
void booleanIsTwoLiteralCases;
void typeGuardsNarrowAndSubtract;
void theWildcardClosesWhateverIsLeft;
void aBarePredicateProvesNothing;
void literalTemplatesNarrowAndProveCoverage;
void aTemplateWithAPredicateLeafProvesNothing;
void aWidenedPatternNeverSubtracts;
void aDataPatternNeverSubtracts;
void aDataLeafNeverSubtracts;
void absenceIsAnOrdinaryUnionAndProvesCoverage;
void resultVariantsProveCoverage;
void nominalErrorArmsNarrowAndSubtract;
void theOutputIsTheUnionOfEveryHandlersResult;
void orElseSeesWhatIsLeft;
void tagOnReadsAnyDiscriminant;
