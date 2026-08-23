/**
 * `Equivalence<T>`: a first-class, law-checked answer to "are these the same value?".
 *
 * The standard library lists `Equivalence` and `Hash` under "Schema and
 * Encoding" (docs/src/pages/reference/standard-library.mdx) as artifacts that
 * are *derived at comptime where possible*. Until the compiler derives them,
 * they are ordinary Smithers values: an `Equivalence` is an immutable, frozen,
 * WeakSet-branded wrapper around a comparison function, built the same way
 * `Duration` and the runtime's `Result`/`Optional` are built, so a structural
 * look-alike cannot be passed off as one. Every operation panics on a forgery.
 *
 * Policies, all deliberate and all tested:
 *
 * - **SameValueZero for primitives.** `Equivalence.number` (and the `number`
 *   branch of `Equivalence.any`) uses SameValueZero: `NaN` equals `NaN`, and
 *   `-0` equals `+0`. This is the comparison `Array.prototype.includes` and
 *   `Map`/`Set` keys already use, so a Smithers value behaves the way a
 *   TypeScript author expects, and it is a genuine equivalence relation —
 *   `Object.is` is too (it separates the zeroes) but `===` is not, because
 *   `NaN === NaN` is false and reflexivity would fail.
 * - **Reference equality is the fallback.** `Equivalence.any` compares two
 *   values structurally when a *registered structural rule* matches them
 *   (`Data` values, `Chunk`, `HashMap`, `HashSet`) and by reference otherwise.
 *   A plain object, a plain array, a class instance, a `Date`, and a `Map` all
 *   compare by reference. Use `Equivalence.struct`/`tuple`/`array`, or wrap the
 *   value with `Data.struct`/`Data.tuple`, to get structural comparison.
 * - **A comparison must return a boolean.** Anything else is a programming
 *   error and panics, rather than being coerced.
 *
 * The structural seam is `registerStructuralEquivalence`. It is deliberately
 * *not* a member of the frozen `Equivalence` namespace, the same way the
 * runtime keeps `__vsOptionalSome` out of `Optional`: registering a rule is a
 * library-construction act, not an authoring one. Each module that defines a
 * branded structural type registers its own rule when it loads, and a value of
 * that type cannot exist unless its module loaded, so the seam is always
 * complete for the values a caller can actually hold.
 */

import type { Optional } from "../runtime/optional.ts";
import { panic } from "../runtime/panic.ts";
import { RuntimeValues } from "../runtime/values.ts";

const { absent, present } = RuntimeValues;

type EqualsFn = (left: unknown, right: unknown) => boolean;

const equalsByInstance = new WeakMap<object, EqualsFn>();
const localEquivalences = new WeakSet<object>();

function equalsOf<T>(instance: Equivalence<T>): EqualsFn {
  const equals = equalsByInstance.get(instance as object);
  if (equals === undefined || !localEquivalences.has(instance as object)) panic("forged Equivalence value");
  return equals;
}

/**
 * SameValueZero, the equality Smithers uses for primitives.
 *
 * `===` everywhere except `NaN`, which is equal to itself so the relation stays
 * reflexive. `+0` and `-0` are the same value, which is what `===` already says.
 */
export function sameValueZero(left: unknown, right: unknown): boolean {
  return left === right || (left !== left && right !== right);
}

export abstract class EquivalenceValue<T> {
  equals(left: T, right: T): boolean {
    const verdict = equalsOf(this)(left, right);
    if (typeof verdict !== "boolean") panic("an Equivalence must return a boolean");
    return verdict;
  }

  /** Compare `B` values by the `T` they project to. */
  contramap<B>(project: (value: B) => T): Equivalence<B> {
    if (typeof project !== "function") panic("Equivalence.contramap requires a function");
    const equals = equalsOf(this);
    return make<B>((left, right) => equals(project(left), project(right)));
  }

  /** Both relations must agree; useful for refining a coarse comparison. */
  and(other: Equivalence<T>): Equivalence<T> {
    const left = equalsOf(this);
    const right = equalsOf(other);
    return make<T>((a, b) => left(a, b) && right(a, b));
  }

  get [Symbol.toStringTag](): string {
    return "Equivalence";
  }
}

export type Equivalence<T> = EquivalenceValue<T>;

class LocalEquivalence<T> extends EquivalenceValue<T> {
  constructor(equals: EqualsFn) {
    super();
    equalsByInstance.set(this, equals);
    localEquivalences.add(this);
    Object.freeze(this);
  }
}

function make<T>(equals: (left: T, right: T) => boolean): Equivalence<T> {
  if (typeof equals !== "function") panic("Equivalence.make requires a function");
  return new LocalEquivalence<T>(equals as EqualsFn);
}

function isEquivalence(value: unknown): value is Equivalence<unknown> {
  return typeof value === "object" && value !== null && localEquivalences.has(value);
}

function requireEquivalence(value: unknown, caller: string): EqualsFn {
  if (!isEquivalence(value)) panic(`${caller} requires an Equivalence value`);
  return equalsOf(value);
}

// ---------------------------------------------------------------------------
// The structural seam
// ---------------------------------------------------------------------------

/**
 * How one branded structural type answers `Equivalence.any`.
 *
 * `matches` must be the type's own brand check — never a shape test — so a
 * look-alike is never routed into a structural comparison. `equals` receives a
 * `recurse` callback (`Equivalence.any`'s comparison) for member values.
 */
export interface StructuralEquivalenceRule {
  readonly name: string;
  readonly matches: (value: unknown) => boolean;
  readonly equals: (left: unknown, right: unknown, recurse: (left: unknown, right: unknown) => boolean) => boolean;
}

