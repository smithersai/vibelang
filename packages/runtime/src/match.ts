// Pattern matching (D206-D225). The compiler parses `match (x) { when P: v; }`
// and `x is P`, from the TC39 pattern matching proposal, into plain tests that
// TypeScript narrows; these helpers are the tests it cannot write inline.
//
// A variable pattern calls $is, an extractor pattern with an argument list
// that the compiler does not know calls $extract, an object pattern's rest
// calls $rest, and a match without a default arm that no arm matched calls
// $noMatch. The last arm of an exhaustive match that tests a class or a
// custom matcher calls $assertMatch. $patternError marks a pattern VibeLang
// does not support; the compiler reports it, so it never runs in a program
// that compiled.

/**
 * The proposal's `Symbol.customMatcher`: a static method that decides whether
 * a subject matches. It returns a boolean for `x is M`, and `false`, `true`,
 * or the extracted values for an extractor pattern `M(...)`.
 */
export const customMatcher: unique symbol = ((Symbol as any).customMatcher ?? Symbol.for("Symbol.customMatcher")) as any

/** The hint a custom matcher receives as its second argument. */
export interface MatchHint {
  readonly matchType: "boolean" | "extractor"
}

/** A value with a custom matcher whose extraction yields R. */
export interface CustomMatcher<R = unknown> {
  readonly [customMatcher]: (subject: any, hint: MatchHint) => R
}

const primitiveTypes = new Map<unknown, string>([
  [String, "string"],
  [Number, "number"],
  [Boolean, "boolean"],
  [BigInt, "bigint"],
  [Symbol, "symbol"]
])

function dateMatches(subject: unknown): boolean {
  try {
    Date.prototype.getTime.call(subject)
    return true
  } catch {
    return false
  }
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
 * a primitive's class tests typeof; another class tests instanceof; another
 * function is called as a predicate; any other value matches by SameValue.
 */
export function $is<C extends abstract new(...args: any) => any>(matcher: C, subject: unknown): subject is InstanceType<C>
export function $is<T>(matcher: (subject: any) => subject is T, subject: unknown): subject is T
export function $is(matcher: CustomMatcher | ((subject: any) => unknown), subject: unknown): boolean
export function $is<const T>(matcher: T, subject: unknown): subject is T
export function $is(matcher: unknown, subject: unknown): boolean {
  if (matcher !== null && (typeof matcher === "object" || typeof matcher === "function")) {
    const custom = (matcher as any)[customMatcher]
    if (typeof custom === "function") return !!custom.call(matcher, subject, { matchType: "boolean" })
    if (typeof matcher === "function") {
      const primitive = primitiveTypes.get(matcher)
      if (primitive !== undefined) return typeof subject === primitive
      if (matcher === Date) return dateMatches(subject)
      return isClass(matcher) ? subject instanceof (matcher as any) : !!(matcher as Function)(subject)
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

/**
 * Runs an extractor pattern's matcher: its values, or false when it does not
 * match. A class without a custom matcher extracts the instance itself, so
 * `NotFound(let error)` binds the error.
 */
export function $extract<C extends abstract new(...args: any) => any>(matcher: C, subject: unknown): readonly [InstanceType<C>] | false
export function $extract<R>(matcher: CustomMatcher<R>, subject: unknown): Extracted<R> | false
export function $extract(matcher: unknown, subject: unknown): ReadonlyArray<any> | false
export function $extract(matcher: unknown, subject: unknown): ReadonlyArray<any> | false {
  const custom = matcher === null || matcher === undefined ? undefined : (matcher as any)[customMatcher]
  if (typeof custom === "function") {
    const result = custom.call(matcher, subject, { matchType: "extractor" })
    if (result === false) return false
    if (result === true) return []
    if (Array.isArray(result)) return result
    if (result !== null && typeof result === "object" && Symbol.iterator in result) return [...result as Iterable<unknown>]
    throw new TypeError("A custom matcher used as an extractor must return true, false, an array, or an iterable")
  }
  if (typeof matcher === "function") {
    const primitive = primitiveTypes.get(matcher)
    if (primitive !== undefined) return typeof subject === primitive ? [subject] : false
    if (matcher === Date) return dateMatches(subject) ? [subject] : false
    if (isClass(matcher)) return subject instanceof (matcher as any) ? [subject] : false
  }
  throw new TypeError("An extractor pattern needs a class or a value with a Symbol.customMatcher method")
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

/** Ends a match without a default arm that no arm matched, as the proposal's TypeError does. */
export function $noMatch(subject: unknown): never {
  let shown: string
  try {
    shown = typeof subject === "string" ? JSON.stringify(subject) : String(subject)
  } catch {
    shown = typeof subject
  }
  throw new TypeError(`No match arm matched ${shown}`)
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

/** A pattern VibeLang does not support; the compiler reports it (EK4702-EK4705). */
export function $patternError(_code: number, _detail?: string): boolean {
  throw new TypeError("This pattern is not supported")
}
