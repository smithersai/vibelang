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

A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.

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

1. **Effectful callee:** its thrown type is `never`; neither `@throws` nor `@rethrows` adds synchronous throws.
2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.
3. **Rethrows:** union the own thrown type with the thrown types of the actual callbacks passed for every named `@rethrows` parameter, whichever case in step 2 applied. The tag is written, never inferred. `@throws {never}` describes only the callee's own throws and does not erase `@rethrows f`. Argument-expression evaluation remains the caller's code.

Calling an `async` `.vibe` function throws `never`: body throws reject its Promise. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; their generated constructors do not throw for well-typed input in Effect 4.1.0. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.

The generator publishes the normative thrown-signature inventory, `docs/design/inventory/throws.json` (detail 81a): exact TypeScript lib inputs and Effect version, keyed by module, declaration and overload signature, with own throws, `@rethrows` parameters, callback admission and returned callable contracts. That artifact awaits its generator: **the specification is incomplete for shipped thrown contracts**. The examples below are not a complete inventory. An unannotated signature follows step 2's inference or default, then step 3's `@rethrows`; omission does not imply `@throws {never}`. Regeneration is part of an Effect or TypeScript bump.

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

<a id="implicit-throws"></a>**Implicit and tracked built-in throws** (decided detail 81). A throw that ECMA-262 or the web or Node lib specifies for a `lib.d.ts` global is implicit (untracked, a defect in effect code) when it comes from the receiver's or the environment's state, not from the documented contract on the arguments: a frozen, sealed or non-extensible receiver; a revoked or trapping proxy; a user getter, setter, `valueOf`, `toString` or `Symbol.toPrimitive`; a detached buffer; or a resource limit (length overflow, stack, memory). Every other specified throw is argument validation and is tracked with its class only when reachable from well-typed arguments under TypeScript `strict` (detail 40). A throw that no argument of the declared parameter types can reach is not tracked: `Object.keys(o)` with `o: object`, for example, throws `never`. Reachable argument-validation throws include: `JSON.parse`, `JSON.stringify` on a cycle or a `bigint`, `BigInt("x")`, `new RegExp(bad)`, `decodeURI*`, `atob`, `structuredClone`, `repeat` and `padStart` counts, `toFixed`, `toPrecision` and `toString(radix)` ranges, `new Array(-1)`, `normalize(form)`. Detail 40's generator applies this classification to the `lib.d.ts` globals ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)).

```ts effect
import { Effect } from "effect"

const keys = (o: object) => Object.keys(o) // throws never for well-typed arguments
const builtins = Effect.gen(function* () {
  const names = keys({ a: 1 })
  const repeated = yield* Effect.try(() => "x".repeat(-1)) // RangeError becomes a failure
  return [names, repeated] as const
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

Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never` (detail 43): `fib` below throws `never`, `walk` throws `Error`. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).

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

### Assignability

As for Swift's non-`throws` function type, a function whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, and `@throws {unknown}` admits anything. A parameter named by `@rethrows` admits anything, because the call then throws what its argument throws. So `const r: () => string = parse` is an error (`EK0402`): wrap the function, or annotate the type `@throws`.

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

### Calls in effect code

| Rule | Diagnostic |
| --- | --- |
| In effect code or the body of a plain `catch` handler, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |
| In effect code, a call, `new` expression or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited. Move the expression into a `tryPromise` thunk, whether or not it can reject; `promise` also works when the thunk's thrown type is `never` | `EK0404` |

`EK0404` uses the Promise test of [Result tests](002-running.md#result-tests) (detail 89): `never`, `any` and `unknown` never trigger it; any union with at least one `PromiseLike` member does.

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

A tracked throwing call in a plain `catch` handler is an error (`EK0403`, detail 39); use an effect handler and a wrapper. An explicit `throw` in the plain handler retains VIP-5's defect meaning.

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
effect function c({ id }: User) { return id }         // c() from untyped JS throws TypeError at the call
```

## `error` declarations

### Syntax

[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: ECMAScript's `MethodDefinition` (plain, `async`, generator and `async` generator methods, getters and setters, private names included) with TypeScript's class-method modifiers, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a `MethodDefinition` and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.

`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module "m"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).

Each member has one classification ([Declarations](900-appendices.md#notes-on-the-productions)): `id: string`, `readonly id: string` and `id?: string` are always [Field](900-appendices.md#field)s, each complete method or accessor is classified once, including `effect` and producer methods, empty `;` class elements are ignored, and any other class element is a [RejectedElement](900-appendices.md#rejectedelement), which the static rules below reject. The parser also accepts type parameters and heritage clauses, only so their rules can report them.

Field keys follow TypeScript object types, as in [Schema declarations](006-data.md#schema-declarations): an identifier, a string or numeric literal, or a computed name, emitted as written. A computed key of non-literal type gives an index signature in the instance type; at runtime it supplies just the one key the expression evaluates to. In `schema error`, the decoder requires that runtime key and ignores other keys by default; an index signature does not make it validate arbitrary keys.

```ts effect
import { Schema } from "effect"

const field: string = "actual"
class Dynamic extends Schema.TaggedError<Dynamic>()("Dynamic", { [field]: Schema.Number }) {}
const decode = Schema.decodeUnknownExit(Dynamic)
decode({ _tag: "Dynamic", other: 1 })             // Failure: actual is missing
decode({ _tag: "Dynamic", actual: 1, other: 2 })  // Success: other is stripped
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
| a `_tag` member in an `error` or `schema error` body | `EK2117` |
| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |
| a user-written `static` member or setter, in either error form | `EK1302` |
| type parameters, such as `error Invalid<T> { value: T }`, in either error form | `EK1303` |
| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |

A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets that diagnostic alone, including in either error form. Otherwise a member gets one diagnostic: the first row that names it. The last row applies only when no other row applies. For example, `_tag = 1` reports `EK2117`; `static x = 1` reports the static-member rule, not the general member rule.

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

`schema error Name { fields }` combines `error` and the field mapping of `schema` declarations ([Data](006-data.md#schema-declarations)). Fields are written as TypeScript types and mapped to Schemas, so the error can be decoded from JSON and crosses workers and RPC. The body rules, and their diagnostics, are those of `error` declarations.

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
