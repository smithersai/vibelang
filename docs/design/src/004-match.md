# Pattern matching

Source: [VIP-7](../vips/0007-match.md).

## Syntax and meaning

```vibe es
// compiler-gap: pending VIP-7
effect function label(d: { _tag: "Sent"; tracking: string } | { _tag: "Waiting" }) {
  const tracking = "outer"
  return match (d) {
    when { _tag: "Sent", let tracking }: try Effect.succeed(tracking);
    default: tracking;
  }
}
```

```ts effect
import { Effect } from "effect"

function label(d: { _tag: "Sent"; tracking: string } | { _tag: "Waiting" }) {
  return Effect.gen(function* () {
    const tracking = "outer"
    const subject = d
    if (subject._tag === "Sent" && "tracking" in subject) {
      const tracking = subject.tracking
      return yield* Effect.succeed(tracking)
    }
    return tracking
  })
}
```

`match`, `when`, `is`, patterns, guards, `and`, `or`, `not` and `default` follow the [vendored TC39 snapshot](../vips/tc39-pattern-matching/README.md): commit `ba73ffe42f30f0cf56ece28bebdc28f955f2a52e`, dated `2025-10-03`, with the reconciliations listed there. VibeLang moves to a newer snapshot deliberately, never automatically. The full proposal is in the language, including regular-expression patterns, relational patterns and `async match`, with the class adaptations below (decided details 67 and 67a).

The first `label` counterpart uses a short object test because its subject type guarantees an object with `_tag`. For an arbitrary subject, the pinned algorithm first rejects non-objects (functions are objects too), then checks property presence before reading it; the short form is not a general lowering.

