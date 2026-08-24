/**
 * `Match`: value-level pattern matching, as an ordinary library.
 *
 * The standard library lists `Match` under "Core Data"
 * (docs/src/pages/reference/standard-library.mdx). This module is that entry,
 * and it is deliberately **library-only**: `Match.value(x).when(...).exhaustive()`
 * is a chain of ordinary method calls on ordinary values, with no new grammar
 * behind it. That is the locked position in docs/DECISIONS.md — "Smithers owns
 * expression-form control-flow grammar while leaving future pattern-matching
 * syntax room to converge with TC39" — so the useful thing to build today is the
 * *semantics*: what a pattern is, what it narrows to, and what it takes to prove
 * a match is total. If syntax arrives later it can lower to exactly this, and if
 * TC39 ships something different this library keeps working unchanged.
 *
 * **This API is provisional**, like the rest of `poc/src/data`. Names and
 * signatures may move. What is meant to survive is the shape: a fluent,
 * immutable, unforgeable builder; first-match-wins; handlers that do not run
 * until a terminal is called; and exhaustiveness that is checked by the *type
 * system* rather than discovered at runtime.
 *
 * ```ts
 * const area = Match.value(shape)
 *   .whenTag("circle", (c) => Math.PI * c.radius ** 2)
 *   .whenTag("square", (s) => s.side ** 2)
 *   .exhaustive();
 * ```
 *
 * ## What a pattern is
 *
 * `.when(pattern, handler)` accepts three kinds of pattern, told apart at
 * runtime by what the value *is*, never by a tag the caller has to write:
 *
 * - A **function** is a predicate. `(value) => boolean` filters; a TypeScript
 *   type guard `(value) => value is T` also narrows the handler's parameter and
 *   subtracts `T` from what is left to cover. `Match.any`, `Match.string`,
 *   `Match.number`, and `Match.boolean` are guards of this kind.
 * - A **plain object or plain array** is a structural template, matched
 *   recursively: literal leaves compare, predicate leaves run, nested plain
 *   objects recurse, and `Match.any` accepts anything.
 * - **Anything else** is a literal, compared with `Data.equals`: SameValueZero
 *   for primitives (so `NaN` matches `NaN` and `-0` matches `0`), structural
 *   for `Data`/`Chunk`/`HashMap`/`HashSet` values, and by reference for
 *   everything else.
 *
 * The plain/branded split is the one rule to remember: `{ kind: "circle" }` is a
 * *template* (match this field, ignore the rest), while
 * `Data.struct({ kind: "circle" })` is a *value* (be equal to this, in whole).
 *
 * ## Policies, all deliberate
 *
 * - **Object templates match subsets.** `{ kind: "circle" }` matches any object
 *   whose `kind` is `"circle"`, whatever else it carries. Extra keys on the
 *   subject are ignored, which is what makes one template usable against a
 *   widening record type — the same policy `Equivalence.struct` already takes
 *   for the fields it compares. The empty template `{}` therefore matches every
 *   object.
 * - **Array templates match exactly.** An array template requires an array of
 *   the same length, because a positional template that matched a prefix would
 *   silently accept the wrong tuple. Use a predicate leaf for anything looser.
 * - **`"kind"` is the default discriminant.** `.whenTag(tag, handler)` reads
 *   `kind`; `.whenTagOn(key, tag, handler)` reads any other property.
 * - **First match wins**, arms are tried in the order they were added, and a
 *   handler runs only when a terminal (`.exhaustive()` or `.run()`) is called.
 * - **The builder is immutable.** Every arm returns a new frozen matcher, so a
 *   partially built matcher can be shared and extended two different ways.
 *
 * ## Exhaustiveness
 *
 * `.exhaustive()` is not a runtime check that panics late; it is a property
 * whose *type* is only callable once the arms have consumed the whole scrutinee
 * union. The builder threads a `Remaining` type parameter that starts as the
 * scrutinee's type and shrinks with each arm that can prove coverage — a type
 * guard, a literal, a tag, a class, a fully literal template, or a
 * `Result` variant arm. When `Remaining` is `never`, `.exhaustive`
 * is `() => Output`. When it is not, `.exhaustive` is an object type whose
 * single property name spells out the problem and which has no call signature,
 * so `.exhaustive()` fails to compile.
 *
 * A pattern subtracts a case only when matching it at runtime provably covers
 * that case, which is why a pattern whose leaves are not *single literals*
 * proves nothing: `.whenTag(someStringVariable, ...)` matches one value at
 * runtime but would look assignable-from every member, so allowing it to
 * subtract would turn a proved `.exhaustive()` into a late panic.
 *
 * The honest limits are recorded as type tests next door: a bare predicate
 * proves nothing, a template with a predicate leaf proves nothing, array
 * templates do not refine at the type level, two *unbranded* Error classes of
 * the same shape cannot be told apart by TypeScript (see `NominalError`), and a
 * type guard is trusted the way TypeScript's own `if`/`else` narrowing trusts
 * one — a guard that answers `false` for a value of the type it claims will
 * still have subtracted that type, and the runtime says so with a panic.
 * `.run()` is the terminal for everything the type system cannot prove: it
 * requires an `.orElse(handler)` fallback, and so is total by construction
 * rather than by proof.
 */

