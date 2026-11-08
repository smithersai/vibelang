// Pattern matching (VIP-7). The compiler parses `match (x) { when P: v; }`,
// `async match` and `x is P`, the TC39 pattern matching proposal pinned in
// docs/design/vips/tc39-pattern-matching, into plain tests that TypeScript
// narrows; these helpers are the tests it cannot write inline.
//
// A variable pattern calls $is, an extractor pattern with an argument list
// that the compiler does not know calls $extract, an object pattern's rest
// calls $rest, a relational pattern other than === and !== calls $relation,
// and a match without a default arm that no arm matched calls $noMatch. The
// last arm of an exhaustive match that tests a class or a custom matcher
// calls $assertMatch. $patternError marks a pattern VibeLang does not
// support; the compiler reports it, so it never runs in a program that
// compiled.

/**
 * The proposal's `Symbol.customMatcher`: a static method that decides whether
 * a subject matches. `x is M` tests its result for truthiness; an extractor
 * pattern `M(...)` accepts `false` or an iterable object of extracted values. The runtime
 * defines `Symbol.customMatcher` when the engine lacks it, as the registered
 * symbol the proposal's polyfills use, so every copy of the runtime agrees.
 * Like a well-known symbol it is non-writable, non-enumerable and
 * non-configurable; an engine's own symbol is kept (008-runtime.md, Matcher
 * symbol initialization).
 */
if ((Symbol as any).customMatcher === undefined) {
  Object.defineProperty(Symbol, "customMatcher", { value: Symbol.for("Symbol.customMatcher") })
}
export const customMatcher: typeof Symbol.customMatcher = (Symbol as any).customMatcher

// Public matcher-bearing declarations reference this module through the
// runtime package, including when a stock consumer has no VibeLang prelude.
declare global {
  interface SymbolConstructor {
    readonly customMatcher: unique symbol
  }
}

/** The generated matchers of error declarations, which their subclasses share (D278). */
const errorMatchers = new WeakSet<object>()

/** Records matcher as an error declaration's generated matcher. */
export function $registerErrorMatcher<F extends Function>(matcher: F): F {
  errorMatchers.add(matcher)
  return matcher
}

/**
 * The matcher that decides for value. A class uses its own, not one a superclass
 * declares (chapter 004, decided details 67 and 93): `class B extends A {}` tests
 * instanceof. An error family's generated matcher is the exception, because it tests
 * the subject's tag and every subclass of the family is written against it.
 */
function matcherOf(value: unknown, ownClassOnly = false): Function | undefined {
  if (value === null || value === undefined) return undefined
  // Generated class patterns follow the own-matcher rule before reading the
  // property. The legacy ABI path retains registered error-family lookup.
  if (ownClassOnly) {
    if (typeof value === "function" && !Object.hasOwn(value, customMatcher)) return undefined
    // An own undefined value uses the draft's identity default, rather than
    // the ordinary-class instanceof fallback selected for an absent property.
    const custom = (value as any)[customMatcher]
    if (typeof value === "function" && custom === undefined) return undefinedOwnClassMatcher
    // Reflect.apply below performs the native callable check for other values.
    return custom
  }
  const custom = (value as any)[customMatcher]
  if (typeof custom !== "function") return undefined
  if (typeof value === "function" && !Object.hasOwn(value, customMatcher) && !errorMatchers.has(custom)) return undefined
  return custom
}

function undefinedOwnClassMatcher(this: unknown, subject: unknown, hint: MatchHint): boolean {
  if (hint.matchType === "extractor") throw new TypeError()
  return subject === this
}

/** The hint a custom matcher receives as its second argument. */
export interface MatchHint {
  readonly matchType: "boolean" | "extractor"
}

/**
 * A value with a custom matcher whose extraction yields R. The matcher is a
 * method, so one that declares only the hint it handles, such as
 * `{ matchType: "extractor" }`, still counts.
 */
export interface CustomMatcher<R = unknown> {
  [customMatcher](subject: any, hint: MatchHint, receiver?: unknown): R
}

const primitiveTypes = new Map<unknown, string>([
  [String, "string"],
  [Number, "number"],
  [Boolean, "boolean"],
  [BigInt, "bigint"],
  [Symbol, "symbol"]
])

// VIP-7, detail 67a: Date follows the current native prototype chain.
function dateMatches(subject: unknown): boolean {
  return subject instanceof Date
}

// Array follows the class adaptation's Array.isArray test (D67a).
// Keep main's Date internal-slot check; other constructors retain instanceof.
const builtinTests = new Map<unknown, (subject: unknown) => boolean>([
  [Array, subject => Array.isArray(subject)],
  [Date, dateMatches]
])

