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
  const iterator: Iterator<number, undefined> = values[Symbol.iterator]()
  const a = iterator.next()
  const b = iterator.next()
  return !a.done && !b.done && iterator.next().done ? a.value + b.value : 0
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

These bindings take part in TypeScript's definite-assignment and use-before-declaration checks, as a `let` assigned where the pattern runs would. A read on a path where the binding may not have run, because short-circuiting skipped it or the pattern failed before reaching it, is `TS2454`; a read before the binding's position in its scope is `TS2448`. A read those checks can't see, such as one inside a closure, throws `ReferenceError` while the cell is uninitialized.

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
  // @ts-expect-error: TS2454, short-circuiting skipped the binding's initialization
  if (true || (1 is const n)) return n
  return 0
} // Die(ReferenceError)
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

Patterns type as the TypeScript counterpart this chapter shows for them, under the project's compiler options; the table below illustrates `tsc --strict` ([VIP-7](../vips/0007-match.md#decision), amended).

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

The table shows `tsc --strict` types. Other options change a binding as they change its counterpart's value: with `exactOptionalPropertyTypes`, `{ let x }` on `{ x?: number }` binds `number`; `strictNullChecks: false` removes the strict null distinctions. A pattern reads an element or key only after proving it exists, so `noUncheckedIndexedAccess` adds no `undefined` to that generated read. Actual payload `undefined` remains: `[let v]` on `(number | undefined)[]` binds `number | undefined`. A pattern key is not dotted property access, so `noPropertyAccessFromIndexSignature` reports no `TS4111` at it. Written reads such as `s[0]` or `s.a` in an arm or guard keep both options ([VIP-7](../vips/0007-match.md#decision), amended).

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
// Stand-in for the runtime-provided Symbol.customMatcher key.
const customMatcher: unique symbol = Symbol.for("Symbol.customMatcher")
class OnlyNumbers {
  static [customMatcher](s: unknown): boolean { return typeof s === "number" }
}
function negated(s: OnlyNumbers | number) {
  if (!OnlyNumbers[customMatcher](s)) {
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

The following is a local typing witness for one `Array(let n)` arm and a tuple-returning custom matcher. The native loop preserves the element type, and its tagged result carries the fact that one element was obtained before the binding read; an array-length comparison alone does not carry it in TypeScript. Tuple extraction keeps its positional types. A payload that includes `undefined` keeps that type after the presence test. This witness does not replace the general cached Iterator Record, failed-extraction, ordered-arm or `FinishMatch` algorithms.

```ts effect
const numericMatcher: unique symbol = Symbol.for("Symbol.customMatcher")
class Numeric {
  static [numericMatcher](s: unknown, _options: { matchType: "extractor" }): false | [number] {
    return typeof s === "number" ? [s] : false
  }
}
function first(s: number[]) {
  const extracted = s // Array adapter, after Array.isArray(s)
  let selected: IteratorResult<number, undefined> = { done: true, value: undefined }
  for (const value of extracted) {
    if (!selected.done) return "other" // a second element: native for-of closes
    selected = { done: false, value }
  }
  if (!selected.done) {
    const n = selected.value
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

The first `do…while` body runs with the initial uninitialized head cells. Its direct reads precede the binding, so they are `TS2448`, and with the check suppressed they throw `ReferenceError`; closures captured there keep those cells permanently in TDZ. Each subsequent condition gets new cells; its true result shares them with the following body. `continue` reaches a fresh condition set, and false/`break` exits without exporting names. The initial closures are never rebound to a later condition. `if` keeps its existing nearest-block scope; the within-one-`or` replacement above is unchanged.

Every other home follows the pinned explainer's rule that the usual binding scopes apply, with ECMAScript's environments:

- In `for (init; test; update)`, a binding from `init` belongs to the loop head, as a name declared by a `let` or `const` declaration in `init` would, whether `init` is a declaration or an expression: CreatePerIterationEnvironment copies a `let` binding into each iteration, and a `const` binding stays in the loop scope. A binding from `test` or `update` is a fresh, uninitialized cell in each environment CreatePerIterationEnvironment creates, shared by the update, test and body that run there and never copied forward, as for a `while` condition.
- In `for…in`, `for…of`, `for await`, `for concurrent` and `for try`, a binding from the head expression, which runs once in the head's own environment, is copied into each iteration's binding environment; a skipped binding is copied uninitialized. A binding from a default inside the head declaration belongs to that iteration's fresh binding environment.
- In a concise arrow body, a binding belongs to the arrow body's scope, where the block-body form would declare it.
- In a class field or static field initializer, a binding belongs to that initializer's own scope, because ECMAScript evaluates each initializer as a separate method-like body. A `static` block is a block.
- An `enum` member initializer has no lexical home in ECMAScript or the pinned explainer, so a binding introduced there is `EK0705`, as for a formal parameter: `enum E { A = (1 is let one) ? 1 : 0 }` is `EK0705`.

Each binding stays in TDZ until its pattern runs, under the checks in [`is` expressions](#is-expressions).

```vibe es
// compiler-gap: pending VIP-7
function drain(it: Iterator<number>) {
  const out: (() => number)[] = []
  for (; it.next() is { done: false, value: let v }; ) out.push(() => v)
  return out.map(g => g()) // [1, 2, 3] for [1, 2, 3]: a fresh v each iteration
}
function countdown(src: { n: number }) {
  const seen: (() => number)[] = []
  for (src.n is let n; n > 0; n--) seen.push(() => n)
  return seen.map(g => g()) // [3, 2, 1] for n = 3: copied each iteration, as a let is
}
```

```ts effect
import { Effect } from "effect"

function drain(it: Iterator<number>) {
  const out: (() => number)[] = []
  for (;;) {
    const r = it.next()
    if (!("done" in r && r.done === false && "value" in r)) break
    const v = r.value
    out.push(() => v)
  }
  return out.map(g => g())
}
function countdown(src: { n: number }) {
  const seen: (() => number)[] = []
  for (let n = src.n; n > 0; n--) seen.push(() => n)
  return seen.map(g => g())
}
const loopHomesExit = Effect.runSyncExit(Effect.sync(() => [drain([1, 2, 3][Symbol.iterator]()), countdown({ n: 3 })])) // Success([[1, 2, 3], [3, 2, 1]])
```

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
  // @ts-expect-error: TS2454, the successful condition skipped initialization
  while (true || (1 is const x)) { return x }
} // Die(ReferenceError)
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
| an `is` pattern binding in formal-parameter initialization with no explicit block/arm as its lexical home ([Parameter initialization](#is-bindings-in-parameter-initialization)) | `EK0705` |
| a class pattern naming a `data` declaration or variant, a `schema`, or a directly constructed `Context.Reference`; a call-only callee whose return type fails detail 94, or a callee with neither signature (services use `EK3004`; [Class patterns](#class-patterns)) | `EK0702` |
| an ordinary-class extractor without an own matcher (detail 100) | `EK0704` |
| lint warning: an extractor whose argument count can never match its pattern's list ([Class patterns](#class-patterns)) | `EK0703` |
| a `return`, `break` or `continue` that leaves an `async match` ([Async jumps](#async-match-jumps)) | `EK0706` |

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

[AsyncMatchExpression](900-appendices.md#asyncmatchexpression) is a primary expression; no line terminator may separate `async` and `match`. `async match (s) { … }` has the async-function behavior `(async () => match (s) { … })()`: subject evaluation, tests and the selected arm run inside the async function. `await` is allowed there; a thrown exception, including the no-match `TypeError`, rejects the resulting `Promise`. The explicit [VIP-7 reconciliation](../vips/tc39-pattern-matching/README.md#reconciliations-with-the-drafts-text) gives the subject, tests and arms `[~Yield, +Await, ~Return, ~Effect]` contexts, even inside a plain function. Under VIP-7, a `return` in it, and a `break` or `continue` whose target is outside it, are syntax errors. Nested source callables retain their own grammar contexts.

<a id="async-match-jumps"></a>`EK0706` reports a jump out of an `async match`: a `return` that belongs to the `async match`, or a `break` or `continue` whose target is outside it. The rule covers the subject, patterns, guards and arm expressions, including a `do` expression in them. A `return` in a nested function belongs to that function, and a `break` or `continue` whose target is inside the `async match` follows the ordinary rules. Ownership and targets come from the source, not from the generated async function; a `break` or `continue` with no target anywhere keeps TypeScript's own error. No quick fix rewrites the jump, because no jump can cross the `Promise` boundary.

```vibe es
// compiler-gap: pending VIP-7
function outward(xs: number[]) {
  for (const x of xs) {
    const early = async match (x) { when 0: do { return 1 }; default: 0; } // EK0706: the return belongs to the async match
    const stop = async match (x) { when 0: do { break }; default: 0; } // EK0706: the loop is outside the async match
  }
}
function inward() {
  return async match (0) {
    when 0: (() => {
      let value = 0
      local: for (let i = 0; i < 3; i++) {
        if (i === 0) continue local
        value = i
        break local
      }
      return value
    })();
    default: 0;
  } // ok: the arrow owns its return, and the loop is inside it
}
```

The rejected jumps have no counterpart. `inward` has the ordinary async counterpart:

```ts effect
import { Effect } from "effect"

function inward() {
  return (async () => {
    const subject = 0
    if (subject === 0) {
      return (() => {
        let value = 0
        local: for (let i = 0; i < 3; i++) {
          if (i === 0) continue local
          value = i
          break local
        }
        return value
      })()
    }
    return 0
  })()
}
const inwardExit = await Effect.runPromiseExit(Effect.promise(inward)) // Success(1)
```

`asyncLabel` shows the async-function behavior:

```vibe es
// compiler-gap: pending VIP-7
function asyncLabel(s: Promise<string>) {
  return async match (await s) {
    when "sent": await Promise.resolve("sent");
  }
}
function asyncNested(s: Promise<string>) {
  return async match (await s) {
    when "sent": (() => { return 1 })();
    default: 0;
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
function asyncNested(s: Promise<string>) {
  return (async () => {
    const subject = await s
    if (subject === "sent") return (() => { return 1 })()
    return 0
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


## `is` bindings in parameter initialization

An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home. This includes direct defaults, defaults nested in parameter destructuring, and evaluated computed binding keys. The pinned explainer leaves that scope unfinished, so no parameter-home binding is invented or moved into the body.

A binding-free test remains allowed. A binding in an explicit source block within the initializer, including a `do` block or a match arm's scope, belongs to that block/arm and does not escape to other parameters or the body. Nested source callable bodies keep their own scopes and boundaries. Ordinary call arguments in a lexical block retain that block's binding rule; they are not formal parameters.

A repair preserves eager, left-to-right, once-only initialization, parameter/body environment separation, `length`, TDZ and closure identity. An explicit local block can return the needed result; a different explicit parameter is an option only when it preserves the intended API. There is no generic move-to-body quick fix. Execution and exception boundaries retain the [shared default rules](002-running.md#destructuring-and-parameter-defaults).

```vibe es
// compiler-gap: pending VIP-7
function bad(a = (1 is let captured)) { return a } // EK0705
function nested({ a = (1 is const captured) } = {}) {} // EK0705
function key({ [(1 is let captured) ? "x" : "y"]: value }: { x?: number; y?: number } = {}) {} // EK0705
function testOnly(a = (1 is 1)) { return a } // allowed: no new binding
function good(a = do { const ok = 1 is let captured; [ok, captured] }) { return a }
function arm(a = match (1) { when let x: (1 is let captured) ? captured : 0; }) { return a }
function body(a = () => (1 is let captured)) { return a } // nested source body
function reader(seed: number, a = do { seed is let captured; () => ++captured }) { return a }
function caller() { consume(1 is let captured); return captured } // caller's lexical block
```

For the simple non-jumping block-local default and ordinary call-argument witnesses, the native counterparts preserve the local cell and call phase:

```ts effect
import { Effect } from "effect"
function good(a = (() => { let captured = 1; const ok = true; return [ok, captured] })()) {
  return a
}
function testOnly(a = (1 === 1)) { return a }
function reader(seed: number, a = (() => { let captured = seed; return () => ++captured })()) { return a }
function caller() {
  let captured = 1
  consume(true)
  return captured
}
function consume(_value: boolean) {}
const defaultEvents: string[] = []
function eager(
  a = (() => { defaultEvents.push("default"); let captured = 1; return captured })(),
  b = (defaultEvents.push("later"), 2)
) {
  defaultEvents.push("body")
  return [a, b]
}
const parameterScopeExit = Effect.runSyncExit(Effect.sync(() => [good(), testOnly(), caller(), eager()])) // Success([[true, 1], true, 1, [1, 2]])
defaultEvents // ["default", "later", "body"]
const readerScopeExit = Effect.runSyncExit(Effect.sync(() => {
  const first = reader(1), second = reader(100)
  return [first(), second(), first()]
})) // Success([2, 101, 3])
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
    const extracted: [RegExpMatchArray] = [result]
    const [m] = extracted
    return m[1] + m[2] // reads the source writes keep noUncheckedIndexedAccess
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

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 112

**Async match resolves its arm union using TypeScript's async return adoption.** (live `004-async-result-adoption`; amends detail 79's Result shorthand.) Let `U` be the union of arm result types. The result is `Promise<Awaited<U>>`, using TypeScript's actual async-return resolution, including its Promise-like/thenable checks, not `Promise<U>` when U itself contains a Promise. Keep the existing async boundary and explicit Effect bridge.
    **Immutable-main source portion (098e7a, 112).** 002/publicVIP5 now state immediate Effect success data for returns, successful try and plain handlers, with no implicit Effect execution or thenable assimilation; explicit Promise runners retain native resolution. The unadopted async-do analogy is replaced by an invoked native async arrow. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope.
    **Immutable-main source scope (2756e4, 112).** 004 now uses Promise<Awaited<U>> with native async-return/thenable adoption, matching the earlier publicVIP7 amendment. This verifies the chapter source portion, not compiler typing/emission. `main-275-source-receipt.json` records the complete two-file read; no own compiler/gate/native rerun.
    **Immutable-main source scope (d50d73, 112).** Public VIP7 now states `Promise<Awaited<U>>` async arm-result adoption using native TypeScript thenable rules and the existing async/bridge boundary. Only this public-amendment source portion is independently verified in this batch. `main-d50-source-receipt.json` records the complete two-file source read; no compiler/gate rerun.
    Current replacement: applied in 25d3d1f2413d9814e2881b92145ad833ad0cec67 (spec-fix-c; supersedes 896853cf4870 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 896853cf4870b2500152bb4951c2d2203526041c (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    const n: Promise<number> = async match (true) { default: Promise.resolve(7); }
    ```
    Effect TS: `const n: Promise<number> = (async () => { return Promise.resolve(7) })()`; `Effect.promise(() => n)` succeeds with 7. Decided by the agent from principle 2 (TypeScript async return typing) and VIP-7's already-chosen async-function counterpart, 2026-10-29. Apply to detail 79's restatement and 004's typing table.

    Native adoption versus success-data source receipt: accepted VIP-1/VIP-5 distinguish native async/Promise resolution from immediate Effect success data at function returns, `try` successes and plain-handler results. An Effect-valued success is not implicitly executed; explicit native Promise runners retain native assimilation, with Exit-wrapper and Promise-runner results distinguished. The analogy uses an invoked native async arrow, without adopting `async do` (existing196/VIP-2). Complete source replacement `e9a134a1faae` (spec-fix-b; supersedes b7403e1988b3, queued, not main) includes the printed counterpart in snippet checks. Three documentation baseline failures/native controls then Node10/Bun10, strict TypeScript5.9.3/native Effect4.1.0 and regeneration/forms/spec/docs checks are attributed to the fixer; no new language/API behavior or decide-live compiler execution.

    Landed source receipt: e9a134a1faae as main098e7a04a7b5 (spec-fix-b26, gate mq-10310155-19). Full success-data law and native async-IIFE analogy/004 companion; focused/strict/native and all required source checks pass. No compiler-conformance claim.

### Detail 113

**A negated pattern narrows by negating its actual positive test.** (live `004-negated-custom-class`; amends detail 79's class-negation shorthand.) Only the ordinary-class path whose positive test is `s instanceof C` may use that test's exclusion for `not C`. An own custom matcher negates its own invocation, with only the complement narrowing TypeScript establishes from its declared predicate; a boolean-returning matcher establishes none. Fixed Effect guards and generated tagged-error patterns likewise complement their actual guards/tag tests. Do not substitute instanceof for another matcher or invent extra exhaustiveness coverage; detail 78's coverage remains.
    **Immutable-main source scope (2756e4, 113).** 004 not-pattern row complements the actual recognition test; ownboolean matchers do not become instanceof exclusions or establish narrowing. Chapter source, not compiler conformance. `main-275-source-receipt.json` records the complete two-file read; no own compiler/gate/native rerun.
    **Immutable-main source scope (d50d73, 113).** Public VIP7 now complements each actual recognition test for negation; ordinary boolean matchers establish no narrowing, and no negation coverage is added. Only this public-amendment source portion is independently verified in this batch. `main-d50-source-receipt.json` records the complete two-file source read; no compiler/gate rerun.
    Current replacement: applied in 25d3d1f2413d9814e2881b92145ad833ad0cec67 (spec-fix-c; supersedes 896853cf4870 after main rebase and current-release placement; queued, not a main receipt).
    Publication receipt: applied in c36e89ad7f0d (spec-fix-c; VIP7 actual-test negation; queued, not a main receipt). Existing004 source receipt896853cf4870 remains separate.
    Status: applied in 896853cf4870b2500152bb4951c2d2203526041c (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    class OnlyNumbers {
      static [Symbol.customMatcher](s: unknown): boolean { return typeof s === "number" }
    }
    // s: OnlyNumbers | number
    match (s) { when not OnlyNumbers: s.toFixed(0); default: "number"; } // TS error: no narrowing
    ```
    Effect TS: `if (!OnlyNumbers[Symbol.customMatcher](s)) { s.toFixed(0) }` is a TypeScript error for the union. Decided by the agent from principle 2 (counterpart-based TypeScript narrowing), VIP-7's actual matcher dispatch, and principle 8 (no unproved narrowing), 2026-10-29.

### Detail 119

**Reconcile the disputed TC39 object-key early error with the accepted bare-key syntax.** (live `004-bare-key-early-error`; VIP-7/VIP-16.) VibeLang does not adopt the pinned draft's disputed early error for a MatchProperty PropertyName coverable by BindingIdentifier, either in the bare presence form or before a colon. Bare identifier keys test presence without creating a binding, and identifier keys such as `_tag:` remain valid. Record this explicitly in the vendored README's reconciliation table and 004; do not silently edit the upstream spec.emu. Keep its separate __proto__ pattern-key early error and all unrelated restrictions.
    **Immutable-main source portion (098e7a, 119).** 004/TC39 README explicitly decline only the disputed BindingIdentifier-coverable object-key early error for bare/colon keys, preserving identifier presence keys, `_tag:` and the separate proto restriction. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    Current replacement: applied in 65e5460f15eaee293b112acd006040b4d2ed0f53 (spec-fix-c; supersedes 6d836e97200f after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 6d836e97200fea42d9f717d3cbcfc7a711ca536d (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    const tracking = "outer"
    match ({ tracking: "payload" }) { when { tracking }: tracking; default: "none"; } // "outer"
    match (x) { when { _tag: "Sent", let tracking }: tracking; default: "none"; } // valid keys
    ```
    Effect TS: `"tracking" in subject ? tracking : "none"`, with the pinned cached property operations and ordinary narrowing. Decided by the agent from VIP-16's specifically accepted bare-key rule, VIP-7's already-required reconciliation mechanism, and principle 4 (one meaning for identifier property names), 2026-10-29. This removes an incorporated-draft contradiction; it does not admit a new form.

### Detail 123

**FinishMatch seeds errors only from a throw, preserving return/break/continue when closing succeeds.** (live `004-finishmatch-abrupt-kind`; reconciles the pinned VIP-7 snapshot and refines detail 117.) Replace the incorporated FinishMatch step “if matchCompletion is abrupt, append its Value” with “if matchCompletion is a ThrowCompletion, append its Value”. Keep every pending nonthrow completion's value and target while finishing cached iterators. If closing adds no error, propagate the original return/break/continue; if a close fails, apply the snapshot's close-error/aggregation behavior, which may replace that pending nonthrow completion. Keep aggregation for an actual throw plus closing errors and keep Effect-generator abandonment on yielded failures/interruption. Record this reconciliation in the vendored README and 004; retain the upstream spec.emu unmodified.
    Status: applied in 12d6a3b9ce5e on main (source/cross-reference revalidated by spec-fix-c; no duplicate patch). Native completion/Exit regressions pass in main-decision-receipts.log.
    ```vibe
    effect function answer() {
      const ignored = match (true) { default: do { return 7 }; }
      return 0
    } // succeeds with 7, never dies with 7
    ```
    Effect TS: `Effect.gen(function* () { return 7 })` for the no-iterator witness; the full lowering carries that ReturnCompletion through FinishMatch. Decided by the agent from VIP-2's same-activation do control flow, VIP-7's no-function-boundary match, and principle 2 (ordinary completion kinds are not all throws), 2026-10-29. Add return/break/continue witnesses; this corrects a contradictory draft step, not source control flow.

### Detail 126

**Empty array patterns have one nullable-list derivation and always pass an Iterator Record.** (live `004-array-nullable-list`; VIP-7 pinned-grammar reconciliation.) Reconcile `ArrayPattern` as `"[" MatchList "]"`, requiring the existing nullable `MatchList` nonterminal. Keep its empty alternative, preserving empty array patterns and zero-argument extractor lists. Every array pattern acquires the iterator record and calls `ListPatternMatches` with that record; its empty path calls `FinishListMatch(iteratorRecord, cacheGroup, 0)`. Drop the draft's absent-MatchList branch passing the original subject, which is not an Iterator Record. Keep the snapshot's caching, empty-length check and iterator finishing; do not treat an empty array pattern as a wildcard or make it array-only.
    **Immutable-main source portion (098e7a, 126).** 004/AppendixA/TC39 README now use one required nullable MatchList derivation for ArrayPattern, empty-iterable behavior and cached Iterator Records rather than a subject-as-record empty path. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    Current replacement: applied in 65e5460f15eaee293b112acd006040b4d2ed0f53 (spec-fix-c; supersedes 6d836e97200f after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 6d836e97200fea42d9f717d3cbcfc7a711ca536d (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    match (xs) { when []: "empty"; default: "not empty"; }
    // matches an empty iterable; there is exactly one grammar derivation for []
    ```
    Effect TS: acquire/cache the subject's iterator, test that its first step is done, and perform the pinned finishing operations. Decided by the agent from principle 4 (remove the redundant optional node, the smaller repair), principle 2 (Iterator Record abstract-operation contracts), and VIP-7's admitted empty-list semantics, 2026-10-29. Record this deliberate reconciliation in the vendored README and 004/Appendix A/008 as applicable; keep upstream spec.emu intact.

### Detail 127

**Pattern elisions consume their full ECMAScript width, not one item per Elision node.** (live `004-array-elision-count`; VIP-7 snapshot reconciliation.) In every array-pattern/extractor-list elision branch, compute the Elision width as the number of commas. Pull/cache that many consecutive elements, requiring each skipped position to exist, and advance the visited index/count by the full width before the next element or final length check. Apply this to leading, internal and trailing elisions, preserving cache order and iterator finishing. Retain the vendored upstream text and record the corrected abstract operations in its README, 004 and 008.
    **Immutable-main source portion (fb3e96, 127).** 004/snapshotREADME state full comma-width elision cardinality, required skipped positions and cached-index advancement, with short/full literal witnesses. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    match ([9,3]) { when [,,3]: "hit"; default: "miss"; }   // "miss"
    match ([9,8,3]) { when [,,3]: "hit"; default: "miss"; } // "hit"
    ```
    Effect TS: the pinned list matcher with two cached skips before comparing the third element to 3, then exact-length finishing. Decided by the agent from principle 2 (ECMAScript Elision width), VIP-7's admitted array structure and its pinned explainer, 2026-10-29. This corrects an abstract-operation count; it adds no syntax.

### Detail 128

**An absent optional pattern element consumes zero values; fixed-arity lint uses the admitted length interval.** (live `004-optional-pattern-cardinality`; reconciles the VIP-7 snapshot; refines detail 82.) When an optional MatchElement sees an exhausted iterator, return zero consumed values, retain Done and the unchanged cache, and do not execute its sub-pattern or initialize its bindings. Do not synthesize an undefined element: a present undefined still runs and must satisfy that sub-pattern. Repeated missing optionals keep the same actual index, preserving the cache's sequential-read invariant. The pinned proposal's other binding/scope rules remain; no new absent-binding default is invented.
    **Immutable-main source portion (fb3e96, 128).** 004/snapshotREADME state zero-consumption absent optionals, no absent binding initialization, present-undefined testing and fixed-extractor required-to-total arity interval, including Option.None(1?). Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    match ([]) { when [1?]: "hit"; default: "miss"; }          // "hit": absent
    match ([undefined]) { when [1?]: "hit"; default: "miss"; } // "miss": present undefined is not 1
    match (o) { when Option.None(1?): "none"; default: "some"; } // allowed; [] fits the optional list
    ```
    Effect TS: the fixed `Option.isOption(s) && Option.isNone(s)` test followed by list matching on `[]`, whose absent optional consumes zero values. For detail 82's no-rest fixed-arity warning, use the interval [required elements, total elements], counting each elision position by detail 127 and optional elements only in the maximum. Warn only if the known extracted length lies outside that interval; raw written argument count is insufficient. Decided by the agent from VIP-7's already-admitted optional grammar and its explicit absence branch, principle 2 (Iterator Record/cache invariants), and principle 8 (no false always-failing warning from an unproved arity test), 2026-10-29. Update 004 and the detail-82 lint restatement together.

### Detail 135

**Default-arm narrowing follows failed actual tests, independently of exhaustiveness coverage.** (live `004-default-predicate-complement`; corrects detail 79's coverage-only shorthand.) Type a default arm using TypeScript control flow after all preceding ordered pattern/guard tests have failed, with the actual cached matcher counterpart. A declared predicate's false branch may exclude a type even though that predicate contributes no `EK4701` coverage. Include guards and source mutations in that flow; do not assume a guarded predicate failed its positive predicate test. Detail 78's deliberately conservative coverage algorithm remains separate and unchanged.
    **Immutable-main source scope (2756e4, 135).** 004 default arms follow failed ordered actual tests/guards with cachedreads/mutations, independent of exhaustiveness coverage; failed guards do not prove positivepredicate failure. Chapter source only. `main-275-source-receipt.json` records the complete two-file read; no own compiler/gate/native rerun.
    **Immutable-main source scope (d50d73, 135).** Public VIP7 now types the default arm by actual failed ordered tests/guards, independent of exhaustiveness coverage. Only this public-amendment source portion is independently verified in this batch. `main-d50-source-receipt.json` records the complete two-file source read; no compiler/gate rerun.
    Current replacement: applied in 25d3d1f2413d9814e2881b92145ad833ad0cec67 (spec-fix-c; supersedes 896853cf4870 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 896853cf4870b2500152bb4951c2d2203526041c (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function isText(s: string | number): s is string { return typeof s === "string" }
    function classify(s: string | number) {
      return match (s) { when isText: s.length; default: s.toFixed(0); }
    } // default s: number
    ```
    Effect TS: `if (isText(s)) return s.length; return s.toFixed(0)`, which TypeScript strictly accepts. Decided by the agent from principle 2 (the actual counterpart's true and false branch narrowing), detail 79's overarching counterpart promise, and principle 4 (one control-flow model; coverage only determines missing-case diagnostics), 2026-10-30. Update 004's default sentence and detail-79 restatement after the claimed r19-diffcheck typing table lands; do not stack on its unlanded 68bae0bed8c2.

### Detail 141

**Matching algorithms pass the iterator records their contracts require.** (live `004-iterator-record-flow`; VIP-7 snapshot reconciliation; refines details 117/123/126.) In InvokeCustomMatcher's extractor path, return the Iterator Record from GetIteratorCached, not the user iterable used to acquire it. ListPatternMatches receives that record. GetIteratorCached's IteratorsToClose Set stores private wrapper objects directly; FinishMatch iterates those SetData entries, skips empty slots, and reads each wrapper's internal CachedIterator directly. Do not invent a Value slot or read user-visible IteratorsToClose properties. Keep insertion/closing order, cached iterator reuse, throw-only initial error collection, and settled closing-error aggregation. Record the correction in the vendored README and 004/008 while leaving upstream spec.emu intact.
    **Immutable-main source portion (fb3e96, 141).** 004/008/snapshotREADME explicitly require shared private cached Iterator Records for array/extractor list/cleanup operations, successful custom-extractor objects, insertion-order registry/empty-slot handling and no user Value/IteratorsToClose bookkeeping reads. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    **Immutable-main source portion (098e7a, 141).** 004 now explicitly states that every array/extractor list receives its cached Iterator Record and finishing paths do not receive the original subject. This verifies that public statement, not every internal extractor/SetData correction or runtime implementation. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    class Numeric {
      static [Symbol.customMatcher](s: unknown): false | [number] { return typeof s === "number" ? [s] : false }
    }
    match (7) { when Numeric(let n): n; default: 0; } // 7
    match ([1]) { when [1]: "yes"; default: "no"; } // "yes"
    ```
    Effect TS: call the own matcher, acquire/cache an iterator for its successful iterable result, pass the resulting private Iterator Record to list matching, then finish the cached records in insertion order. Decided by the agent from principle 2 (the stated abstract-operation and ECMAScript SetData contracts), VIP-7's admitted extractor/list semantics, and principle 4 (one private record representation), 2026-10-30. These are value-flow errata, not new match behavior or runtime prototype patches.


## Items 142–143 (lane decide-r20, 2026-10-30: Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later")

Round 20 left NEEDS-WILL 66 and 67. Detail 118 already closes 67; details 106–107 close 66. Every "Undecided (pending VIP)" marker on `main@github` is already decided (details 73, 76–79, 81–83, 102); the round-20 spec (`v20-ready` `a7bb7ca2`) has none. These two items turn the last two class-B defaults into agent decisions, because a principle settles each; `for-will.json` drops `pending-lint-code-overflow` and `pending-computed-error-tag`.

### Detail 144

**Array patterns read the iterator with primitive-capable GetV semantics.** (live `004-array-subject-getv`; VIP-7 snapshot reconciliation.) Null and undefined fail an array pattern. For every other subject, acquire/cache Symbol.iterator with GetV-equivalent semantics; a missing or noncallable iterator method fails the pattern. Preserve the original subject as the receiver for inherited getters and for invoking its iterator method, including primitive strings; do not substitute a wrapper object as receiver. A throwing accessor/method or malformed iterator protocol retains the existing implicit error behavior and per-evaluation cache. Object patterns retain their separate validated-Object HasProperty rules.
    **Immutable-main source portion (fb3e96, 144).** 004/snapshotREADME publish primitive-capable cached GetV iterator lookup, original getter/call receiver, nullish/missing/noncallable misses and native malformed-protocol throws. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function word(s: unknown) { return match (s) { when ["a","b"]: "word"; default: "other"; } }
    word("ab") // "word"
    word(null); word(undefined); word(1) // each "other"
    ```
    Effect TS: after a nullish check, perform the native `subject[Symbol.iterator]` read and call the acquired method with subject as this, then use the cached list matcher and finishing operations. Decided by the agent from VIP-7's admitted iterable subjects, principle 2 (ECMAScript GetV versus Object-only Get), and principle 8 (do not claim an invalid abstract-operation assertion has a defined runtime outcome), 2026-10-30. Record the reconciliation in the vendored README and 004/008; it removes no primitive iterable from the language.

### Detail 146

**The is evaluator retains Boolean results in a Completion and always finishes synchronous matching.** (live `004-is-result-conversion`; VIP-7 snapshot reconciliation, details 117/123.) Capture `Completion(MatchPatternMatches(...))` without an initial `?` unwrapping. A normal completion already contains true or false; preserve it unchanged and pass the Completion Record to FinishMatch. Remove the obsolete conversion from the internal not-matched sentinel, which this operation does not return. A synchronous matcher throw also reaches FinishMatch before propagating; yielded Effect failure/defect/interruption retains the established generator-abandonment rule.
    Status: applied in 12d6a3b9ce5e on main (source/cross-reference revalidated by spec-fix-c; no duplicate patch). Native completion/Exit regressions pass in main-decision-receipts.log.
    ```vibe
    const no = 2 is 1  // false
    const yes = 1 is 1 // true
    ```
    Effect TS: `const a: number = 2, b: number = 1; const no = a === 1; const yes = b === 1` for these tests (widened subjects avoid TypeScript's unrelated disjoint-literal comparison diagnostic), with the pinned completion/finish machinery for general matching. Decided by the agent from VIP-7's Boolean is contract, principle 2 (Completion versus ECMAScript Boolean values), and detail 117's synchronous finishing rule, 2026-10-30. Record this in README/004/008 without editing the vendored upstream text.

### Detail 147

**A pattern guard reads its expression's value before converting it to Boolean.** (live `004-guard-reference-value`; VIP-7 snapshot reconciliation.) Evaluate the guard Expression once, apply GetValue once to the resulting reference/value, and then ToBoolean. This reads identifier/member values, invokes a property getter at the source read, and preserves a lexical TDZ error. Never treat an internal Reference Record as a truthy ECMAScript value. Retain source order, ordinary TypeScript guard narrowing, and existing implicit-error behavior.
    **Immutable-main source portion (fb3e96, 147).** 004/snapshotREADME state once-only guard GetValue before Boolean conversion, preserving getters/TDZ/abrupt read timing. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function classify(flag: boolean) {
      return match (true) { when true and if (flag): "hit"; default: "miss"; }
    }
    classify(false) // "miss"
    ```
    Effect TS: `if (true && flag) return "hit"; return "miss"`, with the subject tested/cached as specified. Decided by the agent from principle 2 (TypeScript if and ECMAScript GetValue/ToBoolean), VIP-7's adopted guard meaning, and principle 4 (one ordinary expression read, no matcher-specific reference conversion), 2026-10-30. Add an explicit reconciliation to README/004; retain the upstream spec.emu and add no new wrapper or diagnostic.

68c. **The spec states destructuring-default behavior, not a lowering recipe** (ends the circle of details 68, 68a and 68b: Sol and Astra rounds 17-20 each found the latest written recipe off in a new edge case). Chapter 002 states the required behavior normatively and drops every statement-level recipe for destructuring defaults: a destructuring pattern in effect code behaves exactly as ECMAScript destructuring (evaluation order, getters, iterator protocol and closing only on the completions and iterator states for which ECMAScript invokes IteratorClose, with a pending throw winning over a close error); a default's admitted suspensions retain the corresponding enclosing source context (`try` in Effect code, native `await` in ordinary async code, and `yield` in its source producer/generator), subject to the existing callable and formal-parameter placement restrictions (118/212); a `do` default's `return`, `break` and `continue` act on the enclosing function or loop. The witnesses stay as normative examples with their Exits (Sol r17: Success(9), Success(7); Sol r18: Die("body"), Die(TypeError)). How the compiler achieves it (native destructuring with inline `yield*`, a runtime helper, or anything else) is the implementation's choice, checked by those witnesses and the fuzz suite. Decided by the agent: a spec defines meaning and an implementation chooses the lowering (principle 4), 2026-10-30.

    **Native closing and witness qualification.** The native operation and iterator state decide whether closing occurs. Acquisition or advancement failures are not blanket-close paths; array binding/assignment follows its own `[[Done]]` checks. Preserve ordinary body/binding exits, iterator receiver and nullish-method handling, and the operation's actual closing/error precedence. For the historical `Die(TypeError)` witness from a primitive `return()` result, the default must have completed normally and the iterator must still require closing. If the default already threw `"body"`, that pending throw wins over a thrown close, a noncallable close or a primitive close result. An exhausted default does not close an already-done iterator. Non-throw abrupt completions such as return or an outward break/continue keep the native rule that a closing error or primitive close result can replace that jump; normal completion is the condition of this particular default-value witness, not the only incoming completion that can expose a close error. Read the earlier 68b/68c finite witnesses with this qualification, rather than overriding the native algorithm. A failure/defect/interruption reached through yielded Effect execution still abandons the generator; an actual JavaScript throw unwinds it according to the native algorithm.
    ```vibe
    effect function normalDefault(xs: Iterable<number | undefined>) {
      const [value = 7] = xs
      return value
    }
    // If a live iterator yields undefined then return() returns 1: Die(TypeError).
    // If it is already exhausted before the default: Success(7), without closing it again.
    ```
    Effect TS: `Effect.gen(function* () { const [value = 7] = xs; return value })` with the same iterator. The earlier getter-throw witness keeps its original thrown value instead of manufacturing the close-result TypeError. Decided by the agent from accepted VIP-2's native destructuring contract, this detail's existing exact-ECMAScript requirement, VIP-5's existing generator-abandonment rule and principle2 (native IteratorClose/BindingInitialization/ForInOfBodyEvaluation), 2026-10-30. Saved ECMA excerpts and native logs were read, not rerun; the completed spec-fix-d36 source/test receipt is attributed. This is an existing-rule/example qualification, with no new permission, lowering recipe, canonical number or Will question.

### Detail 150

**Object pattern properties execute left to right in source order.** (live `004-object-property-order`; VIP-7 snapshot reconciliation.) In the recursive MatchPropertyList operation, evaluate the left prefix first, stop on failure, then evaluate the final property. Concatenate excluded-key results in that order. For each property retain key evaluation, presence check, cached value read, sub-pattern and binding initialization in order; copy object rest only after the property list. The printed right-to-left recursion contradicts the snapshot's explainer and is not adopted.
    **Immutable-main source portion (fb3e96, 150).** 004/snapshotREADME state left-to-right object property/key/presence/value/subpattern/binding order with short-circuit and rest afterward. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    const seen: string[] = []
    const s = { get first() { seen.push("first"); return seen.length }, get second() { seen.push("second"); return seen.length } }
    match (s) { when { first: 1, second: 2 }: "hit"; default: "miss"; } // hit; seen: first, second
    ```
    Effect TS: the source-ordered cached checks first === 1 and then second === 2, short-circuiting on failure. Decided by the agent from the pinned explainer's explicit object-pattern execution order, principle 2 (ordinary TypeScript property evaluation order), and principle 4 (one source-order rule), 2026-10-30. Record the recursion correction in README/004 and keep the upstream spec.emu intact.

### Detail 151

**Object rest retains ordinary CopyDataProperties reads outside the match-specific read cache.** (live `004-object-rest-cache`; refines detail 117's cache summary under VIP-7.) GetCached and the specified presence/iterator operations use the per-evaluation match cache. Object-rest copying uses the pinned CopyDataProperties own-key, enumerability and Get behavior instead; it can re-read a getter already cached by another pattern. Qualify the once-per-match getter statement to cached pattern reads. Do not silently replace rest copying with a new cached-copy algorithm or freeze its current key/descriptor snapshot.
    **Immutable-main source portion (fb3e96, 151).** 004/snapshotREADME distinguish cached pattern reads from ordinary object-rest CopyDataProperties own-key/enumerability/Get behavior; rest may re-read a getter. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    let reads = 0
    const s = { get value() { return ++reads } }
    const result = match (s) { when { value: 0 }: 0; when { ...let rest }: rest.value; }
    // result === 2; reads === 2
    ```
    Effect TS: the first pattern reads/caches s.value; the next arm's ordinary object rest copy reads it again. Decided by the agent from VIP-7's pinned CopyDataProperties operation, principle 2 (TypeScript object-rest behavior), and principle 4 (keep the existing operation rather than add another cache policy), 2026-10-30. Update README/004/008's cache wording consistently.

### Detail 155

**Selected match arms and default arms read their expression values before finishing.** (live `004-arm-reference-value`; VIP-7 snapshot reconciliation, same reference principle as detail 147.) At all three selected/default Expression sites, evaluate once, perform GetValue once, and return that ECMAScript language value to clause traversal. Capture abrupt completions through the existing Completion/FinishMatch path. A selected getter is read before finishing cached iterators, so its throw is part of the pending match completion and aggregation. Do not defer that read to an outer expression or pass an internal Reference Record as a language value. Retain outward jumps and yielded Effect abandonment.
    **Immutable-main source portion (fb3e96, 155).** 004/snapshotREADME state selected/default expression GetValue before iterator finishing, preserving getter/TDZ/abrupt-completion timing. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function choose(answer: number) { return match (1) { when 1: answer; default: 0; } }
    choose(7) // 7
    ```
    Effect TS: `if (subject === 1) return answer; return 0`, with the pinned cache/finish boundary around arm-value acquisition for a general subject. Decided by the agent from VIP-7's arm-value contract, principle 2 (GetValue distinguishes a reference from its value), and principle 4 (one expression-read rule for guards and selected values), 2026-10-30. Keep the upstream draft intact and list the evaluator-site corrections explicitly.

### Detail 159

**Inclusive relational patterns retain the ordinary <= and >= directions.** (live `004-relational-inclusive-direction`; VIP-7 snapshot reconciliation.) For <= use IsLessThan(value, subject, false); for >= use IsLessThan(subject, value, true). Each returns false for a true or undefined comparison result, and true otherwise. Preserve admitted subject types, once-only bound evaluation, subject/bound coercion order and unordered/NaN behavior. The printed swapped arguments implement the opposite bounds and are not an intentional language exception.
    **Immutable-main source portion (fb3e96, 159).** 004/snapshotREADME publish ordinary admitted-subject <=/>= direction, once-only bound/coercion order, unordered failure and rejection before bound evaluation for other subject types. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    match (1) { when <= 2: "small"; default: "large"; } // small
    match (1) { when >= 2: "large"; default: "small"; } // small
    ```
    Effect TS: ordinary subject <= bound and subject >= bound after the source's once-only evaluations, with the snapshot's subject-admission rule. Decided by the agent from principle 2 (the named ECMAScript/TypeScript comparisons), VIP-7's relational-pattern meaning, and principle 4 (inclusive forms agree with their strict counterparts), 2026-10-30. Reconcile the two algorithms in README/004; leave upstream spec.emu intact.

### Detail 165

**Later or alternatives may replace the same pattern binding initialized by a failed alternative.** (live `004-or-binding-replacement`; VIP-7 snapshot reconciliation.) Adopt the pinned explainer's explicit replacement rule: track initialization provenance within the relevant or pattern and permit a later same-keyword binding to replace a cell initialized by a failed earlier alternative. Preserve that cell's identity so a saved closure sees the replacement. Retain the ordinary TDZ before first initialization, user-facing const immutability, and duplicate-initialization errors outside this authorized replacement. Do not implement separate disconnected cells per alternative or reset unrelated bindings.
    **Immutable-main source portion (098e7a, 165).** 004/README now preserve one shared same-keyword or-binding cell and permit only the authorized replacement after a failed earlier alternative; unrelated bindings, TDZ and const assignment rules remain. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    **Immutable-main source scope (d0cdbe, 165).** Public VIP7 shared-cell/or replacement amendment published; this receipt does not certify the separately queued full chapter/counterpart slice. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Current replacement: applied in c1aba4c130998919c6116ebe436e28fec4f639f1 (spec-fix-c; supersedes 1325fb6df62c after main rebase and current-release placement; queued, not a main receipt).
    Publication receipt: applied in ac8433dd4267 (spec-fix-c; VIP7 cell rules; queued, not a main receipt).
    Status: applied in 1325fb6df62cafb4f1c52d1665ad7f24dcf4c99c (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    match ([5]) { when ([let x and String]) or { length: let x }: x; default: 0; } // 1
    ```
    Effect TS: one hygienic pattern-binding cell receives 5 in the failed left branch, then 1 in the successful right branch; reads/closures share that cell. Decided by the agent from VIP-7's incorporated explainer example, principle 2 (the expressly specified or binding behavior), and principle 4 (one shared binding identity rather than per-alternative source scopes), 2026-10-30. Reconcile or and VariableDeclarationPatternMatches in README/004 while retaining the upstream draft.

### Detail 168

**Primitive template patterns follow the formal no-substitution grammar for now.** (live `004-interpolated-template-pattern`; VIP-7 reconciliation, option A.) Admit NoSubstitutionTemplate patterns; reject an interpolated template in primitive-pattern position as a syntax error. Ordinary interpolated templates remain valid in arms and guard expressions. The explainer's ordinary-interpolation wording and the formal draft's future structural-interpolation note do not agree; choose the conservative formal grammar instead of assigning a meaning that a later pinned snapshot could need to remove. Document this as an explicit reconciliation in README/004, not an unmentioned omission from the full-explainer claim.
    **Immutable-main source scope (2756e4, 168).** 004 and pinnedsnapshotREADME explicitly admit only NoSubstitutionTemplate primitivepatterns and reject interpolation there while allowing ordinary guard/arm interpolation. This source portion does not publish the separate0707 diagnostic catalog. `main-275-source-receipt.json` records the complete two-file read; no own compiler/gate/native rerun.
    Current replacement: applied in ef0aa31ca3d73f8a9e7c2584ea1340024e5d67d3 (spec-fix-c; supersedes f7d0b168341a after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in f7d0b168341a87e441efa07c72cb0f326d2f3857 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    match (s) { when `tag-A`: "hit"; default: "miss"; } // allowed
    match (s) { when let v and if (v === `tag-${kind}`): "hit"; default: "miss"; } // ordinary interpolation in a guard
    // when `tag-${kind}`: is a syntax error; use the guard form
    ```
    Effect TS: compare the string subject to "tag-A", or evaluate the ordinary template in the source-position guard and compare it there. Decided by the agent from principle 8 (reject the unsettled syntax now; a later relaxation preserves compatibility), principle 4 (retain one existing primitive grammar rather than invent another interpolation meaning), and the pinned formal NoSubstitutionTemplate production, 2026-10-30. The direct-pattern corpus search in main cases/examples found no interpolated-template pattern; interpolation in arm values is unaffected. No string-extraction/binding syntax is introduced.

### Detail 169

**Signed Number-zero patterns do not cover TypeScript's collapsed zero case.** (live `004-signed-zero-coverage`; qualifies detail 78's literal coverage, VIP-7.) Preserve the pinned runtime tests: a syntactically signed Number NumericLiteral uses `SameValue`, while unsigned literal zero uses `SameValueZero`. Because TypeScript's literal type `0` admits both positive and negative zero, neither a `+0` nor a `-0` pattern alone matches every value of that case. Such a signed pattern contributes no coverage of the zero case under the existing whole-case algorithm, including any equivalent Number-literal spelling whose evaluated value is zero. An unsigned zero literal covers it. Other valid signed nonzero numeric literals retain singleton coverage; valid bigint zero has no distinct negative-zero value. Do not change pattern equality or give ordinary negative literals no coverage. The current conservative algorithm does not combine the two partial signed-zero arms into a new finer proof: use unsigned zero or `default` for that case. This also applies to a checked zero-valued enum case admitting both signs.
    **Immutable-main source scope (2756e4, 169).** 004 coverage excludes all signed Numberzero spellings, including a pair of signedzero arms and checkedzero enumcases; unsignedzero covers both signs, nonzero/bigint cases retain native rules. Source only. `main-275-source-receipt.json` records the complete two-file read; no own compiler/gate/native rerun.
    Current replacement: applied in ef0aa31ca3d73f8a9e7c2584ea1340024e5d67d3 (spec-fix-c; supersedes f7d0b168341a after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in f7d0b168341a87e441efa07c72cb0f326d2f3857 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function label(n: 0 | 1) {
      return match (n) { when -0: "negative"; when 1: "one"; }
    } // EK4701: ordinary positive zero is not covered
    function complete(n: 0 | -1) {
      return match (n) { when 0: "zero"; when -1: "negative one"; }
    } // exhaustive: unsigned zero covers both signs; -1 covers its singleton
    ```
    Effect TS: the first match tests `Object.is(n, -0)`, then `n === 1`, and otherwise throws `new TypeError()`; the second tests `n === 0`, then `n === -1`. A positive `0` belongs to the first parameter type yet fails both tests. Decided by the agent from principle 2 (TypeScript's collapsed zero type and the pinned TC39 signed tests), detail 78's requirement that a covering arm match every value of a case, and principle 8 (retain conservative whole-case coverage), 2026-10-30. Reconcile 004's literal/unary-numeric coverage and add positive-zero, negative-zero, unsigned-zero, alternate spelling, nonzero-negative and bigint witnesses; keep runtime semantics unchanged.

### Detail 179

**Prefix negation wins the contextual not/member-extractor collision by syntax alone.** (live `004-not-extractor-ambiguity`; VIP-7 incorporated-grammar reconciliation.) When the same pattern token sequence admits both `not MatchPattern` and an identifier-rooted member/extractor pattern starting with contextual `not`, choose the negation derivation before applying the ordinary pattern early errors. Never consult the existence, type or symbol of a local binding to select that parse. This includes `not(let x)` (negation of a parenthesized binding pattern) and `not[0]` (negation of an array pattern). Preserve `not` as an ordinary TypeScript name outside this prefix collision and in property/binding-name positions. A qualified callee such as `helpers.not(...)` is an ordinary extractor; renaming the callee is another existing escape. If negation is not a syntactically available derivation, this rule does not invent one or globally reserve the name. Do not retry the competing identifier parse merely to evade an early error on the selected negation.
    **Immutable-main source portion (098e7a, 179).** 004/AppendixA/README publish syntactic prefix-not priority over an identifier-rooted member/extractor before early errors, without binding lookup or identifier fallback; qualified extractors remain available. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    Current replacement: applied in 65e5460f15eaee293b112acd006040b4d2ed0f53 (spec-fix-c; supersedes 6d836e97200f after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 6d836e97200fea42d9f717d3cbcfc7a711ca536d (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function not(s: unknown): [unknown] { return [s] }
    const helpers = { not }
    match (5) { when not(let x): "hit"; default: "miss"; } // miss; local not is not called
    match (5) { when helpers.not(let x): "hit"; default: "miss"; } // hit; extractor is called
    match ([0]) { when not[0]: "other"; default: "zero"; } // zero; not is prefix negation
    ```
    Effect TS: the first pattern negates the always-matching binding test and therefore selects the fallback without invoking the function; the qualified extractor calls `helpers.not(subject)` once and matches its one-element result list. Decided by the agent from principle 3 (call-site/pattern syntax determines behavior, never binding-dependent grammar), principle 4 (one priority for the contextual prefix rather than type/scope-driven reparsing), and VIP-7's required parenthesized negation syntax, 2026-10-30. Record the collision rule in Appendix A's contextual-keyword row, 004 and the vendored README while retaining upstream files. Evidence: `decide-live-scratch/root-not-pattern-reference.log` on Effect `4.1.0` observes the competing reference outcomes `Success({ result: "miss", calls: 0 })` and `Success({ result: "hit", calls: 1 })`; it demonstrates why the grammar needs one choice, not current compiler behavior. Add the two ambiguous forms and qualified extractor as grammar/behavior witnesses.

### Detail 187

**The regex-literal pattern alternative includes its promised extractor suffix.** (live `004-regex-extractor-grammar`; VIP-7 regex-literal reconciliation and named-RegExp extraction, grammar admission repair.) Use one `RegularExpressionPattern` alternative of `MatchPattern`, with exactly the bare `RegularExpressionLiteral` branch and `RegularExpressionLiteral ( MatchList )` branch, preserving the pinned nullable MatchList and grammar parameters. Replace the earlier bare-literal addition rather than adding a second derivation for the same bare regex. Route the bare branch through the existing regex Boolean test and the suffixed branch through the same adopted regex extractor/iterator/list matching operation used for a named RegExp value. Evaluate the literal once at its pattern evaluation point. Preserve global/non-global behavior and the adopted singleton extraction containing the complete match result; this does not switch to the explainer's different spread-of-captures contract or admit arbitrary expression/call callees.
    **Immutable-main source portion (098e7a, 187).** 004/AppendixA/README use one regex-literal pattern alternative with bare/extractor branches and nullable MatchList, preserving named-RegExp extraction and single evaluation. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    Current replacement: applied in 65e5460f15eaee293b112acd006040b4d2ed0f53 (spec-fix-c; supersedes 6d836e97200f after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 6d836e97200fea42d9f717d3cbcfc7a711ca536d (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function digits(s: string) {
      return match (s) {
        when /(\d+)-(\d+)/(let m): m[1] + m[2];
        default: "none";
      }
    } // digits("12-34") is "1234"
    ```
    Effect TS: evaluate the regexp, obtain its adopted match result through the existing RegExp matching operation, fail the pattern on null, otherwise match the singleton extracted list `[result]`; `m` receives the full result array before the selected expression reads its captures. The named and literal spellings use the same extractor semantics. Decided by the agent from VIP-7's adopted regex-literal pattern support, principle 1 (a literal RegExp extractor behaves like the same value assigned a name), and principle 4 (one narrow regex production rather than broadening every matcher expression), 2026-10-30. Reconcile 004, Appendix A and the vendored README, retaining upstream files. Add bare/suffixed literals, nullable-list handling, named equivalence and global/non-global witnesses. `decide-live-scratch/root-regex-extractor-reference.log` records `Success("1234")` and `Success("none")` on Effect `4.1.0`; the incorporated special member-expression production lacks a regex-literal root. This is grammar/reference evidence, not a VibeLang parser-conformance result.

### Detail 190

**A no-substitution template pattern compares with the general SameValueZero operation.** (live `004-template-precondition`; VIP-7 pinned-algorithm reconciliation, independent of detail 168's interpolation restriction.) Replace the template branch's unguarded `SameValueNonNumber(subject, templateValue)` with `SameValueZero(subject, templateValue)`, as the adjacent Literal branch does. The template value is a string; equal strings match and every non-string subject fails without coercion. Do not manufacture an assertion exception for violating an abstract operation's preconditions, call `toString` on the subject, or change arm selection/order. The template remains evaluated at its ordinary pattern position.
    **Immutable-main source scope (2756e4, 190).** 004/pinnedsnapshotREADME replace unguarded SameValueNonNumber for primitive templatepatterns with general SameValueZero, preserving string equality and nonstring miss without coercion. Source only. `main-275-source-receipt.json` records the complete two-file read; no own compiler/gate/native rerun.
    Current replacement: applied in ef0aa31ca3d73f8a9e7c2584ea1340024e5d67d3 (spec-fix-c; supersedes f7d0b168341a after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in f7d0b168341a87e441efa07c72cb0f326d2f3857 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    effect function label(s: unknown) {
      return match (s) { when `ready`: "hit"; default: "miss"; }
    } // "ready" hits; 0, null, objects and Symbols miss
    ```
    Effect TS: a non-coercing comparison `subject === "ready"` followed by the selected value is equivalent for this string constant; general SameValueZero handles the full admitted subject domain. Decided by the agent from principle 2 (ECMAScript's operation domains and the pinned explainer's primitive no-coercion rule), principle 4 (reuse the neighboring general equality test rather than add a new special failure), and VIP-7's ordinary fallback behavior, 2026-10-30. Reconcile 004 and the vendored README, retaining upstream `spec.emu`. `decide-live-scratch/root-template-precondition-reference.log` on Effect `4.1.0` confirms string hit/miss and non-string misses while identifying the old SameValueNonNumber precondition failures. This is algorithm/reference evidence, not compiler conformance.

### Detail 191

**Lexical is bindings in while/do-while use the explainer's for-of-style loop scope and fresh iteration cells.** (live `004-is-loop-scope`; VIP-7 reconciliation, derives the specific loop model rather than applying nearest-block prose to a loop head.) Adopt the pinned explainer's explicit loop-head/per-iteration model. A loop-local head scope shadows outer names and does not leak outside the loop. Before each complete `while` condition evaluation, establish fresh uninitialized cells for that condition's lexical `is` bindings; all condition reads see their TDZ until the corresponding pattern initializes them. A successful condition and its body share those cells, so closures observe that iteration's later `let` writes. A next test, including after `continue`, gets new cells rather than reinitializing a prior `const` cell. A short-circuited binding stays uninitialized even if another path makes the condition true. Preserve nested source block/function scopes instead of hoisting their own bindings into the head.
    **Immutable-main source portion (098e7a, 191).** 004/008/README now state per-condition fresh lexical-is cells, successful-body sharing, shadowing/TDZ/short-circuit rules and permanent initial-do-head closure TDZ without prescribing a lowering. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    **Immutable-main source scope (d0cdbe, 191).** Public VIP7/snapshot README loop-head/per-iteration/initial-do TDZ-cell lifetime amendment published; separately queued chapter lifetime/counterpart slice not fully certified by this receipt. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Current replacement: applied in c1aba4c130998919c6116ebe436e28fec4f639f1 (spec-fix-c; supersedes 1325fb6df62c after main rebase and current-release placement; queued, not a main receipt).
    Publication receipt: applied in ac8433dd4267 (spec-fix-c; VIP7 cell rules; queued, not a main receipt).
    Status: applied in 1325fb6df62cafb4f1c52d1665ad7f24dcf4c99c (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function readLoop() {
      const x = 99; let n = 0; const readers: (() => number)[] = []
      while (n < 2 && (++n is const x)) { readers.push(() => x) }
      return [x, ...readers.map(f => f())] // [99, 1, 2]
    }
    ```
    For `do-while`, its first body executes in the loop's initial uninitialized head environment; a direct read is TDZ. A closure captured there keeps those cells and remains TDZ later, just as detail 109's pre-iteration head captures never become initialized per-item cells. After that body, each condition gets a fresh cell set; when true, the following body shares that preceding condition's set. `continue` reaches the next condition with a new set; false/break exits without exporting names. Initial-body closures are not retroactively rebound to a later condition. Leave `if`'s nearest-block behavior and detail 165's within-one-or replacement unchanged; this does not relax the existing `var` ban.
    Effect TS: ordinary fresh lexical declarations per iteration give preserved outer `99` and captured `[1,2]`; native head-TDZ closures as in detail 109 model the initial do-body cell lifetime. Decided by the agent from VIP-7's incorporated explainer's specific proposed for-of loop scope, principle 2 (TypeScript/ECMAScript per-iteration lexical identity), detail 109's already-decided head-versus-iteration cell rule, and principle 4 (fresh condition activations rather than an exception allowing const reinitialization), 2026-10-30. Reconcile 004, the vendored README and source-binding guarantees; add repeated-const/shadowing, condition/body shared-cell, skipped-binding TDZ, continue and first-body do-while witnesses. `root-is-loop-reference.log` demonstrates `[1,2]` versus reused-cell `[2,2]`; `root-loop-binding-cells.log` checks shared mutation, permanent initial-head TDZ and fresh later captures. These are native lexical-cell/reference-policy checks, not compiler conformance or execution of native pattern syntax.

    **`is` expression example and non-loop scope clarification (Opus round23 m26).** The operator runs the same ordered pattern test and extraction as a one-pattern match and returns a boolean; apply the same subject evaluation, cache, cleanup and predicate-narrowing rules, not `instanceof` merely because the pattern is a class. Lexical pattern bindings in an `if` condition or ordinary expression belong to the nearest enclosing source block, as the incorporated explainer's `is`/Bindings section expressly says; they are not scoped only to the successful branch. A binding stays TDZ until its binding pattern executes. Match failure after that execution does not undo initialization; a failed prefix or skipped branch may leave it uninitialized. Preserve detail 165's specific `or` replacement rule and this detail's separate loop scopes, and retain the existing `var` ban. A focused example is `function inspect(x: number) { if (x is let value and if (value > 0)) return value; return value }`: both paths can read `value`, because the unconditional binding executed before the guard, and the function returns `x`. Its ordinary TypeScript/Effect counterpart is `function inspect(x: number) { let value = x; if (value > 0) return value; return value }`. Conversely, in `if (s is [1, let value]) { use(value) }`, the enclosing block contains `value`, but a failure of the first element can leave a later read in TDZ. Add complete `vibe es`/`ts effect` examples to 004 and state this scope; a hand-written counterpart for a fallible pre-binding pattern needs the existing uninitialized-cell model, not unconditional `let value = undefined`. Decided by the agent from VIP-7's incorporated pinned explainer and principles 2 and 4, 2026-10-30; no new operator or binding policy is introduced.

### Detail 210

**Finite match coverage uses effective generic constraints without boxing ordinary literal types.** (live `004-generic-subject-coverage`; Opus r21/r22 m6; clarifies details 78/102/200.) For `EK4701` domain normalization, begin with the TypeScript type of the subject expression at its evaluation point, including the flow refinements the pinned checker actually represents there. Resolve that type's effective base constraint where one exists (including a constrained type parameter or a generic-containing intersection); otherwise retain that type. Then apply the existing finite-member/tag-case normalization. Preserve literal, Boolean, enum and tag-case identity. Do not replace every subject with the checker's boxed apparent type: ordinary `0`, `"A"` and `true` must not become `Number`, `String` and `Boolean` wrapper subjects.
    Status: source-identical metadata replacement queued as 31217af424251e9f4bb0b24cd3e5ba4ba19cd18b (spec-fix-c; tracked files identical to tested a2ccf6c40ec7; description deduplicated).
    Status: applied in a2ccf6c40ec7bd236fadcb2ef809655c20f270bc (spec-fix-c; queued, not yet a main receipt).
    Status: applied in ce8771ed0967f85172e079b164a61bac61c76963 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function tags<T extends { _tag: "A" } | { _tag: "B" }>(s: T) {
      return match (s) { when { _tag: "A" }: 1; when { _tag: "B" }: 2; } // exhaustive
    }
    function letters<T extends "A" | "B">(s: T) {
      return match (s) { when "A": 1; } // EK4701: B remains in the constraint
    }
    function open<T>(s: T) { return match (s) { when "A": 1; } } // open subject: no EK4701; unmatched execution still TypeError
    ```
    A constrained `T` uses its finite constraint as a conservative domain: missing `B` in the tagged example is likewise `EK4701`; covering both cases suffices for every permitted instantiation. Unconstrained `T`, `any`/`unknown`, a broad constraint, or any normalized member outside the admitted families keeps details 78/102's existing open-subject policy (checking off, runtime matching/no-match behavior unchanged). Do not adopt the old native compiler's separate rejection of unconstrained matches as the current policy. Aliases/instantiations use resolved checker identities and reductions; an unprovable finite domain stays open rather than being guessed closed.

    **Flow is not a second inference engine.** Honor a genuine represented refinement, such as `T & { _tag: "A" }` supplied by a predicate, whose effective constraint is the A member; a single A arm can then cover it. An ordinary union subject already narrowed to A likewise has the A domain. If TypeScript still exposes the bare generic `T` after an equality/property guard, its constraint remains the domain: do not infer extra narrowing from source guard text just for coverage. In the pinned 5.9.3 reference, both a direct tag guard and a literal-equality guard leave the bare generic reference typed `T`, while the predicate-intersection and ordinary-union controls expose the narrower type. Preserve ordinary arm/default subject flow under details 79/113/135; this coverage projection neither casts the subject nor changes binding types, and it never removes runtime tests.

    Effect TS: the corresponding native generic `switch (s._tag)` or `switch (s)` over the admitted literal constraint, with explicit no-match `TypeError` where a source path remains; the type proof changes no Effect operation or Exit. Decided by the agent from principle 2 (the pinned TypeScript flow/constraint types), principle 8 (finite over-approximation without invented narrowing), and details 78/102/200's existing domain/coverage contract, 2026-10-30. Add tagged/literal constrained complete/incomplete cases, unconstrained/open controls, represented-flow and bare-generic guard controls, and ordinary single-literal controls to 004/VIP-7 and fixing tests. This settles an underspecified normalization term; no Will choice or new runtime/public API is involved. `root-generic-domain-reference.log` records strict TypeScript 5.9.3 checker types, base constraints and apparent types for all those boundary forms. It is static reference evidence, not a VibeLang conformance claim; spec-fix-c retains source investigation/application.
    **Additional native-check receipt, 2026-10-30.** `generic-coverage-reference.log` independently confirms complete/incomplete tagged and literal constraints, unconstrained controls and the raw-reference boundary. Native TypeScript may accept a one-case switch or assignment after a bounded literal guard while still reporting the source reference type as bare `T`; detail 210 deliberately keeps that reference's conservative full constraint for coverage. Do not use the native switch's final whole-object `never` proof as a replacement for the stated coverage projection (likewise detail 200's uniform-tag distinction). Ordinary flow/assignability remains TypeScript's. The expanded exploratory log records the expected TS2322 for assigning an unconstrained `T` to `"A"`; the final strict control marks that as an expected error and passes. These are checker-reference controls, not VibeLang diagnostics or permission to broaden the recorded rule.

### Detail 214

**An `is` pattern may not introduce lexical bindings into an unsettled formal-parameter initialization environment.** (live `004-is-parameter-binding-scope`; VIP-7 pinned explainer Binding Behavior Details explicitly leaves function-argument-list scope unfinished; scope-analysis draft operations are TODOs.) Report `EK0705` when a `let`/`const` binding introduced by an `is` expression in formal-parameter initialization would need the parameter environment as its lexical home. Apply to direct parameter defaults, defaults nested in parameter destructuring, and evaluated computed binding keys there. Do not invent a hoisted parameter binding, leak a body-local binding backwards into defaults, or decide eager TDZ/closure identity by moving the expression into the body. A pattern with no bindings remains allowed under the existing rules. A binding in an explicit source block inside that initializer, including a `do` block or a match arm's already-defined scope, uses that block/arm and may be used there; it does not escape into other parameters or the source body. Nested source callable bodies retain their own existing scopes and boundaries, rather than becoming parameter work of the containing function. Ordinary call arguments evaluated in a lexical block are not formal-parameter declarations and retain detail 191's nearest-block rule. Keep eager, left-to-right, once-only initialization, parameter/body environment separation, and the existing Effect/producer exception boundary unchanged. This is conservative admission of a scope the accepted draft does not define, not a new parameter-binding model; a later accepted reconciliation can relax EK0705. Do not offer a generic move-to-body quick fix because that can change timing, parameter TDZ, length and closures. Suggest an explicit local block returning the needed result, or an ordinary explicit parameter, only when the source author can preserve the intended result.
    Status: landed on main 77510050781c (commit 2a2f70e288fe; spec-fix-c, queued as aeab02eb878c).
    Status: applied in d9a37430188ebb0757dbb60d6233b8685a59d939 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function bad(a = (1 is let captured)) { return a } // EK0705: no defined parameter-home binding
    function alsoBad({ a = (1 is const captured) } = {}) {} // EK0705
    function good(a = do { const ok = 1 is let captured; [ok, captured] }) { return a }
    function testOnly(a = (1 is Number)) { return a } // no new pattern bindings
    function caller() { consume(1 is let captured); return captured } // ordinary call argument: caller block
    ```
    Effect TS: the simple block-local example has the ordinary counterpart `function good(a = (() => { let captured = 1; const ok = true; return [ok, captured] })()) { return a }`; its local binding does not become a parameter or body-local name. This non-jumping example is illustrative, not a universal lowering recipe. Decided by the agent from principle 8 (reject an unspecified scope until it can be safely relaxed), principle 4 (reuse explicit existing scopes instead of inventing parameter-binding machinery), VIP-7's explicit unfinished scope note, and details 118/191/197's parameter/activation boundaries, 2026-10-30. `EK0701`–`EK0704` are already allocated in main; `EK0705` is the next free VIP-7 code after checking the shared log/live findings. Add 004/001/default-scope notes, VIP-7 reconciliation and Appendix B with direct/default/computed-key rejects, explicit-block and binding-free controls, and ordinary call-argument scope examples. This decision makes no compiler-conformance or source-landing claim.

### Detail 232

**Diagnostic ownership follows the source rule, not parser reuse.** (live `004-interpolated-template-code`; accepted VIP-7/VIP-34; Appendix B; details 60/168/213/224.) TypeScript's own syntax, lexical and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types. A rejection that instead depends on a VibeLang production, placement rule, proposal-specific early error or explicitly adopted reconciliation has the owning VIP's `EK` code. Importing a TC39 proposal or implementing it with a TypeScript parser helper does not make its new grammar native TypeScript. This classifies diagnostics only; it changes no admitted program or runtime meaning.
    **General ownership source publication (a4359).** At immutable main `a4359e5274e5`, chapter007 and public VIP-34 explicitly preserve native `TS` lexical/syntax/static errors and assign VibeLang-specific rejections to their owning `EK` diagnostic, regardless of parser-helper reuse. Independent native errors and existing specific codes are preserved. The full two-file,5,003-character diff was independently read. The separate004/AppendixB `EK0707` catalog application is not in this slice; neither compiler emission nor any other queued packet is certified. `main-a43-source-receipt.json` records scope.
    Status: applied in 1435a289a173f0644ca9c738962dbdeff9154c64 (spec-fix-c; queued, not yet a main receipt).
    For VIP-7's `match`/`is` grammar and pattern-specific early errors without a more specific assigned diagnostic, allocate `EK0707`: invalid match/pattern syntax, with the concrete rejected form and a valid repair in the message. Detail 168's interpolated template in primitive-pattern position therefore uses `EK0707`; ordinary template interpolation in a guard or arm remains admitted. Keep existing assigned identities, including `EK0701` arm separation, `EK0702` matcher admission, `EK0703` arity lint, `EK0704` ordinary-class extraction, `EK0705` parameter-home bindings, `EK0706` outward async-match jumps, `EK4701` exhaustiveness and `EK3004` service patterns. Do not add `EK0707` on top of a specific diagnostic for the same rejection, and do not suppress independent native lexical/type/name errors or errors in valid subexpressions under a blanket recovery range. A malformed native template or ordinary invalid expression is not automatically `EK0707` merely because it appears inside a match.
    ```vibe
    const bad = match (s) { when `tag-${kind}`: 1; default: 0; } // EK0707: use a guard
    const good = match (s) { when let v and if (v === `tag-${kind}`): 1; default: 0; }
    const nativeError = match (s) { when let v and if (missingName): 1; default: 0; } // TS2304 for missingName
    ```
    Effect TS:
    ```ts
    const v = s
    const good = v === `tag-${kind}` ? 1 : 0
    ```
    The rejected primitive pattern has no accepted runtime counterpart. An unresolved `missingName` in the equivalent ordinary conditional remains TypeScript's own error. Decided by the agent from accepted VIP-34/Appendix B's explicit own-syntax-versus-TypeScript distinction, VIP-7's ownership of the pinned proposal/reconciliations, principle 2 (preserve native TypeScript diagnostics), principle 4 (one shared remaining syntax diagnostic rather than a code per witness), and principle 8/detail 168 (retain conservative rejection), 2026-10-30. Update `004-match.md`, `007-tooling.md` and Appendix B and public VIP-7/VIP-34 under detail 213; source implementation remains with spec-fix-c. The compiler registry and catalog at immutable main `352013c7a59f` contain neither printed `EK0707` nor numeric `707`, and the shared ledger/claims contain no earlier allocation at reservation time; `root-match-syntax-code-availability.json` preserves source hashes and the claim distinction. This is not a compiler-emission, historical-code, whole-suite or main-landing verification.

    Chapter007/publicVIP34 companion: applied in 196612922a3f5d67f3068baf5ea4da22a8889946 (spec-fix-d; verified and queued, not a main receipt). Three before/after documentation regressions, strict/native TypeScript5.9.3 controls and rebased spec/docs/forms checks pass. Spec-fix-c retains004/AppendixB/VIP7 and0707 source delivery; this receipt does not claim the whole decision implemented.

### Detail 277

**Prelude cleanup preserves the required declaration surface, including source import identity and order where observable.** (The waiting migfix-smithers prelude-pass inquiry, opencode-41, accepted VIP-27/VIP-34, chapter007 safe-fix, existing263, principles1/2/3/8.) Ordinary `--fix` must retain an explicit Effect import or equivalent source-binding provenance when removing it would change the required emitted declaration: import order, local/namespace alias, quote choice, inferred named type, re-export order and actual module identity included. A prelude binding being available without an import is not proof that deleting its source import is declaration-neutral. Keeping that declaration-needed import is an ordinary safe fix, not a new language mode or runtime API.

    Apply the check to every declaration artifact the compiler promises, including VIP-27 compatibility sidecars. They are emitted even under `noEmit` or `declaration: false`, so a guard on public declaration-output options alone is insufficient. Retain a needed binding/provenance whenever a required artifact depends on it. When the original source order/identity cannot be reconstructed, retaining the original import is the conservative answer. Track its declaration use correctly rather than suppressing `noUnusedLocals`, fabricating a runtime use, or accepting renamed public types. Removing genuinely unused imports is still permitted when it preserves the existing runtime/side-effect and declaration contracts.

    **Declaration-gate scope clarification, decide-live, 2026-11-01.** A target's published-declaration byte gate applies to its actual shipped, consumer-reachable declarations, including deep paths; it does not require a bare-name `types` or `main` entry. Without an encapsulating `exports` map, `import type { X } from "cli/dist/internal.js"` can reach a shipped `dist/internal.d.ts` even when the package root has no `index.d.ts`. Therefore a manifest with only `bin` and `files` is not by itself proof that all non-root declarations are private. The inspected main7b1a resolver, `typescript/tsc/internal/module/resolver.go`, `loadModuleFromSpecificNodeModulesDirectory`, tries full subpath candidates when the export map does not block them. A root-index-only inventory omits that case.

    Distinguish that consumer surface from truly unshipped intermediate declarations. If the target owner permits canonical comparison for those internal outputs, keep that unchanged canonical gate and the raw differences as evidence; do not impose a new all-output byte gate merely because the application package itself is published. Establish shipping/reachability from the real pack/build inventory and native consumer controls, retaining conservative comparison for an unresolved surface. This applies existing277 and principle2 (native TypeScript subpath resolution), not a new language/API or test-edit permission. It qualifies the queued3a122973822b root-index premise as a general classifier; this lane has not audited T3's packed contents and does not declare its14 restored modules unsafe or instruct their reversion. Its owning drive retains the actual package/surface proof.

    This does not promise unchanged arbitrary JavaScript bytes or forbid all source transformations. It preserves the existing native/public declaration requirement and any stronger original-byte migration gate. Detail263 changes only the explicitly authorized relative migrated-source specifier spelling; it does not authorize import reordering, aliases or changing a named inferred type into an import type. An independent flow normalizer proposal must disclose normalized versus raw equality and cannot waive a target's stricter raw-byte requirement. Do not work around the defect by disabling teaching fixes, using a different fix-mode switch, changing target declaration golds or editing protected tests under272.

    ```vibe
    import type { Scope } from "effect"
    import { Effect } from "effect"
    export const a = (x: Effect.Effect<number>): Effect.Effect<number, never, Scope.Scope> => x
    // Retain these declaration-needed source bindings/order through --fix.
    ```

    Effect TypeScript: the same two imports and ordinary arrow declaration; stock TypeScript's declaration keeps the written binding identities/order. For an inferred `Schema.String`-named value, preserve the source's explicit `Schema` namespace where the native declaration uses it; do not silently replace that declaration with a differently spelled import type.

    Decided by the agent from VIP-27's faithful native declarations, VIP-34/chapter007's declaration-preserving safe fix, principle2 (native TypeScript import identity), principle3 (bindings rather than spelling) and principle8 (retain when deleting cannot be proved safe), 2026-11-01. Class A; no new Will question or change to valid program semantics. This answers the owner who paused for a ruling. The reports identify `rewritePrelude` removing original imports before re-emission; those are attributed source/reproduction receipts, not a new independent run by this lane. The compiler owners keep their implementation claims. Add a failing-main regression plus keyed spec-quoted fuzz over aliases, inferred names, import/re-export order, quote modes, scope-only types, compatibility sidecars, public output options, unused imports, all fix-entry modes and both source suffixes. Preserve native TypeScript baselines and272-protected target tests.




    **277 comment-elision clarification, decide-live, 2026-11-01.** The required declaration bytes include observable comment attachment and native elision. In the reported `Canonical` conversion, the original TypeScript header belongs to a first Effect import that native declaration emit removes; deleting that import in the source can attach the header to a surviving declaration instead. The existing safe-fix rule therefore retains that original import or proven equivalent provenance when its removal changes the required bytes, even if no emitted type names the import. Follow the valid original source's TypeScript comment/elision behavior, not a guessed insertion order for implicit prelude imports. This is not a general compiler rule to discard headers in newly authored VibeLang or to remove unrelated JSDoc. If the original provenance cannot be preserved, refuse that cleanup or retain the module as TypeScript.

    Native counterpart: the original explicit TypeScript import and its original leading comments, with TypeScript deciding whether both disappear from the declaration. This applies principle2 (native declaration emission), principle4 (the same observable-byte preservation rule), principle8 (retain rather than guess) and accepted VIP-27/VIP-34, not a new numbered decision or language change. The owner reports two single-threaded emitted witnesses and a successful native retention; this lane read that report and accepted VIP-27 but did not execute the probe. Owners add a failing-main regression and keyed properties for leading line/block/JSDoc comments, first versus later imports, elided versus retained imports, aliases, declaration-only/sidecar outputs and prelude cleanup entry modes. Keep raw equality and protected target tests unchanged.

    **Further272 upgrade-baseline clarification, recorded by decide-live, 2026-11-01.** The smithers agent's04:45Z inbox records the spec agent's later~04:25Z answer: Smithers main already has22 .vibe files on0.0.8, and the pinned Effect4.1 upgrade requires a newer VibeLang. “No .vibe changes” in the earlier third addendum means no new .ts-to-.vibe conversions in the upgrade, not a requirement to delete or freeze pre-existing VibeLang sources. The separate bottom upgrade baseline may port those already-.vibe files, including existing .vibe tests, through the required language-version codemod, before new conversions. Use vibelang --fix output; list every necessary hand edit and file it as a missing codemod, as the transmitted spec answer requires. Keep those ports separate from conversion edits and run the original checks on that upgraded baseline. Existing test intent, assertions and coverage must survive; this is not permission to repair a failing migration by changing its tests or to make arbitrary source/test edits. This records the reported later spec clarification, not an independently inspected private message or a new general test-edit allowance.

    A pre-existing .vibe test that relies on an old prelude alias must be ported from its original resolved meaning, not from a spelling guess. Preserve the original Effect FileSystem service type where the old binding meant that service. A DOM Request value remains governed by VIP33/005's derived ban: merely replacing new Request with new globalThis.Request outside an approved native boundary is not a valid fix. Use the accepted native boundary/codemod with its original evaluation, run and error behavior preserved, or retain the port as not-yet-fixed. The language-version migration obligation does not relax a platform ban or manufacture a changed error contract. Existing272 module-specifier/selector/upgrade exceptions remain the complete relevant process allowances; a filter that discovers files but feeds raw VibeLang to a TypeScript-only transformer or loses dependency edges still fails preservation.
    - *Fourth addendum to detail 272 (effectscript-11, Will's proxy, decided for Smithers; recorded 2026-11-01T04:19:06Z): path strings to migrated files.* This replaces the first addendum's "a path string read with `fs` ... is still forbidden" for one case: a string literal in a test or fixture that names a migrated source file by path may change `.ts` to `.vibe` (`.tsx` to `.vibex`), mechanically, when the flow checks that the new path resolves to the migrated file, nothing else in the test changes, the test passes, and the PR lists each edit. A test that asserts on the file's text (reads it and compares contents, line numbers or source shape) keeps that module `.ts`, and the case goes to the repo's migfix lane. The test-diff verifier accepts this third edit form with a resolves-to-the-migrated-file check.


    **272 configuration-scope clarification, decide-live, 2026-11-01.** The original272 expressly allows setup to wire the repository's own configuration files outside tests. This includes a genuine standalone Vite/electron-vite test-tool configuration outside a protected test/fixture; its purpose or a filename such as electron.vite.config.test.ts alone does not make its exported tool configuration a test assertion. Conversely, a configuration embedded in a test or stored as a protected fixture stays protected regardless of its basename. Preserve that source-role boundary rather than a broad “no test-config edits” or filename-only rule. This does not permit rewriting test logic, embedded plugin/build calls, fixtures or coverage to pass a conversion. Existing config-wiring regressions belong to the VibeLang-owned flow tests. This is the existing272 sentence applied to opencode21/29, not a new general exception.



    **277 private generated-literal gate clarification, decide-live, 2026-11-01.** The reported harness `RealmFlowBundle.d.ts` encodes compiled JavaScript as the literal type of a generated `source` constant. An exports-null internal path and an unchanged public surface do not automatically waive the target owner's separately stated requirement that existing declaration files remain identical. Keep that stronger gate; the narrow allowance for an added internal companion declaration is not permission to change this existing artifact. Do not normalize or ignore the changing bundle literal after seeing its failure.

    A separately tested native generator repair that deliberately emits a stable internal contract such as `export declare const source: string` can establish a new baseline through the ordinary target-main process, provided it preserves runtime behavior, the actual public surface, original tests and any internal contract the owner requires. That is ordinary source/generator engineering, not permission to edit the generated file or a test snapshot, and this lane neither implements nor authorizes publication of that change. Until an approved matching baseline exists, retain/revert the affected native TypeScript closure or keep the conversion WIP. This follows277's explicit stronger-owner-gate scope,272's independent baseline rule and principles4/8; no new numbered language decision or Will question. The exports-null/generated facts are owner-reported, not independently audited here.

    **Migration alias coherence (opencode-54, decide-live, 2026-11-01).** Native TypeScript importers retain native checks, including `TS2877` under `rewriteRelativeImportExtensions`. The migration flow must not generate an unrewritable non-relative alias and simultaneously enable the option that rejects it. Preserve authored compiler options by default. If the original option is already enabled, choose an alias spelling that the actual compiler/options accept and that preserves the original module/runtime identity; do not disable an authored option merely to hide a generated error. If setup introduced an unnecessary option, retain the original valid configuration rather than impose it globally. Any required option change needs the ordinary whole-program/emit/loader preservation proof, not a VibeLang exception in the native checker.

    No single extensionless spelling or flag value is valid in every project: validate the actual `paths`, source/declaration layout, importer kind and runtime graph. Record every forward specifier edit, alias and relative alike, and revert it to the exact recorded original; do not restore only relative paths or guess the old suffix. Ordinary `--fix` keeps detail 270's writable-file limits, and protected tests keep detail 272's specific exceptions. This is the existing native-option, identity and reversible-migration contract (principles 2, 3 and 8, VIP-34,007,263/277/291), not a new resolver mode, flag or source syntax. Product owners need the minimized Opencode alias corpus and regression/property controls over options, alias targets, native/Vibe importers, forward/revert cycles and native emit/runtime resolution. The reported m9 witness is not this lane's product execution.


    **Actual consumer scope for local compatibility names (Foldkit-33, decide-live, 2026-11-01).** A valid project-local sidecar can name the actual local type without `any`, but `noEmit` with `declaration`/`composite` disabled is not by itself proof that the type is unexposed. Check actual package exports, published files, deep entries, reexports and downstream consumers. A publicly reachable declaration keeps the existing portability, native identity and byte requirements, including detail 271's independent-consumer rule. A genuinely unshipped, project-local compatibility output can use an actually resolving local path only within its proven consumer scope and subject to any stronger existing target declaration gate. This applies principles 2 and 8 and details 271/277; it approves no candidate printer, does not waive `TS2883` for public contracts and requires no new language decision. The reported eleven-module candidate is still in validation, not landed.


    **277 native declaration-elision clarification, decide-live, 2026-11-02.** Accepted VIP-27's documented-schema amendment already attaches a schema's JSDoc only to its value `declare const`, leaves its `typeof Name.Type` alias without that comment, and preserves native `removeComments`/`stripInternal` behavior. Authored native elision can leave an invalid declaration, just as stock TypeScript can. Do not silently retain a value, copy `@internal` onto its companion alias, rewrite the public type or change authored compiler options to make that different output valid.

    ```vibe
    /** @internal */
    export schema Message {}
    // Under stripInternal, apply the exact native pair's elision.
    ```

    Effect TS counterpart:
    ```ts
    import { Schema } from "effect"
    /** @internal */
    export const Message = Schema.Struct({})
    export type Message = typeof Message.Type
    // stripInternal emits only the alias above; consuming it reports TS2693.
    ```

    For a generic declaration-consumer oracle, first compare the exact native counterpart under the same frozen compiler/options/consumer settings. If that native output is valid but Vibe output is invalid, retain the compiler defect. If native elision itself produces the identical invalid type query, preserve that native result and attribute the diagnostic to that authored native option; the property must assert the paired behavior rather than a false universal promise that every native declaration output checks. Any oracle adjustment is narrowly tied to demonstrated native elision and the exact emitted artifact/diagnostic, with ordinary-valid, both-elided and Vibe-only-invalid controls. This is no blanket `stripInternal` skip, new pending gap, arbitrary diagnostic suppression or weakening of an actual target repository's original tests/public-byte/consumer gates. Do not turn on `skipLibCheck` merely to hide a new mismatch.

    Decided by the agent from the accepted VIP-27 documented-schema amendment, principle2 (native TypeScript options), principle4 (one exact counterpart) and existing277, 2026-11-02 under the 2026-10-29 delegation. No new numbered detail, API choice or Will question. Publish the native-option qualification in VIP-27/001/007 under213. Shared oracle edits remain with its core owner; this decision lane changes none.

    Native reference: three TypeScript5.9.3/Effect4.1 emitted/consumed pairs in `strip-internal-reference/observation.json`: ordinary pair checks, const-only `@internal` plus `stripInternal` emits a lone alias and exactly `TS2693`, and an explicit native `@internal` on both declarations elides both and checks. The last is a native control, not permission to copy the schema's comment onto its generated alias. Consumer declaration checking used `skipLibCheck:false`. The actual `FuzzCompile`943/945 fixtures, VibeLang emit, TS7 compiler and product oracle were not run here; their owners must establish the exact paired condition before changing classification.


    **277 post-flip migration-oracle clarification, decide-live, 2026-11-02.** Use the proposed original-TypeScript-to-migrated-program oracle as the primary new conversion gate. VIP-1's written-kind invariant and its `FuzzPlainEffectBody` regression coverage remain valuable; a conforming post-flip compiler passing them is not proof that the codemod chose the right explicit `effect`/`try` edits. Do not delete their defect-neighborhood coverage merely because the compiler fix makes it pass. A pre-flip implicit-wrapper detector may remain diagnostic, but cannot replace original-program preservation after migration writes the keywords explicitly.

    Compare the frozen original TypeScript emit, actual migrated source and actual Vibe emit using the same dependency/options/runtime identities. Attribute functions, captures and run sites through real syntax/bindings/source maps, not names or a raw count of `fn`/`gen`/`yield*` markers. Compiler-kind conformance and migration semantic equivalence are distinct checks.

    ```vibe
    let made = 0
    const make = () => { made += 1; return class {} } // preserves ordinary call-time work
    effect function load() { return 1 }              // valid if original built this same cold program
    ```

    Effect TS counterparts: the identical ordinary `make` callback, and `function load() { return Effect.gen(function* () { return 1 }) }`. A native TypeScript function is not wrong to migrate merely because it is syntactically plain: the original may explicitly construct a cold Effect with `Effect.gen` or `Effect.fn`. Conversely, an Effect-valued annotation/result or an explicit keyword newly inserted by the codemod is not evidence that the rewrite preserves the original factory, constructor or held value.

    Flag candidates, then establish/refuse the actual difference: call-time versus run-time work and initialization, returned ordinary/class/Effect-as-data values, coldness, invocation counts, currying/receiver/identity, error/defect channels, requirements, exports and declarations. Keep original target tests and all stronger gates. Do not automatically ban legitimate native Effect constructors or approve them by a callee-name heuristic; match resolved actual native behavior. Generated run sites can correspond to accepted running forms besides literal `try`, and a source-written native `yield*` inside an ordinary generator is not automatically an inserted Effect run.

    The owner should retain Alchemy `effectClass` and Smithers `grammar`/`revert` positive witnesses, paired legitimate cold-construction controls, explicit-keyword-but-wrong migrations, held Effect data, and source/native generator controls in regression/property coverage. Make failures identify the actual module/function/origin and observed contract difference. AST/marker triage alone is not a whole-program equivalence proof or qualification of every historical module.

    Decided by the agent from accepted VIP-1/VIP-34, existing203/274/277 and principles1/2/3 (native Effect behavior, TypeScript counterparts and syntax/binding identity), 2026-11-02 under the 2026-10-29 delegation. This answers the migration-oracle implementation choice without new syntax, API, numbered detail or Will question. The owner reports main251 versus unlanded65af before/after controls and a proposed `lib/run-phase.mjs`; this lane has not executed/inspected that candidate or certified its gate/performance. No code, oracle, fixture or target test is changed here.

    **277 review-verdict bound, same oracle decision.** An automated `review` or ambiguous original/migrated function pairing is unverified by that phase, even when it does not fail the batch. Clear it only with recorded appropriate source/native/runtime/declaration evidence satisfying the original preservation contract; otherwise retain/refuse the affected conversion. Do not count every nonfailing verdict as preserved or advertise a bounded syntactic guard as whole-program equivalence. A name path is a locator; actual unique binding/origin correspondence and accepted native Effect constructor identity still need proof. This records the limits of the owner-reported `5a272ab9ecf2` proposal without inspecting/certifying its source, changing the implementation or imposing a new source-language ban.


    **277 concrete run-phase guard limits, decide-live, 2026-11-02.** The immutable proposed guard at commit `5a272ab9ecf2`, `.smithers/flows/migrate/lib/run-phase.mjs` (SHA-256 `436ed8d07a92cd526f974e1bdc294d16a34e49a94457cc16c0b8a87f94829b7a`), returns `ok` for both native witnesses below. This is bounded source/probe evidence, not execution of the full `verify` gate or an approval/landing claim.

    ```vibe
    import { Effect } from "effect"
    let made = 0
    const makeGenerator = () => { made += 1; return function* () { return 7 } }
    const factory = () => Effect.gen(makeGenerator()) // generator factory runs when called
    ```

    In a separate module the same spelling can be an ordinary object:

    ```vibe
    const Effect = { gen: () => 7 }
    const ordinary = () => Effect.gen() // ordinary number; no Effect construction
    ```

    Effect TypeScript counterparts are the identical ordinary source functions with the actual bindings. In the first fixture the genuine Effect import is used; `made` starts at `0`. Native `factory()` sets it to `1` immediately, while the handwritten lifted counterpart `() => Effect.gen(function* () { return yield* Effect.gen(makeGenerator()) })` leaves it at `0` until run. Both eventually yield `7`; equal eventual values do not preserve the call phase. In the second module the original returns `7`, so spelling `Effect.gen` cannot prove a program.

    The candidate's `returned` branch accepts a recognized `.gen` callee without examining argument evaluation or resolving the binding, and `runPhaseOf` skips eager-work traversal for top-level return statements. Existing principles1/3, VIP-1 and this detail already require actual native constructor identity and preservation of eager construction/captures; no new source restriction follows. Unmapped/ambiguous originals, unmatched functions or name-only constructor evidence also cannot become verified preservation merely because they produce no blocking diagnostic. A bounded guard may report review/unverified; independent evidence or retention/refusal must settle those affected conversions.

    Native stock TypeScript5.9.3/Effect4.1.0 controls: both original fixtures compile with zero diagnostics (`strict:true`, `skipLibCheck:true`), inferred `() => Effect<number, never, never>` and `() => number`; native timing is `1/1` for call/after-run versus `0/1` for the handwritten lift. Receipts and the exact immutable guard copy are in `~/vibe/fix/alpha/decide-live-scratch/run-phase-candidate-reference/`. Only the guard's exported function-level analysis and native counterparts were run. No VibeLang parser/compiler/emit, complete `runPhaseCheck`/`verify`, codemod, target suite, Go/fuzz or merge gate was run; no candidate, target, shared test or oracle was edited. Agent application of existing principles1/3 and accepted VIP-1/277, not a new numbered decision or Will answer.



    **277 private-error serialization correction, decide-live, 2026-11-02.** Earlier continuation notes called the unannotated cross-module private-error shape a generic compiler inference/serializer defect too broadly. A native source-check pass with `declaration:false` does not prove native declaration emit is possible. Compare the actual native emit boundary and import graph before classifying a Vibe-only defect. Here `foldkit-33` is the repository finding, not canonical detail33 (the `Function` ban).

    A stock TypeScript5.9.3/Effect4.1.0 six-graph matrix now establishes: private `BootError` in `helper.ts`, exported `load`, and inferred exported `main` in a second module check/emit JavaScript with declarations off; declarations on report `TS4058` at `main` and `TS4023` at a further inferred consumer export, because the expanded private error needs unnameable `NodeInspectSymbol`. A same-file private-error control and an exported-error control emit declarations cleanly. A written exact `Effect.Error<ReturnType<typeof load>>` contract makes `main.d.ts` printable with raw-identical helper/main JavaScript; a consumer which further exports the inferred program still fails `TS4023`, while a consumer that only calls `main` emits cleanly. An annotation at one boundary is not proof of every downstream declaration.

    ```vibe
    // helper.vibe: the error remains private.
    error BootError { message: string }
    export effect function load() { throw new BootError({ message: "boot" }) }
    // A separate, genuinely new internal entry can choose an exact written contract.
    // import { load } from "./helper.vibe"
    // export effect function main(): void!Effect.Error<ReturnType<typeof load>> { try load() }
    ```

    The native helper counterpart is `class BootError extends Data.TaggedError("BootError")<{ message: string }> {}` and `export function load() { return Effect.gen(function* () { return yield* Effect.fail(new BootError({ message: "boot" })) }) }`, with actual `Data`/`Effect` imports. The exact new-entry counterpart is `export function main(): Effect.Effect<void, Effect.Error<ReturnType<typeof load>>, never> { return Effect.gen(function* () { yield* load() }) }`. These are authoring/control examples, not permission to alter an existing target API or auto-export a private class.

    The recorded Foldkit coordinator ruling of2026-10-31T18:55Z already requires an unprintable compatibility sidecar to avoid failing a no-declaration module with no native TypeScript importer; when a `.ts` importer needs the sidecar, report the real declaration error at that import with the `annotate the export` quick fix. Do not fabricate an `any`/weakened sidecar. The missing importer quick fix reported by the owner at09:37 remains `foldkit-33` follow-up work. A native-unprintable error at that required boundary is not by itself a Vibe serializer bug. Conversely, a like-for-like native declaration which prints validly while Vibe alone fails, a spurious failure without an importing boundary, wrong channels/provenance or a missing required diagnostic/fix remains an implementation defect; these native controls do not close every original48model fixture.

    Exact evidence: `private-error-native-matrix/receipt.json`, native `strict:true`, `skipLibCheck:false`, actual declaration emission and diagnostics in all six graphs. The first assumption that the written-main graph with another inferred export would emit cleanly failed and is retained in `attempt1-failure.json`; the subsequent matrix keeps that failure as a distinct boundary instead of deleting it. No actual VibeLang/TS7 emit,48Foldkit fixtures, target graph, LSP, Go/fuzz or merge gate was run. This corrects an evidence classification under existing VIP-27/VIP-34/277 and the recorded project ruling; it is not a new Will answer, API change, numbered decision or permission to rewrite protected targets.



    **277 provide-repair fixture context, decide-live, 2026-11-02.** The current `FuzzProvideServiceFixScope` generator writes `export function main() { return Effect.provide(...) }` (or `Effect.provideService`): it is a plain cold factory under accepted VIP-1, not source Effect code. A `provide` statement under VIP-12 cannot replace its ordinary returned program. Retain that source kind as a negative placement/refusal case; an otherwise-safe Layer operand does not create execution permission or authorize a whole-function rewrite.

    ```vibe
    function factory() { return Effect.provide(observe(), Layer.succeed(Key, { value: 1 })) }
    effect function running() { return try Effect.provide(observe(), Layer.succeed(Key, { value: 1 })) }
    // effect function factory() { return Effect.provide(...) } would instead return the held Effect as success data.
    ```

    Effect TypeScript counterparts: the identical ordinary `factory`, and `function running() { return Effect.gen(function* () { return yield* Effect.provide(observe(), Layer.succeed(Key, { value: 1 })) }) }`. These snippets assume the fixture's actual service/observe bindings. Merely adding `effect` to the old source while retaining `return p` is not an equivalent migration of `() => p`.

    Test the independent provision-scope invariant in an explicit Effect activation which actually runs the native call, e.g. `running` above, with preserved before/after runtime and channel observations. There, a proven Layer repair may be offered only with its ordinary evaluation/coldness checks; native `Effect.provideService`, its resolved alias and qualified service-key variants must retain their native `Layer.CurrentMemoMap` observation, rather than silently allocating a Layer memo map. Keep both the plain-context refusal neighborhood and the explicit-running scope neighborhood. If placement already prevents a repair, do not require that diagnostic to pretend a later scope check ran; pin the meaningful `CurrentMemoMap` refusal in the admitted context instead. Preserve all actual runtime assertions and original witnesses, and keep protected-oracle ownership.

    This is existing VIP-1/VIP-12/VIP-34/277 source-kind and safe-repair policy, not permission to weaken the scope oracle or mechanically mark every callback Effect. The unlanded flip's gate/advice mismatch needs actual matching-artifact regression/fuzz evidence from the owner. This lane read the complete current fixture and accepted rules but ran no Go/fuzz/editor/compiler gate and changed no test/product source. No new diagnostic, numbered decision or Will question.


    **Alchemy-63 class-pattern preservation, decide-live, 2026-11-02.** A class pattern testing `instanceof` is not a general replacement for native `Effect.catchTag`, which recognizes the tag. Own Effect4.1.0 native controls compare a genuine `NotReady` instance, an ordinary `Error` with own `_tag: "NotReady"`, and an untagged `Error`. The six executions agree for genuine/untagged controls; the structural `Error` is handled by `catchTag` but is propagated by `instanceof`. The structural `Error` still inhabits the broader `Error` type. This is a counterexample to a universal rewrite, not evidence that a particular SDK actually supplies structural errors. For each proposed site, retain actual provenance/callers/runtime and declaration-contract proof; class nameability and successful compilation alone do not establish preservation. Keep the original pipeline or TypeScript when that evidence is unavailable. Do not change public inferred channels with a cast, annotation, broader error union or normalized declaration gate. Existing277 and principle8 settle the conservative outcome; no new language choice or Will question. Native receipt `catch-tag-class-native-reference/receipt.json` records six runtime controls only; no actual Alchemy/Vibe/static twin or target suite ran here. Decided by the agent from those existing rules, 2026-11-02 under the 2026-10-29 delegation.


    **Foldkit-130/131 legacy-preserving migration, decide-live, 2026-11-02.** Existing VIP-1/VIP-5 source-kind rules require an `effect` modifier on the legacy active outer arrow whose direct body executes an Effect through `catch`; merely adding `try` to an unmarked arrow is not the repair. Written legacy `Flags!!` alone does not authorize promotion of a genuine plain factory returning held Effect data. Keep Promise/plain-catch and nested-function controls separate, preserve the actual return contract and call/run events, and verify the original current-core witness rather than claiming the uncompiled minimal sketch passed. For the legacy `forkIn(scope, () => work())` family, accepted VIP-17/detail84 fix source operand order, while VIP-33 removes redundant runtime APIs. The replacement consumes a program using actual `Effect.forkIn(program, scope)`. Preserve the old thunk's execution phase, eager captures, receiver, multiplicity, scope and cleanup: use a proven delayed counterpart such as `Effect.suspend(() => work())` when the original thunk is deferred, and evaluate/bind the source scope first when needed. Do not blindly drop arbitrary plain thunks or swap observable source operand order. The owner's three no-argument, no-default, const-bound explicit Effect functions may construct cold programs directly only with the stated actual provenance and runtime/public-declaration proof; this does not establish a general pure-call rule. Retain the original program or explain refusal when proof is unavailable. Do not claim unsupported `fork.in` syntax is implemented; the documented Effect API is an available counterpart while that compiler gap remains. Existing277/84/300 and accepted VIP-1/VIP-5/VIP-17/VIP-33, principles1/2/3/8, settle both as implementation/migration gaps, not new language choices. Required regression/fuzz neighborhoods retain nested/generic/written/inferred arrows, plain factories/Promises, handler kinds, side-effecting thunk/arguments/receiver/captures, interrupt/finalizer order and repeated runs. Root ran no actual preview17/core/compiler/fuzz/consumer gate.

    **Matcher-kind qualification for the Alchemy-63 native control.** The `catchTag`/`instanceof` counterexample above is specifically for an ordinary class without an own matcher. Current accepted `004-match.md` Class patterns and103 explicitly distinguish generated `error`/`schema error` tag matchers, own custom matchers and the retained fixed guards; those are not replaced by `instanceof`. Resolve the actual declaration/module binding and matcher before applying the control to a site. This preserves VIP-7/VIP-13 rather than introducing a general class-pattern restriction.


    **Public factory capture timing, decide-live, 2026-11-02 (Alchemy audit W2).** Checking only immediate in-repository callers cannot establish that an eager-to-lazy rewrite preserves a public factory. A caller may retain the program, mutate an argument object and run the same program more than once. Preserve exactly the reads/calls, their order and exceptions that the original performs before constructing the program; moving a property read into an Effect body changes this contract even for an ordinary mutable data property. Do not substitute a blanket clone or new eager reads of other properties.

    ```vibe
    function captureId(props: { id: string }) {
      const id = props.id
      return effect { return id }
    }
    ```

    Its Effect TypeScript counterpart is `function captureId(props: { id: string }) { const id = props.id; return Effect.gen(function* () { return id }) }`. This illustrates the simple capture boundary, not permission to drop an actual original factory's tracing, defaults, receiver, metadata or public declaration contract. The original `const id = props.id; return Effect.succeed(id)` agrees with that counterpart: after calling with `id: "A"`, changing the property to `"B"`, running, changing it to `"C"` and running again, both return `"A"` twice with one read at call time. Lifting the whole function to `Effect.gen(function* () { const id = props.id; return id })` returns `"B"`, then `"C"`. A throwing getter likewise throws during the original call but becomes a run-time defect in the lifted program. Ordinary `.vibe` throw restrictions are unchanged.

    Own `factory-property-capture-native-reference/receipt.json` records six native scenarios and seven Effect runs on Effect4.1.0/Node26.5, including mutation/repeated-run and throwing-getter controls. This is native reference evidence, not an actual Alchemy/Vibe compiler/target-suite replay. The audit owner's previous immediate-consumer waiver is withdrawn; preserve or revert each affected source until its actual call/run/public-contract proof holds. Marker flags remain candidates for inspection rather than a count of proven wrong functions.

    Decided by the agent from existing277/300, principles1/2/3/8 and the native evaluation/cold-program contract, 2026-11-02 under the 2026-10-29 delegation. No new numbered detail, Will question or authorization to change the public factory contract.


    **277 generated type-helper hygiene, decide-live, 2026-11-02 (RC-40).** The approved VIP-9 `default` to `defaultValue` migration preserves the meaning of corresponding type reads. A generated `ReturnType<typeof Flags.defaultValue>` must not resolve to a user's local/imported/nested type alias or type parameter. Preserve the intended utility identity or emit a checker-proved capture-free extraction; otherwise refuse safely. Do not rename, overwrite or ban the user's alias. A value-only `const ReturnType` does not by itself shadow the type namespace and is an accepted control.

    The recorded witness defines `type ReturnType<T> = { enabled: "captured" }`, a legacy `Flags.default: Flags.Shape`, and `export type Value = typeof Flags.default`. Editor and CLI repairs compile successfully yet change the exported shape or its `enabled` member from `boolean` to `"captured"`. The equivalent return extraction must keep `Flags.Shape`/`boolean`, with a fresh inference binding if a conditional type is used. This applies principle3 (resolved symbols and hygiene, not spelling), VIP-9's already-authorized migration and277's public-type/safe-fix contract. It grants no new declaration-normalization or comparison waiver; retain the original public types and the target's approved migration/declaration gate. Compile success/no-new-errors alone cannot prove this repair.

    Reviewer pass130 has actual LSP/CLI actions for `typeof Flags.default`, `(typeof Flags)["default"]` and `(typeof Flags.default)["enabled"]`; before/after original/captured type-equality assertions and a value-only-name control distinguish capture. Counts and successful manual conditional extractions are owner receipts, not this lane's execution or a product fix. This is new RC40, not a reopening of RC19's independently verified unshadowed missing-read repair. Chapters005/007 and impl-hunt-svc own the capture-free repair or refusal and failing-main regression/keyed spec-quoted fuzz across type/value namespaces, imported/local/nested/type-parameter shadows, every read form, original assertions and declaration output. No language admission change, new code, numbered detail or Will question here. Decided by the agent from those existing rules, 2026-11-02 under the 2026-10-29 delegation.


    **277 ordinary entry-binding preservation, decide-live, 2026-11-02 (RC-ENTRY-1).** Accepted VIP-26 retires magic `main` and its obsolete EK4843 entry rewrite; a source `main` is an ordinary JavaScript binding. Retire that preserving-repair claim rather than convert a lexical declaration into a hoisted function. Any genuinely version-scoped compatibility action must preserve the actual binding's initialization, TDZ, mutability, named-expression self binding, call-time behavior and public declaration, or refuse. Passing a subsequent compiler check does not prove runtime equivalence. Do not weaken native TDZ or make an implicit runner to justify the edit.

    ```vibe
    let seen: unknown
    function read(): unknown { return main }
    try { seen = typeof read() }
    catch (e) { seen = e instanceof Error ? e.name : String(e) }
    export const main = (): number => 7
    export function probe(): unknown { return seen }
    ```

    Effect TS: the same ordinary TypeScript module; no Effect operation or runner is involved. `probe()` returns `"ReferenceError"` because the deferred read executes before the lexical initialization. Replacing the declaration with `export function main(): number { return 7 }` returns `"function"` and is not an equivalent repair.

    Reviewer pass134a reports arrow/anonymous-expression/matching-name-expression witnesses changed by both CLI and actual editor repair. Native/before/CLI controls agree for late reads and an original function declaration. Its10 compiler checks/15 native-before-CLI executions and four edited compilations/executions are owner receipts, not root tests. Earlier writable-`let main` probes were safely refused by CLI after TS2630; the offered editor edit can still create that error, and rejected results have no assigned runtime. These negative controls do not erase the accepted TDZ counterexample. Chapter007/tooling and chapter002/impl-hunt-run own retirement or proven refusal, failing-main regression and keyed spec-quoted fuzz over early deferred reads/import cycles, late reads, declaration kinds, named-expression self bindings, writes, CLI/editor parity and unchanged ordinary functions. Existing277, accepted VIP-26 and principles2/8 settle this Class A application. Decided by the agent from those sources, 2026-11-02 under the 2026-10-29 delegation; no new numbered detail or Will question.


    **277 service default value-to-factory preservation, decide-live, 2026-11-02 (RC-SVCVALUE-1).** VIP-9 authorizes the `default` to `defaultValue` migration under the existing safe-fix/refusal rules. It does not authorize delaying and repeating an already evaluated static value. Preserve original eager once-only initialization and the captured value's identity, mutable-binding snapshot, side effects and exceptions; retain source `this`/`super`/`new.target`, order, cold enclosing bodies, original reads and public types. Replacing an arbitrary initializer with an arrow that re-executes it is unsafe. If equivalent capture cannot be proved at that source site, refuse the automatic migration. This does not memoize or otherwise change an already authored `defaultValue` factory or native Reference fallback invocation.

    ```vibe
    const cachedFlags: { enabled: boolean } = { enabled: true }
    service Flags {
      static readonly defaultValue = () => cachedFlags
      enabled: boolean
    }
    export function probe(): boolean {
      return Flags.defaultValue() === Flags.defaultValue()
    }
    ```

    Effect TS: `const cachedFlags = { enabled: true }; const Flags = Context.Reference<{ enabled: boolean }>("@app/flags#Flags", { defaultValue: () => cachedFlags });` The comparison calls the same factory twice and is `true`, as with the legacy static object. This is a simple object-initializer witness only, not a universal instruction to lift class-context expressions to module scope or wrap them in an IIFE. Fresh `() => ({ enabled: true })` instead returns distinct objects.

    Reviewer pass135a reports three runtime changes after successful CLI and actual editor repairs: object identity, a counted eager initializer becoming delayed/repeated, and a snapshot becoming a later mutable-binding read; the stable const-bound object control agrees. The four explicitly plain annotated scratch capture controls restore their original results; the initial unannotated transitional-compiler rejection is retained separately and has no assigned runtime. These are attributed receipts, not root execution or a general lowering proof. RC19 missed type reads and RC40 generated utility capture remain distinct bugs. Chapter005/impl-hunt-svc and chapter007 own the capture-safe repair/refusal, failing-main regression and keyed spec-quoted fuzz over literals, stable/reassigned bindings, getters/calls/comma expressions, unused defaults, repeated reads, initialization failure, class lexical context and CLI/editor parity. Decided by the agent from accepted VIP-9's eager declaration context and safe migration rules, existing277 and principles2/8, 2026-11-02 under the 2026-10-29 delegation. Class A application; no new number, syntax, API or Will question.

    **Public project API scope, decide-live, 2026-11-02:** the existing typed `vibelang/project` `Result.errors` promises all project error diagnostics, and its warnings promise all project warning diagnostics. A loader performance change may use a private narrower compile, but must preserve the documented public `compileProjectSync`/`projectBackend.compile` result contract. Skipping an in-root `.ts` file in those public results is an observable API change, even when the loader would not report that unrelated file to the user of one `.vibe` module. Do not infer approval from a faster startup, a narrower output map, or passing corrected plugin oracles. Public outputs already cover `.vibe` sources; output scope alone does not settle diagnostic scope.

    ```vibe
    // main.vibe, in a project that also includes unrelated.ts:
    export const answer = 42
    ```

    Effect TS counterpart: native `main.ts` exports the same value; if the same project's `unrelated.ts` writes `const n: number = "bad"`, a full native project check reports `TS2322`. The public project result retains that diagnostic under its existing contract. Private loader-specific work is a separate implementation route, with unchanged public APIs. This is a source/API contract inference, not an executed new regression test.

    Candidate `6107af12995f`, carried by `b5944dd81a67`, actually filters every non-`.vibe` file in `outsideLoaderRoot`; its existing typed public backend uses the same loader flag and still declares all-project errors. That mismatch needs implementation reconciliation. The same carrier still publicly exports typed `writeLoaderRecord` through the existing `./project` export map, as immutable source inspection verifies. Keep the chosen private cache/emit route; no new public writer is approved. A retained public API change requires separate accepted authority or Will's approval. Decided by the agent from principle8 and the existing published API contract, 2026-11-02; Class A conservative preservation, no new question. No repository source edit, build, gate waiver or public API approval by this lane.

    **Current-main loader API status (decide-live, 2026-11-02T20:17Z):** own immutable cdc source confirms the typed public `writeLoaderRecord` export in `project.mjs`, `project.d.mts` and the existing `./project` package export. This supersedes earlier candidate-only/e4-absent observations. This detail's selected private portable emit/cache route remains the decision; landing and passing tests do not themselves authorize the additional public surface. The owner must reconcile it with that boundary. Current `project.mjs` has no `outsideLoaderRoot` filter, so the prior candidate's narrowed-diagnostics concern is not asserted as a current-main failure.
    **277 cache-record checker scope clarification, decide-live, 2026-11-02:** the same selected private portable cache/emit route applies to final-record validation. Candidate `a1e7d83c649f` adds a typed public `checkLoaderRecord` through the existing `vibelang/project` export map as well as using the existing public writer. Successful record-order or namespace regression tests do not authorize an additional public package API. Reconcile checker and writer with the chosen private implementation boundary; a retained public API addition still requires separate accepted authority. This applies the existing decision, not a new API approval or a request to reconfirm it.

    Final verification also follows details 291/292: report whether validation actually ran. The candidate's `checkLoaderRecords` returns its original entries when the installed checker cannot be imported or is unavailable. That compatibility fallback must be distinguishable from a checked hit or miss in the operation's receipt; a written entry is not evidence of a validated final graph. An older package may still use ordinary cold compilation, but that is not zero-compile readiness or a successful record-validation claim. Preserve actual source, options, dependency and compiler fingerprints. This adds no public flag or language syntax.

    Recorded by the agent from existing 277's published-API/private-route boundary, principles 4/8 and details 291/292's actual-input/completion rules, 2026-11-02. Class A application; no new numbered detail or Will question. Evidence is selected candidate API/flow source inspection and attributed owner tests, not this lane's execution.