import { type ErrorConstructor, errorIs } from "../runtime/errors.ts";
import { panic } from "../runtime/panic.ts";
import { type Result, type ResultValue, isResult } from "../runtime/result.ts";
import { Data, isData } from "./data.ts";
import { sameValueZero } from "./equivalence.ts";

/** How deep a structural template may nest before it is treated as a mistake. */
const MAX_TEMPLATE_DEPTH = 32;

// ---------------------------------------------------------------------------
// The scrutinee's case union
// ---------------------------------------------------------------------------

declare const okBrand: unique symbol;
declare const failureBrand: unique symbol;

/**
 * The two case markers are type-level only: no value of these types is ever
 * constructed. They stand in for the variants of a `Result` scrutinee so that
 * `.whenOk()`/`.whenError()` can subtract a variant from what is left to cover,
 * exactly the way `.whenTag()` subtracts a member of a discriminated union.
 *
 * Absence needs no marker. A `T | undefined` scrutinee is an ordinary union, so
 * `.when(undefined, ...)` and a type guard already cover both of its members
 * (specification/type-system.mdx, "Absence").
 */
export interface OkCase<A> {
  readonly [okBrand]: A;
}
export interface FailureCase<E> {
  readonly [failureBrand]: E;
}

type AnyCase = OkCase<unknown> | FailureCase<Error>;

/**
 * What `Match.value(x)` starts out owing coverage for. A `Result` scrutinee
 * becomes its case union; everything else — `T | undefined` included — is
 * itself, and is matched as the ordinary union it is.
 *
 * The check is non-distributive (`[In] extends [...]`) on purpose: a union that
 * merely *contains* a `Result` is matched as an ordinary value, because
 * `.whenOk()` on it could not say which member it had unwrapped.
 */
export type Scrutinee<In> = [In] extends [ResultValue<infer A, infer E extends Error>]
  ? OkCase<A> | FailureCase<E>
  : In;

type OkOf<Remaining> = Remaining extends OkCase<infer A> ? A : never;
type FailureOf<Remaining> = Remaining extends FailureCase<infer E> ? E : never;

// ---------------------------------------------------------------------------
// Pattern types
// ---------------------------------------------------------------------------

/** The primitives a literal pattern may be. */
export type LiteralPattern = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Which literals `.when` will accept for the cases still outstanding.
 *
 * When the remaining union has literal members, only those are allowed — so a
 * literal arm that could never fire is a compile error rather than dead code.
 * When it has none (an object union, say), any literal is allowed and the arm
 * simply proves nothing.
 */