/**
 * The proposal's `RegExp.prototype[Symbol.customMatcher]` for an extractor:
 * the match in a one-element array, or every match of a global expression,
 * or false when nothing matches.
 */
function regExpExtract(regexp: RegExp, subject: unknown): ReadonlyArray<RegExpMatchArray> | false {
  if (String(regexp.flags).includes("g")) {
    const all = Array.from((regexp as any)[Symbol.matchAll](subject) as Iterable<RegExpMatchArray>)
    return all.length === 0 ? false : all
  }
  const result = (regexp as any)[Symbol.match](subject) as RegExpMatchArray | null
  return result === null ? false : [result]
}

/**
 * The proposal's test for a built-in matcher, which the engine does not yet
 * define as a custom matcher: a regular expression, a primitive's class, a
 * constructor with a dedicated test. Undefined for any
 * other matcher.
 */
function builtinTest(matcher: unknown, subject: unknown): boolean | undefined {
  if (matcher instanceof RegExp) return !!matcher.test(subject as string)
  const primitive = primitiveTypes.get(matcher)
  if (primitive !== undefined) return typeof subject === primitive || subject instanceof (matcher as any)
  const test = builtinTests.get(matcher)
  if (test !== undefined) return test(subject)
  return undefined
}

/**
 * Reports whether f is a class: written with class syntax, or a constructor
 * with methods on its prototype (a built-in such as Date or Map). Other
 * functions are predicates.
 */