[MatchExpression](900-appendices.md#matchexpression) is a primary expression. Its arm grammar is [MatchBody](900-appendices.md#matchbody), [MatchArm](900-appendices.md#matcharm) and [ArmBody](900-appendices.md#armbody): the pinned draft with VIP-7's `when` prefix and VIP-5's `throw` arm body. At least one arm is required; `default` appears at most once, last; guards belong to `MatchPattern` (`P and if (condition)`). Separate arms with `;`, including the final arm; a missing separator is `EK0701` (quick fix: insert `;`). A newline alone is not a separator. The reconciliations are: relational patterns use the draft specification; regex patterns accept both literals and `RegExp` values; `async match` uses the explainer's Promise-producing sketch; custom matchers receive `(subject, { matchType })`, with `matchType` either `"boolean"` or `"extractor"`; the `RegExp.prototype` matcher uses the draft specification, emulated without modifying globals; built-in and primitive constructor tests use decided details 67a and 87 below.

Invalid `match`/`is` grammar and pattern-specific early errors use `EK0707` when no more specific diagnostic is assigned. The message identifies the rejected form and a valid repair. Do not add it to a specific diagnostic for the same rejection, including arm separation, matcher admission, arity lint, ordinary-class extraction, parameter-home bindings, outward async-match jumps, exhaustiveness or service patterns. Independent native lexical, type and name errors, including errors in valid embedded expressions, retain TypeScript's diagnostics; malformed native templates do not become `EK0707` merely by appearing in a match.

```vibe
const bad = match (s) { when `tag-${kind}`: 1; default: 0; } // EK0707
const good = match (s) { when let v and if (v === `tag-${kind}`): 1; default: 0; }
const nativeError = match (s) { when let v and if (missingName): 1; default: 0; } // TS2304
```

The rejected primitive pattern has no runtime counterpart. The guard repair retains ordinary template evaluation:

```ts effect
import { Effect, Exit } from "effect"

function patternGuardRepair(s: unknown, kind: string) {
  const v = s
  return v === `tag-${kind}` ? 1 : 0
}
function independentNativeError() {
  // @ts-expect-error TS2304: this remains a native name error
  return missingName ? 1 : 0
}
const patternSyntaxExit = Effect.runSyncExit(Effect.sync(() => [
  patternGuardRepair("tag-A", "A"),
  patternGuardRepair("tag-B", "A"),
  patternGuardRepair(Symbol("tag-A"), "A")
]))
console.log(patternSyntaxExit) // Success([1, 0, 0])
```

A primitive template pattern is a `NoSubstitutionTemplate`, such as `` `tag-A` ``. An interpolated template in pattern position is `EK0707`; ordinary interpolation remains valid in guards and arm expressions. This follows the pinned formal grammar where the explainer leaves interpolation unsettled. A no-substitution template uses general `SameValueZero`: equal strings match and every non-string subject fails without coercion, as for a string literal.

```vibe es
// compiler-gap: pending VIP-7
function templateLabel(s: unknown, kind: string) {
  return match (s) {
    when `tag-A`: "literal";
    when let v and if (v === `tag-${kind}`): "guard";
    default: "miss";
  }
}
// when `tag-${kind}`: is a syntax error; use the guard above.
```

```ts effect
import { Effect } from "effect"

function templateLabel(s: unknown, kind: string) {
  if (s === "tag-A") return "literal"
  if (s === `tag-${kind}`) return "guard"
  return "miss"
}
const templateExit = Effect.runSyncExit(Effect.sync(() => [
  templateLabel("tag-A", "B"), templateLabel("tag-B", "B"), templateLabel(Symbol("tag-A"), "B"),
])) // Success(["literal", "guard", "miss"])
```

Synchronous `match` evaluates its subject once and tests arms in order. It introduces no function or Effect boundary: its ordered tests and selected arm stay in the enclosing activation, so an arm's `try` becomes `yield*` in the enclosing Effect generator, as above. Only the selected arm body runs; guards run during arm testing and may have side effects. When no arm matches and there is no `default`, it throws `new TypeError()`, with an empty message: the pinned snapshot says only "a newly created *TypeError*", and no user code runs. In effect code that throw is a defect, not a failure.

<a id="match-evaluation"></a>**Match cache.** One `CreateMatchCache` per `match` (and per `is` test) caches property presence, property reads, `Symbol.iterator` lookup, iterators and pulled values per subject across arms, as the pinned draft specifies. Later arms reuse them: a cached pattern getter runs at most once and an iterable subject is iterated once. Object-rest copying is separate: it follows ordinary `CopyDataProperties` and may read the same getter again. The short object and fixed-pattern counterparts in this chapter omit cache machinery for subjects with plain data properties; they are not general lowerings for getters or iterators.

The pinned matching operations obey these behavioral invariants, with the draft errata recorded in [the snapshot](../vips/tc39-pattern-matching/README.md). Ordinary expression reads use ECMAScript [GetValue](https://tc39.es/ecma262/#sec-getvalue); iterator lookup preserves [GetV](https://tc39.es/ecma262/#sec-getv) receivers, and object rest keeps [CopyDataProperties](https://tc39.es/ecma262/#sec-copydataproperties).

| Rule | Required behavior |
| --- | --- |
| Object properties | Test properties left to right in source order, stopping at the first failure. For each property retain key evaluation, presence check, cached value read, sub-pattern and binding initialization in order; copy rest afterward. |
| Guard and selected expressions | Read a guard expression's value once before Boolean conversion. Read every selected/default arm expression's value once before iterator finishing. Getter calls, TDZ errors and abrupt completions occur at that read, never on an internal Reference Record or after cleanup. |
| Object rest | Use ordinary own-key, enumerability and value reads outside the match-specific read cache. A rest copy can re-read a previously cached getter; do not freeze its keys or descriptors in an earlier arm. |
| Array-pattern admission | `null` and `undefined` fail. Other subjects use cached `Symbol.iterator` lookup with `GetV` semantics: retain the original subject as receiver for both an inherited getter and the iterator call, including primitive strings. Missing/noncallable methods fail the pattern. Throwing accessors/calls and malformed protocol results retain their implicit throws. |
| Iterator records | Array and successful extractor list matching, and cleanup, use the same private cached Iterator Records, not user iterables. Successful custom extractor results must be objects. Iterator registration/closing stays in insertion order and skips empty registry slots; bookkeeping never reads user properties named `Value` or `IteratorsToClose`. Native iterator acquisition, saved `next`, result-object checks, `done`/`value` reads and abrupt-completion handling are preserved; an iterator marked done by an iteration error is not closed again. |
| Elisions | Each `Elision` consumes its full number of commas, excluding a list-separator comma. Every skipped position must exist. Leading, internal and trailing elisions advance cached reads and list cardinality by that width. |
| Optional elements | An absent optional element consumes zero values, leaves the iterator done and the actual index unchanged, and does not run its sub-pattern or initialize its bindings. Repeated missing optionals remain absent. A present `undefined` is a value and must satisfy its sub-pattern; no absent-binding default is invented. |
| Inclusive relations | On the admitted string, number or bigint subject, `<= bound` and `>= bound` mean ordinary `subject <= bound` and `subject >= bound`, with once-only bound evaluation and native coercion order. Unordered/`NaN` comparisons fail both; other subject types fail before bound evaluation. The draft's reversed inclusive bounds are not adopted. |

```vibe es
// compiler-gap: pending VIP-7
effect function evaluationWitness() {
  let reads = 0
  const restSubject = { get value() { return ++reads } }
  const copied = match (restSubject) { when { value: 0 }: 0; when { ...let rest }: rest.value; }
  const short = match ([9, 3]) { when [,,3]: "hit"; default: "miss"; }
  const full = match ([9, 8, 3]) { when [,,3]: "hit"; default: "miss"; }
  const absent = match ([]) { when [1?, 2?]: "hit"; default: "miss"; }
  const present = match ([undefined]) { when [1?]: "hit"; default: "miss"; }
  const primitive = match ("ab") { when ["a", "b"]: "word"; default: "other"; }
  const flag = false
  const guarded = match (true) { when true and if (flag): "hit"; default: "miss"; }
  const lower = match (1) { when <= 2: "small"; default: "large"; }
  const upper = match (1) { when >= 2: "large"; default: "small"; }
  return { copied, reads, short, full, absent, present, primitive, guarded, lower, upper }
}
// Success({ copied: 2, reads: 2, short: "miss", full: "hit", absent: "hit", present: "miss", primitive: "word", guarded: "miss", lower: "small", upper: "small" })
```

The following counterpart witnesses use their literal arrays and plain objects; they are not a general matcher lowering.

```ts effect
import { Effect } from "effect"

function evaluationWitness() {
  let reads = 0
  const restSubject = { get value() { return ++reads } }
  let copied = 0
  if (restSubject.value !== 0) { const { ...rest } = restSubject; copied = rest.value }
  const elided = (xs: readonly number[]) => { const [, , third] = xs; return xs.length === 3 && third === 3 ? "hit" : "miss" }
  const flag = false
  const guarded = flag ? "hit" : "miss"
  const optional = (xs: readonly unknown[]) => xs.length === 0 || (xs.length === 1 && xs[0] === 1) ? "hit" : "miss"
  return { copied, reads, short: elided([9, 3]), full: elided([9, 8, 3]), absent: optional([]), present: optional([undefined]), primitive: [..."ab"].join() === "a,b" ? "word" : "other", guarded, lower: 1 <= 2 ? "small" : "large", upper: 1 >= 2 ? "large" : "small" }
}
const evaluationExit = Effect.runSyncExit(Effect.sync(evaluationWitness))
// Success({ copied: 2, reads: 2, short: "miss", full: "hit", absent: "hit", present: "miss", primitive: "word", guarded: "miss", lower: "small", upper: "small" })
const sourceOrder: string[] = []
const ordered = { get first() { sourceOrder.push("first"); return sourceOrder.length }, get second() { sourceOrder.push("second"); return sourceOrder.length } }
const sourceOrderExit = Effect.runSyncExit(Effect.sync(() => ordered.first === 1 && ordered.second === 2)) // Success(true); sourceOrder: ["first", "second"]
function armBeforeClose(log: string[], answer: { readonly value: number }) {
  function* values() { try { yield 1; yield 2 } finally { log.push("close") } }
  for (const value of values()) return answer.value
  return 0
}
const armOrder: string[] = []
const armValueExit = Effect.runSyncExit(Effect.sync(() => armBeforeClose(armOrder, { get value() { armOrder.push("arm"); return 7 } })))
// Success(7); armOrder: ["arm", "close"]
```

<a id="leaving-a-match"></a>**Leaving a `match`.** However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator, in draft order, before control goes on, as the end of a `for…of` body closes its iterator:

| The arm, guard or test ends with | What happens |
| --- | --- |
| a value | the iterators close, then the `match` gives the value |
| `return`, `break` or `continue`, through `do` or a generator's `return()` | the iterators close, then the jump goes on |
| a JavaScript throw, the no-match `TypeError` included | the iterators close, then the throw goes on |
| an error from closing | it replaces a value or a jump, as in `for…of`. With a pending throw, or a second closing error, the `match` throws an `AggregateError` whose `errors` lists the pending throw and then the closing errors, where `for…of` keeps the pending throw alone |
| in effect code, a `try` that fails, dies or is interrupted, or a `throw` | nothing closes: the generator is [abandoned](008-runtime.md#abandonment) |

The pinned draft's `FinishMatch` appends every abrupt completion to its errors, so read literally it turns `return 7` into `throw 7`. Its own notes intend otherwise, and VibeLang reads that step as "a throw completion" ([the snapshot's reconciliations](../vips/tc39-pattern-matching/README.md)). The rule is the `for…of` rule because a jump out of an arm is the same completion as a jump out of a loop body:

```vibe es
// compiler-gap: pending VIP-7
function* numbers(log: string[]) { try { yield 1; yield 2 } finally { log.push("closed") } }
function first(log: string[]) {
  const v = match (numbers(log)) { when [let a, ...]: do { return a }; default: 0; }
  return -1
}
effect function answer() {
  const ignored = match (true) { default: do { return 7 }; }
  return 0
}
effect function typed(log: string[]) {
  return match (numbers(log)) { when [let a, ...]: do { throw "bad" }; default: 0; }
}
effect function implicit(log: string[], o: { value: number }) {
  return match (numbers(log)) { when [let a, ...]: o.value; default: 0; }
}
```

| Call | Exit | `log` |
| --- | --- | --- |
| `first(log)` | returns `1` | `["closed"]`, as `for (const a of numbers(log)) return a` |
| `answer()` | `Success(7)` | |
| `typed(log)` | `Failure("bad")` | `[]`: the generator is abandoned |
| `implicit(log, o)`, the getter `o.value` throws `"t"` | `Die("t")` | `["closed"]`: a JavaScript throw unwinds the generator |

```ts effect
import { Effect, Exit } from "effect"

function* numbers(log: string[]) { try { yield 1; yield 2 } finally { log.push("closed") } }
function first(log: string[]) {
  for (const a of numbers(log)) return a
  return -1
}
function typed(log: string[]) {
  return Effect.gen(function* () {
    for (const a of numbers(log)) return yield* Effect.fail("bad")
    return 0
  })
}
function implicit(log: string[], o: { value: number }) {
  return Effect.gen(function* () {
    for (const a of numbers(log)) return o.value
    return 0
  })
}
const firstLog: string[] = []
if (first(firstLog) !== 1 || firstLog.join() !== "closed") throw new Error("return lost its close")
const typedLog: string[] = []
const typedExit = Effect.runSyncExit(typed(typedLog))
if (!Exit.isFailure(typedExit) || typedLog.length !== 0) throw new Error("a failure closed the iterator")
const implicitLog: string[] = []
const bad = { get value(): number { throw "t" } }
const implicitExit = Effect.runSyncExit(implicit(implicitLog, bad))
if (!Exit.isFailure(implicitExit) || implicitLog.join() !== "closed") throw new Error("a throw skipped the close")
```

```vibe es
// compiler-gap: pending VIP-7
function* two() { yield 1; yield 2 }
function pairs(g: Generator<number, void, unknown>) {
  return match (g) { when [let a]: a; when [let a, let b]: a + b; default: 0; }
}
pairs(two()) // 3: the second arm reuses 1 and 2
```

For the fixed `two()` generator above, the two yielded values give this native witness. The general caching and closing behavior is the rule above; the witness does not prescribe a matcher lowering.

```ts effect
import { Effect } from "effect"

function* two() { yield 1; yield 2 }
function pairCacheWitness() {
  const values = [...two()]
  return values.length === 2 ? values[0] + values[1] : 0
}
const pairCacheExit = Effect.runSyncExit(Effect.sync(pairCacheWitness)) // Success(3)
```

- In an object pattern, a bare key such as `{ tracking }` only tests that the property exists. Binding it takes `let tracking`, shorthand for `tracking: let tracking` (VIP-16). Replacing `let tracking` with `tracking` above would return `"outer"`, not the field.
  VibeLang does not adopt the draft's disputed early error rejecting a `MatchProperty` name coverable by `BindingIdentifier`, either as a bare presence key or before `:`. Identifier keys such as `_tag:` remain valid; the separate `__proto__` pattern-key restriction and unrelated early errors remain.
- Prefix `not` wins whenever the same token sequence can also be a member/extractor rooted at an identifier `not`. Parsing never consults a local binding or its type, and does not retry that identifier parse to evade an early error. Thus `not(let x)` negates a parenthesized binding pattern and `not[0]` negates an array pattern; `helpers.not(let x)` remains a qualified extractor. `not` stays an ordinary name outside the prefix collision and in property/binding-name positions.
- Pattern bindings use `let` or `const`; `when var x:` is `EK0107`, as `var` is everywhere in `.vibe`.
- An arm's body may be `throw e`, as VIP-5's example writes it. In effect code it fails the Effect ([Failures](003-failures.md#throw)); outside effect code it is JavaScript's `throw`.
- No-match `TypeError`, implicit matcher reads/calls and protocol checks are implicit throws: never tracked, and defects in effect code (decided detail 95). Written calls in subjects, guards, arms and detail-94 predicates are tracked normally ([Thrown type by kind of callable](003-failures.md#thrown-type-by-kind-of-callable)).

The empty array pattern uses [ArrayPattern](900-appendices.md#arraypattern) with its one nullable-list derivation. It matches an empty iterable, including an empty string, and is not a wildcard or an array-only test. Every array pattern and extractor list receives a cached Iterator Record; its finishing paths never receive the original subject instead of that record.

```vibe es
// compiler-gap: pending VIP-7
function empty(xs: Iterable<unknown>) {
  return match (xs) { when []: "empty"; default: "not empty"; }
}
function not(s: unknown): [unknown] { return [s] }
const helpers = { not }
match (5) { when not(let x): "hit"; default: "miss"; } // "miss"; the local function is not called
match (5) { when helpers.not(let x): "hit"; default: "miss"; } // "hit"
match ([0]) { when not[0]: "other"; default: "zero"; } // "zero"
```

```ts effect
import { Effect } from "effect"

function empty(xs: Iterable<unknown>) {
  for (const value of xs) return "not empty"
  return "empty"
}
const emptyPatternExit = Effect.runSyncExit(Effect.sync(() => [empty([]), empty(""), empty([1])]))
// Success(["empty", "empty", "not empty"])
```

A `match` in a destructuring or parameter default follows [Destructuring and parameter defaults](002-running.md#destructuring-and-parameter-defaults). A `match` inside a larger expression follows the shared [evaluation-order rule](002-running.md#evaluation-order). `eval` and `arguments` are compile errors anywhere in `.vibe`, including subjects, guards and arms ([Legacy JavaScript](001-functions.md#direct-eval); VIP-1, amended).

```vibe es
// compiler-gap: pending VIP-7
effect function defaultBit(o: { x?: number }, b: boolean) {
  const { x = match (b) { when true: try succeed(7); default: 0; } } = o
  return x
}
```

```ts effect
import { Effect } from "effect"
function defaultBit(o: { x?: number }, b: boolean) {
  return Effect.gen(function* () {
    const { x = b === true ? yield* Effect.succeed(7) : 0 } = o
    return x
  })
}
```


## `is` expressions

`subject is P` evaluates the subject once and returns the pattern's Boolean result, using the same cache and finishing rules as `match`. In an ordinary block expression or an `if` head, its `let` and `const` names belong to the nearest enclosing lexical block, as the pinned explainer's binding rule states. They are in scope in both branches and after the `if`, shadow outer names throughout that block, and exist even when short-circuiting skips the expression or a preceding subpattern fails. Each cell stays in TDZ until its binding pattern executes. A failed overall test does not undo bindings already initialized; a skipped binding is still uninitialized. Source assignments keep ordinary `const` immutability; repeated binding patterns keep the pinned duplicate-initialization rules and their `or` replacement exception.

An `is` in a loop head uses the pinned loop-head/per-iteration scopes. Each complete `while` or `do…while` condition evaluation has fresh cells; the initial `do` body sees its uninitialized head cells. A match arm has its own lexical scope, so an `is` inside it does not export names to another arm.

```vibe es
// compiler-gap: pending VIP-7
function nameOf(value: { name: string } | undefined) {
  if (value is { let name }) return name
  return "missing"
}
function failedGuard() {
  if (5 is let n and if (false)) return 0
  return n // 5: the binding ran before the guard failed
}
effect function skippedBinding() {
  if (true || (1 is const n)) return n
  return 0
} // Die(ReferenceError): short-circuiting skipped the binding's initialization
```

The object counterpart specializes its stated subject type. Native lexical-cell witnesses check initialization before a failed guard and TDZ after a skipped initialization:

```ts effect
import { Effect } from "effect"
function nameOf(value: { name: string } | undefined) {
  const subject = value
  if (subject !== undefined && "name" in subject) {
    const name = subject.name
    return name
  }
  return "missing"
}
function failedGuardCell() {
  let n = 5
  if (false) return 0
  return n
}
function skippedBindingCell(): number {
  // @ts-expect-error: the read precedes the skipped lexical initialization
  if (true) return n
  const n = 1
  return 0
}
const isNamesExit = Effect.runSyncExit(Effect.sync(() => [nameOf({ name: "Ada" }), nameOf(undefined)])) // Success(["Ada", "missing"])
const failedGuardCellExit = Effect.runSyncExit(Effect.sync(failedGuardCell)) // Success(5)
const skippedBindingCellExit = Effect.runSyncExit(Effect.sync(skippedBindingCell)) // Die(ReferenceError)
```

## Typing

Patterns type as the TypeScript counterpart this chapter shows for them, so every rule below is what `tsc --strict` gives that counterpart (VIP-7, amended; decided detail 79).

- **Result.** A `match` expression has the union of its arm types; a `throw` arm contributes `never`. A `match` with no `default` whose subject passes `EK4701` ([Exhaustiveness](#exhaustiveness)) adds nothing for the no-match path. For arm-type union `U`, `async match` has type `Promise<Awaited<U>>`, with TypeScript's async-return resolution and Promise-like/thenable checks: a returned Promise is adopted, not nested. `x is P` has type `boolean` and narrows `x` as a type predicate where `P` narrows.
- **Subject narrowing.** Inside an arm the subject narrows as the arm's test narrows in TypeScript; a `default` arm follows TypeScript control flow after every preceding ordered pattern and guard test has failed, including cached reads and source mutations. This is independent of exhaustiveness coverage: a predicate false branch may exclude a type even though the predicate covers no `EK4701` case; failure of a guard does not establish that its positive predicate failed. A guard `and if (c)` narrows further, as `if (c)` would.
- **Bindings.** A `let` binding has the type TypeScript gives the value it is bound to in the counterpart.

| Pattern | Narrows `s` to | Binding types |
| --- | --- | --- |
| literal `"a"`, `1`, `null`, `undefined`, enum member | `s === v` | none |
| object `{ _tag: "Sent", let tracking, id }` | `(typeof s === "object" \|\| typeof s === "function") && s !== null && "_tag" in s && s._tag === "Sent" && "tracking" in s && "id" in s` | `tracking`: the narrowed subject's property type |
| array `[let a, let b]` | members that are iterable | the element type of the subject's iterable (tuple element types for a tuple) |
| `error` / `schema error` class `NotFound`, `NotFound(let e)` | subject members with `_tag: "NotFound"`, if any; otherwise `NotFound` (detail 103) | `e`: those subject members; otherwise the declared `NotFound` |
| class `C` with an own matcher | only narrowing established by its matcher invocation; no implicit `instanceof` | elements of the declared extraction iterable, excluding `false` |
| ordinary class `C` without an own matcher | `s instanceof C` | bare test has no bindings; any extractor is `EK0704` (detail 100; [Class patterns](#class-patterns)) |
| built-in `Array(let n)`, typed-array extractor | `Array.isArray(s)`, `s instanceof C` respectively | elements of the subject array or typed array (`number` or `bigint`) |
| other built-in constructor extractor | its specified recognition test | elements of its actual draft extraction list; `Map` and `Set` return `[s]`, so bind the collection |
| primitive class `String(let t)`, `Number`, … | `typeof s === "string" \|\| s instanceof String`, … | `t`: `string`, … |
| fixed `Option.Some(let v)` | `Option.isOption(s) && Option.isSome(s)` | `v`: `A` for `Option<A>`; `unknown` for an `unknown` subject |
| fixed `Exit.Failure(let c)`, `Result.Success(let v)` | the module guards ([Retained fixed patterns](#retained-fixed-patterns)) | `c`: `Cause.Cause<E>`; `v`: `A` |
| retained error `Cause.TimeoutError(let t)` | `Cause.isTimeoutError(s)` | `t`: `Cause.TimeoutError`, so `t._tag` is `"TimeoutError"` |
| own matcher object `M(let x)` | only narrowing established by its matcher invocation | `x`: an element of its declared extraction iterable, excluding `false` |
| call-only predicate `p` | its declared type predicate, as `if (p(s))` | bare: none; extractor `p(let x)`: an element of its declared return iterable, excluding `false` (detail 94) |
| regex `/(\d+)/(let m)` | none | `m`: `RegExpMatchArray` (non-global); `RegExpExecArray` elements for a global regex |
| relational `< 0` | none | none |
| `not P` | the false branch of the actual positive test: `!(s instanceof C)` only for an ordinary class using `instanceof`; an own matcher, generated error matcher or fixed guard complements its own invocation/test. A boolean-returning custom matcher establishes no narrowing | none |
| `P or Q` | the union of each side's narrowing | a name bound in every alternative gets the union of its types |
| `P and Q` | both narrowings in order | both sides' bindings |

```vibe es
// compiler-gap: pending VIP-7
function isText(s: string | number): s is string { return typeof s === "string" }
function classify(s: string | number) {
  return match (s) { when isText: s.length; default: s.toFixed(0); }
} // default s: number, although isText contributes no exhaustiveness coverage
const adopted: Promise<number> = async match (true) { default: Promise.resolve(7); }
class OnlyNumbers {
  static [Symbol.customMatcher](s: unknown): boolean { return typeof s === "number" }
}
// For s: OnlyNumbers | number, an arm `when not OnlyNumbers: s.toFixed(0);`
// is a TypeScript error: this boolean matcher establishes no narrowing.
```

```ts effect
import { Effect } from "effect"

function isText(s: string | number): s is string { return typeof s === "string" }
function classify(s: string | number) {
  if (isText(s)) return s.length
  return s.toFixed(0)
}
const adopted: Promise<number> = (async () => Promise.resolve(7))()
const adoptedExit = await Effect.runPromiseExit(Effect.promise(() => adopted)) // Success(7)
class OnlyNumbers {
  static [Symbol.customMatcher](s: unknown): boolean { return typeof s === "number" }
}
function negated(s: OnlyNumbers | number) {
  if (!OnlyNumbers[Symbol.customMatcher](s)) {
    // @ts-expect-error no implicit instanceof exclusion for an own boolean matcher
    s.toFixed(0)
  }
}
const defaultNarrowingExit = Effect.runSyncExit(Effect.sync(() => [classify("text"), classify(7)])) // Success([4, "7"])
```

The object row describes narrowing; evaluation uses the cache/property algorithms above. An extracted property of an `unknown` subject is `unknown`; a declared field has its narrowed property type.

Generated error matchers deliberately trust `_tag`: a matching foreign object need not carry every field or getter promised by the local error type (VIP-13). TypeScript intuition: detail 103 preserves the subject’s own tagged members when available, but for `unknown` the fallback declared class type can still promise a getter absent from a foreign object.

```vibe es
// compiler-gap: pending VIP-7
error NotFound { id: string }
error Timeout
function errorId(e: NotFound | Timeout) {
  return match (e) { when NotFound(let n): n.id; when Timeout: ""; }
}
```

```ts effect
import { Data } from "effect"
class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}
class Timeout extends Data.TaggedError("Timeout") {}
function errorId(e: NotFound | Timeout) {
  if (e._tag === "NotFound") { const n = e; return n.id }
  return ""
}
errorId(new NotFound({ id: "42" })) // "42"
```

In `errorLabel` ([Retained fixed patterns](#retained-fixed-patterns)) `t` is `Cause.TimeoutError`, and the function's type is `"TimeoutError" | "invalid" | "other"`.

```vibe es
// compiler-gap: pending VIP-7
class Numeric {
  static [Symbol.customMatcher](s: unknown, _options: { matchType: "extractor" }): false | [number] {
    return typeof s === "number" ? [s] : false
  }
}
function first(s: number[]) {
  return match (s) { when Array(let n): n.toFixed(0); default: "other"; }
}
function numeric(s: unknown) {
  return match (s) { when Numeric(let n): n.toFixed(0); default: "other"; }
}
// first([1]) is "1"; numeric(7) is "7", although 7 is not a Numeric instance.
```

```ts effect
const numericMatcher: unique symbol = Symbol.for("Symbol.customMatcher")
class Numeric {
  static [numericMatcher](s: unknown, _options: { matchType: "extractor" }): false | [number] {
    return typeof s === "number" ? [s] : false
  }
}
function first(s: number[]) {
  const extracted = s // Array adapter, after Array.isArray(s)
  if (extracted.length === 1) {
    const [n] = extracted
    return n.toFixed(0)
  }
  return "other"
}
function numeric(s: unknown) {
  const extracted = Numeric[numericMatcher](s, { matchType: "extractor" })
  if (extracted !== false) {
    const [n] = extracted
    return n.toFixed(0) // s remains unknown; n is number
  }
  return "other"
}
first([1]) // "1"
numeric(7) // "7"
```

## Pattern bindings

An `or` pattern shares one lexical cell for a name bound with the same keyword in its alternatives. A later alternative may replace a cell initialized by a failed earlier alternative of that `or`; closures saved by that earlier alternative observe the replacement. Ordinary TDZ before first initialization, user-facing `const` immutability, and duplicate-initialization restrictions outside that authorized replacement remain. Do not reset unrelated bindings or give alternatives disconnected cells.

Lexical `is` bindings in `while` and `do…while` have the pinned explainer's loop-head/per-iteration scope, rather than an enclosing block's scope. The loop head shadows outer names and does not leak outside the loop. Each complete condition evaluation starts with fresh uninitialized cells, including after `continue`; condition reads see TDZ until the matching pattern initializes them. A successful condition and its following body share those cells, so closures see that body's later `let` writes. Short-circuiting past a binding leaves it uninitialized even if the condition is true. Nested source blocks/functions retain their own scopes.

The first `do…while` body runs with the initial uninitialized head cells. Its direct reads throw `ReferenceError`, and closures captured there keep those cells permanently in TDZ. Each subsequent condition gets new cells; its true result shares them with the following body. `continue` reaches a fresh condition set, and false/`break` exits without exporting names. The initial closures are never rebound to a later condition. `if` keeps its existing nearest-block scope; the within-one-`or` replacement above is unchanged.

```vibe es
// compiler-gap: pending VIP-7
effect function alternative() {
  return match ([5]) { when ([let x and String]) or { length: let x }: x; default: 0; }
} // Success(1): the failed left alternative initialized x with 5, the right replaces it with 1
function readLoop() {
  const x = 99; let n = 0; const readers: (() => number)[] = []
  while (n < 2 && (++n is let x)) { readers.push(() => x); x += 10 }
  return [x, ...readers.map(f => f())] // [99, 11, 12]
}
effect function skipped() {
  while (true || (1 is const x)) { return x }
} // Die(ReferenceError): the successful condition skipped initialization
```

Native lexical-cell witnesses for the per-iteration and initial-head rules:

```ts effect
import { Effect } from "effect"

function loopCells() {
  const x = 99
  const readers: (() => number)[] = []
  for (const input of [1, 2]) { let x = input; readers.push(() => x); x += 10 }
  return [x, ...readers.map(f => f())]
}
const loopCellsExit = Effect.runSyncExit(Effect.sync(loopCells)) // Success([99, 11, 12])
let initialReader: () => number = () => 0
initialHead: {
  initialReader = (): number => x
  break initialHead
  const x = 0
}
const initialHeadExit = Effect.runSyncExit(Effect.sync(initialReader)) // Die(ReferenceError); later cells cannot initialize this closed-over binding
```

## Exhaustiveness

VibeLang adds these checks to TC39's proposal; `EK4701` is the exhaustiveness check.

| Rule | Diagnostic |
| --- | --- |
| a `match` with no `default` over a finite union that misses a case | `EK4701` |
| invalid `match`/`is` grammar or a pattern-specific early error without a more specific diagnostic | `EK0707` |
| a missing `;` after a `match` arm, the last one included | `EK0701` |
| a class pattern naming a `data` declaration or variant, a `schema`, or a directly constructed `Context.Reference`; a call-only callee whose return type fails detail 94, or a callee with neither signature (services use `EK3004`; [Class patterns](#class-patterns)) | `EK0702` |
| an ordinary-class extractor without an own matcher (detail 100) | `EK0704` |
| lint warning: an extractor whose argument count can never match its pattern's list ([Class patterns](#class-patterns)) | `EK0703` |

`EK4701` applies equally to `match` and `async match`, which have the same arms. The check only reports errors. It never changes what runs: a `match` that passes the check compiles to the same tests as one that doesn't need it.

One algorithm decides every subject (VIP-7, amended; decided details 10, 78 and 102):

- **Subjects.** Start from TypeScript's type of the subject expression at that evaluation point, including its represented flow refinements. Resolve its effective base constraint when one exists; otherwise keep that type. Normalize the result into a union of members, expanding `boolean` to `true | false`, an enum to its members, a `data` type to its variants, `Option.Option<A>` to `None | Some`, and `Exit.Exit<A, E>` and `Result.Result<A, E>` to `Success | Failure`. `EK4701` applies when every member is a literal type, `true`, `false`, `null`, `undefined`, an enum member, a `data` variant, an `error` or `schema error` instance, one of those six `Option`, `Exit` and `Result` cases, a retained Effect error ([Retained fixed patterns](#retained-fixed-patterns)), or a tagged member. Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off for that `match`, which keeps TC39's run-time `TypeError`.
- **Generic constraints and flow.** A constrained type parameter uses its finite constraint as a conservative domain; an unconstrained parameter or a broad constraint stays open. A represented refinement such as `T & { _tag: "A" }` can reduce that domain to `"A"`. If TypeScript still exposes bare `T` after an equality or property guard, its whole constraint remains: the check does not invent extra narrowing from the guard's text. Ordinary literals keep their literal types, without apparent-type boxing to `Number`, `String` or `Boolean`. This coverage projection neither casts the subject nor changes arm or default-flow types.
- <a id="tagged-members"></a>**Tagged members.** Only `_tag` is a discriminant, Effect's convention, and `EK4701` counts the literal cases of `switch (s._tag)`. Coverage is per normalized member and tag case, even when TypeScript does not narrow the whole subject because every member has the same `_tag` type. A member is tagged when it is an object, interface or class instance and its `_tag` is what TypeScript calls a literal type: a string, number, bigint, boolean, enum, `null` or `undefined` literal, a `unique symbol`, or a union of those. Each of those literals is a case of the member, and an optional `_tag` has the case `undefined`. A `_tag` of any other type, such as `string` or a template type, is not tagged, because TypeScript checks no `switch` over it.
- **Coverage.** Only an unguarded arm covers anything. A literal, `null`, `undefined` or enum-member pattern covers that member. A signed Number literal whose value is zero (`+0`, `-0`, `-0.0`, `+0e0`, and equivalent spellings) covers no zero case: its `SameValue` test distinguishes signs, while TypeScript's `0` type admits both. Even both signed arms together give no whole-case proof; use unsigned zero or `default`. Unsigned zero uses `SameValueZero` and covers both signs. Valid signed nonzero literals retain singleton coverage; bigint zero has no distinct negative zero. The same rule applies to a checked zero-valued enum case. A bare binding (`let x` or `const x`) covers every member. `when NotFound:`, `when NotFound(let e):` and `when NotFound(const e):` cover each member's `"NotFound"` tag case, including a plain object with that tag; other tag cases on that member remain; `when NotFound():` and `when NotFound({ id: "x" }):` cover nothing. A fixed pattern (`Option.Some(let v)`, `Option.None`, `Exit.Success(…)`, `Exit.Failure(…)`, `Result.Success(…)`, `Result.Failure(…)`) and a retained error's bare or one-binding extractor cover their case only when their argument list has the required length and every argument pattern is a bare `let` or `const` binding. An object pattern with `_tag: "V"` covers case `V` of each `data` variant or tagged member when every other property it tests is a bare key or a `let` or `const` binding that the member declares as required: `"x" in s` removes a member from its false branch only where `x` is required. Members that share a tag are covered one at a time, and one left uncovered stays uncovered. The `undefined` case of an optional `_tag` is covered only by a bare binding, because `{ _tag: undefined }` tests `"_tag" in s` first and an absent tag fails that test. `or` covers the union of its alternatives. `and`, `not`, regex, relational, array, built-in matcher and user-matcher patterns cover nothing, so those arms need a `default`.

```vibe es
// compiler-gap: pending VIP-7
function signedZero(n: 0 | 1) {
  return match (n) { when -0: "negative"; when 1: "one"; }
} // EK4701: positive zero is not covered
function allZero(n: 0 | -1) {
  return match (n) { when 0: "zero"; when -1: "negative one"; }
} // exhaustive
```

```ts effect
import { Effect } from "effect"

function signedZero(n: 0 | 1) {
  if (Object.is(n, -0)) return "negative"
  if (n === 1) return "one"
  throw new TypeError()
}
function allZero(n: 0 | -1) {
  if (n === 0) return "zero"
  if (n === -1) return "negative one"
  throw new TypeError()
}
const positiveZeroExit = Effect.runSyncExit(Effect.sync(() => signedZero(0))) // Die(TypeError)
const negativeZeroExit = Effect.runSyncExit(Effect.sync(() => signedZero(-0))) // Success("negative")
const unsignedZeroExit = Effect.runSyncExit(Effect.sync(() => [allZero(0), allZero(-0), allZero(-1)])) // Success(["zero", "zero", "negative one"])
```

```vibe es
// compiler-gap: pending VIP-7
match (o) { when Option.Some(let v): v; when Option.None: 0; }          // ok: Option<number>, covered
match (r) { when NotFound: 1; when undefined: 2; }                       // ok: NotFound | undefined
data Delivery { Waiting; Sent { tracking: string } }
declare const d: Delivery
match (d) { when { _tag: "Sent", let tracking }: 1; }                    // EK4701: Waiting not covered
match (d) { when { _tag: "Sent" } or { _tag: "Waiting" }: 1; }          // ok
match (plain) { when { _tag: "Sent" }: 1; } // plain: { _tag: "Sent" } | { _tag: "Waiting" }: EK4701
match (s) { when { _tag: "A" }: 1; }        // s: { _tag: "A"; x: number } | { _tag: "A"; y: number }: ok
match (s) { when { _tag: "A", let x }: x; } // EK4701: the y member is left
match (o) { when { _tag: "A" }: 1; when { _tag: "B" }: 2; } // o: { _tag?: "A" } | { _tag: "B" }: EK4701: the absent-tag case remains uncovered; only a bare binding covers it
match (u) { when { _tag: "A" }: 1; when { _tag: "C" }: 3; } // u: { _tag: "A" | "B" } | { _tag: "C" }: EK4701: "B" is left
match (w) { when { _tag: "A" }: 1; } // w: { _tag: "A" } | { _tag: string }: no check, as for a switch
match (k) { when { kind: "a" }: 1; } // k: { kind: "a" } | { kind: "b" }: no check
match (n) { when 1: "a"; }                                               // n: number: no check
match (b) { when true and if (flag): 1; when false: 0; }                 // EK4701: a guarded arm covers nothing
```

```ts effect
import { Match } from "effect"
type Tagged = { _tag: "Sent"; tracking: string } | { _tag: "Waiting" }
const taggedLabel = Match.type<Tagged>().pipe(
  Match.tag("Sent", (s) => s.tracking),
  Match.tag("Waiting", () => "waiting"),
  Match.exhaustive
)
taggedLabel({ _tag: "Sent", tracking: "1Z" }) // "1Z"
```

`tsc --strict` checks the corresponding narrowing on the same shapes. Its whole-subject `never` check is not a coverage oracle for a uniform tag: the pattern still recognizes each member's case.

```ts effect
type Shared = { _tag: "A"; x: number } | { _tag: "A"; y: number }
function sharedTagSwitch(s: Shared) {
  switch (s._tag) { case "A": return 1 }
  // @ts-expect-error: TypeScript does not narrow a uniform tag; the pattern covers both members
  const left: never = s
  return left
}
function sharedTagPattern(s: Shared) {
  if (s._tag === "A") return 1
  throw new TypeError()
}
function shared(s: Shared) {
  if (s._tag === "A" && "x" in s) return s.x
  // @ts-expect-error: the y member is left
  const left: never = s
  return left
}
type Optional = { _tag?: "A" } | { _tag: "B" }
function optional(o: Optional) {
  switch (o._tag) { case "A": return 1; case "B": return 2 }
  // @ts-expect-error: { _tag?: "A" } is left, until a `case undefined`
  const left: never = o
  return left
}
type Union = { _tag: "A" | "B"; x: number } | { _tag: "C" }
function union(u: Union) {
  switch (u._tag) { case "A": return 1; case "C": return 3 }
  // @ts-expect-error: "B" is left
  const left: never = u
  return left
}
function unionDone(u: Union) {
  switch (u._tag) { case "A": return 1; case "B": return 2; case "C": return 3 }
  const left: never = u
  return left
}
type Units = { _tag: 1 } | { _tag: true } | { _tag: null }
function units(n: Units) {
  switch (n._tag) { case 1: return 1; case true: return 2; case null: return 3 }
  const left: never = n
  return left
}
type Wide = { _tag: "A" } | { _tag: string }
function wide(w: Wide) {
  switch (w._tag) { case "A": return 1 }
  // @ts-expect-error: string has no last case
  const left: never = w
  return left
}
type Payload = { _tag: "A"; x?: number } | { _tag: "B" }
function payload(p: Payload) {
  if (p._tag === "A" && "x" in p) return 1
  if (p._tag === "B") return 2
  // @ts-expect-error: A without x is left
  const left: never = p
  return left
}
```


A finite generic constraint is checked for every admitted instantiation; an open parameter retains the ordinary no-match `TypeError`:

```vibe es
// compiler-gap: pending VIP-7
type TaggedDomain = { readonly _tag: "A" } | { readonly _tag: "B" }
function tags<T extends TaggedDomain>(s: T) {
  return match (s) { when { _tag: "A" }: 1; when { _tag: "B" }: 2; } // exhaustive
}
function missingTag<T extends TaggedDomain>(s: T) {
  return match (s) { when { _tag: "A" }: 1; } // EK4701: B remains
}
function letters<T extends "A" | "B">(s: T) {
  return match (s) { when "A": 1; } // EK4701: B remains
}
function open<T>(s: T) {
  return match (s) { when "A": 1; } // open: no EK4701; a non-A value throws TypeError
}
function broad<T extends string>(s: T) {
  return match (s) { when "A": 1; } // open: the constraint is string
}
function isA<T extends TaggedDomain>(s: T): s is T & { readonly _tag: "A" } {
  return s._tag === "A"
}
function refined<T extends TaggedDomain>(s: T) {
  if (isA(s)) return match (s) { when { _tag: "A" }: 1; } // exhaustive: represented intersection
  return 0
}
function bareGuard<T extends TaggedDomain>(s: T) {
  if (s._tag === "A") return match (s) { when { _tag: "A" }: 1; } // EK4701: reference still has type T
  return 0
}
function ordinary(s: TaggedDomain) {
  if (s._tag === "A") return match (s) { when { _tag: "A" }: 1; } // exhaustive: represented union refinement
  return 0
}
match (0) { when 0: 1; } // exhaustive: 0 is not boxed to Number
```

```ts effect
import { Effect } from "effect"
type TaggedDomain = { readonly _tag: "A" } | { readonly _tag: "B" }
function tagCoverage<T extends TaggedDomain>(s: T) {
  switch (s._tag) { case "A": return 1; case "B": return 2 }
  throw new TypeError()
}
function literalCoverage<T extends "A" | "B">(s: T) {
  switch (s) { case "A": return 1; case "B": return 2 }
  throw new TypeError()
}
function openCoverage<T>(s: T) {
  if (s === "A") return 1
  throw new TypeError()
}
const genericCoverageExit = Effect.runSyncExit(Effect.sync(() => [
  tagCoverage({ _tag: "A" }), tagCoverage({ _tag: "B" }),
  literalCoverage("A"), literalCoverage("B"), openCoverage("A")
])) // Success([1, 2, 1, 2, 1])
const openCoverageExit = Effect.runSyncExit(Effect.sync(() => openCoverage("other"))) // Die(TypeError)
```

A generated error matcher tests the tag of the subject, including a foreign plain object with that tag:

```vibe es
// compiler-gap: pending VIP-7
error SameTag {}
declare const same: SameTag | { readonly _tag: "SameTag"; source: string }
match (same) { when SameTag: 1; } // exhaustive: both members have the recognized tag
```

```ts effect
import { Data, Effect } from "effect"
class SameTag extends Data.TaggedError("SameTag") {}
type SameTagSubject = SameTag | { readonly _tag: "SameTag"; source: string }
function sameTagPattern(s: SameTagSubject) {
  if (s._tag === "SameTag") return 1
  throw new TypeError()
}
const sameTagExit = Effect.runSyncExit(Effect.sync(() => [
  sameTagPattern(new SameTag()),
  sameTagPattern({ _tag: "SameTag", source: "foreign" })
])) // Success([1, 1])
```

```vibe es
// compiler-gap: pending VIP-7
effect function bit(b: boolean) {
  return match (b) { when true: 1; when false: 0; }
}
// Guarding the true arm requires another unguarded true arm or default.
```

```ts effect
import { Effect } from "effect"

function bit(b: boolean) {
  return Effect.gen(function* () {
    const subject = b
    if (subject === true) return 1
    if (subject === false) return 0
    throw new TypeError()
  })
}
```

<a id="async-match"></a>

[AsyncMatchExpression](900-appendices.md#asyncmatchexpression) is a primary expression; no line terminator may separate `async` and `match`. Its independent context is `[~Yield, +Await, ~Effect]`, even inside a plain function. `async match (s) { … }` has the async-function behavior `(async () => match (s) { … })()`: subject evaluation, tests and the selected arm run inside the async function. `await` is allowed there; a thrown exception, including the no-match `TypeError`, rejects the resulting `Promise`. Under VIP-7, a `return` in it, and a `break` or `continue` whose target is outside it, are syntax errors.

```vibe es
// compiler-gap: pending VIP-7
function asyncLabel(s: Promise<string>) {
  return async match (await s) {
    when "sent": await Promise.resolve("sent");
  }
}
```

```ts effect
function asyncLabel(s: Promise<string>) {
  return (async () => {
    const subject = await s
    if (subject === "sent") return await Promise.resolve("sent")
    throw new TypeError()
  })()
}
```

```vibe es
// compiler-gap: pending VIP-7
function grammarAsync() {
  return async match (await Promise.resolve(7)) { when 7: await Promise.resolve(9); default: 0; }
} // the plain outer function returns Promise<number>
```

```ts effect
import { Effect } from "effect"

function grammarAsync() {
  return (async () => {
    const subject = await Promise.resolve(7)
    if (subject === 7) return await Promise.resolve(9)
    return 0
  })()
}
const grammarAsyncExit = await Effect.runPromiseExit(Effect.promise(grammarAsync)) // Success(9)
```

Inside effect code, a direct `async match` is a compile error under the [Promise-bridge rule](003-failures.md#calls-in-effect-code): like a Promise-returning call or `new` expression, it must run inside an explicit bridge's thunk. Its subject, tests and arms form a plain async boundary (`[~Effect, +Await]`): `await` is allowed there and effect `try` is not, as in a nested TypeScript async function. For example:

```vibe es
// compiler-gap: pending VIP-7
effect function asyncBit(b: boolean) {
  return try promise(() => async match (b) {
    when true: await Promise.resolve(1);
    default: 0;
  })
}
```

```ts effect
import { Effect } from "effect"

function asyncBit(b: boolean) {
  return Effect.gen(function* () {
    return yield* Effect.promise(() => (async () => {
      const subject = b
      if (subject === true) return await Promise.resolve(1)
      return 0
    })())
  })
}
```

## Regular-expression patterns

A [RegularExpressionPattern](900-appendices.md#regularexpressionpattern) admits a bare `RegularExpressionLiteral` or its extractor suffix `(MatchList)`, including the nullable list `()`. It evaluates the literal once at its pattern position and matches as the same named `RegExp` value does. The runtime emulates the draft's `RegExp.prototype` matcher without patching the prototype: a bare pattern calls `test`; a non-global extractor returns `[regexp[Symbol.match](subject)]`, failing on `null`. A global extractor returns `Array.from(regexp[Symbol.matchAll](subject))` directly, failing when empty. Thus a non-global regex extracts one match array, not separate capture arguments; a global regex extracts one element per match. Calls preserve the regex receiver and the draft's observable property reads and `lastIndex` effects.

```vibe es
// compiler-gap: pending VIP-7
function digits(s: string) {
  return match (s) {
    when /(\d+)-(\d+)/(let m): m[1] + m[2];
    default: "none";
  }
}
```

```ts effect
import { Effect } from "effect"

function digits(s: string) {
  const regexp = /(\d+)-(\d+)/
  const result = regexp[Symbol.match](s)
  if (result !== null) {
    const extracted = [result]
    const [m] = extracted
    return m[1] + m[2]
  }
  return "none"
}
digits("12-34") // "1234"
const regexPatternExit = Effect.runSyncExit(Effect.sync(() => [digits("12-34"), digits("none")])) // Success(["1234", "none"])
```

## Class patterns

A class arm whose class has its own `Symbol.customMatcher` (an own property, `Object.hasOwn(C, Symbol.customMatcher)`) reads and calls that matcher when the pattern runs, as the draft says. A static matcher inherited from a superclass is not an own matcher: for `class B extends A {}`, `when B:` tests `s instanceof B` (decided details 67 and 93). Inherited lookup would make `class Sub extends NotFound {}` match every `NotFound` through its superclass’s tag matcher. VIP-7's retained fixed patterns below are recognized before this test. Any other class uses `instanceof`; the runtime never installs the draft's `Function.prototype` matcher.

- An `error` class ([Failures](003-failures.md#error-declarations)), including a `schema error`, gets a matcher that tests `_tag`. It returns `[subject]` on a match and `false` otherwise; `when NotFound(let e):` binds that subject. `when NotFound():` never matches: the matcher returns one element, but the extractor has zero argument patterns. Write `when NotFound:` for a bare test. Thus `when NotFound:` matches across copies of the same package. The TypeScript counterpart is in [Failures](003-failures.md#error-declarations).
- `data` variants get no custom matchers. Match them with object patterns on `_tag`: `when { _tag: "Sent", let tracking }: …` ([Data](006-data.md#data-declarations)). Only `error` and `schema error` declarations, and the retained Effect checks, have their own matcher.
- A class pattern whose expression resolves to a `data` declaration or variant constructor, a `schema` declaration or a directly constructed `Context.Reference` is `EK0702` (decided detail 67b): under the draft such a function would be called with the subject and match almost anything. The quick fix for a variant writes `when { _tag: "Sent" }:`; for a schema, test `Schema.is(Address)(x)` in a guard. Every `service` declaration, with or without `defaultValue`, reports `EK3004` instead ([Services](005-services.md#static-rules)).
- **No run-time patching of Effect.** The thirty-nine fixed patterns below are compiler intrinsics until Effect ships matchers. The names are pattern syntax, not values exported by Effect 4.1.0. Recognition follows the resolved module binding, including aliases: `import * as O from "effect/Option"` permits `when O.Some(let v):`. A local `Option` instead uses TC39's matcher lookup; spelling alone never selects an intrinsic.
- Thirty-three of the thirty-nine are Effect’s tagged errors, each tested with its module’s own guard (decided detail 53). The alias and shadowing rule above applies. Neither `instanceof`, a universal `_tag` test nor the subject’s static type replaces the guard.
- Built-in constructor patterns use `Array.isArray(subject)` for `Array`, and `subject instanceof C` for every other built-in, including native errors, `AggregateError`, `Date`, `RegExp`, collections, `Promise`, typed arrays and `ArrayBuffer` (decided detail 67a). A cross-realm array matches; other cross-realm built-ins may fail. Native-error matching follows the current prototype chain, not an inaccessible original native-error kind. `String`, `Number`, `Boolean`, `BigInt` and `Symbol` test the primitive or its boxed object, `typeof s === "string" || s instanceof String` and so on, and extract `[s]` for a primitive and `[s.valueOf()]` for a boxed object (decided detail 87). Extraction otherwise follows the draft; no methods are defined on globals. Ordinary classes without an explicit matcher, including classes imported from untouched `.ts` or `.js`, instead test `subject instanceof C`, then extract as the draft specifies (decided detail 67). No helper patches `Function.prototype` or records construction identity. This deliberately differs from the snapshot's `[[ConstructedBy]]` test: changing a genuine instance's prototype can make it stop matching, while forging a prototype can make an object match. A future switch to engine matchers requires a VIP. Where an engine lacks `Symbol.customMatcher`, the runtime defines the symbol ([Runtime guarantees](008-runtime.md)).

For an ordinary class without an own matcher, the draft’s successful test returns `true`, not `[s]`: using it as an extractor throws `TypeError`, rather than binding an instance. Built-in adapters retain their own extraction rules: `Array` and typed arrays return the subject as the list; `Map` and `Set` return `[subject]`.

After own matchers, fixed patterns, built-ins and declaration diagnostics, dispatch uses the callee’s static signatures (decided detail 94): a construct signature selects `instanceof`, including ES5 constructors declared as constructable; call signatures only select `C(subject, { matchType })`, preserving a member receiver. A bare call-only pattern requires a return type assignable to `boolean`; an extractor requires `Iterable<unknown> | false`. Other return types, and callees with neither signature (`any`, `unknown`, `Function`, non-callable objects), are `EK0702`; quick fix: test the call in a guard. Type predicates narrow as ordinary TypeScript calls do. The global `Function` still reports `EK0107`; use a `typeof` guard.

```vibe es
// compiler-gap: pending VIP-7
function isText(s: unknown): s is string { return typeof s === "string" }
function callableLabel(s: unknown) {
  return match (s) { when isText: s.toUpperCase(); when Array.isArray: s.length; default: 0; }
}
```

```ts effect
function isText(s: unknown): s is string { return typeof s === "string" }
function callableLabel(s: unknown) {
  // Runtime calls also receive the protocol hint; extra JS arguments do not affect these predicates.
  if (isText(s)) return s.toUpperCase()
  if (Array.isArray(s)) return s.length
  return 0
}
callableLabel("sent") // "SENT"
callableLabel([1, 2]) // 2
```

An ordinary-class extractor without an own matcher is `EK0704`, with any argument count, including `()` (decided detail 100). An inherited matcher does not count. Quick fixes: `when C:`; or, when the arguments bind the constructor’s parameter properties, `when C and { p1: let a, p2: let b }:`. A bypass through `any` retains the draft’s run-time `TypeError` on recognition.

```vibe es
// compiler-gap: pending VIP-7
class Point { constructor(readonly x: number, readonly y: number) {} }
function sum(p: unknown) {
  return match (p) { when Point and { x: let x, y: let y }: x + y; default: 0; }
}
// when Point(let x, let y): is EK0704; when Point: is a bare instanceof test.
```

```ts effect
class Point { constructor(readonly x: number, readonly y: number) {} }
function sum(p: unknown) {
  if (p instanceof Point && "x" in p && "y" in p) {
    const x = p.x, y = p.y
    return x + y
  }
  return 0
}
sum(new Point(2, 3)) // 5
```

```vibe es
// compiler-gap: pending VIP-7
class A {
  static [Symbol.customMatcher](s: unknown, _options: { matchType: "boolean" }) {
    return s === "inherited"
  }
}
class B extends A {}
function inherited(s: unknown) {
  return match (s) { when B: "yes"; default: "no"; }   // B has no own matcher: s instanceof B
}
function builtin(s: unknown) {
  return match (s) { when Array: "array"; when TypeError: "type"; when String(let t): t; default: "other"; }
}
```

```ts effect
const customMatcher: unique symbol = Symbol.for("Symbol.customMatcher")
class A {
  static [customMatcher](s: unknown, _options: { matchType: "boolean" }) {
    return s === "inherited"
  }
}
class B extends A {}
// Stand-in for the runtime-provided Symbol.customMatcher key.
function inherited(s: unknown) {
  // B has no own matcher (Object.hasOwn(B, customMatcher) is false), so the test is instanceof
  return s instanceof B ? "yes" : "no"
}
function builtin(s: unknown) {
  if (Array.isArray(s)) return "array"
  if (s instanceof TypeError) return "type"
  if (typeof s === "string" || s instanceof String) return typeof s === "string" ? s : s.valueOf()
  return "other"
}
inherited("inherited") // "no": A's matcher is inherited, not own
inherited(new B())     // "yes"
const changed = new TypeError()
Object.setPrototypeOf(changed, Error.prototype)
builtin(changed) // "other"
builtin(Object.create(TypeError.prototype)) // "type"
```

Zero-argument extractors: `Option.None()` matches (`[]`); `NotFound()` and the thirty-three retained error constructors with `()` never match (`[s]`). When a class or fixed pattern's extracted list has a statically known length (an `error` or `schema error` class and the thirty-three retained errors: 1; `Option.Some`, `Exit.*`, `Result.*`: 1; `Option.None`: 0) and its known length lies outside the admitted interval of an extractor without a rest pattern: required positions through total positions, counting every elision slot and counting optional elements only in the maximum, VibeLang reports the VIP-38 lint warning `EK0703`, with the quick fixes `when X:` and, for a singleton list, `when X(let e):` (decided detail 82). The interval controls only this warning; actual list patterns still decide matching. For example, `Option.None(1?)` admits its empty extracted list and is not warned.

```vibe es
// compiler-gap: pending VIP-7
match (e) { when NotFound(): 1; default: 0; }      // warning EK0703: never matches; write NotFound or NotFound(let e)
match (o) { when Option.None(): 1; default: 0; }   // ok: its list is []
```

```vibe es
// compiler-gap: pending VIP-7
class Foreign {}
effect function classify(x: unknown) {
  return match (x) { when Foreign: "yes"; default: "no"; }
}
const real = new Foreign()
Object.setPrototypeOf(real, null)
const fake = Object.create(Foreign.prototype)
// classify(real) succeeds with "no"; classify(fake) succeeds with "yes".
```

```ts effect
import { Effect } from "effect"

class Foreign {}
function classify(x: unknown) {
  return Effect.gen(function* () {
    return x instanceof Foreign ? "yes" : "no"
  })
}
const real = new Foreign()
Object.setPrototypeOf(real, null)
const fake = Object.create(Foreign.prototype)
Effect.runSync(classify(real)) // "no"
Effect.runSync(classify(fake)) // "yes"
```

<a id="retained-effect-tagged-error-patterns"></a>

## Retained fixed patterns

VIP-7 keeps today's fixed checks (D208) until Effect ships matchers: the six `Option`, `Exit` and `Result` patterns and Effect 4.1.0's thirty-three tagged errors (decided details 53, 86 and 92). Each is recognized by its resolved module binding, aliases included, shadowing excluded. `s` is the subject, evaluated once. A bare pattern only runs the test. An extractor matches the listed array against its argument patterns by the snapshot's list rules: without rest, the extracted length must fit the required-to-total position interval and every present sub-pattern must match. Zero arguments match only `[]`; absent optionals consume zero positions, so `Option.None(1?)` also matches. An arity mismatch is a failed match (`EK0703` warns).

| Pattern | Ordered test on `s` | List |
| --- | --- | --- |
| `Option.Some` | `Option.isOption(s) && Option.isSome(s)` | `[s.value]` |
| `Option.None` | `Option.isOption(s) && Option.isNone(s)` | `[]` |
| `Exit.Success` | `Exit.isExit(s) && Exit.isSuccess(s)` | `[s.value]` |
| `Exit.Failure` | `Exit.isExit(s) && Exit.isFailure(s)` | `[s.cause]` |
| `Result.Success` | `Result.isResult(s) && Result.isSuccess(s)` | `[s.success]` |
| `Result.Failure` | `Result.isResult(s) && Result.isFailure(s)` | `[s.failure]` |
| `Cause.NoSuchElementError` | `Cause.isNoSuchElementError(s)` | `[s]` |
| `Cause.TimeoutError` | `Cause.isTimeoutError(s)` | `[s]` |
| `Cause.IllegalArgumentError` | `Cause.isIllegalArgumentError(s)` | `[s]` |
| `Cause.ExceededCapacityError` | `Cause.isExceededCapacityError(s)` | `[s]` |
| `Cause.AsyncFiberError` | `Cause.isAsyncFiberError(s)` | `[s]` |
| `Cause.UnknownError` | `Cause.isUnknownError(s)` | `[s]` |
| `Schema.SchemaError` | `Schema.isSchemaError(s)` | `[s]` |
| `Cron.CronParseError` | `Cron.isCronParseError(s)` | `[s]` |
| `PlatformError.PlatformError` | `PlatformError.isPlatformError(s)` | `[s]` |
| `SemVer.SemVerError` | `SemVer.isSemVerError(s)` | `[s]` |
| `Terminal.QuitError` | `Terminal.isQuitError(s)` | `[s]` |
| `TextDiff.TextDiffError` | `TextDiff.isTextDiffError(s)` | `[s]` |
| `AiError.AiError` (`effect/ai/AiError`) | `AiError.isAiError(s)` | `[s]` |
| `McpClientError.McpClientError` (`effect/ai/McpClientError`) | `McpClientError.isMcpClientError(s)` | `[s]` |
| `CryptoError.CryptoError` (`effect/crypto/CryptoError`) | `CryptoError.isCryptoError(s)` | `[s]` |
| `Csv.CsvError` (`effect/encoding/Csv`) | `Csv.isCsvError(s)` | `[s]` |
| `EncodingError.EncodingError` (`effect/encoding/EncodingError`) | `EncodingError.isEncodingError(s)` | `[s]` |
| `JsonArray.JsonArrayError` (`effect/encoding/JsonArray`) | `JsonArray.isJsonArrayError(s)` | `[s]` |
| `Ndjson.NdjsonError` (`effect/encoding/Ndjson`) | `Ndjson.isNdjsonError(s)` | `[s]` |
| `Tar.TarError` (`effect/encoding/Tar`) | `Tar.isTarError(s)` | `[s]` |
| `Xml.XmlError` (`effect/encoding/Xml`) | `Xml.isXmlError(s)` | `[s]` |
| `Zip.ZipError` (`effect/encoding/Zip`) | `Zip.isZipError(s)` | `[s]` |
| `GraphQLClientError.GraphQLClientError` (`effect/graphql/GraphQLClientError`) | `GraphQLClientError.isGraphQLClientError(s)` | `[s]` |
| `Cookies.CookiesError` (`effect/http/Cookies`) | `Cookies.isCookiesError(s)` | `[s]` |
| `Headers.HeaderParseError` (`effect/http/Headers`) | `Headers.isHeaderParseError(s)` | `[s]` |
| `HttpBody.HttpBodyError` (`effect/http/HttpBody`) | `HttpBody.isHttpBodyError(s)` | `[s]` |
| `HttpClientError.HttpClientError` (`effect/http/HttpClientError`) | `HttpClientError.isHttpClientError(s)` | `[s]` |
| `HttpServerError.HttpServerError` (`effect/http/HttpServerError`) | `HttpServerError.isHttpServerError(s)` | `[s]` |
| `Multipart.MultipartError` (`effect/http/Multipart`) | `Multipart.isMultipartError(s)` | `[s]` |
| `DatagramSocket.DatagramSocketError` (`effect/socket/DatagramSocket`) | `DatagramSocket.isDatagramSocketError(s)` | `[s]` |
| `Socket.SocketError` (`effect/socket/Socket`) | `Socket.isSocketError(s)` | `[s]` |
| `SqlError.SqlError` (`effect/sql/SqlError`) | `SqlError.isSqlError(s)` | `[s]` |
| `WorkerError.WorkerError` (`effect/workers/WorkerError`) | `WorkerError.isWorkerError(s)` | `[s]` |

The tagged-error guards recognize Effect's brands across installed copies and reject an unbranded object with only the same `_tag`. Every other constructor, including `Config.ConfigError` (no guard), `PlatformError.BadArgument` and `PlatformError.SystemError`, follows [Class patterns](#class-patterns): its own `Symbol.customMatcher` if present, otherwise `instanceof`. `cli/CliError` is a union with no constructor; its members and nested reason classes without companion guards use ordinary class matching. A VIP-32 Effect version bump updates this inventory.

```vibe es
// compiler-gap: pending VIP-7
import * as O from "effect/Option"
effect function unwrap(s: unknown) {
  return match (s) {
    when O.Some(let v): v;
    when O.None: "none";
    when Exit.Success(let v): v;
    when Exit.Failure(let c): c;
    when Result.Success(let v): v;
    when Result.Failure(let e): e;
    default: "other";
  }
}
// A local Option is matched as an ordinary class instead (Class patterns).
```

```ts effect
import { Effect, Exit, Option as O, Result } from "effect"

function unwrap(s: unknown) {
  return Effect.gen(function* () {
    const subject = s
    if (O.isOption(subject) && O.isSome(subject)) return subject.value
    if (O.isOption(subject) && O.isNone(subject)) return "none"
    if (Exit.isExit(subject) && Exit.isSuccess(subject)) return subject.value
    if (Exit.isExit(subject) && Exit.isFailure(subject)) return subject.cause
    if (Result.isResult(subject) && Result.isSuccess(subject)) return subject.success
    if (Result.isResult(subject) && Result.isFailure(subject)) return subject.failure
    return "other"
  })
}
```

```vibe es
// compiler-gap: pending VIP-7
function errorLabel(e: unknown) {
  return match (e) {
    when Cause.TimeoutError(let t): t._tag;
    when Schema.SchemaError: "invalid";
    default: "other";
  }
}
```

```ts effect
import { Cause, Schema } from "effect"

function errorLabel(e: unknown) {
  const subject = e
  if (Cause.isTimeoutError(subject)) {
    const t = subject
    return t._tag
  }
  if (Schema.isSchemaError(subject)) return "invalid"
  return "other"
}
```

```vibe es
// compiler-gap: pending VIP-7
errorLabel(new Cause.TimeoutError())        // "TimeoutError"
errorLabel({ _tag: "TimeoutError" })        // "other": no Effect brand
```

```ts effect
import { Cause } from "effect"

const taggedErrorLabel = (e: unknown) =>
  Cause.isTimeoutError(e) ? e._tag : "other"

taggedErrorLabel(new Cause.TimeoutError())  // "TimeoutError"
taggedErrorLabel({ _tag: "TimeoutError" })  // "other"
```

```vibe es
// compiler-gap: pending VIP-7
import * as CryptoError from "effect/crypto/CryptoError"
function cryptoLabel(e: unknown) {
  return match (e) { when CryptoError.CryptoError(let c): c._tag; default: "other"; }
}
```

```ts effect
import * as CryptoError from "effect/crypto/CryptoError"
function cryptoLabel(e: unknown) {
  if (CryptoError.isCryptoError(e)) {
    const c = e
    return c._tag
  }
  return "other"
}
```