type LiteralPatternFor<Remaining> = [Extract<Remaining, LiteralPattern>] extends [never] ? LiteralPattern
  : Extract<Remaining, LiteralPattern>;

/** A structural template: a plain record or a plain tuple of leaf patterns. */
export type ShapePattern = { readonly [key: string]: unknown } | readonly unknown[];

/** The type a literal or class arm hands its handler, keeping `never` out of the signature. */
type NarrowTo<Remaining, Candidate> = [Extract<Remaining, Candidate>] extends [never] ? Candidate
  : Extract<Remaining, Candidate>;

/**
 * Refine one union member by a structural template, or drop it.
 *
 * A member is dropped (becomes `never`) when it lacks a key the template names,
 * or when any leaf refines to `never` — a literal leaf that cannot equal the
 * member's field, for instance. Array templates are passed through unrefined:
 * relating a positional template to a tuple type is more machinery than this
 * POC needs, and the runtime still checks it.
 */
type RefineMember<Member, Shape> = Shape extends readonly unknown[] ? Member
  : Member extends object ? keyof Shape extends keyof Member ? DropUninhabited<RefineFields<Member, Shape>> : never
  : never;

type RefineFields<Member, Shape> = {
  [Key in keyof Member]: Key extends keyof Shape ? RefineLeaf<Member[Key], Shape[Key]> : Member[Key];
};

type RefineLeaf<Field, Leaf> = Leaf extends (value: any) => value is infer Narrowed ? Field & Narrowed
  : Leaf extends (...args: readonly any[]) => unknown ? Field
  : Leaf extends object ? RefineMember<Field, Leaf>
  : Field & Leaf;

type DropUninhabited<Refined> = true extends
  { [Key in keyof Refined]-?: [Refined[Key]] extends [never] ? true : false }[keyof Refined] ? never
  : Refined;

/**
 * Whether a type is one concrete value rather than a whole domain. `"circle"`
 * is; `string` is not; `"low" | "high"` is not, because it stands for two.
 *
 * This is what keeps subtraction sound. A pattern only removes a case from
 * `Remaining` when matching it at runtime provably covers that case, and that
 * holds exactly when every leaf the pattern names is a single literal. A widened
 * pattern — `Data.struct({ kind: "a" })` has type `{ kind: string }`, and a
 * `const level: string` argument is just `string` — would otherwise *look*
 * assignable-from every member and subtract them all while matching only one
 * value at runtime, turning a proved `.exhaustive()` into a late panic.
 */
type IsSingleLiteral<Candidate> = [Candidate] extends [never] ? false
  : [Candidate] extends [null] ? true
  : [Candidate] extends [undefined] ? true
  : [Candidate] extends [string] ? ([string] extends [Candidate] ? false : NotAUnion<Candidate>)
  : [Candidate] extends [number] ? ([number] extends [Candidate] ? false : NotAUnion<Candidate>)
  : [Candidate] extends [bigint] ? ([bigint] extends [Candidate] ? false : NotAUnion<Candidate>)
  : [Candidate] extends [boolean] ? ([boolean] extends [Candidate] ? false : NotAUnion<Candidate>)
  : [Candidate] extends [symbol] ? ([symbol] extends [Candidate] ? false : NotAUnion<Candidate>)
  : false;

type NotAUnion<Candidate, Whole = Candidate> = Candidate extends unknown
  ? [Whole] extends [Candidate] ? true : false
  : never;

/** Every leaf a template names is a single literal, so matching it covers the case in full. */
type AllLeavesLiteral<Shape> = [keyof Shape] extends [never] ? false
  : Shape extends readonly unknown[] ? false
  : false extends { [Key in keyof Shape]-?: IsLiteralLeaf<Shape[Key]> }[keyof Shape] ? false
  : true;