function isClass(f: Function): boolean {
  if (/^class[\s{]/.test(Function.prototype.toString.call(f))) return true
  const prototype = (f as any).prototype
  return prototype !== undefined && prototype !== null && Object.getOwnPropertyNames(prototype).length > 1
}

/** SameValue, except that the pattern 0 matches -0 (SameValueZero for an unsigned zero). */
function sameValue(pattern: unknown, subject: unknown): boolean {
  return pattern === 0 ? subject === 0 : Object.is(pattern, subject)
}

/**
 * Tests a variable pattern: a custom matcher decides when the value has one;
 * a primitive's class tests typeof or its boxed constructor; another class tests instanceof; another
 * function is called as a predicate; any other value matches by SameValue.
 *
 * A predicate's and an extractor's subject parameter is the inferred S, not
 * any: TypeScript tries overloads by subtype first, where any is no subtype
 * of a parameter typed string | number, and the value overload would then
 * take the function and narrow the subject to it.
 */
export function $is<C extends abstract new(...args: any) => any>(matcher: C, subject: unknown, receiver?: unknown): subject is InstanceType<C>
export function $is<S, T extends S>(matcher: (subject: S, hint: MatchHint) => subject is T, subject: unknown, receiver?: unknown): subject is T
export function $is<S>(matcher: CustomMatcher | ((subject: S, hint: MatchHint) => unknown) | RegExp, subject: unknown, receiver?: unknown): boolean
export function $is<const T>(matcher: T, subject: unknown, receiver?: unknown): subject is T
export function $is(matcher: unknown, subject: unknown, receiver: unknown = null, ownClassOnly = false, dispatch: "" | "call" | "construct" = ""): boolean {
  if (matcher !== null && (typeof matcher === "object" || typeof matcher === "function")) {
    const custom = matcherOf(matcher, ownClassOnly)
    if (custom !== undefined) return !!Reflect.apply(custom, matcher, [subject, { matchType: "boolean" }, receiver])
    const builtin = builtinTest(matcher, subject)
    if (builtin !== undefined) return builtin
    if (typeof matcher === "function") {
      return (dispatch === "construct" || dispatch === "" && isClass(matcher))
        ? subject instanceof (matcher as any)
        : !!Reflect.apply(matcher, receiver, [subject, { matchType: "boolean" }])
    }
  }
  return sameValue(matcher, subject)
}

/** The values an extractor pattern with a custom matcher returning R matches against. */
export type Extracted<R> = R extends false ? false
  : R extends true ? readonly []
  : R extends ReadonlyArray<any> ? R
  : R extends Iterable<infer X> ? ReadonlyArray<X>
  : ReadonlyArray<unknown>

/** The list `Array(...)` matches against: the array members of the subject's type. */
export type ArrayExtraction<S> = unknown extends S ? ReadonlyArray<unknown> : Extract<S, ReadonlyArray<unknown>>

/** A typed array's constructor. */
interface TypedArrayClass<T> {
  readonly BYTES_PER_ELEMENT: number
  new(...args: Array<any>): T
}

const typedArray = Object.getPrototypeOf(Uint8Array)

// VIP-7 built-in adapters extract the subject. Ordinary constructors instead
// recognize with a boolean, which is not a valid successful extractor result.
const instanceExtractors = new Set<unknown>([
  Object, Function, Map, Set, WeakMap, WeakSet, WeakRef, FinalizationRegistry, RegExp, Promise,
  Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError,
  AggregateError, ArrayBuffer, DataView,
  ...(typeof SharedArrayBuffer === "function" ? [SharedArrayBuffer] : [])
])

/** The list a matcher or a call-only extractor returned, or false. */
function extractedList(result: unknown): ReadonlyArray<any> | false {
  if (result === false) return false
  if (Array.isArray(result)) return result
  if (result !== null && (typeof result === "object" || typeof result === "function")) return [...result as Iterable<unknown>]
  throw new TypeError("A matcher used as an extractor must return false or an iterable object")
}

// Constructor types are structural: a parameter can hold a primitive
// constructor even when its construct signature describes only the box.
type PrimitiveForConstructor<C> =
  | (typeof String extends C ? string : never)
  | (typeof Number extends C ? number : never)
  | (typeof Boolean extends C ? boolean : never)
  | (typeof BigInt extends C ? bigint : never)
  | (typeof Symbol extends C ? symbol : never)

type PrimitiveConstructor = typeof String | typeof Number | typeof Boolean | typeof BigInt | typeof Symbol
type BoxForConstructor<C> =
  | (typeof String extends C ? String : never)
  | (typeof Number extends C ? Number : never)
  | (typeof Boolean extends C ? Boolean : never)
  | (typeof BigInt extends C ? BigInt : never)
  | (typeof Symbol extends C ? Symbol : never)


/**
 * Runs an extractor pattern's matcher: its values, or false when it does not
 * match. `Array` and a typed array list the subject's elements; another class
 * with a built-in adapter extracts the instance itself, so `Map(let m)` binds
 * the map. An ordinary class throws TypeError after recognizing the subject;
 * a function that is no class is called with the matcher's hint.
 */
// A global regular expression literal: the compiler passes its flag as the
// type argument, and the list holds matchAll's elements, RegExpExecArray
// (Chapter 004, Typing). Without that argument the subject parameter is never,
// so the overload never applies, and a RegExp value or a non-global literal
// extracts one RegExpMatchArray below.
export function $extract<F extends "g" = never>(matcher: RegExp, subject: [F] extends [never] ? never : unknown, receiver?: unknown): ReadonlyArray<RegExpExecArray> | false
export function $extract<S>(matcher: ArrayConstructor, subject: S, receiver?: unknown): ArrayExtraction<S> | false
// Infer the constructor itself: inferring its result can lose the BigInt
// constructors to the generic class overload during subtype selection.
export function $extract<C extends TypedArrayClass<unknown>>(matcher: C, subject: unknown, receiver?: unknown): InstanceType<C> | false
export function $extract<T>(matcher: TypedArrayClass<T>, subject: unknown, receiver?: unknown): T | false
export function $extract<R>(matcher: CustomMatcher<R>, subject: unknown, receiver?: unknown): Extracted<R> | false
export function $extract(matcher: RegExp, subject: unknown, receiver?: unknown): ReadonlyArray<RegExpMatchArray> | false
export function $extract<C extends abstract new(...args: any) => any>(matcher: C, subject: unknown, receiver?: unknown): readonly [InstanceType<C> | PrimitiveForConstructor<C>] | false
export function $extract<C extends PrimitiveConstructor>(matcher: C, subject: unknown, receiver?: unknown): readonly [PrimitiveForConstructor<C> | BoxForConstructor<C>] | false
export function $extract<S, R>(matcher: (subject: S, hint: MatchHint) => R, subject: unknown, receiver?: unknown): Extracted<R> | false
export function $extract(matcher: unknown, subject: unknown, receiver?: unknown): ReadonlyArray<any> | false
export function $extract(matcher: unknown, subject: unknown, receiver: unknown = null, ownClassOnly = false, dispatch: "" | "call" | "construct" = ""): unknown {
  const custom = matcherOf(matcher, ownClassOnly)
  if (custom !== undefined) return extractedList(Reflect.apply(custom, matcher, [subject, { matchType: "extractor" }, receiver]))
  if (matcher instanceof RegExp) return regExpExtract(matcher, subject)
  if (typeof matcher === "function") {
    if (matcher === Array) return Array.isArray(subject) ? subject : false
    if (Object.getPrototypeOf(matcher) === typedArray) return subject instanceof (matcher as any) ? subject : false
    const builtin = builtinTest(matcher, subject)
    if (builtin !== undefined) {
      if (!builtin) return false
      const primitive = primitiveTypes.get(matcher)
      return [primitive !== undefined && typeof subject !== primitive ? (subject as { valueOf(): unknown }).valueOf() : subject]
    }
    if (dispatch === "construct" || dispatch === "" && isClass(matcher)) {
      if (!(subject instanceof (matcher as any))) return false
      if (instanceExtractors.has(matcher)) return [subject]
      throw new TypeError("An ordinary class used as an extractor must return an object")
    }
    return extractedList(Reflect.apply(matcher, receiver, [subject, { matchType: "extractor" }]))
  }
  if (ownClassOnly) throw new TypeError()
  throw new TypeError("An extractor pattern needs a class, a regular expression, or a value with a Symbol.customMatcher method")
}

/** The own enumerable properties of an object pattern's subject that its clauses do not name. */
export function $rest<T, K extends PropertyKey>(subject: T, keys: ReadonlyArray<K>): Omit<T, K> {
  const result: Record<PropertyKey, unknown> = {}
  const excluded = new Set<PropertyKey>(keys.map(key => typeof key === "number" ? String(key) : key))
  for (const key of Reflect.ownKeys(subject as object)) {
    if (!excluded.has(key) && Object.prototype.propertyIsEnumerable.call(subject, key)) {
      // Object rest creates data properties, including a literal __proto__.
      Object.defineProperty(result, key, {
        value: (subject as any)[key], enumerable: true, configurable: true, writable: true
      })
    }
  }
  return result as Omit<T, K>
}

/**
 * Tells whether a relational pattern admits its subject, which the proposal's
 * RelationalPatternMatches checks before it evaluates the operand (VIP-7):
 * `<`, `>`, `<=` and `>=` admit a string, a number or a bigint, and `in` a
 * property key. The compiler tests it first, so an operand such as a getter
 * does not run for any other subject.
 */
export function $relates(operator: "<" | ">" | "<=" | ">=" | "in", subject: unknown): boolean {
  if (operator === "in") return typeof subject === "string" || typeof subject === "symbol"
  return typeof subject === "string" || typeof subject === "number" || typeof subject === "bigint"
}

/**
 * Tests a relational pattern that the compiler does not write as its
 * operator (VIP-7): `< v`, `> v`, `<= v` and `>= v` are false unless the
 * subject is a string, a number or a bigint, and `in v` is false unless the
 * subject is a property key and v an object, as the proposal's
 * RelationalPatternMatches says.
 */
export function $relation(operator: "<" | ">" | "<=" | ">=" | "in", subject: unknown, value: unknown): boolean {
  if (!$relates(operator, subject)) return false
  if (operator === "in") {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return false
    return (subject as PropertyKey) in (value as object)
  }
  const s = subject as any
  const v = value as any
  switch (operator) {
    case "<":
      return s < v
    case ">":
      return s > v
    case "<=":
      return s <= v
    case ">=":
      return s >= v
  }
}

/** Ends a match without a default arm that no arm matched, as the proposal's TypeError does. */
export function $noMatch(subject: unknown): never {
  throw new TypeError()
}

/**
 * Tests the last arm of a match that D209 proves exhaustive when one of its
 * arms tests a class or a custom matcher, whose result a value's type does
 * not prove (D294): returns when the arm's test passed, and otherwise ends the
 * match as $noMatch does. The compiler writes it in place of the arm's if, so
 * the test adds no branch to the program.
 */
export function $assertMatch(matched: unknown, subject: unknown): void {
  if (!matched) $noMatch(subject)
}

/** A pattern VibeLang does not support; the compiler reports it (EK4702-EK4704 and EK0707). */
export function $patternError(_code: number, _detail?: string): boolean {
  throw new TypeError("This pattern is not supported")
}

/**
 * Compiler ABI: a binding pattern that runs again for a name one top-level
 * pattern already initialized, outside an or's replacement of a failed
 * alternative's binding (VIP-7).
 */
export function $duplicateBinding(name: string): never {
  throw new ReferenceError(`Cannot initialize the pattern binding ${name} twice`)
}

const createBindingSentinel = Symbol

/** Compiler ABI: create a private identity for one compiled module's TDZ. */
export function $uninitializedBinding(): symbol {
  return createBindingSentinel("uninitialized pattern binding")
}

/** Compiler ABI: GetValue of a lexical pattern binding (VIP-7). */
export function $readBinding<T>(value: T, uninitialized: symbol): T {
  if (value === uninitialized) throw new ReferenceError("Cannot access an uninitialized pattern binding")
  return value
}

/** Compiler ABI: preserve native GetValue/PutValue ordering for source writes. */
export function $bindingReference<T>(read: () => T, write: (value: T) => void, constant: boolean, uninitialized: symbol): { value: T } {
  return {
    get value() { return $readBinding(read(), uninitialized) },
    set value(value: T) {
      $readBinding(read(), uninitialized)
      if (constant) throw new TypeError("Assignment to constant pattern binding")
      write(value)
    }
  }
}
