# Failures

Sources: [VIP-4](../vips/0004-throw.md), [VIP-13](../vips/0013-error-declarations.md), [VIP-29](../vips/0029-schema-errors.md). Handling failures with `catch` is in [Running Effects](002-running.md#catch), and matching them is in [Pattern matching](004-match.md).

## `throw`

### Meaning

`throw` is allowed everywhere ([Thrown types](#thrown-types) says which calls may throw).

| Where | `throw e` means |
| --- | --- |
| a plain or `async` function, or the top level | JavaScript's `throw` |
| effect code | the Effect fails with `e`, a typed error: `return yield* Effect.fail(e)` |

```vibe es
// compiler-gap: pending VIP-4
effect function load(id: string) {
  const user = try findUser(id)
  if (!user) throw new NotFound({ id })
  return user
}
```

```ts effect
// fragment
function load(id: string) {
  return Effect.gen(function* () {
    const user = yield* findUser(id)
    if (!user) return yield* Effect.fail(new NotFound({ id }))
    return user
  })
}
```

## Thrown types

This section is the one definition of throw tracking; every other chapter refers to it. Every call, `new` expression, tagged template and class declaration or expression has a *thrown type*: what it may throw synchronously, or `never`. Tracking applies only to non-effectful callables (VIP-4, amended: "an effectful function literally cannot throw").

### Effectful callables

A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. For example, in Effect 4.1.0 this includes `Exit` values, `Config` programs, `error` instances, service keys and references; this is not an exhaustive list. A plain function whose return type is wholly one of these Effect subtypes is effectful and may not throw: `function bad(): Exit.Exit<number> { throw "x" }` is `EK0401`. `Stream` and `Layer` have their separate effectful-return categories above; neither they nor `Fiber` pass the Effect execution operand test. An effectful callable's thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.

Because an effectful function can't throw, its own code that runs before the Effect exists may not throw either. In a plain `.vibe` function whose return type is an Effect, a `Stream` or a `Layer`, an uncaught `throw` in its own body (nested functions excluded), or an unwrapped call or class evaluation whose thrown type is not `never`, is an error (`EK0401`): make it an `effect` function, or return `fail(e)`. This follows VIP-4's effectful-callable amendment; its later ‘`try` only in effect code’ amendment removes the old restriction on non-Effect return annotations. The same holds for code an `effect` function runs at the call ([Code outside the generator](#code-outside-the-generator)).

Only a return type other than `never`, wholly consisting of Effects, `Stream`s or `Layer`s, is effectful. `never`, `any`, `unknown` and unions containing a non-effectful member, such as `Effect.Effect<number> | undefined`, remain throw-tracked (decided detail 36).

```vibe es
// compiler-gap: pending VIP-4
error Missing
function missing() { return new Missing() } // effectful; no synchronous throw
const boom = () => { throw new Error("x") } // throws Error; never is not effectful
// function bad() { throw new Error(); return new Missing() } // error
```

```ts effect
import { Data, Effect } from "effect"

class Missing extends Data.TaggedError("Missing") {}
function missing() { return new Missing() }
const boom = () => { throw new Error("x") }
const failure: Effect.Effect<never, Missing> = missing()
```

`@throws` applies only to non-effectful callables (VIP-4, amended). A written `@throws` or `@rethrows` on an effectful `.vibe` callable is `EK0406`: remove the tag and declare failures in the Effect's error type (decided detail 96). Such tags in `.ts`, `.d.ts` and JavaScript are ignored.

```vibe es
// compiler-gap: pending VIP-4
error Absent
/** @throws {Absent} */
effect function badTag(): number!Absent { throw new Absent() } // EK0406
// The same rule rejects @rethrows on an effectful callable.
effect function find(): number!Absent { throw new Absent() }
```

```ts effect
import { Data, Effect } from "effect"

class Absent extends Data.TaggedError("Absent") {}
function find(): Effect.Effect<number, Absent> {
  return Effect.gen(function* () { return yield* Effect.fail(new Absent()) })
}
```

### Thrown type by kind of callable

```vibe es
// compiler-gap: pending VIP-4
/** @rethrows f */
function invoke(f: () => number) { return f() }
// lib.d.ts: /** @throws {never} @rethrows f */
// export declare function each(xs: string[], f: (s: string) => void): void
// lib.d.ts: export declare const parse: (s: string) => string

effect function checked() {
  // invoke(() => { throw "bad" })                 // EK0403
  // each(["x"], () => { throw "callback" })        // EK0403
  // parse("x")                                   // EK0403, from source or .d.ts
  return try Effect.try(() => invoke(() => { throw "bad" }))
}
```

```ts effect
import { Effect } from "effect"

/** @rethrows f */
function invoke(f: () => number) { return f() }
/** @throws {never} @rethrows f */
function each(xs: string[], f: (s: string) => void) { xs.forEach(f) }
const checked = Effect.try(() => invoke(() => { throw "bad" }))
const checkedEach = Effect.try({
  try: () => each(["x"], () => { throw "callback" }),
  catch: (error) => error
})
```

Determine a call's synchronous thrown type in three steps (decided detail 66):

1. **Effectful callee:** its thrown type is `never`; neither `@throws` nor `@rethrows` adds synchronous throws. An ordinary nongenerator `async` callable declared in `.vibe` also has synchronous thrown type `never`: initialization and callback throws reject its Promise, as [Async contracts](#async-contracts) specifies.
2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.
3. **Rethrows for synchronous callables:** union the own thrown type with the thrown types of the actual callbacks passed for every named `@rethrows` parameter, whichever case in step 2 applied. The tag is written, never inferred. `@throws {never}` describes only the callee's own throws and does not erase `@rethrows f`. Argument-expression evaluation remains the caller's code.

<a id="async-contracts"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In declaration output, preserve that admission on the parameter's callable signature with `@throws {unknown}`, emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after `async` is erased. Normalize aliases and sidecars alike, using a local annotated parameter type instead of mutating a shared type alias. A returned callable keeps its own thrown contract. A Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain. A Promise return type alone does not establish the async rule. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; this is the intrinsic static contract. The Effect 4.1.0 constructors still read and copy the payload fields, including ordinary getters, `Proxy` traps and target property operations ([`Object.assign`](https://tc39.es/ecma262/2025/multipage/fundamental-objects.html#sec-object.assign), [`CopyDataProperties`](https://tc39.es/ecma262/2025/multipage/abstract-operations.html#sec-copydataproperties)). Exceptions from those implicit operations retain their native order and value and follow [Implicit throws](#implicit-throws): they are defects in effect code, even when the payload is well-typed. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.

```vibe es
// compiler-gap: pending VIP-4
/** @rethrows f */
export async function invokeAsync(f: () => number) { return f() }
/** @throws {never} */
function build() { return invokeAsync(() => { throw "callback" }) }
```

```ts effect
import { Effect } from "effect"

/** @rethrows f */
async function invokeAsync(f: () => number) { return f() }
/** @rethrows f */
function invokePlain(f: () => number) { return Promise.resolve(f()) }
const checkedAsync = Effect.tryPromise({ try: () => invokeAsync(() => { throw "callback" }), catch: (error) => error })
const checkedPlain = Effect.try({ try: () => invokePlain(() => { throw "callback" }), catch: (error) => error })
// Both fail with "callback" through their matching wrappers; only invokePlain throws at the call.
```

The async declaration preserves the callback's admitted bound without claiming that the call rethrows:

```ts
/** @throws {never} */
export declare function invokeAsync(f: { /** @throws {unknown} */ (): number }): Promise<number>
```

The runtime `import()` operation's own synchronous thrown type is `never`. Loading, linking, module evaluation, specifier coercion and import-attribute failures reject its Promise, as [`EvaluateImportCall`](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-import-calls) specifies. Independently evaluated source argument expressions keep their existing thrown contracts and left-to-right order; a throwing `makeSpecifier()` can throw before the operation creates a Promise. Type-only `import(...)` queries and static import declarations are not runtime import expressions.

A typed payload can have a throwing getter. Both native constructors below perform the getter read; either call to `copyPayload` gives `Die("payload")` before a value or typed failure is produced:

```vibe es
// compiler-gap: pending VIP-4, VIP-13, VIP-16
error PayloadCopyError { value: number }
data CopiedPayload { Item { value: number } }
effect function copyPayload(kind: "error" | "data") {
  const payload = { get value(): number { throw "payload" } }
  if (kind === "error") throw new PayloadCopyError(payload)
  return CopiedPayload.Item(payload)
}
```

```ts effect
import { Data, Effect } from "effect"

class PayloadCopyError extends Data.TaggedError("PayloadCopyError")<{ readonly value: number }> {}
type CopiedPayload = Data.TaggedEnum<{ Item: { readonly value: number } }>
const CopiedPayload = Data.taggedEnum<CopiedPayload>()
function copyPayload(kind: "error" | "data") {
  return Effect.gen(function* () {
    const payload = { get value(): number { throw "payload" } }
    if (kind === "error") return yield* Effect.fail(new PayloadCopyError(payload))
    return CopiedPayload.Item(payload)
  })
}
// Both inputs die with "payload"; the constructors keep their static never contract.
```

The generator publishes the normative thrown-signature inventory, `docs/design/inventory/throws.json` (detail 81a): exact TypeScript lib inputs and Effect version, keyed by module, declaration and overload signature, with own throws, `@rethrows` parameters, callback admission and returned callable contracts. The published `docs/design/inventory/throws.json` is generated by `node docs/tools/throws-inventory.mjs --write`. The examples below are not a complete inventory. An unannotated signature follows step 2's inference or default, then step 3's `@rethrows`; omission does not imply `@throws {never}`. Regeneration is part of an Effect or TypeScript bump.

These shipped contracts are decided (VIP-4; details 2 and 40); a successful call alone does not establish `@throws {never}`:

| Call in effect code | Synchronous thrown type | Use |
| --- | --- | --- |
| `JSON.parse(s)` | `SyntaxError` | `try Effect.try(() => JSON.parse(s))` |
| `Math.max(1, 2)` | `never` | call directly |
| `Option.some(1)` | `never` | call directly |
| `Schema.decodeUnknownSync(Schema.String)` or `Schema.decodeSync(Schema.String)` | `never` | call directly to build the decoder |
| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |

```ts effect
import { Effect, Option, Schema } from "effect"

const decode = Schema.decodeUnknownSync(Schema.String)
const calls = Effect.gen(function* () {
  const json = yield* Effect.try(() => JSON.parse("1"))
  const text = yield* Effect.try(() => decode("ok"))
  const mapped = yield* Effect.succeed(1).pipe(Effect.map((n) => n + 1))
  return [json, Math.max(1, 2), Option.some(1), text, mapped] as const
})
```

<a id="implicit-throws"></a>**Implicit and tracked built-in throws** (decided detail 81). A throw that ECMA-262 or the web or Node lib specifies for a `lib.d.ts` global is implicit (untracked, a defect in effect code) when it comes from the receiver's or the environment's state, not from the documented contract on the arguments: a frozen, sealed or non-extensible receiver; a revoked or trapping proxy; a user getter, setter, `valueOf`, `toString` or `Symbol.toPrimitive`; a detached buffer; or a resource limit (length overflow, stack, memory). Every other specified throw is argument validation and is tracked with its class when reachable from any input admitted by the selected signature's receiver and parameter types under TypeScript `strict`. This is a contract on the selected signature: a safe literal, a local range check, a literal-typed argument or constant folding does not erase its thrown type. Ordinary overload resolution still chooses the signature; the arguments' values do not specialize its thrown contract. A throw that no argument of the declared parameter types can reach is not tracked: `Object.keys(o)` with `o: object`, for example, throws `never`. Reachable argument-validation throws include: `JSON.parse`, `JSON.stringify` on a cycle or a `bigint`, `BigInt("x")`, `new RegExp(bad)`, `decodeURI*`, `atob`, `structuredClone`, `repeat` counts, `toFixed`, `toPrecision` and `toString(radix)` ranges, `new Array(-1)`, `normalize(form)`. Both `padStart` and `padEnd` use `ToLength`, which clamps nonpositive lengths; unlike `repeat`, neither validates a count range. For their well-typed string/number/string signatures, padding's own thrown type is `never`; allocation/length limits and coercion hooks remain implicit defects. See ECMA-262's [String padding](https://tc39.es/ecma262/2025/multipage/text-processing.html#sec-string.prototype.padstart) and [String repeat](https://tc39.es/ecma262/2025/multipage/text-processing.html#sec-string.prototype.repeat) algorithms. Detail 40's generator applies this classification to the `lib.d.ts` globals ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)).

```ts effect
import { Effect } from "effect"

const keys = (o: object) => Object.keys(o) // throws never for well-typed arguments
const builtins = Effect.gen(function* () {
  const names = keys({ a: 1 })
  const padded = "x".padEnd(-1, "0") // no tracked count-validation throw
  const fixed = yield* Effect.try(() => (1.5).toFixed(2)) // the signature still includes RangeError
  const repeated = yield* Effect.try(() => "x".repeat(3)) // a safe literal keeps that contract
  return [names, padded, fixed, repeated] as const
  // Success([["a"], "x", "1.50", "xxx"]); repeat(-1) and toFixed(101) fail through Effect.try.
})
```

```vibe es
// compiler-gap: pending VIP-4
effect function f(xs: number[], s: string, v: object) {
  xs.push(1)                                          // implicit: a frozen receiver is receiver state
  const n = s.length                                  // no throw
  const t = JSON.stringify(v)                         // EK0403: may throw TypeError (cycle, bigint)
  const u = try Effect.try(() => JSON.stringify(v))   // ok
  return "ab".repeat(n)                               // EK0403: may throw RangeError
}
```

The normative [`throws.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/throws.json) supplies the remaining shipped contracts, generated by `node docs/tools/throws-inventory.mjs --write` from this repository's bundled TypeScript `lib.*.d.ts` files and `effect@4.1.0` declarations and `dist` sources (VIP-4; details 40, 81 and 81a). It records each module, declaration and overload signature, own throws, `@rethrows` parameters, callback admission and returned callable contracts, with exact versioned inputs and their hashes.

For built-ins, receiver or environment state (frozen objects, proxies, coercion hooks, detached buffers and resource limits) causes implicit throws; documented argument validation is tracked (detail 81). Accordingly, `xs.push(x)`, `new Map()` and `Object.keys(o)` have own thrown type `never`; `JSON.stringify(v)` has `TypeError` and `s.repeat(n)` has `RangeError`. An iterable's iterator is an implicit protocol hook: `Array.from(it)`, `new Map(it)` and `new Set(it)` have own thrown type `never`; an explicit mapping callback still rethrows (detail 202). A data-last `dual(arity, body)` call such as `retry(p)` only builds a function; its returned function has a separate invocation contract. An unresolved native or source proof remains `unknown`. [Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations) describes the inventory and its representative contracts.

`@throws {T}` and `@rethrows p` attach to call signatures, not a `type` alias's declaration: write `type Reader = { /** @throws {Error} */ (): string }`. Contracts travel with signatures: `const g = f` preserves `f`'s thrown type. Declaration output tags exported non-effectful callables ([Declaration output](001-functions.md#declaration-output)). Implicit throws, such as reading a property of `undefined` or a stack overflow, are never tracked; they are defects, as in `Effect.sync`.

A no-match `TypeError`, the implicit read and call of `Symbol.customMatcher`, and pattern-protocol errors (including iterator closing, and the `AggregateError` of [Leaving a `match`](004-match.md#leaving-a-match)) are implicit throws: never tracked, and defects in effect code (decided detail 95). Calls written in a subject, guard or arm, and predicate calls under detail 94, follow ordinary tracking. `EK4701` prevents a no-match on exhaustively checked subjects.

```vibe es
// compiler-gap: pending VIP-7
function label(x: unknown) { return match (x) { when 1: "one"; } } // throws never
function parsed(s: string) {
  return match (s) { when let t and if (JSON.parse(t)): 1; default: 0; }
} // throws SyntaxError: the guard contains a written call
```

```ts effect
import { Effect } from "effect"

function label(x: unknown) {
  if (x === 1) return "one"
  throw new TypeError() // implicit in the source match
}
const labeled = Effect.sync(() => label(2)) // a defect, not a typed failure
function parsed(s: string) {
  if (JSON.parse(s)) return 1
  return 0
}
const guarded = Effect.try(() => parsed("bad")) // the written call is wrapped
```

A local implementation must satisfy every exposed overload bound, including parameter/default initialization. A wholly Effect, Stream or Layer overload has the implicit `never` synchronous bound even without a throws tag; a mixed-return implementation whose tracked throws exceed it is `EK0401`. The check uses one conservative implementation bound, for methods too; plain overload bounds and foreign signature trust keep their existing rules ([Declaration output](001-functions.md#declaration-output)).

Contracts attach to each call signature, including each overload and a returned callable's own signature; declaration output preserves them (decided details 37–38). Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives' thrown types (detail 44). TypeScript still requires narrowing `unknown` before calling it.

```ts effect
import { Effect } from "effect"

// A returned callable carries its own contract:
declare function decoder(): { /** @throws {Error} */ (s: string): string }
const dynamic: any = (s: string) => { if (!s) throw new Error("empty"); return s }
const wrapped = Effect.try(() => dynamic("ok"))
function uncertain(): Effect.Effect<number> | undefined { throw new Error("empty") }
const uncertainWrapped = Effect.try(() => uncertain()) // mixed return type remains tracked
```

A generated `schema error` constructor has thrown type `never`, a static contract (detail 42). Effect 4.1.0 validates its fields; invalid input can throw a plain `Error`, which becomes a defect inside `Effect.gen`.

```vibe es
// compiler-gap: pending VIP-29
schema error Invalid { name: Schema.NonEmptyString }
effect function invalid() { throw new Invalid({ name: "" }) } // defect, not typed failure
```

```ts effect
import { Effect, Schema } from "effect"

class Invalid extends Schema.TaggedError<Invalid>()("Invalid", { name: Schema.NonEmptyString }) {}
const invalid = Effect.gen(function* () {
  return yield* Effect.fail(new Invalid({ name: "" }))
})
```

For synchronous and `async` generator declarations, expressions and methods, parameter initialization alone contributes to the call's synchronous thrown type: defaults and destructuring run when the iterator is created. The suspended body and its calls do not contribute; they run when the iterator is resumed. Calls to `next`, `throw` and `return` have their own signature contracts under the three-step procedure above, with the foreign `unknown` default where no contract is supplied. An `async` generator's body throws reject its resumption Promise, but its parameter initialization can still throw synchronously at creation. This follows ECMA-262's [generator body evaluation](https://tc39.es/ecma262/2025/multipage/ecmascript-language-functions-and-classes.html#sec-generator-function-definitions-runtime-semantics-evaluatebody) and [async generator body evaluation](https://tc39.es/ecma262/2025/multipage/ecmascript-language-functions-and-classes.html#sec-asyncgenerator-definitions-evaluatebody), which initialize parameters before creating the suspended generator (VIP-1, VIP-4 and VIP-21).

```vibe es
// compiler-gap: pending VIP-4
function* lazy() { throw "body" }
function failDefault() { throw "default" }
function* eager(x = failDefault()) { yield x }
effect function inspect() {
  lazy()                          // creates an iterator; its body does not run
  return "not started"
}
// eager() may throw "default" at the call; lazy().next() may throw "body".
```

```ts effect
import { Effect } from "effect"

function* lazy() { throw "body" }
function failDefault() { throw "default" }
function* eager(x = failDefault()) { yield x }
const constructed = Effect.gen(function* () {
  lazy()
  return "not started"
})
const resumed = Effect.try({ try: () => lazy().next(), catch: (error) => error })
const defaulted = Effect.try({ try: () => eager(), catch: (error) => error })
async function* asyncLazy() { throw "async body" }
async function* asyncEager(x = failDefault()) { yield x }
const resumedAsync = Effect.tryPromise({ try: () => asyncLazy().next(), catch: (error) => error })
const defaultedAsync = Effect.try({ try: () => asyncEager(), catch: (error) => error })
// resumedAsync fails with "async body"; defaultedAsync fails with "default".
// constructed succeeds with "not started"; resumed fails with "body"; defaulted fails with "default".
```

Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never`: `fib` below throws `never`, `walk` throws `Error`. If an expanding recursive summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected strongly connected component's inferred thrown summary to `unknown` and emit `@throws {unknown}`. The same rule applies to mutual recursion. Never truncate the union or emit an invalid circular alias. A written checked upper bound, including `unknown`, cuts the corresponding inference dependency and is checked normally. Independent source type errors still receive TypeScript's ordinary diagnostics; this fallback applies only to inferred throws. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).

```vibe es
// compiler-gap: pending VIP-4
function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
/** @throws {Error} */
function walk(n: number) { if (n) walk(n - 1); else throw new Error("end") }
// /** @throws {never} */ function bad() { throw new Error("end") } // error
```

```ts effect
// fragment
function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
/** @throws {Error} */
function walk(n: number): void { if (n) walk(n - 1); else throw new Error("end") }
const direct = fib(5)
const walked = Effect.try(() => walk(1))
```

An expanding generic recursion can throw arrays of arbitrarily increasing depth, so a finite prefix such as `T | T[]` is not a sound contract:

```vibe es
// compiler-gap: pending VIP-4
export function grow<T>(value: T, depth: number): void {
  if (depth <= 0) throw value
  grow([value], depth - 1)
} // inferred @throws {unknown}
```

```ts effect
import { Effect } from "effect"

function grow<T>(value: T, depth: number): void {
  if (depth <= 0) throw value
  grow([value], depth - 1)
}
const grown = Effect.try({ try: () => grow(7, 2), catch: (error) => error })
// Failure([[7]]); depth 0 fails with 7, and depth 1 fails with [7].
```

Its emitted declaration remains ordinary TypeScript:

```ts
/** @throws {unknown} */
export declare function grow<T>(value: T, depth: number): void
```

### Assignability

As for Swift's non-`throws` function type, a function whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, and `@throws {unknown}` admits anything. A parameter named by `@rethrows` admits anything, because the call then throws what its argument throws. So `const r: () => string = parse` is an error (`EK0402`): wrap the function, or annotate the type `@throws`.

A `@rethrows` parameter that admits arbitrary throwing callbacks retains an admitted thrown bound of `unknown` outside direct synchronous propagation in the annotated callable. Returning, storing, assigning or capturing it in a nested callable must preserve that bound, including returned object callable members and immediately invoked nested functions. Such a nested plain callable emits its own `@throws {unknown}`; a nonthrowing destination is `EK0402`, and an unwrapped invocation in effect code is `EK0403`. Merely returning/storing it does not invoke it, and async/effect boundaries keep their existing rules ([Declaration output](001-functions.md#declaration-output)).

The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`. An overriding or implementing method may throw only what the base or interface signature admits (`EK0402`). VIP-4's two wrappers declare their thunk parameter `@throws {unknown}` ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)), in both overloads: the function argument or the options object's `try` property. Thus `Effect.try(() => parse(s))` and `tryPromise(() => queryDb(q))` are allowed, and the wrapper turns a throw into a failure. The options object's `catch` callback has the ordinary non-throwing function type; a tracked throw there is rejected, while an implicit throw is a defect. Effect's `LazyArg` and other callback parameter types, including those in `.d.ts` files, describe what an argument callback may throw; without `@throws`, they admit only `never`. This admission rule does not change the foreign-callable default: calling an unannotated foreign function-typed property still throws `unknown`. Every other function parameter admits only what its type says: `sync(() => parse(s))` is an error, so wrap the call with `Effect.try`.

A `service` member is an interface member for throw tracking (detail 3): without `@throws` it admits only `never`; an implementation whose member may throw is `EK0402`.

```vibe es
// compiler-gap: pending VIP-4
service Reader { read(): string }
// Providing { read() { throw new Error("bad") } } as Reader is EK0402.
```

```ts effect
import { Context } from "effect"

class Reader extends Context.Service<Reader, { read(): string }>()("example/Reader") {}
const reader: { read(): string } = { read() { return "ok" } }
// Effect TypeScript preserves the shape; VibeLang also checks its throw contract.
```

JavaScript's `Promise` constructor separately admits `@throws {unknown}` on its executor's call signature (detail 64). The constructor itself has `@throws {never}` and no `@rethrows`: executor throws reject the Promise. Evaluating the executor argument is still the caller's code. This does not change the Effect wrapper contracts above.

```vibe es
// compiler-gap: pending VIP-4
function rejected() { return new Promise<never>(() => { throw "executor" }) }
effect function checked() { return try tryPromise(() => rejected()) }
```

```ts effect
import { Effect } from "effect"

interface PromiseExecutor<T> {
  /** @throws {unknown} */
  (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void): void
}
const executor: PromiseExecutor<never> = () => { throw "executor" }
/** @throws {never} */
function rejected() { return new Promise<never>(executor) }
const checked = Effect.tryPromise(() => rejected())
```

```vibe es
// compiler-gap: pending VIP-4
class Base { read() { return "ok" } }
class Loud extends Base { read() { throw new Error("loud") } } // EK0402
interface Reader { read(): string }
class Bad implements Reader { read(): string { throw new Error("bad") } } // EK0402
// foreign.d.ts: export declare const client: { get: () => string }
effect function checked() {
  // client.get()                             // EK0403: foreign property
  class C { static value = JSON.parse("bad") } // EK0403 on class evaluation
}
```

```ts effect
import { Effect } from "effect"

// Bridge the class evaluation, rather than its initializer alone.
const initialized = Effect.try(() => {
  class C { static value = JSON.parse("1") }
  return C.value as number
})
```

Generic signatures are classified as effectful before type-argument substitution, using their constraints. An unconstrained return `T` is not wholly effectful, even when a call substitutes an Effect for `T`; a constraint wholly assignable to Effect, Stream or Layer can establish effectfulness. Instantiation substitutes inside the existing own-throws and `@rethrows` contracts and preserves that classification through aliases and declaration output.

A parameter named by `@rethrows` admits a throwing default callback as well as a throwing argument. For a synchronous callable, infer the default callback's thrown contract before assignment to the parameter type, union it into the callable's own thrown bound, and emit it in `@throws`. Immediate throws while evaluating a default expression also contribute to that own bound. The default callback's contribution remains even when a caller supplies a safe callback; an omitted or `undefined` argument cannot lose it when declarations erase the initializer. A written `@throws` must bound these contributions or gets `EK0405`. Ordinary nongenerator `async` callables keep their Promise-rejection contract and preserve callback admission in their normalized declarations.

```vibe es
// compiler-gap: pending VIP-4
/** @throws {"boom"} */
function keep<T>(value: T): T { throw "boom" }
function passEffect<T extends Effect.Effect<unknown>>(value: T): T { return value }
/** @rethrows f */
function invoke(f: () => number = () => { throw "default" }): number { return f() }
effect function contracts() {
  // keep(succeed(1))             // EK0403: substitution preserves "boom"
  // invoke()                    // EK0403: the default's own bound
  // invoke(undefined)           // EK0403
  // invoke(() => 7)             // EK0403: conservative own bound
  const e = try Effect.try({ try: () => keep(succeed(1)), catch: (error) => error })
  return try e
}
effect function constrained() {
  return try passEffect(succeed(2)) // a constraint wholly assignable to Effect is effectful
}
```

```ts effect
import { Effect } from "effect"

/** @throws {"boom"} */
function keep<T>(value: T): T { throw "boom" }
function passEffect<T extends Effect.Effect<unknown>>(value: T): T { return value }
/** @throws {"default"} @rethrows f */
function invoke(f: () => number = () => { throw "default" }): number { return f() }
const constrainedContract = Effect.gen(function* () { return yield* passEffect(Effect.succeed(2)) })
const genericContract = Effect.gen(function* () {
  const e = yield* Effect.try({ try: () => keep(Effect.succeed(1)), catch: (error) => error })
  return yield* e
})
const omittedContract = Effect.try({ try: () => invoke(), catch: (error) => error })
const undefinedContract = Effect.try({ try: () => invoke(undefined), catch: (error) => error })
const suppliedContract = Effect.try({ try: () => invoke(() => 7), catch: (error) => error })
// genericContract fails with "boom"; omittedContract and undefinedContract fail with "default".
// constrainedContract succeeds with 2; suppliedContract succeeds with 7; its static own bound is deliberately conservative.
```

### Calls in effect code

| Rule | Diagnostic |
| --- | --- |
| In effect code or a plain `catch` handler's parameter/default/destructuring initialization or body, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |
| In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited. Move the expression into a `tryPromise` thunk, whether or not it can reject; `promise` also works when the thunk's thrown type is `never` | `EK0404` |

`EK0404` uses the Promise test of [Result tests](002-running.md#result-tests) (detail 89): `never`, `any` and `unknown` never trigger it; any union with at least one `PromiseLike` member does. For a tagged template, apply this test to the selected tag signature's result. Keep the original native invocation inside the bridge thunk, preserving its receiver, cached template object identity, once-only substitutions and evaluation order.

```vibe es
// compiler-gap: pending VIP-4
async function tag(_parts: TemplateStringsArray) { return 7 }
effect function unwrappedTag() { const p = tag`x`; return 0 } // EK0404
effect function wrappedTag() { return try tryPromise(() => tag`x`) } // Success(7)
```

```ts effect
import { Effect } from "effect"

async function tag(_parts: TemplateStringsArray) { return 7 }
function wrappedTag() {
  return Effect.gen(function* () {
    return yield* Effect.tryPromise(() => tag`x`)
  })
}
// Success(7).
```


```vibe es
// compiler-gap: pending VIP-4
function maybeQuery(): Promise<number> | undefined { return undefined }
effect function mixed() {
  // const p = maybeQuery() // EK0404: may produce a Promise
  return try tryPromise(async () => maybeQuery())
}
```

```ts effect
import { Effect } from "effect"

function maybeQuery(): Promise<number> | undefined { return undefined }
const mixed = Effect.tryPromise(async () => maybeQuery())
```

A plain function may propagate a JavaScript throw; an `async` function turns it into rejection. Effect code calls a function whose thrown type is `never` directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md). `Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code. An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk under the wrapper annotations above.

A dynamic import uses the same explicit Promise bridge. Enclose the complete native import expression, including its arguments, in the thunk once per execution; bridging never admits a forbidden literal module specifier. The local `worker.mjs` fixture exports `const value = 7` with matching declarations.

```vibe es
// compiler-gap: pending VIP-4
effect function unwrappedImport() { const module = import("./worker.mjs"); return 0 } // EK0404
effect function importedValue() {
  const module = try tryPromise(() => import("./worker.mjs"))
  return module.value
} // Success(7)
type Worker = typeof import("./worker.mjs") // erased type query
```

```ts effect
// fragment: ./worker.mjs exports const value = 7 and has matching declarations
import { Effect } from "effect"

function importedValue() {
  return Effect.gen(function* () {
    const module = yield* Effect.tryPromise(() => import("./worker.mjs"))
    return module.value
  })
}
type Worker = typeof import("./worker.mjs")
// importedValue succeeds with 7; Worker is a type query, not a runtime import.
export { importedValue }
```


A tracked throwing call in a plain `catch` handler's eager parameters or body is an error (`EK0403`), including defaults, destructuring and computed binding keys. Use an effect handler with nonthrowing parameters, moving the throwing initialization into its body and bridging it explicitly. Keeping it in an effect handler's parameters still encounters `EK0401`; `try` cannot run there. Implicit initialization exceptions and explicit JavaScript throws retain their defect policies. Merely defining a nested source function adds no calls to initialization; invoking it checks its contract.

```vibe es
// compiler-gap: pending VIP-4, VIP-5
function defaultError(): never { throw "default" }
effect function rejected() {
  return fail(undefined) catch (e: unknown = defaultError()) => 7 // EK0403
}
effect function recovered() {
  return fail(undefined) catch effect (input) => {
    if (input === undefined) try Effect.try({ try: () => defaultError(), catch: error => error })
    return 7
  }
} // Failure("default")
```

```ts effect
import { Effect } from "effect"

function defaultError(): never { throw "default" }
function defaultKey(): never { throw "key" }
const defaultedHandler = Effect.catch(Effect.fail(undefined),
  (e: unknown = defaultError()) => Effect.succeed(7))
const expressionHandler = Effect.catch(Effect.fail(undefined),
  function (e: unknown = defaultError()) { return Effect.succeed(7) })
const computedHandler = Effect.catch(Effect.fail({}),
  ({ [defaultKey()]: value }: any) => Effect.succeed(7))
const implicitHandler = Effect.catch(Effect.fail(null as any),
  ({ value }: { value: number }) => Effect.succeed(value))
const lazyHandler = Effect.catch(Effect.fail(undefined),
  (e: unknown = () => defaultError()) => Effect.succeed(7))
const bridgedHandler = Effect.catch(Effect.fail(undefined), input => Effect.gen(function* () {
  if (input === undefined) yield* Effect.try({ try: () => defaultError(), catch: error => error })
  return 7
}))
// Defaults and computed keys above Die("default") / Die("key"); implicitHandler dies with TypeError.
// lazyHandler succeeds with 7; bridgedHandler fails with "default".
```

```vibe es
// compiler-gap: pending VIP-4
// fragment: source: string!Error; parse(e: Error): string may throw
source catch (e) => parse(e) // error
source catch effect (e) => try Effect.try(() => parse(e))
```

```ts effect
// fragment
const source = Effect.fail(new Error("input"))
function parse(e: Error): string { throw e }
const recovered = Effect.catch(source, (e) => Effect.try(() => parse(e)))
```

```vibe es
// compiler-gap: pending VIP-4
function parse(s: string) { if (!s) throw new Error("empty"); return s }   // throws Error (inferred)
function add(a: number, b: number) { return a + b }                         // throws never

effect function load(s: string, q: string) {
  add(1, 2)                                      // ok: throws never
  parse(s)                                       // error: may throw
  const p = try Effect.try(() => parse(s))       // ok: the thunk parameter admits any throw
  const r = try tryPromise(() => queryDb(q))     // a Promise is always wrapped; queryDb is from a .ts module
  return [p, r]
}
```

```vibe es
// compiler-gap: pending VIP-4
error BadInput
effect function parsed(s: string) {
  return try Effect.try({ try: () => parse(s), catch: () => new BadInput() })
}
```

```ts effect
// fragment
class BadInput extends Data.TaggedError("BadInput") {}
function parsed(s: string) {
  return Effect.gen(function* () {
    return yield* Effect.try({ try: () => parse(s), catch: () => new BadInput() })
  })
}
```

An empty input fails with `BadInput`; the thunk-only form instead fails with Effect's `UnknownError`.

`Effect.try` keeps its module prefix because `try` is a reserved word ([VIP-6](../vips/0006-effect-globals.md)).

The annotations affect checking, not the JavaScript implementation:

```vibe es
// compiler-gap: pending VIP-4
/** @rethrows callback */
function invoke(callback: () => string) { return callback() }
type Reader = () => string                       // throws never by default
function stream(text: string) { return Stream.succeed(text) }
function layer() { return Layer.empty }          // both effectful: never tracked
class Input {
  constructor(readonly text: string) { if (!text) throw new Error("empty") }
  get value() { return this.text }               // access is not throw-tracked
}
effect function checked(text: string) {
  const input = try Effect.try(() => new Input(text)) // the constructor throws Error
  const some = Option.some(input.value)                  // throws never
  const decode = Schema.decodeUnknownSync(Schema.String) // building the decoder throws never
  return try Effect.try(() => decode(text))              // the decoder throws SchemaError
}
```

```ts effect
// fragment
/** @rethrows callback */
function invoke(callback: () => string) { return callback() }
type Reader = () => string
function stream(text: string) { return Stream.succeed(text) }
function layer() { return Layer.empty }
class Input {
  constructor(readonly text: string) { if (!text) throw new Error("empty") }
  get value() { return this.text }
}
function checked(text: string) {
  return Effect.gen(function* () {
    const input = yield* Effect.try(() => new Input(text))
    const some = Option.some(input.value)
    const decode = Schema.decodeUnknownSync(Schema.String)
    return yield* Effect.try(() => decode(text))
  })
}
```

### Code outside the generator

Parameter and class initialization retain JavaScript evaluation timing. `try` works like `await` (VIP-5): parameter defaults, field initializers and static blocks are not effect code ([Appendix A](900-appendices.md#the-effect-parameter)):

- **Parameter defaults and destructuring** run at the call, before the Effect exists. An effectful function can't throw, so a default whose thrown type is not `never` is an error (`EK0401`). A default that returns a Promise is a plain value, as in TypeScript. Destructuring a parameter can still throw a `TypeError`, an implicit throw. As an `async` function rejects instead of throwing (ECMA-262 EvaluateAsyncFunctionBody), the call of an `effect` function then gives an Effect that dies with that value, and a producer's gives a `Stream` that dies with it. The call itself never throws. A `.ts` function that returns an Effect keeps its own behavior.
- **Instance field initializers** run in `new X()`, so their thrown types belong to the constructor. With no written derived constructor, include the implicit `super(...args)` call.
- **Static blocks and static field initializers** run when the class is evaluated, including inside a generator. The class evaluation contributes their uncaught throws and unwrapped throwing calls, inferred as a plain body: `never` if there are none. It joins a plain enclosing function's thrown type; a non-`never` class evaluation is `EK0403` in effect code or `EK0401` in a plain effectful-returning function. These initializers are not themselves effect code; `try` cannot run an Effect there.
- **Arguments** are evaluated by the caller, so their thrown types are the caller's.
- **Wrapper thunks** run inside the Effect: their throws become what the wrapper makes of them.

```vibe es
// compiler-gap: pending VIP-4
// fragment: s: string and q: string are supplied by the enclosing scope
effect function a(p = parse(s)) { return p }          // error: a default that may throw
effect function b(p = queryDb(q)) { return p }        // error: unannotated foreign queryDb may throw unknown
async function resolved() { return 1 }              // calling an async function throws never
effect function b2(p = resolved()) { return p }      // allowed: p is a Promise
effect function c({ id }: User) { return id }         // c() from untyped JS gives an Effect that dies with TypeError
```

## `error` declarations

### Syntax

[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript. Two members on one line with no separator, `error E { a: number b: string }`, are `EK1306`; the quick fix inserts `;`.

`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module "m"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).

Bodyless plain and `async` overload signatures are methods in both error forms, as in a TypeScript class; they execute no code themselves. For example, `labels()` gives an Effect with `Success(["ok", 7])`:

```vibe es
// compiler-gap: pending VIP-13, VIP-29
error Plain {
  label(x: string): string;
  label(x: number): number;
  label(x: string | number) { return x }
}
schema error Encoded {
  label(x: string): string;
  label(x: number): number;
  label(x: string | number) { return x }
}
effect function labels() { return [new Plain().label("ok"), new Encoded().label(7)] }
```

```ts effect
// Error-method overload counterpart
import { Data, Effect, Schema } from "effect"
class Plain extends Data.TaggedError("Plain") {
  label(x: string): string;
  label(x: number): number;
  label(x: string | number) { return x }
}
class Encoded extends Schema.TaggedError<Encoded>()("Encoded", {}) {
  label(x: string): string;
  label(x: number): number;
  label(x: string | number) { return x }
}
const labels = () => Effect.gen(function* () {
  return [new Plain().label("ok"), new Encoded().label(7)]
})
console.log(JSON.stringify(Effect.runSync(labels())))
```

Each member has one classification ([Declarations](900-appendices.md#notes-on-the-productions)): `id: string`, `readonly id: string` and `id?: string` are always [Field](900-appendices.md#field)s, each complete method or accessor is classified once, including `effect` and producer methods, empty `;` class elements are ignored, and any other class element is a [RejectedElement](900-appendices.md#rejectedelement), which the static rules below reject. The parser also accepts type parameters and heritage clauses, only so their rules can report them.

Field keys follow their actual counterpart's native checks. In a plain `error`, fields are type-only payload members whose keys use TypeScript's `TypeLiteral` member admission, matching `Data.TaggedError`'s payload type. For example, with `keys.value: number` and `key(): number`, `[keys.value]` is admitted, while `[(keys.value)]`, `[keys["value"]]` and `[key()]` retain native diagnostics such as `TS1170`, even for a call returning a literal. Admission depends on the expression shape as well as its type. Admitted computed keys and any resulting index signature are erased, with no runtime key evaluation or TDZ read. Actual methods and getters keep TypeScript's computed-name evaluation.

`schema error` field keys instead use the runtime object literal admission of `Schema.TaggedError`'s fields object ([Schema declarations](006-data.md#schema-declarations)), together with the existing `_tag` exclusion checks. The numeric call, parenthesized and element access forms above can be admitted in that counterpart. An admitted computed field key runs while building the schema-fields object and supplies just its one runtime key. The decoder requires that key and ignores other keys by default; an index signature does not make it validate arbitrary keys.

A noncomputed `__proto__` field is an own data field, including quoted and escaped spellings and fields in nested structs. Emit `["__proto__"]` in the generated schema-fields object so JavaScript's prototype-setting syntax cannot remove the field from validation.

In a `schema error` body, a computed key is `EK2117` unless its well-typed runtime property-key domain is proved to exclude `"_tag"`. Raw assignability of the unbranded string literal to a nominal key type does not establish that exclusion. Resolve effective generic constraints recursively; broad string constraints and unions that may contain the tag are rejected. Use enum members' underlying string values. In intersections retain genuine primitive literal/template constraints, but an opaque brand or refinement marker does not exclude the underlying string. Every possible union component must exclude it.

Known numeric and symbol domains, including unique symbols, cannot become that string key. Safe literals, literal unions, templates and their brands remain admitted; `never` has no possible key. Reject `any`, `unknown`, unresolved/cyclic domains or any other unprovable exclusion conservatively. Ordinary TypeScript invalid-key errors remain independent. Use a literal key or a symbol when needed. Accepted keys keep their existing evaluation order and are emitted as written: no decoder/refinement is executed to prove exclusion, no value is unwrapped and no runtime tag guard is added.

```vibe es
// fragment
// compiler-gap: pending VIP-29
enum Field { Tag = "_tag", Count = "count" }
declare const field: Field
schema error Bad { [field]: number } // reserved-tag diagnostic: Field.Tag remains possible
schema error Good { [Field.Count]: number }
function generic<K extends string>(key: K) {
  schema error AlsoBad { [key]: number } // the string constraint may be "_tag"
}
```

```ts effect
import { Schema } from "effect"
enum Field { Tag = "_tag", Count = "count" }
class Good extends Schema.TaggedError<Good>()("Good", { [Field.Count]: Schema.Number }) {}
const admittedKeyExit = Schema.decodeUnknownExit(Good)({ _tag: "Good", count: 1 }) // Success
const BrandedKey = Schema.String.pipe(Schema.brand("Key"))
const brandedKey = Schema.decodeUnknownSync(BrandedKey)("_tag")
const rawBrandAssignable: "_tag" extends typeof brandedKey ? true : false = false
const rawEnumAssignable: "_tag" extends Field ? true : false = false
brandedKey // "_tag": nominal typing does not change the runtime property key
```

```ts effect
import { Schema } from "effect"

const field = "actual"
class Dynamic extends Schema.TaggedError<Dynamic>()("Dynamic", { [field]: Schema.Number }) {}
const decode = Schema.decodeUnknownExit(Dynamic)
decode({ _tag: "Dynamic", other: 1 })             // Failure: actual is missing
decode({ _tag: "Dynamic", actual: 1, other: 2 })  // Success: other is stripped
```

```vibe es
// compiler-gap: pending VIP-13
function plainKey() {
  error Plain { [field]: number }
  const field = "actual"
  return new Plain({ actual: 7 }).actual
}
effect function inspectKey() { return plainKey() } // Success(7); no early read of field
```

```ts effect
import { Data, Effect, Schema } from "effect"

// Payload projection: the type's computed key is erased before execution.
const erasedPayloadKey = Effect.sync(() => {
  class Plain extends Data.TaggedError("Plain")<{ readonly [field]: number }> {}
  const field = "actual"
  return new Plain({ actual: 7 }).actual
})
const evaluatedSchemaKey = Effect.sync(() => {
  let reads = 0
  const key = { get field(): "actual" { reads++; return "actual" } }
  class Dynamic extends Schema.TaggedError<Dynamic>()("Dynamic", { [key.field]: Schema.Number }) {}
  return [reads, new Dynamic({ actual: 7 }).actual] as const
})
// erasedPayloadKey succeeds with 7; evaluatedSchemaKey succeeds with [1, 7].
```

```vibe es
// compiler-gap: pending VIP-13
error Access {
  role:
    | "admin"
    | "member"
  get message() { return this.role }; // empty class element is allowed
}
```

### Static rules

| Rule | Diagnostic |
| --- | --- |
| a constructor in an `error` or `schema error` body | `EK1301` |
| a `_tag` member in an `error` or `schema error` body, or a computed `schema error` key whose runtime domain cannot be proved to exclude `"_tag"`; use a literal key or a symbol | `EK2117` |
| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |
| a user-written `static` member or setter, in either error form | `EK1302` |
| type parameters, such as `error Invalid<T> { value: T }`, in either error form | `EK1303` |
| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |
| two members on one line with no separator, in either error form; write `;` or a line break between them (quick fix: insert `;`) | `EK1306` |

A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`. Otherwise a member gets one diagnostic: the first row that names it. The last row applies only when no other row applies. For example, `_tag = 1` reports `EK2117`; `static x = 1` reports the static-member rule, not the general member rule.

```vibe es
// compiler-gap: pending VIP-1, VIP-13
error BadMember { async effect get value() { return 1 } } // EK0104 and EK0105; no extra EK1304
```

### Meaning

`error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly. Optional `id?: T` maps to `readonly id?: T`, as in a TypeScript type literal. Fields, methods and getters may be interleaved, as in a TypeScript class.

User-written `static` members and setters are forbidden in both forms. The compiler-supplied matcher below is the exception; its `Symbol.customMatcher` shim is described in [Pattern matching](004-match.md#class-patterns).

```vibe es
// compiler-gap: pending VIP-13
error NotFound {
  id: string
  get message() { return `no user ${this.id}` }
}
error Timeout
```

```ts effect
// fragment
class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {
  get message() { return `no user ${this.id}` }
  static [Symbol.customMatcher](subject: unknown) {          // VIP-7: tests _tag
    return (subject as { _tag?: unknown } | null)?._tag === "NotFound" ? [subject] : false
  }
}
class Timeout extends Data.TaggedError("Timeout") {
  static [Symbol.customMatcher](subject: unknown) {
    return (subject as { _tag?: unknown } | null)?._tag === "Timeout" ? [subject] : false
  }
}
```

The matcher gives `[subject]` on a match, so `when NotFound(let e):` binds the error, and `false` otherwise. `when NotFound:` is a bare test; `when NotFound():` never matches because its zero patterns cannot match the singleton extraction list. By comparison, `when Option.None():` matches: its extracted list is empty. The 33 retained Effect error constructors, like `NotFound`, extract one subject, so their zero-argument extractors never match (details 53 and 92), and VibeLang reports a lint warning on such an extractor (`EK0703`, decided detail 82). An error is constructed with its fields as one object, `new NotFound({ id })`. Two packages that both declare `error NotFound` match each other in `match`, as with Effect's `catchTag`, because an `error` class's matcher tests `_tag` ([Pattern matching](004-match.md#class-patterns)).

VIP-7 retains module-guard checks for Effect's own tagged errors, without patching Effect (details 53 and 92). For example, `when Cause.TimeoutError(let e):` tests `Cause.isTimeoutError(subject)` and binds `subject` as `e`. A bare `{ _tag: "TimeoutError" }` does not pass that guard. These checks use neither a universal `_tag` test nor `instanceof`. The 33 resolved constructors, alias and shadowing rules and singleton extraction are listed in [Retained fixed patterns](004-match.md#retained-fixed-patterns).

```ts effect
import { Cause } from "effect"

function timeoutPattern(subject: unknown) {
  return Cause.isTimeoutError(subject) ? [subject] : false
}
timeoutPattern(new Cause.TimeoutError()) // [subject]
timeoutPattern({ _tag: "TimeoutError" }) // false
```

An `error` always extends `Data.TaggedError`. Group errors with a union, `type LookupError = NotFound | Timeout`: tagged errors are matched by `_tag`, and a subclass would match two tags.

Neither form accepts type parameters. For example, `error Invalid<T> { value: T }` and `schema error Invalid<T> { value: T }` are compile errors.

## `schema error` declarations

### Syntax

[SchemaErrorDeclaration](900-appendices.md#schemaerrordeclaration). Its [ErrorBody](900-appendices.md#errorbody) is shared with `error`. Each field's type is mapped as in a `schema` declaration, optional properties included. Every field is readonly, as in `error`, so no field gets `Schema.mutableKey`. Omitting the body means no fields, as for `error Timeout`, and the body boundary is the same as for `error`.

`schema error NotFound {` and a schema named `error` (`schema error = …`) differ at the next token. `schema error { id: string }` is a schema named `error`: `{` is not the name required after `schema error`.

### Meaning

`schema error Name { fields }` combines `error` and the field mapping of `schema` declarations ([Data](006-data.md#schema-declarations)). Fields are written as TypeScript types and mapped to Schemas. Encoding follows those codecs' `Encoded` representations; JSON, worker messages and RPC transports must support that representation. The declaration adds no implicit wire conversion. For JSON, choose compatible field codecs, such as `Schema.BigIntFromString` for a bigint encoded as a string. The body rules, and their diagnostics, are those of `error` declarations. Referenced field schemas also obey the [decoded-key modifier checks](006-data.md#schema-declarations): every payload field is effectively readonly, even without a written `readonly`, so a mutable-key reference is `EK2109`. Nested mutable values remain mutable.

```vibe es
// compiler-gap: pending VIP-29
schema error NotFound { id: string }
schema error Timeout
```

```ts effect
// fragment
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {
  static [Symbol.customMatcher](subject: unknown) {          // as for error
    return (subject as { _tag?: unknown } | null)?._tag === "NotFound" ? [subject] : false
  }
}
class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {}) {
  static [Symbol.customMatcher](subject: unknown) {
    return (subject as { _tag?: unknown } | null)?._tag === "Timeout" ? [subject] : false
  }
}
```

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 108

**Plain generators' synchronous call throws come from parameter initialization, not their suspended body.** (live `003-generator-call-phase`; owner `spec-fix-b`; VIP-1/VIP-4.) For an ordinary synchronous or async generator declaration, expression, or method, infer/check the construction call's synchronous thrown type from parameter defaults and destructuring initialization only. Its body is suspended. Calling a synchronous iterator's `next`, `return`, or `throw` uses that method's ordinary signature contract (conservative `unknown` when unannotated); this decision does not invent body-to-iterator metadata. An async generator's resumption rejects its returned Promise on body throws, but its parameter initialization still throws synchronously when the generator is called. An ordinary `async function` instead rejects for a throwing default, as before.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    **Immutable-main source scope (d0cdbe, 108).** 003/VIP4 distinguish eager synchronous/async-generator parameter initialization from suspended-body/resumption throws. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status update: applied in78b64fc8af61 (spec-fix-b; queue accepted/held, not main). Carries291c6e9dc2c1 plus the Creating Effects synchronous/ordinary-async qualification and current unreleased note; Node7/Bun7 and regen/forms/spec/docs pass. Old queue entry superseded after guarded check.
    Status: applied in 291c6e9dc2c1 (spec-fix-b; queued, not yet a main landing receipt).
    ```vibe
    function* lazy() { throw "body" }
    function failDefault(): number { throw "default" }
    function* eager(x = failDefault()) { yield x }
    async function* asyncEager(x = failDefault()) { yield x }
    effect function inspect() { const it = lazy(); return "not started" } // safe construction
    ```
    Effect TS: the same native generator declarations; `Effect.sync(() => { lazy(); return "not started" })` succeeds, `Effect.try(() => eager())` catches the default, and an ordinary async default rejects. Decided by the agent from principle 2 (ECMAScript generator execution phases) and VIP-4's “throws synchronously” contract, 2026-10-29. Applies to 003 and the generated declaration contract; not a source-language ban.

    **Round26 generator-table follow-up (Fable m13):** the absence of a generator row in 003 is source-delivery work under this existing rule, not a choice to infer suspended-body throws at construction. Async iterator resumptions produce Promises and retain the explicit `EK0404`/`tryPromise` bridge rule; `Effect.try` alone does not execute/adopt the returned Promise. Keep ordinary selected-signature contracts instead of inventing body-to-iterator metadata.

### Detail 115

**Generic instantiation preserves the declaration signature's throw classification.** (live `003-effectful-generic-instantiation`; refines details 36/38/66.) Classify whether a generic declaration signature is wholly Effect/Stream/Layer before type-argument substitution, using constraints as TypeScript does for assignability. An unconstrained return `T` is not wholly effectful; `T extends Effect.Effect<…>` can be. Once a signature carries own-throws/rethrows metadata, instantiation substitutes type parameters within that contract and retains it; it does not erase it merely because the instantiated return happens to be an Effect. Preserve the classification through aliases and declaration output. A concretely effectful declaration still has the existing never-throws contract and cannot declare or contain tracked synchronous throws.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    **Immutable-main source receipt (54182a, 115).** Immutable main `54182a644026` contains the generic pre-instantiation classification and retained own/rethrows contracts in003 and public VIP4 (history `4a337dac4d5b`). This verifies source publication; no compiler/regression rerun by decide-live.
    Status update: applied in1d1a6df63474 (spec-fix-b; queue accepted/held, not main). Replaces97b21dab7b1d with public VIP-4 generic/default-contract amendments and current-main changelog; Node3/Bun3, regeneration/forms/spec/docs pass.
    Status: applied in 97b21dab7b1d (spec-fix-b; queued, replaces withdrawn 46c8217f1921; no main landing receipt yet).
    ```vibe
    /** @throws {"boom"} */
    function keep<T>(value: T): T { throw "boom" }
    effect function f() { return try keep(succeed(1)) } // EK0403: call may throw "boom"
    // bridge construction first, then run the returned Effect:
    effect function g() { const e = try Effect.try(() => keep(succeed(1))); return try e }
    ```
    Effect TS: `Effect.gen(function* () { const e = yield* Effect.try(() => keep(Effect.succeed(1))); return yield* e })`. Decided by the agent from VIP-4's known-synchronous-throw rule, detail 38 (contracts travel with signatures), principle 2 (generic instantiation substitutes an existing declaration contract) and principle 8 (a known throw cannot acquire an exemption through substitution), 2026-10-29. This settles an unspecified classification phase; no new runtime wrapper is inserted.

### Detail 120

**A rethrows parameter's possible default callback contributes to the callable's own thrown bound.** (live `003-rethrows-default-callback`; extends details 4/38/45/66.) Use the conservative single-bound model. A rethrows parameter admits a throwing default callback just as it admits an actual callback. Infer that callback value's thrown contract before assigning it to the nonthrowing-looking parameter type, union it into the callable's own thrown bound, and emit it in `@throws` so erasing the initializer in declarations loses nothing. Evaluating the default expression can itself throw; those immediate throws also belong to the own bound, distinct from invoking the callback value. At calls, union this own bound with actual callback throws as before. It applies even when a supplied callback is safe and the default is not selected; a later precision improvement can relax that rejection without breaking code. An explicit written `@throws` must bound these contributions or gets the ordinary bound error. No conditional-default metadata or new annotation syntax is introduced.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    **Immutable-main source receipt (54182a, 120).** Immutable main `54182a644026` contains conservative default-callback own bounds, immediate initialization contributions and declaration preservation in003/public VIP4 (history `4a337dac4d5b`). Source publication is verified; compiler semantics remain separately evidenced.
    Status update: applied in1d1a6df63474 (spec-fix-b; queue accepted/held, not main). Replaces97b21dab7b1d with public VIP-4 generic/default-contract amendments and current-main changelog; Node3/Bun3, regeneration/forms/spec/docs pass.
    Status: applied in 97b21dab7b1d (spec-fix-b; queued, replaces withdrawn 46c8217f1921; no main landing receipt yet).
    ```vibe
    /** @rethrows f */
    function invoke(f: () => number = () => { throw "default" }): number { return f() }
    effect function a() { return invoke() }             // EK0403
    effect function b() { return invoke(undefined) }    // EK0403
    effect function c() { return invoke(() => 7) }      // EK0403: conservative own bound
    // emitted declaration retains @throws {"default"} and @rethrows f
    ```
    Effect TS: `Effect.try(() => invoke())`, `Effect.try(() => invoke(undefined))`, or `Effect.try(() => invoke(() => 7))` retains the synchronous exception boundary. Decided by the agent from principle 8 (never silently discard a known default throw), principle 4 (reuse the existing own-throws bound and declaration format), and VIP-4's rethrows contract, 2026-10-29. This settles an unspecified default case, not a new runtime behavior.

### Detail 133

**Plain error payload keys are type-only; schema field keys retain runtime evaluation.** (live `003-error-computed-key-erasure`; VIP-13/VIP-29.) A plain `error` declaration emits its fields in `Data.TaggedError`'s generic payload type. Computed payload keys there add no runtime lookup, evaluation, or TDZ read, as in a TypeScript type literal. The shared “one runtime key” statement applies to schema/schema-error fields' runtime schema objects only. Any admitted broad-key-to-index-signature mapping for plain errors is likewise type-only. Actual methods/getters keep ordinary TypeScript computed-name evaluation; declaration output retains the payload key type.
    **Immutable-main error-key companion (9a7f38, 133).** Chapter003/publicVIP13 now publish plain-error TypeLiteral key admission/erasure versus runtime schema-error object admission, preserving existing reserved-tag checks and actual method/getter evaluation. The complete two-file,7,121-character diff was independently read. This verifies the B companion; it does not certify full233's separately owned006/AppendixA/publicVIP15/16/29 application, selector-test byte identity or compiler behavior. `main-9a7-source-receipt.json` records exact scope.
    Earlier queued Chapter003/VIP13 companion receipt (before main `9a7f385aa855`): applied in6e02b2bc5970 (spec-fix-b; corrected replacement queued, not a main receipt; e37eee4a3b31 guarded-superseded after the decoder-selector repair). Native TypeLiteral payload admission/erasure and runtime schema-error object admission are distinct, including numeric entity-name acceptance and four TS1170 shape rejections. Node4/Bun4, strict TypeScript5.9.3 matrix, getter0/1 native controls and regen/forms/spec/docs pass. C retains006/AppendixA/VIP15/16/29; this does not claim the whole decision delivered.

    Status update: applied in876299a03280 (spec-fix-b; queue accepted/held, not main). Carries85e5747082ba with public VIP-13 key-erasure/runtime distinction and current unreleased note; Node2/Bun2 and regen/forms/spec/docs pass. Old copy superseded after guarded queue check.
    Status: applied in 85e5747082ba (spec-fix-b; queued, replaces withdrawn 4c45a2c53635; no main landing receipt yet).
    ```vibe
    function build() {
      error Plain { [field]: number }
      const field = "actual"
      return new Plain({ actual: 1 })
    } // field is not read while defining Plain
    ```
    Effect TS: `class Plain extends Data.TaggedError("Plain")<{ readonly [field]: number }> {}`, followed by the same const and construction. Decided by the agent from VIP-13's exact Data.TaggedError counterpart and principle 2 (TypeScript erases type-member keys), 2026-10-29. Distinguish the two declaration families in 003 instead of adding runtime reads to plain-error fields.


    Landed003/VIP13/plain-error-guide companion: 6e02b2bc5970 -> main9a7f385aa855 (spec-fix-b10, officialmq-10310219-20). Original finite native TypeLiteral/erasure/required-field controls and all selector assertions retained; finalNode6/Bun6/fullDocsTools,regen/forms/spec/docs pass. This receipt covers this companion only; compiler conformance and other owners’ slices remain separate.

### Detail 140

**The plain-handler tracked-call check covers its eager parameters as well as its body.** (live `003-plain-handler-parameter-default`; extends detail 39 under VIP-4/VIP-5.) A known throwing call during a plain catch handler's parameter/default/destructuring initialization is `EK0403`, just like the same call in its body. Include computed binding keys. Move the throwing work into an effect handler's body and bridge it explicitly; placing it in the effect handler's parameter list instead still encounters its existing eager-parameter check. Implicit initialization exceptions and explicit JavaScript throw statements retain the existing defect policies. Do not reject a merely defined nested source function unless its call actually contributes to initialization.
    **Throw-expression disposition (Will, 2026-11-02; VIP-40):** "Refer to tc39 spec for answer". Adopt the pinned proposal's grammar and precedence. General throw expressions remain supported; the retirement codemod is cancelled. Where a throw is allowed remains the 2026-10-31 no-throw ruling (EK0401).
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    **Immutable-main source receipt (54182a, 140).** Immutable main `54182a644026` contains the plain-handler eager parameter/default/destructuring/computed-key check in002/003 and public VIP5 (history `b453ef86dce6`), distinguishing tracked calls from implicit defects and lazy nested definitions. No compiler execution by this lane.
    Status: applied in 025f449d7ea4 (spec-fix-b; queued, not yet a main landing receipt). Eager/default/destructuring/computed-key and uncalled-function controls; public VIP-5 reconciled.
    ```vibe
    function defaultError(): never { throw "default" }
    effect function recover() {
      return fail(undefined) catch (e: unknown = defaultError()) => 7 // EK0403
    }
    ```
    Effect TS: the plain handler's native parameter default runs inside `Effect.catch`'s invocation and can defect; the checked alternative is an effect handler whose generator uses `yield* Effect.try(() => defaultError())` where the default is selected. Decided by the agent from detail 39's no-unwrapped-known-throw policy, principle 4 (one synchronous invocation includes initialization and body), and principle 8 (do not silently lose a known throw at a parameter boundary), 2026-10-30. The explicit-throw-as-defect exception is not removed.

    **Throw grammar and diagnostics (Will, 2026-11-02; VIP-40; details 189/232/284):** The TC39 snapshot at `78b887751db4e380870a0a6bfc47319c50aa1404` now defines general throw expressions. Earlier comparisons to native TypeScript did not establish VibeLang rejection. Keep the parser dispatch, adopt the proposal's unary recursion and punctuator lookahead, and retain EK1010 for that VibeLang syntax restriction. VIP-39 imports these productions in JSX mode too. The proposed conversion to do blocks is cancelled.

### Detail 166

**Nonrepresentable or expanding recursive thrown summaries widen conservatively to unknown.** (live `003-polymorphic-recursive-throws`; refines details 43/115 under VIP-4/VIP-27.) Keep precise least-fixed-point inference for ordinary stable recursive summaries. When polymorphic substitution creates an expanding summary cycle for which the pinned checker cannot produce a finite representable stable contract, widen the affected inferred SCC summary to unknown and emit @throws {unknown}. Never silently truncate the union, keep only its first type argument, or emit an invalid circular alias. A written checked upper bound, including unknown, cuts the corresponding inference dependency and is validated normally. Apply to mutual recursion too.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    **Immutable-main source scope (d0cdbe, 166).** 003/VIP4 widen nonrepresentable expanding inferred recursive throws to unknown within pinned checker bounds, without truncating contracts or changing independent source errors. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status update: applied in4bb15a41d1f3 (spec-fix-b; queue accepted/held, not main). Complete original0aad5cdcd238 fix/public VIP-4 amendment retained, moved its bug note to current unreleased section and regenerated on main; Node2/Bun2/spec/docs/forms green. Old entry superseded after guarded check.
    Status: applied in 0aad5cdcd238 (spec-fix-b; queued, not yet a main landing receipt).
    ```vibe
    export function grow<T>(value: T, depth: number): void {
      if (depth <= 0) throw value
      grow([value], depth - 1)
    } // inferred @throws {unknown}, not T or a finite T[] truncation
    ```
    Effect TS: the same native function; its emitted ordinary declaration has @throws {unknown}. Use the pinned TypeScript checker's recursion/instantiation/representation bounds for summary computation (current checker: recursive instantiation depth 100 or 5,000,000 instantiations per operation; node-builder representation depth 100), widening the summary rather than attempting an unbounded symbolic fixed point. Failure arising in independent source type checking still reports TypeScript's normal diagnostic; this fallback applies only to inferred throws. A resource-limited summary may conservatively lose precision, never soundness. Decided by the agent from principle 8 (unknown contains every real throw and admits no falsely nonthrowing call), principle 4 (reuse the existing unknown contract and declaration format), and VIP-27's valid-declaration requirement, 2026-10-30. An explicit annotation remains available without introducing a new mandatory-annotation error.

### Detail 176

**An outward parameter-default return in an ordinary async callable fulfills its Promise.** (live `003-async-default-return-completion`; makes detail 68's accepted moved-default/ordinary-return meaning explicit for VIP-1/VIP-2 integration.) Retain the existing early-return meaning rather than changing it to parameter-initialization rejection: evaluate the parameter/default work eagerly, skip the remaining defaults and source body on `return v`, and fulfill the returned Promise with the normal async adoption of `v`. A genuinely throwing default still rejects the Promise. Apply to ordinary nongenerator async declarations, expressions, methods and arrows, including concise arrows where their parameter default can return outward. Distinguish ReturnCompletion and ThrowCompletion; the native async algorithm's generic abrupt-initialization rejection branch cannot be imported literally for the return-bearing expression TypeScript does not have. Record that explicit do/async integration reconciliation in the do snapshot README and 002/003, together with the existing parameter-environment/length/evaluation-order guarantees. Details 163–164 for ordinary generators and 118 for source Effect/producer defaults remain separate.
    ```vibe
    async function early(x: unknown = do { return 7 }) { return 0 }
    effect function inspect() {
      return try tryPromise({ try: () => early(), catch: (e) => e }) // succeeds with 7
    }
    async function thrown(x: unknown = do { throw 7 }) { return 0 } // returned Promise rejects with 7
    ```
    Effect TS: `async function early(x = undefined) { if (x === undefined) return 7; return 0 }`; its explicit `Effect.tryPromise` bridge succeeds with `7`. Replacing that `return 7` by `throw 7` makes the bridge fail with `7`. Use the guarded body-return code only as a simple behavioral counterpart, not a general parameter-binding lowering recipe. Decided by the agent from detail 68's already-selected moved-default return meaning, principle 2 (an ordinary async `return` fulfills with normal Promise adoption), and principle 4 (retain one outward-return meaning rather than reinterpret it as a throw only during async parameter setup), 2026-10-30. This is class A because it preserves the settled recipe's result and does not change admitted source behavior; the alternative literal-initialization rejection would change that result. Primary ECMAScript's abrupt/reject branch was independently verified from its functions chapter on nyc-01; `decide-live-scratch/root-async-default-model.log` records literal-model `Fail(7)`, accepted-return counterpart `Success(7)`, and genuine-throw counterpart `Fail(7)` on Effect `4.1.0`. These are algorithm/reference checks, not native-do or compiler conformance.

### Detail 185

**Ordinary async declaration output preserves callback admission without synchronous rethrows.** (live `003-async-rethrows-declaration`; VIP-4/VIP-27 normalization, qualifies details 38/66/120's generic copy rule.) For a source nongenerator `async` callable, callback and parameter/default throws reject its Promise; the construction call's synchronous contract remains `never`. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In emitted declarations, represent that admission with the existing per-parameter callable `@throws {unknown}` signature (or equivalent existing signature metadata), emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after the `async` modifier is erased. Normalize async declarations, methods and arrows alike, through aliases and sidecars; create an appropriately annotated parameter type locally rather than mutating a shared type alias. Preserve any returned callable's own contract under detail 173. No additional runtime wrapper or async-identity annotation is needed.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    **Immutable-main source scope (d0cdbe, 185).** 001/003 and VIP4/27 normalize ordinary nongenerator async callback admission on emitted parameter signatures with callee never-throws and no active synchronous rethrows; plain Promise functions and async generators remain distinct. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status update: applied in78b64fc8af61 (spec-fix-b; queue accepted/held, not main). Carries291c6e9dc2c1 plus the Creating Effects synchronous/ordinary-async qualification and current unreleased note; Node7/Bun7 and regen/forms/spec/docs pass. Old queue entry superseded after guarded check.
    Status: applied in 291c6e9dc2c1 (spec-fix-b; queued, not yet a main landing receipt).
    ```vibe
    /** @rethrows f */
    export async function invoke(f: () => number) { return f() }
    /** @throws {never} */
    function build() { return invoke(() => { throw "callback" }) } // accepted from source or sidecar
    ```
    Effect TS: ordinary native `async invoke` returns a Promise rejected with `"callback"`; bridge it with `Effect.tryPromise`. Its emitted declaration has a `@throws {never}` callee and a parameter type such as `{ /** @throws {unknown} */ (): number }`, with no synchronous `@rethrows`. A plain function returning `Promise.resolve(f())` can instead throw before returning; keep its ordinary own-throws/rethrows contract and explicit `Effect.try` bridge. Do not infer the async exception from a Promise return type, and do not apply it to async generators, whose construction/default rules are details 108/163. Decided by the agent from principle 2 (ordinary async throws reject), VIP-4's already-settled async-never rule, VIP-27's source/declaration contract agreement, and principle 4 (reuse admission and signature metadata instead of adding a new async marker), 2026-10-30. Reconcile 001/003 and VIP-4/VIP-27's unconditional-copy wording; test source-versus-sidecar diagnostics and default/callback admission. `decide-live-scratch/root-async-rethrows-types.log` verifies native declaration erasure; `root-async-rethrows-reference.log` records equal ordinary declaration shapes, async rejection versus a genuine synchronous throw, and the matching typed-failure bridges on Effect `4.1.0`. These are reference/metadata-consistency checks, not VibeLang compiler-conformance results.

### Detail 269

**A bare `: infer _` return annotation is not a VibeLang form; the flip codemod deletes it and writes no `infer` into any signature.** (drive-t3code `V4/V5:nested-infer-annotation-lowering` in inbox/migrate-alchemy.md 2026-11-01T02:36Z and migfix-t3code `bf181747` in inbox/migfix-t3code-2.md; accepted VIP-1 and VIP-3, chapter 001 "A function's kind is decided by a keyword on the function, never by its body or by a type" and "To have the type inferred, leave the annotation out", existing194, principles2,4 and8.) Before the VIP-1 flip the migration tools wrote `: infer _` to keep a function plain (historical D282/D500; inbox/migrate-alchemy.md line152 says so explicitly: "until then"). Under VIP-1 a function with no `effect` or `async` keyword is plain by syntax, so the marker carries no information, and TypeScript admits `infer` only in the `extends` clause of a conditional type (TS1338). Rule: `infer` has no VibeLang meaning in a return annotation, bare or as an `Effect<…>` slot; a channel is written out or the whole annotation is left out (001 line374, VIP-3, 194). The flip codemod removes every bare `: infer _` that it or an earlier `--fix` wrote and leaves the return type to TypeScript inference; it never emits `infer` into a callback or any other signature, and "preserve the `infer _` marker when lowering nested callbacks" is not a requirement. Where the declared public type matters (an exported declaration whose emitted `.d.vibe.ts` must stay byte-identical under VIP-27), write the original TypeScript return type instead. The compiler's channel-slot `infer` hook (`inferChannel`, `effectTypeRewrite`) is a pre-flip implementation leftover to retire with the flip, not a spec form; the user-docs page getting-started/003-the-effect-type.md, which teaches `Effect<infer A, …>`, `number!!` as the fix for `EK2003` and D282, is stale against chapter 001 and Appendix B (`EK2003` is now the `for try` label error). No case under typescript/vibelang/cases uses a bare `: infer _`.

    ```vibe
    // before the flip a codemod wrote: try: (): infer _ => Promise.resolve(1), catch: (cause): infer _ => String(cause)
    const run = effect () => {
      return try Effect.tryPromise({ try: () => Promise.resolve(1), catch: (cause) => String(cause) }) // plain callbacks, TypeScript inference
    }
    export const describe = (cause: unknown): string => String(cause) // written type where the public declaration must not change
    ```

    Effect TS:

    ```ts
    const run = () => Effect.tryPromise({ try: () => Promise.resolve(1), catch: (cause) => String(cause) })
    export const describe = (cause: unknown): string => String(cause)
    ```

    Decided by the agent from accepted VIP-1 (kind by keyword), VIP-3 and chapter 001 (an omitted slot is `never`; inference is the omitted annotation), existing194, principle2 (TypeScript's `infer` grammar), principle4 (no marker without meaning) and principle8, 2026-11-01. Class A; no Will question. Existing-code impact: a bare `: infer _` is a TypeScript syntax error in a flipped program and the flip codemod rewrites it in the same migration; no program meaning changes. Owners: flip-core/codemod-alchemy/migfix-t3code for the codemod, impl for the hook retirement with a regression case and a keyed fuzz mutation (`infer` in each annotation position), docs for the stale page.

    - **Correction and addendum to detail 269 (2026-11-01T02:50:24Z): a channel written `infer Name` stays a form; only the bare `: infer _` whole-type marker is not.** The sentences "bare or as an `Effect<…>` slot" and "the compiler's channel-slot `infer` hook ... is a pre-flip implementation leftover to retire with the flip" are withdrawn. A slot written `infer Name` inside `Effect<A, E, R>`, or a bang-form slot, of a body return annotation is the per-channel inference form: Will's S2 ("Each channel is inferred or declared, inference is never silently confused with `never`") and the D57 row ("`infer Name` channels ... Document it, or connect the channels") in core-decisions.md; compiler case `typescript/vibelang/cases/contracts/main.vibe` ("A channel written `infer Name` comes from the body (D57)"), six user-docs pages and Appendix A's EffectOperand ("optionally after keyof, unique, readonly or infer") carry it. Chapter 001 line 374 speaks only of an omitted slot (`never`; omit the whole annotation to infer everything) and is silent on a written `infer`: that silence is the spec gap. Class A under D57's own default (document it): the spec owner adds to chapter 001, beside line 374, "A slot written `infer Name` is inferred from the body as `Effect.gen` would infer it; the name is documentation only, not a binding, and `infer _` is allowed", citing D57 and S2, and Appendix A keeps its grammar. No compiler change for the slot form; a keyed fuzz construct should pin `infer` in each slot of each annotation position. The bare marker rule, the codemod rule and the stale `EK2003`/D282/`number!!` sentences of getting-started/003 stand as written above.