type IsLiteralLeaf<Leaf> = Leaf extends readonly unknown[] ? false
  : Leaf extends (...args: readonly any[]) => unknown ? false
  : Leaf extends object ? AllLeavesLiteral<Leaf>
  : IsSingleLiteral<Leaf>;

type SubtractShape<Remaining, Shape> = AllLeavesLiteral<Shape> extends true ? Exclude<Remaining, Shape> : Remaining;

type SubtractLiteral<Remaining, Pattern> = IsSingleLiteral<Pattern> extends true ? Exclude<Remaining, Pattern> : Remaining;

type SubtractTag<Remaining, Key extends string, Tag> = IsSingleLiteral<Tag> extends true
  ? Exclude<Remaining, Record<Key, Tag>>
  : Remaining;

/** What `.orElse` hands its handler: the outstanding cases, or the whole input for a variant scrutinee. */
type FallbackParam<Input, Remaining> = [Remaining] extends [AnyCase] ? Input : Remaining;

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

/**
 * The uncallable stand-in for `.exhaustive` while cases are outstanding.
 *
 * The property name is the diagnostic: TypeScript prints this type in the
 * "has no call signatures" error, so the reader sees both the complaint and the
 * union that is still uncovered.
 */
export interface NonExhaustive<Remaining> {
  readonly "Match.exhaustive() is unavailable while these cases are unhandled": Remaining;
}

/** The uncallable stand-in for `.run` until `.orElse(handler)` supplies a fallback. */
export interface NeedsFallback {
  readonly "Match.run() is unavailable until .orElse(handler) supplies a fallback": true;
}

type ExhaustiveTerminal<Remaining, Output> = [Remaining] extends [never] ? () => Output : NonExhaustive<Remaining>;

type RunTerminal<Fallback extends boolean, Output> = Fallback extends true ? () => Output : NeedsFallback;

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

interface Arm {
  /** Does this arm claim the scrutinee? Never runs the handler. */
  readonly matches: (subject: unknown) => boolean;
  /** Runs the handler over whatever this arm projects out of the scrutinee. */
  readonly invoke: (subject: unknown) => unknown;
}

interface MatcherState {
  readonly scrutinee: unknown;
  readonly arms: readonly Arm[];
  readonly fallback: boolean;
}

const states = new WeakMap<object, MatcherState>();
const localMatchers = new WeakSet<object>();

function stateOf(matcher: object): MatcherState {
  const state = states.get(matcher);
  if (state === undefined || !localMatchers.has(matcher)) panic("forged Match value");
  return state;
}

export function isMatcher(value: unknown): boolean {
  return typeof value === "object" && value !== null && localMatchers.has(value);
}

function requireHandler(handler: unknown, caller: string): (value: never) => unknown {
  if (typeof handler !== "function") panic(`${caller} requires a handler function`);
  return handler as (value: never) => unknown;
}

/** Every arm goes through here, so immutability and the "orElse is last" rule hold everywhere. */
function extend(matcher: object, arm: Arm, fallback: boolean): unknown {
  const state = stateOf(matcher);
  if (state.fallback) panic("Match.orElse must be the last arm");
  return new LocalMatcher({
    scrutinee: state.scrutinee,
    arms: Object.freeze([...state.arms, arm]),
    fallback: state.fallback || fallback,
  });
}