const structuralRules: StructuralEquivalenceRule[] = [];

/**
 * Library-construction API, not an authoring one: teaches `Equivalence.any`
 * about one more branded structural type. Registering the same `name` twice is
 * a programming error and panics, so a double-registered module is loud.
 */
export function registerStructuralEquivalence(rule: StructuralEquivalenceRule): void {
  if (
    typeof rule?.name !== "string" || typeof rule.matches !== "function" ||
    typeof rule.equals !== "function"
  ) {
    panic("registerStructuralEquivalence requires a { name, matches, equals } rule");
  }
  if (structuralRules.some((existing) => existing.name === rule.name)) {
    panic(`structural Equivalence rule "${rule.name}" is already registered`);
  }
  structuralRules.push(Object.freeze({ ...rule }));
}

function anyEquals(left: unknown, right: unknown): boolean {
  if (sameValueZero(left, right)) return true;
  for (const rule of structuralRules) {
    if (rule.matches(left)) return rule.matches(right) && rule.equals(left, right, anyEquals) === true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Built-in instances and combinators
// ---------------------------------------------------------------------------

const numberEquivalence = make<number>(sameValueZero);
const stringEquivalence = make<string>((left, right) => left === right);
const booleanEquivalence = make<boolean>((left, right) => left === right);
const referenceEquivalence = make<unknown>((left, right) => Object.is(left, right));
const anyEquivalence = make<unknown>(anyEquals);

type EquivalenceOf<E> = E extends EquivalenceValue<infer A> ? A : never;

function tuple<const Parts extends readonly EquivalenceValue<never>[]>(
  ...parts: Parts
): Equivalence<{ readonly [Index in keyof Parts]: EquivalenceOf<Parts[Index]> }> {
  const comparisons = parts.map((part, index) => requireEquivalence(part, `Equivalence.tuple[${index}]`));
  return make<readonly unknown[]>((left, right) => {
    if (left.length !== comparisons.length || right.length !== comparisons.length) return false;
    for (let index = 0; index < comparisons.length; index += 1) {
      if (!(comparisons[index] as EqualsFn)(left[index], right[index])) return false;
    }
    return true;
  }) as Equivalence<{ readonly [Index in keyof Parts]: EquivalenceOf<Parts[Index]> }>;
}

function array<T>(item: Equivalence<T>): Equivalence<readonly T[]> {
  const equals = requireEquivalence(item, "Equivalence.array");
  return make<readonly T[]>((left, right) => {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!equals(left[index], right[index])) return false;
    }
    return true;
  });
}

/**
 * Compares exactly the declared fields. Undeclared own properties are ignored,
 * which is what makes a struct Equivalence usable against a wider record type.
 */
function struct<const Fields extends Readonly<Record<string, EquivalenceValue<never>>>>(
  fields: Fields,
): Equivalence<{ readonly [Key in keyof Fields]: EquivalenceOf<Fields[Key]> }> {
  if (fields === null || typeof fields !== "object") panic("Equivalence.struct requires a record of Equivalence values");
  const entries = Object.keys(fields).map(
    (key) => [key, requireEquivalence(fields[key], `Equivalence.struct.${key}`)] as const,
  );
  return make<Record<string, unknown>>((left, right) => {
    if (left === right) return true;
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
    for (const [key, equals] of entries) {
      if (!equals(left[key], right[key])) return false;
    }
    return true;
  }) as unknown as Equivalence<{ readonly [Key in keyof Fields]: EquivalenceOf<Fields[Key]> }>;
}

/**
 * The equivalence laws, checked against a sample set.
 *
 * An `Equivalence` must be reflexive (`a ~ a`), symmetric (`a ~ b` implies
 * `b ~ a`), and transitive (`a ~ b` and `b ~ c` imply `a ~ c`). Absence means
 * every sample obeys them; a present value describes the first violation.
 * Transitivity is checked over every triple, so keep sample sets small.
 */
function checkLaws<T>(equivalence: Equivalence<T>, samples: readonly T[]): Optional<string> {
  const equals = requireEquivalence(equivalence, "Equivalence.checkLaws");
  if (!Array.isArray(samples)) panic("Equivalence.checkLaws requires an array of samples");

  for (let index = 0; index < samples.length; index += 1) {
    if (!equals(samples[index], samples[index])) return present(`not reflexive at sample ${index}`);
  }
  for (let left = 0; left < samples.length; left += 1) {
    for (let right = 0; right < samples.length; right += 1) {
      if (equals(samples[left], samples[right]) !== equals(samples[right], samples[left])) {
        return present(`not symmetric for samples ${left} and ${right}`);
      }
    }
  }
  for (let a = 0; a < samples.length; a += 1) {
    for (let b = 0; b < samples.length; b += 1) {
      if (!equals(samples[a], samples[b])) continue;
      for (let c = 0; c < samples.length; c += 1) {
        if (equals(samples[b], samples[c]) && !equals(samples[a], samples[c])) {
          return present(`not transitive for samples ${a}, ${b}, and ${c}`);
        }
      }
    }
  }
  return absent();
}

export const Equivalence = Object.freeze({
  make,
  isEquivalence,
  /** SameValueZero: `NaN` equals `NaN`, `-0` equals `+0`. */
  number: numberEquivalence,
  string: stringEquivalence,
  boolean: booleanEquivalence,
  /** `Object.is`, for when identity is the point and `-0` must stay distinct. */
  reference: referenceEquivalence,
  /** Structural where a registered rule matches, SameValueZero for primitives, reference otherwise. */
  any: anyEquivalence,
  tuple,
  array,
  struct,
  checkLaws,
});