function unreachable(): never {
  panic("Match arm ran against the wrong variant");
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Is this value a structural template rather than a value to be equal to?
 *
 * Only *unbranded* plain objects and plain arrays are templates. A `Data` value
 * is a value: it has structural equality of its own, and reading it as a subset
 * template would quietly discard the fields the author wrote down.
 */
function isTemplate(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  if (typeof value !== "object" || value === null) return false;
  if (isData(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (Array.isArray(value)) return prototype === Array.prototype;
  return prototype === Object.prototype || prototype === null;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Walks a template once, at `.when()` time, so a cyclic or absurdly deep
 * template is a loud programming error at the call site instead of a hang
 * inside a terminal.
 */
function assertTemplate(template: unknown, pending: Set<object>, depth: number): void {
  if (!isTemplate(template)) return;
  if (depth > MAX_TEMPLATE_DEPTH) panic("Match pattern exceeds the template depth limit");
  const node = template as object;
  if (pending.has(node)) panic("Match patterns must be acyclic");
  pending.add(node);
  try {
    const leaves = Array.isArray(template) ? template : Object.keys(template).map((key) => (template as Record<string, unknown>)[key]);
    for (const leaf of leaves) assertTemplate(leaf, pending, depth + 1);
  } finally {
    pending.delete(node);
  }
}

function templateMatches(subject: unknown, template: Record<string, unknown> | readonly unknown[]): boolean {
  if (Array.isArray(template)) {
    if (!Array.isArray(subject) || subject.length !== template.length) return false;
    for (let index = 0; index < template.length; index += 1) {
      if (!leafMatches((subject as readonly unknown[])[index], template[index])) return false;
    }
    return true;
  }
  if (!isObjectLike(subject)) return false;
  const fields = template as Record<string, unknown>;
  // Subset matching: only the keys the template names are constrained.
  for (const key of Object.keys(fields)) {
    if (!(key in subject)) return false;
    if (!leafMatches(subject[key], fields[key])) return false;
  }
  return true;
}

function leafMatches(subject: unknown, pattern: unknown): boolean {
  if (typeof pattern === "function") {
    const verdict = (pattern as (value: unknown) => unknown)(subject);
    if (typeof verdict !== "boolean") panic("a Match predicate must return a boolean");
    return verdict;
  }
  if (isTemplate(pattern)) return templateMatches(subject, pattern);
  // SameValueZero for primitives; `Data.equals` adds the structural rules for
  // branded values and falls back to reference equality for everything else.
  return sameValueZero(subject, pattern) || Data.equals(subject, pattern);
}

function safeInstanceOf(value: unknown, type: Function): boolean {
  try {
    return Boolean(Function.prototype[Symbol.hasInstance].call(type, value));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * A matcher under construction.
 *
 * - `Input` is the scrutinee's own type, which `.orElse` hands back.
 * - `Remaining` is what the arms have not yet covered; `.exhaustive()` unlocks
 *   when it reaches `never`.
 * - `Output` accumulates the handlers' return types, and is what a terminal
 *   answers with.
 * - `Fallback` records whether `.orElse` has supplied one, which is what
 *   `.run()` requires.
 */
export abstract class MatcherValue<Input, Remaining, Output, Fallback extends boolean> {
  /**
   * Match a pattern. The overloads below are the four pattern kinds, in the
   * order TypeScript resolves them: a type guard (narrows and proves coverage),
   * a bare predicate (filters, proves nothing), a structural template, and a
   * value compared with `Data.equals` — a primitive literal, or any other
   * object, `Data` value, `Chunk`, or class instance.
   *
   * First match wins, and no handler runs until a terminal is called.
   */
  when<Narrowed extends Remaining, R>(
    guard: (value: Remaining) => value is Narrowed,
    handler: (value: Narrowed) => R,
  ): Matcher<Input, Exclude<Remaining, Narrowed>, Output | R, Fallback>;
  when<R>(
    predicate: (value: Remaining) => boolean,
    handler: (value: Remaining) => R,
  ): Matcher<Input, Remaining, Output | R, Fallback>;
  when<const Shape extends ShapePattern, R>(
    shape: Shape,
    handler: (value: RefineMember<Remaining, Shape>) => R,
  ): Matcher<Input, SubtractShape<Remaining, Shape>, Output | R, Fallback>;
  when<const Pattern extends LiteralPatternFor<Remaining>, R>(
    literal: Pattern,
    handler: (value: NarrowTo<Remaining, Pattern>) => R,
  ): Matcher<Input, SubtractLiteral<Remaining, Pattern>, Output | R, Fallback>;
  when<Value extends object, R>(
    value: Value,
    handler: (value: NarrowTo<Remaining, Value>) => R,
  ): Matcher<Input, Remaining, Output | R, Fallback>;
  when(pattern: unknown, handler: unknown): unknown {
    const body = requireHandler(handler, "Match.when");
    assertTemplate(pattern, new Set(), 0);
    return extend(this as object, {
      matches: (subject) => leafMatches(subject, pattern),
      invoke: (subject) => body(subject as never),
    }, false);
  }

  /**
   * Match by class. Error classes route through the runtime's `errorIs`, so a
   * class that carries a `NominalError` brand narrows both branches — two
   * same-shaped Error classes are told apart by identity, not by shape.
   */
  whenInstanceOf<Class extends abstract new (...args: never[]) => object, R>(
    type: Class,
    handler: (value: NarrowTo<Remaining, InstanceType<Class>>) => R,
  ): Matcher<Input, Exclude<Remaining, InstanceType<Class>>, Output | R, Fallback> {
    const body = requireHandler(handler, "Match.whenInstanceOf");
    if (typeof type !== "function") panic("Match.whenInstanceOf requires a class");
    return extend(this as object, {
      matches: (subject) => errorIs(subject, type as unknown as ErrorConstructor) || safeInstanceOf(subject, type),
      invoke: (subject) => body(subject as never),
    }, false) as Matcher<Input, Exclude<Remaining, InstanceType<Class>>, Output | R, Fallback>;
  }

  /** Match a discriminated-union member by its `kind`. */
  whenTag<const Tag extends LiteralPattern, R>(
    tag: Tag,
    handler: (value: NarrowTo<Remaining, Record<"kind", Tag>>) => R,
  ): Matcher<Input, SubtractTag<Remaining, "kind", Tag>, Output | R, Fallback> {
    return this.whenTagOn("kind", tag, handler);
  }

  /** `whenTag` over a discriminant other than `kind` — `_tag`, `type`, `status`. */
  whenTagOn<const Key extends string, const Tag extends LiteralPattern, R>(
    key: Key,
    tag: Tag,
    handler: (value: NarrowTo<Remaining, Record<Key, Tag>>) => R,
  ): Matcher<Input, SubtractTag<Remaining, Key, Tag>, Output | R, Fallback> {
    const body = requireHandler(handler, "Match.whenTag");
    if (typeof key !== "string") panic("Match.whenTagOn requires a string discriminant");
    return extend(this as object, {
      matches: (subject) => isObjectLike(subject) && key in subject && sameValueZero(subject[key], tag),
      invoke: (subject) => body(subject as never),
    }, false) as Matcher<Input, SubtractTag<Remaining, Key, Tag>, Output | R, Fallback>;
  }

  /** The success branch of a `Result` scrutinee, handed the value inside. */
  whenOk<R>(handler: (value: OkOf<Remaining>) => R): Matcher<Input, Exclude<Remaining, OkCase<unknown>>, Output | R, Fallback> {
    const body = requireHandler(handler, "Match.whenOk");
    const scrutinee = stateOf(this as object).scrutinee;
    if (!isResult(scrutinee)) panic("Match.whenOk requires a Result scrutinee");
    return extend(this as object, {
      matches: (subject) => (subject as Result<unknown, Error>).isOk(),
      invoke: (subject) =>
        (subject as Result<unknown, Error>).match({ ok: (value) => body(value as never), error: unreachable }),
    }, false) as Matcher<Input, Exclude<Remaining, OkCase<unknown>>, Output | R, Fallback>;
  }

  /** The failure branch of a `Result` scrutinee, handed the Error inside. */
  whenError<R>(
    handler: (error: FailureOf<Remaining>) => R,
  ): Matcher<Input, Exclude<Remaining, FailureCase<Error>>, Output | R, Fallback> {
    const body = requireHandler(handler, "Match.whenError");
    const scrutinee = stateOf(this as object).scrutinee;
    if (!isResult(scrutinee)) panic("Match.whenError requires a Result scrutinee");
    return extend(this as object, {
      matches: (subject) => (subject as Result<unknown, Error>).isError(),
      invoke: (subject) =>
        (subject as Result<unknown, Error>).match({ ok: unreachable, error: (error) => body(error as never) }),
    }, false) as Matcher<Input, Exclude<Remaining, FailureCase<Error>>, Output | R, Fallback>;
  }

  /**
   * The fallback. It must be the last arm — adding another after it panics,
   * because that arm could never run — and it is what `.run()` requires.
   */
  orElse<R>(handler: (value: FallbackParam<Input, Remaining>) => R): Matcher<Input, never, Output | R, true> {
    const body = requireHandler(handler, "Match.orElse");
    return extend(this as object, {
      matches: () => true,
      invoke: (subject) => body(subject as never),
    }, true) as Matcher<Input, never, Output | R, true>;
  }

  /**
   * Terminal. Callable only once the arms cover the whole scrutinee union;
   * until then its type is {@link NonExhaustive}, which has no call signature.
   */
  declare readonly exhaustive: ExhaustiveTerminal<Remaining, Output>;

  /** Terminal for a matcher that ends in `.orElse(handler)`. Total by construction. */
  declare readonly run: RunTerminal<Fallback, Output>;

  get [Symbol.toStringTag](): string {
    return "Match";
  }
}

/** A matcher under construction. See {@link MatcherValue}. */
export type Matcher<Input, Remaining, Output, Fallback extends boolean = false> = MatcherValue<
  Input,
  Remaining,
  Output,
  Fallback
>;

class LocalMatcher<Input, Remaining, Output, Fallback extends boolean> extends MatcherValue<Input, Remaining, Output, Fallback> {
  constructor(state: MatcherState) {
    super();
    states.set(this, Object.freeze(state));
    localMatchers.add(this);
    Object.freeze(this);
  }
}

/**
 * The terminals live on the prototype rather than on each instance, so a forged
 * look-alike built from the prototype still panics on the brand check instead of
 * failing with a bare `TypeError`. Their *types* are declared as properties on
 * the class above, which is what lets `.exhaustive` disappear as a callable
 * while cases are outstanding.
 */
function terminate(matcher: object, proven: boolean): unknown {
  const state = stateOf(matcher);
  for (const arm of state.arms) {
    if (arm.matches(state.scrutinee) === true) return arm.invoke(state.scrutinee);
  }
  panic(
    proven
      ? "non-exhaustive Match: no arm matched the value"
      : "Match.run() found no arm and no fallback",
  );
}

for (const [name, proven] of [["exhaustive", true], ["run", false]] as const) {
  Object.defineProperty(MatcherValue.prototype, name, {
    value: function terminal(this: object): unknown {
      return terminate(this, proven);
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

// ---------------------------------------------------------------------------
// Entry points and built-in guards
// ---------------------------------------------------------------------------

/** Start a matcher over one value. Nothing runs until a terminal is called. */
function value<Input>(scrutinee: Input): Matcher<Input, Scrutinee<Input>, never, false> {
  return new LocalMatcher<Input, Scrutinee<Input>, never, false>({
    scrutinee,
    arms: Object.freeze([]),
    fallback: false,
  });
}

/** The wildcard. As an arm it covers everything that is left; as a leaf it accepts any field. */
function any<T>(subject: T): subject is T {
  void subject;
  return true;
}

function string(subject: unknown): subject is string {
  return typeof subject === "string";
}

function number(subject: unknown): subject is number {
  return typeof subject === "number";
}

function boolean(subject: unknown): subject is boolean {
  return typeof subject === "boolean";
}

export const Match = Object.freeze({
  value,
  any,
  string,
  number,
  boolean,
  isMatcher,
});
