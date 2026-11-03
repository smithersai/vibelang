# Running Effects

Sources: [VIP-4](../vips/0004-throw.md), [VIP-5](../vips/0005-try-runs-effects.md), [VIP-2](../vips/0002-effect-blocks-and-do.md), [VIP-17](../vips/0017-fork.md), [VIP-18](../vips/0018-concurrent.md), [VIP-19](../vips/0019-for-concurrent.md), [VIP-20](../vips/0020-for-try.md), [VIP-21](../vips/0021-producers.md), [VIP-22](../vips/0022-interruption-blocks.md), [VIP-23](../vips/0023-pipe.md).

Calling an `effect` function constructs its cold Effect. Calls retain ordinary JavaScript evaluation, including receivers, arguments and parameter initialization; a plain factory can perform JavaScript work while constructing its result. Returning an Effect does not itself execute it. The table lists language execution sites in effect code (an `effect` function, a producer or an `effect` block); native Effect APIs and explicit written runners keep their own call behavior:

| Construct | Runs |
| --- | --- |
| `try e` | one Effect, giving its success |
| `e catch (err) => y` | one Effect, handling its failure |
| `fork e` and its forms | one Effect, in a new fiber |
| `join f` | `Fiber.join(f)`, giving the fiber's success or propagating its failure |
| `throw e` | `Effect.fail(e)`, failing the enclosing Effect with `e` as its error value |
| `try.all`, `try.race`, `try.any`, `try.allSettled` | several Effects at once |
| `for concurrent` | one Effect per item, at once |
| `for try` | one Effect per Stream element, in order |
| `provide`, `uninterruptible`, `interruptible`, `restore` | a block of statements ([Services](005-services.md#provide-blocks) for `provide`) |
| `yield x` in a producer | one `Queue.offer`, waiting for buffer room |

"Effect code" means the body of an `effect` function, a producer or an `effect` block, not counting nested functions, class field or enum member initializers or `static` blocks, as `await` is not allowed there in an `async` function. The special `static readonly defaultValue` initializer of a `service` has that same source class-field boundary, including the reset of enclosing `fork`/`join` reservation ([Service defaults](005-services.md#meaning)). Its emitted options-object position does not grant source Effect execution. A computed class key and an `extends` clause are effect code, as `await` is allowed there: in `effect function f() { class C { [try key()]() { } } }`, `try key()` runs. It is the code Appendix A parses with [the grammar's Effect parameter](900-appendices.md#the-effect-parameter), minus parameter lists and `static` blocks, which inherit its reservation without permission to run an Effect; class field and enum member initializers parse without it. Parentheses, `do` and `match` are not boundaries; an `async match` is one, as a nested `async` function is ([Pattern matching](004-match.md)), so `try` inside it is an error. Outside effect code a parser still parses these constructs, as TypeScript parses `await x` outside an `async` function, and reports the construct's "outside effect code" error. Where the Effect parameter is off, tokens that are also valid TypeScript, such as `fork(x)` or `join(x)`, keep their TypeScript meaning. A parameter list or `static` block that inherits the reservation still parses them as fiber operations, so `effect function f(p: Fiber.Fiber<number>, a = join(p)) { }` is `EK1701`, as `async function f(p, a = await(p)) { }` is a SyntaxError.

Every operand is evaluated once, left to right as written, with two exceptions: a `catch` handler is evaluated only on failure, and the body of an `effect` block or function is evaluated on each run. Where Effect's argument order differs from source order, the source order still governs: `fork.in(scope) e` evaluates `scope` before `e`, and `for concurrent(n) (… of xs)` evaluates `n` before `xs`. Each operand retains its source lexical environment, including the loop head scope described below.

## `try`

### Syntax

[TryExpression](900-appendices.md#tryexpression).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `try` outside effect code; the same rule applies to `try.all`, `try.race`, `try.any` or `try.allSettled` | `EK0501` |
| `try e` where `e` is not an Effect. A call that may throw, and a Promise, must first be wrapped with `Effect.try`, `tryPromise` or `promise` | `EK0502` |
| a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())` | `EK0503` |
| an unparenthesized `try`, `try.all`, `try.race`, `try.any`, `try.allSettled`, `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join` expression on the left of `**`: `try a ** b`, `fork.scoped e ** 2`, as ECMAScript rejects `await a ** b`; write `(try a) ** b` | `EK0510` |

<a id="operand-test"></a>**Operand test.** `e` is an Effect when its type is assignable to `Effect.Effect<any, any, any>`. For example, in Effect 4.1.0 an `Exit`, a `Config`, a `Context.Service` key, a `Context.Reference` and an `error` instance (`Data.TaggedError` or `Schema.TaggedError`) pass this structural test; the list is not exhaustive. So `try new NotFound({ id })` fails like `throw`. `Option`, `Result`, `Stream`, `Layer` and `Fiber` do not pass the Effect operand test. An Effect that can't fail is still run with `try`. `never` and `any` pass this test, `never` as the success of an Effect that only fails; `unknown` does not, as TypeScript doesn't assign it to `Effect.Effect<any, any, any>`; it is the operand test, not [Failures](003-failures.md)' test of which callables are effectful.

`try` works like `await`: it is a unary operator with `await`'s precedence, so `try a.b()` runs `a.b()` and `try f() + 1` adds 1 to the success. As with `await`, the operand may start on the next line. At the start of a statement, `try` followed by `{`, on the same line or not, begins a `try` statement, as in JavaScript, and that is an error in effect code.

### Meaning

`try e` is `yield* e`. It runs `e` and gives its success value. A failure propagates to the enclosing Effect, as Zig's `try x` means `x catch |err| return err`. The static operand test adds no runtime Effect guard: an unchecked `any` follows native delegation, including its iterator errors, rather than Promise adoption or identity on a non-Promise value. A noniterable such as `5`, `undefined` or an ordinary Promise produces a native `TypeError` defect; an unchecked empty iterable can complete with `undefined`, and an ordinary iterator can delegate Effects or return a value. This does not admit typed arrays or generators as Effect operands. See the [checked runtime witness](008-runtime.md#unchecked-delegation).

```vibe es
// compiler-gap: pending VIP-5
effect function load(id: string) {
  const u = try fetchUser(id)
  try sleep("1 second")
  return u
}
```

```ts effect
// fragment
function load(id: string) {
  return Effect.gen(function* () {
    const u = yield* fetchUser(id)
    yield* Effect.sleep("1 second")
    return u
  })
}
```

The structural test admits both values below; running `operands()` gives `Success(15)`:

```vibe es
// compiler-gap: pending VIP-5
import { Config, Exit } from "effect"
effect function operands() {
  const a = try Exit.succeed(8)
  const b = try Config.succeed(7)
  return a + b
}
```

```ts effect
import { Config, Effect, Exit } from "effect"

function operands() {
  return Effect.gen(function* () {
    const a = yield* Exit.succeed(8)
    const b = yield* Config.succeed(7)
    return a + b
  })
}
// operands succeeds with 15.
```

## `catch`

### Syntax

[CatchExpression](900-appendices.md#catchexpression) with a [CatchHandler](900-appendices.md#catchhandler). `catch` sits beside `??` in ECMAScript's precedence chain: it has the precedence of `??` and is left-associative, so `a catch (() => b) catch (() => c)` parses as `(a catch (() => b)) catch (() => c)`, which type-checks only when the inner `catch` gives an Effect (below), and `x = a catch () => b` assigns the result. As with `??`, mixing it with `??`, `||` or `&&` needs parentheses; without them it is a syntax error.

The handler is always a function literal, and its syntax alone decides its kind (VIP-5, amended 2026-10-29). Either kind may be parenthesized:

| Handler | Kind | On `fail("bad")` gives |
| --- | --- | --- |
| an `effect` arrow or `effect function` expression | effect function | what the function's Effect succeeds with; a `throw` in it fails again, typed |
| an arrow or `function` expression | plain function | what the function returns |

Anything else after `catch` is a syntax error (`EK0509`): a name, a call, any other value, an `effect { … }` block, a class expression, an `async` arrow or function expression, or a generator or `async` generator expression (decided detail 85). The quick fix wraps a value in a function literal, so the handler's kind stays visible in the source, and removes `async` or `*` from a function:

| Written | Kind | On `fail("bad")` gives |
| --- | --- | --- |
| `x catch (e) => 7`, `x catch ((e) => 7)` | plain function | `7` |
| `x catch () => guest` | plain function | `guest` |
| `x catch function (e) { return 7 }` | plain function | `7` |
| `x catch effect (e) => 7`, `x catch (effect function (e) { return 7 })` | effect function | `7` |
| `x catch (e) => { throw e }` | plain function | a defect, with lint warning `EK0511`; no `EK0507` or `EK0508`, since the result type is `never` |
| `x catch guest` | syntax error | quick fix: `x catch () => guest` |
| `x catch onErr` (`onErr` a function) | syntax error | quick fix: `x catch (e) => onErr(e)` |
| `x catch effect { return 7 }` | syntax error | quick fix: `x catch effect () => { return 7 }` |
| `x catch async (e) => 7` | syntax error | quick fix: `x catch (e) => 7` |
| `x catch function* (e) { }` | syntax error | quick fix: `x catch function (e) { }` |
| `try x catch (e) { … }` | syntax error `EK0509` | quick fix: `x catch effect (e) => { … }` |

An arrow handler's body is TypeScript's concise body, which extends as far as an assignment expression does, as in `(e) => a ?? b`: `a catch () => b ? c : d` means `a catch (() => (b ? c : d))`, and `a catch () => b |> % + 1` means `a catch (() => (b |> % + 1))`: with `a` succeeding with `5` and `b` equal to `0` it gives `5`, and `(a catch () => b) |> % + 1` gives `6`. So `a catch effect (e) => b catch () => c` means `a catch (effect (e) => (b catch (() => c)))`. With a plain arrow, `b catch () => c` is in a plain function, so `a catch (e) => b catch () => c` is the error "`catch` outside effect code". Parenthesizing the arrow, `a catch ((e) => b) catch ((e) => c)`, parses, but the outer `catch` then needs an Effect operand (below).

In `(a catch h) catch k`, the outer `catch` runs the value that `a catch h` gives, so `a`'s success (`never`, if `a` only fails, passes the operand test above) and `h`'s result must both be Effects. To try fallbacks in turn, nest them in an `effect` handler: `a catch effect () => b catch () => c`.

```ts effect
// fragment
const chained = Effect.gen(function* () {
  // (a catch h) catch k, where a's success and h's result are both Effects
  return yield* Effect.catch(yield* Effect.catch(a, (e) => Effect.succeed(h(e))), (e) => Effect.succeed(k(e)))
})
const nested = Effect.gen(function* () {
  // a catch effect () => b catch () => c
  return yield* Effect.catch(a, () => Effect.gen(function* () { return yield* Effect.catch(b, () => Effect.succeed(c)) }))
})
```

After a parenthesized handler or a function expression handler, another `catch` or a lower-precedence operator may follow, but a member access or call can't attach to the handler, so `a catch function () { }.call(o)` is a syntax error. Parenthesize the whole `catch` expression first: `(a catch function () { }).pipe(f)`.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `catch` outside effect code | `EK0504` |
| `try x catch h`: write `try x` or `x catch h`, never both. It fires when a `try` or `try.all` is reachable from the head through unary and binary operator nodes only, ignoring the erased TypeScript wrappers described below: `try a + b catch h`, `-try a catch h` and `x + try a catch h` are each `EK0505`; the quick fix removes `try`. One inside arguments, an array or object literal, a template substitution, parentheses, a function body or a `match` arm does not count, so `g(try a) catch h` catches `g`'s failure. `try.all x catch h` and the other three operations get this error too, not the one below. A `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join` head gets it by the same rule, since each runs an Effect as `try` does (decided detail 99): `join f catch h` (quick fix `Fiber.join(f) catch h`, which handles the fiber's failure) and `fork e catch h` (quick fix `fork Effect.catch(e, ($e) => Effect.succeed(h($e)))`, or `fork Effect.catch(e, h)` for an `effect` handler: `e` stays on the caller and the handler runs on the forked fiber, as [`fork`'s operand](#fork-operand) says). `fork (e catch h)` runs `e` here and forks its result: `EK1703` unless the result is an Effect. `(try x) catch h` and `(join f) catch h` are allowed: each catches the Effect its parenthesized operand succeeds with. `(fork e) catch h` is not `EK0505`, but its head is a `Fiber`, which is not an Effect in Effect 4.1.0, so it is `EK0506` | `EK0505` |
| `e catch h` where `e` is not an Effect | `EK0506` |
| a non-function handler, including a parameter list followed directly by a block, or an `async`, generator or `async` generator handler (table above) | `EK0509` |
| a plain handler whose result type is a Promise or thenable (`x catch (e) => queryDb(e)`): the Promise is never run, as for an unwrapped Promise in effect code ([Failures](003-failures.md)) | `EK0507` |
| an explicit `throw` that can complete a plain handler, not one caught inside it or in a nested function: the result dies | `EK0511` (lint warning) |

For a malformed handler consisting of a parameter list followed directly by a block, as in `try x catch (e) { B }`, recovery reports `EK0509` and does not additionally report `EK0505` for that same expression. The handler has no admitted function literal yet; this priority does not suppress independent source-context or separate syntax diagnostics. A repaired, well-formed `try x catch (e) => B` still gets `EK0505`. Write `x catch effect (e) => { B }` for an Effect handler, or `x catch (e) => { B }` for a plain fallback. Their throw and result rules remain distinct. Offer a mechanical repair only when the recovered parameters, body and source jump targets form the selected valid function literal; do not move outward jumps, invent bindings or implicitly run a plain handler's returned Effect.

```vibe es
// compiler-gap: pending VIP-5
effect function malformedCatchHandler() {
  return try fail("x") catch (e) { return 0 } // EK0509, without a redundant EK0505
}
effect function repairedCatchHandler() {
  return fail("x") catch effect (e) => { return 0 }
}
effect function repairedPlainCatchHandler() {
  return fail("x") catch (e) => { return 0 }
}
```

Both explicit repairs have `Success(0)` in these counterparts. The malformed source has no runtime Exit.

```ts effect
import { Effect } from "effect"

function repairedCatchHandler() {
  return Effect.gen(function* () {
    return yield* Effect.catch(Effect.fail("x"), (e) => Effect.gen(function* () { return 0 }))
  })
}
function repairedPlainCatchHandler() {
  return Effect.gen(function* () {
    return yield* Effect.catch(Effect.fail("x"), (e) => Effect.succeed(0))
  })
}
```

For `EK0505`'s head search, [runtime-erased TypeScript expression wrappers](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/transformers/ts.ts) are transparent along the unary/binary path: `as`, angle-bracket assertions where admitted, `satisfies`, non-null `!` and type-only instantiation expressions that add no call. Actual source parentheses still stop the search; grouping added by emission is not a source grouping choice. Ordinary TypeScript checks on each wrapper still apply, and calls, literals, source functions and the other existing barriers retain their rules.

```vibe es
// compiler-gap: pending VIP-5
import { Effect } from "effect"
type Nested = Effect.Effect<Effect.Effect<number, string>, string>
effect function rejectedCatchHeads(nested: Nested, genericEffect: (<T>() => T) & Nested) {
  try nested as Effect.Effect<number, string> catch () => 7 // EK0505
  <Effect.Effect<number, string>>try nested catch () => 7   // EK0505
  try nested satisfies Effect.Effect<number, string> catch () => 7 // EK0505
  try nested! catch () => 7                                // EK0505
  try genericEffect<number> catch () => 7                  // EK0505
}
effect function groupedHead(nested: Nested) {
  return (try nested) as Effect.Effect<number, string> catch () => 7
} // Success(7) for an inner failure; an outer failure propagates
```

```ts effect
import { Effect } from "effect"

type Nested = Effect.Effect<Effect.Effect<number, string>, string>
function groupedHead(nested: Nested) {
  return Effect.gen(function* () {
    return yield* Effect.catch((yield* nested) as Effect.Effect<number, string>, () => Effect.succeed(7))
  })
}
// The parentheses expose the inner Effect to the handler, not the outer run.
```

<a id="result-tests"></a>**Result tests.** `EK0103` and `EK0508` ask: may this value be an unrun Effect? A type answers yes when it is not `never`, `any` or `unknown` and at least one union member is an Effect. `EK0404` and `EK0507` ask the same of Promises, with `PromiseLike` for Effect, as typescript-eslint's `no-floating-promises` does (decided detail 89). Detail 36 keeps its every-member test, because it asks the opposite question. Only the [operand test](#operand-test) of `try` (`EK0502`), `catch` (`EK0506`), `try.all` (`EK1801`) and `fork` (`EK1703`) uses assignability to `Effect.Effect<any, any, any>`, which `never` and `any` pass. Every other chapter names one of these two tests.

```vibe es
// compiler-gap: pending VIP-5
// fragment
async function a(x: any) { return await x }                         // ok: any fails the result test
async function b(e: Effect.Effect<number> | undefined) { return await e }   // EK0103: e may be an Effect
effect function c() { const p = maybeQuery() }                      // EK0404: Promise<number> | undefined
```

### Meaning

`e catch h` runs `e`. On a failure in its error channel it calls `h` with the error, as Zig's `catch |err|` does. `h` runs only when the `Cause` holds no defect: a `Cause` with both a failure and a defect, such as one a `.ts` function builds with `Effect.failCause`, passes through with its failures re-raised as defects, as `Effect.catch` does in Effect 4.1.0. The handler's kind decides whether its result runs Effects, as for any function. `h` is evaluated only on failure. An `effect` block is an ordinary operand, so `effect { try write(x); try close() } catch effect (e) => try log(e)` replaces the banned `try { } catch { }` statement:

| Written | Effect TypeScript |
| --- | --- |
| `x catch h`, `h` a plain function: `x catch (e) => f(e)` is `(e) => Effect.succeed(f(e))`, and `x catch () => guest` is `() => Effect.succeed(guest)`. A `throw` inside is a JavaScript exception, so a defect (VIP-5); write `catch effect (e) =>` to fail again, typed | `yield* Effect.catch(x, ($e) => Effect.succeed(h($e)))` |
| `x catch h`, `h` an effect function: it runs its Effects, and `throw` fails again, typed | `yield* Effect.catch(x, ($e) => h($e))`; for an arrow, `(e) => Effect.gen(…)` |
| `(try x) catch (e) => y`, `x` succeeding with an Effect | `yield* Effect.catch(yield* x, (e) => Effect.succeed(y))` |

```vibe es
// compiler-gap: pending VIP-5
effect function load(id: string) {
  const g = fetchUser(id) catch () => guest
  const h = fetchUser(id) catch effect (e) => match (e) {
    when NotFound: guest;
    when DbError: throw e;         // fails again, typed (VIP-4)
  }
  return [g, h]
}
```

```ts effect
// fragment
function load(id: string) {
  return Effect.gen(function* () {
    const g = yield* Effect.catch(fetchUser(id), () => Effect.succeed(guest))
    const h = yield* Effect.catch(fetchUser(id), (e) => Effect.gen(function* () {
      if (e._tag === "NotFound") return guest              // NotFound's matcher tests _tag
      if (e._tag === "DbError") return yield* Effect.fail(e)
      throw new TypeError()                                // no arm matched (pinned snapshot): a defect
    }))
    return [g, h]
  })
}
```

The known-throwing-call check covers a plain handler's eager parameter/default/destructuring initialization and computed binding keys as well as its body ([Calls in effect code](003-failures.md#calls-in-effect-code)). Use an effect handler with nonthrowing parameters and move the throwing work into its body behind an explicit bridge; a `try` in its parameter list is still forbidden, as `await` is.

A handler's parameter may have a type annotation, checked as for a TypeScript arrow parameter: the error type must be assignable to it, so `x catch (e: NotFound) => guest` is an error when `x` can also fail with `DbError` (VIP-5, amended).

A plain handler whose result type is an Effect gets a VIP-38 lint warning (`EK0508`), with the quick fix `catch effect (e) => try …`:

```vibe es
// compiler-gap: pending VIP-38
// fragment: inside an effect function
fetchUser(id) catch (e) => fetchUser("guest")              // warning: the fallback is an unrun Effect
fetchUser(id) catch effect (e) => try fetchUser("guest")   // the fix: Effect.catch(fetchUser(id), () => fetchUser("guest"))
```

A plain handler with an explicit `throw` that can complete it gets a VIP-38 lint warning (`EK0511`), with the quick fix `catch effect (e) => { … }`. The `throw` is a JavaScript exception inside the handler, so the result dies; an effect handler's `throw` fails, typed. A `throw` caught inside the handler, or written in a nested function, does not warn. A call that may throw keeps `EK0403`, and an implicit exception stays a silent defect. The warning changes no program's meaning:

```vibe es
// compiler-gap: pending VIP-38
// fragment: inside an effect function
fetchUser(id) catch (e) => { throw new Wrapped(e) }                          // EK0511: dies with Wrapped
fetchUser(id) catch effect (e) => { throw new Wrapped(e) }                   // the fix: fails with Wrapped
fetchUser(id) catch (e) => { try { throw e } catch { return 0 } }            // no warning: caught inside
fetchUser(id) catch (e) => () => { throw e }                                 // no warning: a nested function
```

## `await`

`await` keeps exactly JavaScript's meaning and belongs to `async` functions and the module top level. `await`, `for await` and `await using` inside effect code are errors, and so is `await` on an Effect inside an `async` function ([Functions](001-functions.md#static-rules)). `await fiber` and `await deferred` keep TypeScript's native `await` behavior and get VIP-38 lint warnings (`EK4609` and `EK4610`). In the existing `async` context, suggest `await runPromise(Fiber.join(fiber))` or `await runPromise(Deferred.await(deferred))`, using the explicit Promise bridge from VIP-1 and VIP-5. The Effect-body forms `join fiber` and `try Deferred.await(deferred)` do not run in an ordinary `async` body; suggesting them there would introduce `EK1701` or `EK0501`. Reporting the warning does not run either object or change the original result.

```vibe es
// compiler-gap: pending VIP-5
async function asyncFiberValue(fiber: Fiber.Fiber<number>) {
  return await runPromise(Fiber.join(fiber))
}
async function asyncDeferredValue(deferred: Deferred.Deferred<number>) {
  return await runPromise(Deferred.await(deferred))
}
```

These existing bridges obtain the completion values. With a fiber completing with `7` and a Deferred completed with `8`, the observation below is `Success([7, 8])`. In this example, native `await` alone retains the unmodified Fiber and Deferred objects.

```ts effect
import { Effect, Fiber, Deferred } from "effect"

async function asyncFiberValue(fiber: Fiber.Fiber<number>) {
  return await Effect.runPromise(Fiber.join(fiber))
}
async function asyncDeferredValue(deferred: Deferred.Deferred<number>) {
  return await Effect.runPromise(Deferred.await(deferred))
}
const fiber = Effect.runFork(Effect.succeed(7))
const deferred = Effect.runSync(Deferred.make<number>())
Effect.runSync(Deferred.succeed(deferred, 8))
const nativeFiber = await fiber
const nativeDeferred = await deferred
const observed = await Effect.runPromiseExit(Effect.promise(async () => [
  await asyncFiberValue(fiber), await asyncDeferredValue(deferred)
]))
```

<a id="try-follows-await"></a>`try e` is allowed, forbidden and ordered exactly where `await e` is, and every rule that differs is listed here with its reason. The columns use their corresponding execution contexts; transparent expressions inherit that context:

| Position | `await` | `try` |
| --- | --- | --- |
| the body of the corresponding function (`async` for `await`, `effect` for `try`), and a `do`, `match` arm/guard or parentheses inside that context | allowed | allowed |
| a computed class key, an `extends` clause, a decorator expression such as `@(try d)` | allowed | allowed |
| a parameter default, a class field initializer, a `static` block | SyntaxError | error |
| a nested plain function | SyntaxError | error |
| the module top level | allowed | error: the top level is not effect code, and nothing runs an Effect implicitly (VIP-26). Write `await runPromise(e)` |

The other constructs follow the Promise they mirror: `effect { }` builds a cold Effect much as `(async () => { })()` constructs a Promise, `fork e` is starting a Promise without awaiting it, `e catch h` is `await e.catch(h)`, and a failure is a rejection. They differ where an Effect isn't a Promise:

| Promise | Effect | Why |
| --- | --- | --- |
| `await` accepts non-Promise operands, including `1` and a possibly `undefined` optional-call result | A statically non-Effect or possibly `undefined` operand is `EK0502` | VIP-5 runs an Effect; the [operand test](#operand-test) requires Effect assignability, independently of optional-call syntax |
| `await p.catch(h)` awaits the handled Promise's result | `try e catch h` is `EK0505` under the head rule; write `e catch h` | VIP-5's `catch` already runs its operand; explicit source parentheses retain the separate rule for catching an Effect returned by another run |
| A statement beginning `await { value: 1 }` awaits an object expression | A statement-start `try` followed by `{` begins JavaScript's `try` statement; a complete `try { } finally { }` in effect code is `EK0503` | The existing JavaScript statement grammar keeps priority over the unary expression |
| `for await (x of values)` may assign an existing binding, and `for await` accepts `var`, `using` and `await using` heads | `for try` with any head other than a `const` or `let` declaration is `EK2005`: `for try (x of stream)`; write `for try (const v of stream) { x = v }` | VIP-20 requires a `ForDeclaration` head, `LetOrConst ForBinding`; assignment remains available in the body |
| Even an already completed value resumes `await` on a later Promise job | `try` can complete without suspending; cooperative scheduling can still run other fibers | `yield*` follows Effect's scheduler, with no added Promise job or implicit `yieldNow` |
| A rejected `await` resumes the function with a throw, so `using`, iterator closing and `finally` run | A failed `try` never resumes the generator, so none of them run | [Abandonment](008-runtime.md#abandonment): `try e` is `yield* e` |
| A thrown error and a rejection are one channel, and `.catch` sees both | A failure and a defect are two channels, and `catch` sees failures only | Effect's typed error channel |
| A Promise starts when it is created and runs once | An Effect is cold, and each `try e` runs it again | An Effect is a value (VIP-1) |
| `await v` adopts a Promise or gives a non-Promise `v` | `try v` with `v: any` uses native delegation: a noniterable defects with `TypeError`; an unchecked iterable may complete normally | `try` is `yield* v`, with no dynamic Effect guard |
| An `async` `return p` [assimilates](https://262.ecma-international.org/16.0/#sec-promise-resolve-functions) a returned Promise or thenable | An `effect` `return e` keeps `e` as its success value, including an inner Effect left unrun; write `return try e` to run it | `Effect.gen` returns its value without flattening it (VIP-1/VIP-5) |
| Nothing cancels a Promise | Interruption ends a fiber: the generator is abandoned and Effect's finalizers run | Promises have no counterpart |
| A function's body starts at the call | A forked fiber starts later, and a child that never got a step is interrupted when its parent ends | Fibers are scheduled and owned |


The `await` analogy specifies source placement, precedence and evaluation order, not Promise-job scheduling. Use explicit `try yieldNow` to request a cooperative yield; it gives no global ordering guarantee for unrelated fibers. The short default-scheduler reference below observes different orders; synchronous work can also reach Effect's cooperative scheduling budget.

```vibe es
// compiler-gap: pending VIP-5, VIP-17
effect function effectOrder() {
  const events: string[] = []
  fork effect { events.push("child") }
  try succeed(1)
  events.push("after completed")
  try yieldNow
  events.push("after yield")
  return events
}
// Short reference: Success(["after completed", "child", "after yield"]).
```

```ts effect
import { Effect } from "effect"

function effectOrder() {
  return Effect.gen(function* () {
    const events: string[] = []
    yield* Effect.forkChild(Effect.sync(() => { events.push("child") }))
    yield* Effect.succeed(1)
    events.push("after completed")
    yield* Effect.yieldNow
    events.push("after yield")
    return events
  })
}
async function promiseOrder() {
  const events: string[] = []
  void Promise.resolve().then(() => { events.push("child") })
  await Promise.resolve(1)
  events.push("after completed")
  await Promise.resolve()
  events.push("after yield")
  return events
}
// Short default-scheduler reference: effectOrder succeeds with
// ["after completed", "child", "after yield"]; promiseOrder resolves to
// ["child", "after completed", "after yield"]. This is no global scheduling guarantee.
```

Within the Effect, a successful `try` gives the immediate success value unchanged: it neither recursively runs an inner Effect nor assimilates a Promise or thenable stored in that value. An `effect` function's return and a plain `catch` handler's result use the same data rule. Explicit Promise runners retain native Promise resolution.

The imported `returnEffectInGen` lint reports returned Effects in generators under its [imported lint code](900-appendices.md#imported-lint-codes); its configured severity does not change the returned value.

```vibe es
// compiler-gap: pending VIP-1
effect function boxedReturn(inner: Effect.Effect<number>) { return inner }
effect function unboxedReturn(inner: Effect.Effect<number>) { return try inner }
```

```ts effect
import { Effect } from "effect"
function boxedReturn(inner: Effect.Effect<number>) {
  return Effect.gen(function* () { return inner })
}
function unboxedReturn(inner: Effect.Effect<number>) {
  return Effect.gen(function* () { return yield* inner })
}
```

For `inner = succeed(7)`, running `boxedReturn(inner)` gives `Success(inner)`, with the inner Effect unrun; running `unboxedReturn(inner)` gives `Success(7)`.

## `effect` blocks

### Syntax

[EffectBlock](900-appendices.md#effectblock), an expression.

### Meaning

`effect { … }` is an expression. It builds an Effect from the block without running it. Each time the Effect runs, the block runs again. It is `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`. Inside it, `try` runs Effects. Its `this`, `super` and `new.target` are the enclosing function's, passed in as for an `effect` arrow ([Functions](001-functions.md#meaning)).

```vibe es
// compiler-gap: pending VIP-2
effect function demo() {
  const p = effect { try Console.log("hi"); return 1 }   // an Effect, not yet run
  try p                                              // prints "hi", gives 1
  try p                                              // prints "hi" again
  return try retry(effect { try save(try fetchUser("1")) }, policy)
}
const UsersLive = Layer.effect(Users, effect { return makeUsers() })
```

```ts effect
// fragment
function demo() {
  return Effect.gen(function* () {
    const p = Effect.gen(function* () { yield* Console.log("hi"); return 1 })
    yield* p
    yield* p
    return yield* Effect.retry(Effect.gen(function* () { yield* save(yield* fetchUser("1")) }), policy)
  })
}
const UsersLive = Layer.effect(Users, Effect.gen(function* () { return makeUsers() }))
```

An `effect { … }` statement builds an Effect and discards it, as a call statement `f()` does; the Effect language service's imported `floatingEffect` rule, run by VIP-38, reports it under its `EK38xx` code ([Effect's type-aware lint](007-tooling.md#effects-type-aware-lint); decided detail 77). Write `try effect { … }` to run it.

No other syntax builds an Effect. A function literal never becomes an Effect because the parameter it's passed to expects one.

**Jumps.** A `break` or `continue` inside an `effect { … }` block whose target lies outside the block is `EK0202` (decided detail 247): the block builds its own Effect, which runs later, so a loop or `switch` outside it is not in reach. A jump to a target inside the block, and a `return` from the block, remain allowed.

## `do` expressions

`do { … }` is exactly TC39's do expression, pinned to a dated snapshot of the proposal, everywhere, with no exceptions. It runs now and gives its source block's normal completion value. Its type is the union of the values reaching normal completion under ECMAScript's `UpdateEmpty` flow, including consumed local jumps. Only a final empty normal completion becomes `undefined`; an empty completion that inherits an earlier value keeps that value. Paths leaving outward by `return`, `break`, `continue` or `throw` supply no normal result, and a do expression with no normal path has type `never`. Their outward returns and typed failures are still checked at the enclosing activation.

A do expression keeps ordinary expression fresh literal treatment: `const exact = do { 1 }` has type `1`, while `let ordinary = do { 1 }` widens to `number`; a written annotation such as `const checked: number = do { 1 }` follows TypeScript as usual. `const chosen = do { if (c) 1; else "a" }` has type `1 | "a"`; `do { }` gives `undefined`, while `const inherited = do { 7; {} }` keeps `7`. Contextual typing reaches only the expression alternatives contributing to the normal result; discarded intermediate expressions and outward returns retain their own source contexts. Declaration output and overload selection use this source type, independent of generated function or temporary types.

It is not a function: as TC39 specifies, `await` inside `do` belongs to the enclosing function, and so does `try`, so a `try` in a `do` or `match` suspends the enclosing generator.

```ts
// fragment: static counterparts; choose has no runtime implementation here
import type { Effect } from "effect"

const literalSource = 1
const exact: 1 = literalSource
let ordinaryLet = 1
// @ts-expect-error: an ordinary let initializer widens
const letIsNotExact: 1 = ordinaryLet
const annotatedSource: number = 1
// @ts-expect-error: the written type governs
const annotationIsNotExact: 1 = annotatedSource
const returnedTemporary = (() => 1)()
// @ts-expect-error: function-return widening is different
const returnIsNotExact: 1 = returnedTemporary
const onlyAbrupt = () => { throw 7 }
const noNormalValue: never = onlyAbrupt()
declare const condition: boolean
const alternatives = condition ? 1 : "a"
const alternativeTypes: 1 | "a" = alternatives
declare function choose(value: 1): Effect.Effect<number>
declare function choose(value: number): Promise<number>
const effectOverload: Effect.Effect<number> = choose(literalSource)
const promiseOverload: Promise<number> = choose(ordinaryLet)
const contextual: { value: 1 } = condition ? { value: 1 } : { value: 1 }
```

```vibe es
// compiler-gap: pending VIP-1, VIP-2
effect function leaveDo() {
  const neverValue = do { return 7 }
  return neverValue // unreachable; neverValue has type never
} // Success(7), with no normal value from the do expression
```

```ts effect
import { Effect } from "effect"

function leaveDo() { return Effect.gen(function* () { return 7 }) }
```

**Static predicates.** For `EndsInIterationOrBareIfOrDeclaration`, `CaseBlock : { }` returns `false` for either value of `isLast` and any `labelSet`, including when the switch is nonfinal. Every [ForTry](900-appendices.md#fortry) and [ForConcurrent](900-appendices.md#forconcurrent) production, with or without a concurrency limit, uses the native iteration rule: `isLast` equal to `true` gives `true`; otherwise a body passing `IsBreak` with that label set gives `true`; otherwise apply the predicate to the body with the same `labelSet` and `isLast`. The loop statement itself has `IsEmpty` and `IsBreak` equal to `false`. Thus nonfinal loop bodies are still visited, and a final added loop is rejected like a final native loop. Ordinary switch completion and loop jump restrictions stay unchanged. The [snapshot receipt](../vips/tc39-do-expressions/README.md#static-predicate-reconciliations) and [Appendix A](900-appendices.md#notes-on-the-productions) record these cases.

For `Statement : VariableStatement`, the pinned predicate returns `isLast`. A final `var` declaration is therefore `EK0201`, including when only empty statements or empty blocks follow it. A nonfinal `var` is still the legacy-JavaScript compile error ([Legacy JavaScript](001-functions.md#direct-eval)): `var` is banned in all `.vibe` code (VIP-4, amended). The separate parameter-list restriction remains `EK0203`.

```vibe es
// compiler-gap: pending VIP-2, VIP-19, VIP-20
const value = do { switch (0) {} 7 } // 7
const empty = do { switch (0) {} }   // undefined
effect function first(rows: Stream.Stream<number>) {
  return do { for try (const row of rows) {} 7 } // Success(7)
}
effect function second(rows: number[]) {
  return do { for concurrent (const row of rows) {} 7 } // Success(7)
}
// Ending either do with its for try or for concurrent instead of 7 is an early error.
```

```ts effect
// Do static-predicate controls
import { Effect, Stream } from "effect"
const value = Effect.gen(function* () { switch (0) {}; return 7 })
const empty = Effect.gen(function* () { switch (0) {}; return undefined })
const first = (rows: Stream.Stream<number>) => Effect.gen(function* () {
  yield* Stream.runForEachWhile(rows, () => Effect.succeed(true))
  return 7
})
const second = (rows: number[]) => Effect.gen(function* () {
  yield* Effect.forEach(rows, () => Effect.succeed(undefined), { concurrency: "unbounded", discard: true })
  return 7
})
console.log(JSON.stringify([
  Effect.runSync(value), Effect.runSync(empty) === undefined,
  Effect.runSync(first(Stream.make(1))), Effect.runSync(second([1]))
]))
```

The counterparts give `Success(7)`, `Success(undefined)`, `Success(7)` and `Success(7)` respectively.

In plain code, `try`/`finally` inside `do` follows ECMA-262's `TryStatement` evaluation: a normal finalizer preserves the `try` or `catch` completion, and an abrupt finalizer replaces it before `UpdateEmpty` supplies `undefined` if needed. Thus `do { label: { try { 1 } finally { 2; break label } } }` gives `2`, the same block without `2;` gives `undefined`, and `do { try { 1 } finally { 2 } }` gives `1`. Nested finalizers apply the same rule at each level.

<a id="evaluation-order"></a>**Evaluation order.** Captures also preserve the [source naming context](001-functions.md#source-names): a private temporary cannot give an anonymous value a name or erase a requested one. A `do` or `match` is an expression, and this is the one rule for it inside a larger expression: it runs where JavaScript evaluates the expression that holds it, never earlier or more often. Everything to its left runs first, in source order, the callee and a method's receiver included, so `o.m(try a(), match (x) { … })` reads `o.m`, runs `a()`, runs the `match`, and calls the method with `this` as `o`. An operand to its left is finished, not only read: a spread is iterated, an object spread copies its properties, a computed object key is converted to a property key, an untagged template converts each earlier substitution to a string, a tag is read with its receiver, and a constructor is read before its arguments, so in `[...xs, do { … }]` the iterator of `xs` finishes before the block runs. Element-assignment keys keep the assignment operator's own conversion timing. In a conditional position (one side of `&&`, `||`, `??`, `?:`, `&&=`, `||=`, `??=`, after `?.`, a `case` test, a loop condition or update) it runs only when JavaScript evaluates that position. How the compiler keeps this is its choice. Destructuring and parameter defaults follow [their own rule](#destructuring-and-parameter-defaults). As the snapshot's explainer says, an unlabeled `break` or `continue` in a `do` in a loop head is an early error. Calls retain ECMA-262's `CallExpression` evaluation, `EvaluateCall` and `ArgumentListEvaluation` behavior, including the receiver, callee lookup, abrupt completions and native non-callable errors; generated invocation machinery must add no observable helper lookup. Reading `this` is part of that order: in a derived constructor, an earlier `this` read still precedes a later `do` that calls `super()`. Lowering must preserve the source diagnostic and the native uninitialized-receiver error, including inside lexical arrows.

<a id="jumps-from-expressions"></a>**Jumps from expressions.** `do` gives an expression completions no other expression has: `return`, `break` and `continue`. Around it, each stays what it is. ECMA-262 and the pinned drafts say "abrupt" in steps written when an expression could only throw, and VibeLang reads those steps as "throw": [`FinishMatch`](004-match.md#leaving-a-match), and the parameter steps of [`async` functions and generators](#parameter-defaults). The [snapshot's README](../vips/tc39-do-expressions/README.md) lists them.

```vibe es
// compiler-gap: pending VIP-2
const x = do { const a = 1; a + 1 }    // 2
effect function total(o: Calc) {
  return o.add(try a(), match (n()) { when 1: 10; default: 0; })
}
```

```ts effect
// fragment
function total(o: Calc) {
  return Effect.gen(function* () {
    return o.add(yield* a(), n() === 1 ? 10 : 0)
  })
}
```

The pinned snapshot is the [vendored copy](../vips/tc39-do-expressions/README.md) of `tc39/proposal-do-expressions` at commit `3ef6d463b8163cbf222846b40d17178cca36e9e1`, the head on 2026-10-28 (UTC), as pattern matching is pinned.

### Destructuring and parameter defaults

A destructuring or parameter default runs only when it applies. In effect code a destructuring pattern behaves exactly as the same pattern in JavaScript with the pinned `do` proposal: ECMA-262's BindingInitialization, IteratorBindingInitialization and DestructuringAssignmentEvaluation, with GetIterator and IteratorClose for array patterns. Evaluation order, getters, the iterator protocol, temporal dead zones, closing, and the `name` and `message` of every protocol error are that algorithm's on the same host, and the canonical `Exit` compares them ([Runtime guarantees](008-runtime.md)). How the compiler achieves it (native destructuring with an inline `yield*`, a runtime helper, or any other lowering) is its choice; the examples below, the VIP-31 differential suite and the fuzz suite check it.

Three things can happen in a default:

- **A jump.** A `return`, `break` or `continue` in a default's `do` acts on the enclosing function or loop, as TC39 specifies. It leaves an array pattern as the same jump leaves a `for…of` body: ECMA-262 gives IteratorClose the jump's completion, so the iterator closes unless it is done, and an error from closing replaces the jump.
- **A suspension.** A `try` in a destructuring default in effect code runs in the enclosing effect function, as `await` in one suspends the enclosing `async` function; in a producer, a `yield` there emits from it. A parameter default can't suspend ([below](#parameter-defaults)).
- **A failure.** A `try` that fails, dies or is interrupted, or a `throw`, [abandons](008-runtime.md#abandonment) the generator, so nothing closes. A JavaScript throw unwinds the generator under the native destructuring algorithm: `IteratorClose` runs only when that algorithm requires it, a pending throw wins over an error from closing, and the result becomes a defect.

<a id="parameter-defaults"></a>**Parameter defaults.** A parameter default can't run an Effect, as `async function g(x = await p)` is a SyntaxError. Directly evaluated formal-parameter initialization of an Effect function, arrow, method or producer rejects `await` with `EK0102` and `yield` with `EK2104`, as native async and generator parameters cannot suspend. This includes destructuring defaults and computed binding keys, and stops at nested source callable or context boundaries; it does not extend effect code into a parameter list. A `try` there remains `EK0501`.

```vibe
// compiler-gap: pending VIP-1, VIP-21
effect function badParameterAwait(value = await Promise.resolve(7)) { return 0 } // EK0102
effect function* badParameterYield(value = yield 7) { } // EK2104
effect function badParameterTry(value = try succeed(7)) { return 0 } // EK0501
effect function parameterBoundaryWitness(
  make = function* () { yield 7 },
  later = async () => await Promise.resolve(8)
) { return 0 }
```

```ts effect
import { Effect } from "effect"

function parameterBoundaryWitness(
  make = function* () { yield 7 },
  later = async () => await Promise.resolve(8)
) {
  return Effect.gen(function* () { return 0 })
}
```

`parameterBoundaryWitness()` succeeds with `0`. Its parameter defaults create functions; the nested async and generator bodies have their own native execution contexts.

Everything else JavaScript with the `do` proposal allows there stays, including a `return` in a default's `do`. The pinned proposal allows it and stops there, so it acts as `return` at the top of the body, whatever the kind of function:

| Function | `x = do { return 7 }` |
| --- | --- |
| plain function, arrow, method | the call gives `7` |
| `async` | the Promise fulfills with `7` |
| `effect` | the call gives an Effect that succeeds with `7` |
| `effect function*` | a bare `return` gives an empty `Stream`; `return 7` is `EK2128` |
| `function*`, `async function*` | the default runs at the call and the body never starts: the call gives a generator that finishes with `7`, so its first `next()` gives `{ done: true, value: 7 }` |

Parameters are bound at the call, left to right, so earlier defaults have run, later ones don't run, and `length` is unchanged. A default sees the parameter scope, not the body's bindings: in `function g(a = do { return 0 }, b = () => y) { const y = "body"; return b() }`, `b` reads the outer `y`. The `return` adds the type of `7` to the function's result, as any `return` does. A throw in a default follows the kind of function: a plain function throws, an `async` function rejects, and an `effect` function gives an Effect that dies ([Code outside the generator](003-failures.md#code-outside-the-generator)).

```vibe es
// compiler-gap: pending VIP-2
effect function f() { const { x = do { return 9 } } = {}; return 0 }        // Success(9)
effect function g() { const { x = do { try succeed(7) } } = {}; return x }  // Success(7)
effect function e(x = do { return null }) { return 1 }                      // e() gives Success(null)
effect function k(xs: Iterable<number | undefined>, bad: { value: number }) {
  const [x = do { try succeed(7); bad.value }] = xs
  return x
}
effect function h(xs: Iterable<number | undefined>, b: { value: number }) {
  const [x = do { const v = b.value; try succeed(7); v }] = xs
  return x
}
effect function j(xs: Iterable<number | undefined>) {
  const [x = do { return 9 }] = xs
  return 0
}
effect function i(xs: Iterable<number | undefined>) {
  const [x = do { try fail("f"); 1 }] = xs
  return 0
}
```

Each row runs the function with the iterable `xs` described; unless the row says otherwise, `xs` yields `undefined` first and its `return` returns an object. The Exit is the spec's expected result and equals the Effect TypeScript program with the same pattern written natively. `j` has no native form, because `return` is not an expression, so its rows equal the same `return` in a `for…of` body.

| Function | `xs` and `b` | Exit |
| --- | --- | --- |
| `k` | `return` throws `"close"`; the getter `bad.value` throws `"body"` | `Die("body")`: the pending throw wins |
| `k` | `return` returns `1`; `bad.value` returns | `Die(TypeError)`: the close result is not an object |
| `h` | `b.value` is `7`; `return` calls a closure that reads `x` | `Success(7)`; the closure reads `7` |
| `h` | `b.value` is `7`; before the pattern, `globalThis.Symbol` is replaced by a `Proxy` of `Symbol` whose `iterator` is `undefined` | `Success(7)`: GetIterator uses `%Symbol.iterator%` |
| `h` | `xs[Symbol.iterator]()` returns `1` or `null` | `Die(TypeError)` with native GetIterator's message |
| `h` | as above, returning `1`, with `Number.prototype.next` defined by a foreign fixture to return `{ done: true }` | `Die(TypeError)`, not `Success(7)`: the object check comes before `next` is read |
| `h` | the iterator's `next` is `1` | `Die(TypeError)` with native IteratorStep's message |
| `h` | the iterator's `return` is `1`; `b.value` is `7` | `Die(TypeError)` with native IteratorClose's message |
| `h` | `xs` is `5` | `Die(TypeError)` with the message native `const [x] = xs` gives, naming `xs` as the host does |
| `j` | `return` returns an object | `Success(9)`; `return` is called once |
| `j` | `return` throws `"close"` | `Die("close")`: the error replaces the jump, as in `for…of` |
| `j` | `return` returns `1` | `Die(TypeError)` with native IteratorClose's message |
| `j` | `xs` is empty | `Success(9)`; `return` is not called |
| `i` | `return` returns an object | `Failure("f")`; `return` is not called: the generator is abandoned |

**Diagnostics.** A `do` block whose last statement violates TC39's `EndsInIterationOrBareIfOrDeclaration` early error, ending in a declaration, a loop or an `if` without an `else`, is `EK0201` (decided detail 247). `var` in a `do` expression in a parameter list is `EK0203`. A `break` or `continue` in a loop head's `do` that leaves it unlabeled or targets that loop is `EK0205`. Every label in a contiguous chain around that loop names the same loop, so `outer: inner: while (do { continue outer; true }) {}` is also `EK0205`. A jump to a label on a different enclosing loop remains exempt from this early error. `EK0204` names a current compiler limitation, not a TC39 early error: an outward completion (`return`, `var`, a jump, `await` or `yield`) that would leave a `do` the compiler still compiles to a function in that position.

## `fork` and `join`

### Syntax

[ForkExpression](900-appendices.md#forkexpression) and [JoinExpression](900-appendices.md#joinexpression). `fork` and `join` are reserved wherever [Appendix A](900-appendices.md#the-effect-parameter) parses `[+Effect]`, including parameter lists and static blocks that inherit that reservation. They cannot name a variable, parameter or label there; in an expression they begin a fiber operation. As property names they stay ordinary names. Class field and enum member initializers reset to `[~Effect]`, so ordinary helper calls to `fork` or `join` remain calls. A static block in a plain context also keeps those identifiers under VIP-17’s outside-code promise; a static block inheriting Effect reservation receives `EK1701` for the recognized operation because it cannot execute Effects. So an imported function named `join` can't be called in effect code; rename it at the import: `import { join as joinText } from "./strings.vibe"`. The owner forms `fork.in(…)`, `fork.scoped` and `fork.detached` are productions in JavaScript's `keyword.name` shape, like `new.target` and `import.meta`, not property reads. Their tokens may be separated as `new . target`'s may ([TryAll](900-appendices.md#tryall)). As with `await`, the operand may start on the next line. A [ForkOperand](900-appendices.md#forkoperand) never contains a top-level comma, so `const f = fork a(), g = fork b()` declares two fibers.

```vibe es
// compiler-gap: pending VIP-17
const sep = (xs: string[]) => xs.join("/")      // outside effect code: a method named join
effect function names(parts: Fiber.Fiber<string[]>) {
  const xs = join(parts)             // joins the fiber parts
  const s = xs.join(",")             // the method join
  const t = sep(xs)
  return [s, t]
}
effect function bad(join: number) { }  // EK1702: join is reserved here, as await is in async code
```

The inherited reservation covers the whole head, including defaults and destructuring; it does not turn an ordinary `async` arrow into an Effect arrow. Its body can declare `fork` or `join` and uses native `await`. Outside an enclosing Effect reservation those two names also remain ordinary parameters, as VIP-17 requires.

```vibe es
// compiler-gap: pending VIP-17
effect function badArrowHead() {
  const f = async (join: number) => 1 // EK1702
  return 0
}
const ordinary = async (join: number) => join // ordinary context: allowed
effect function arrowHeadNames() {
  function plain(join: number) { return join } // a plain function resets the head
  const later = async (value: number) => { const join = value; return join }
  return plain(7)
}
```

The admitted `arrowHeadNames()` has this counterpart and `Success(7)`; the rejected head has no runtime Exit.

```ts effect
import { Effect } from "effect"

const ordinary = async (join: number) => join
function arrowHeadNames() {
  return Effect.gen(function* () {
    function plain(join: number) { return join }
    const later = async (value: number) => { const join = value; return join }
    return plain(7)
  })
}
```

A line break after `fork` or `join` changes nothing, as after `await`: `join` then `f` on the next line joins `f`. After `join`, `/` begins a regular expression and `- 1` is a negation, as after `await` (VIP-17, amended).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `fork` or `join` outside effect code | `EK1701` |
| a `fork` or `join` naming a variable, parameter or label under `[+Effect]`, including parameter lists and static blocks inheriting Effect reservation, including a plain or `async` arrow head inheriting that reservation, even in an Effect callable's parameters: both `const k = (join) => 1` and `const k = async (join) => 1` are errors in effect code, as their `await` counterparts are in an `async` function; the arrow body has its own context, and a nested `function h(join) { }` resets its head too. A reserved `fork` or `join` as a shorthand property, `{ join }`, is the same error, as `{ await }` is in an `async` function; a property key or access, `{ join: f }` or `o.join`, stays a name | `EK1702` |
| a `fork`, `fork.in(s)`, `fork.scoped` or `fork.detached` operand that fails the [operand test](#operand-test): `fork n` with `n: number`; write `fork effect { … }` or call the function (decided detail 88) | `EK1703` |
| a `join` operand not assignable to `Fiber.Fiber<any, any>`: `join p` with `p: Promise<number>`; `join` the value `fork` gave (decided detail 88) | `EK1704` |
| a `fork.` owner other than `in(s)`, `scoped` or `detached`: `fork.other e`; write one of the three, or `fork e` | `EK1705` |
| a `fork.in(s)` scope operand not assignable to `Scope.Scope`: `fork.in(5) e`; pass a `Scope`, as `Effect.forkIn` requires | `EK1706` |

### Meaning

`fork` starts a fiber and gives its `Fiber`. The form names the owner, which interrupts the fiber when it ends. A child is not awaited at the end of a scope, as Swift's and Kotlin's structured children are; it keeps Effect's meaning. A `fork` child whose parent ends first exits with an interruption; a `fork.detached` child runs to its own end.

<a id="fork-operand"></a>`fork e` evaluates `e` now, on the caller, as `const p = work(await id())` calls `id` and `work` now, and runs only the Effect that `e` gives on the new fiber. So a failure of `id` in `fork worker(try id())` is the caller's, as a rejection of `await id()` is. Handling a failure on the child keeps that split, as `.catch(h)` does on a Promise:

```vibe es
// compiler-gap: pending VIP-17
effect function start(id: Effect.Effect<number, string>) {
  const child = fork Effect.catch(worker(try id), (e) => Effect.succeed(recover(e)))
  return "started"
}
```

```ts effect
import { Effect } from "effect"

const worker = (n: number) => Effect.fail(`worker ${n}`)
const recover = (e: string) => `recovered ${e}`
function start(id: Effect.Effect<number, string>) {
  return Effect.gen(function* () {
    const child = yield* Effect.forkChild(Effect.catch(worker(yield* id), (e) => Effect.succeed(recover(e))))
    return "started"
  })
}
if (Effect.runSync(start(Effect.succeed(1))) !== "started") throw new Error("the operand was lost")
const failed = Effect.runSyncExit(start(Effect.fail("no id")))
if (failed._tag !== "Failure") throw new Error("the operand left the caller")
```

| `id` | Exit of `start` | Runs on the child |
| --- | --- | --- |
| succeeds | `Success("started")` | `worker`'s Effect and the handler |
| fails with `"no id"` | `Failure("no id")`, the caller's | nothing: no fiber starts |

| VibeLang | Effect TypeScript | Owner |
| --- | --- | --- |
| `fork worker()` | `yield* Effect.forkChild(worker())` | the current fiber |
| `fork.in(scope) worker()` | `const $s = scope; yield* Effect.forkIn(worker(), $s)` | the given scope; `scope` is evaluated before `worker()`, in source order (decided detail 84) |
| `fork.scoped worker()` | `yield* Effect.forkScoped(worker())` | the current `Scope`; adds `Scope` to R |
| `fork.detached worker()` | `yield* Effect.forkDetach(worker())` | none |
| `join f` | `yield* Fiber.join(f)` | |

```vibe es
// compiler-gap: pending VIP-17
effect function both() {
  const f = fork worker()
  const mine = try other()
  return [mine, join f]
}
effect function owners(scope: Scope.Scope) {
  const a = fork.in(scope) worker()
  const b = fork.scoped worker()
  const c = fork.detached worker()
  return [a, b, c]
}
```

```ts effect
// fragment
function both() {
  return Effect.gen(function* () {
    const f = yield* Effect.forkChild(worker())
    const mine = yield* other()
    return [mine, yield* Fiber.join(f)]
  })
}
function owners(scope: Scope.Scope) {
  return Effect.gen(function* () {
    const $s = scope
    const a = yield* Effect.forkIn(worker(), $s)
    const b = yield* Effect.forkScoped(worker())
    const c = yield* Effect.forkDetach(worker())
    return [a, b, c]
  })
}
```

`fork` and `join` have `await`'s precedence: [ForkOperand](900-appendices.md#forkoperand) is a `UnaryExpression`, as for `try` (VIP-17, amended: "exactly as `await`"). So `fork a() |> f(%)` forks `a()` and pipes the `Fiber`, and `join f + 1` adds 1 to the joined value.

## Running Effects concurrently

### Syntax

[TryAll](900-appendices.md#tryall). `try` is a reserved word, so `try.` can't start anything else. Its tokens may be separated as `new . target`'s may. The operand has `try`'s precedence, so `try.all [a(), b()]` and `try.all ids.map(load)` each have one reading. The operand is any expression whose type is an array, readonly array or tuple of Effects, not only an array literal (VIP-18, amended).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `try.all`, `try.race`, `try.any` or `try.allSettled` outside effect code | `EK0501` |
| an operand that is not an array of Effects, for `try.all`, `try.race`, `try.any` or `try.allSettled`, `try.all [1, a()]`; an object of Effects uses the `all` global instead | `EK1801` |
| a retired `await.all`, `await.race`, `await.any` or `await.allSettled`; `vibelang --fix` writes the `try` operation | `EK1802` |
| a name after `try.` other than `all`, `race`, `any` or `allSettled`: `try.map x`; run the Effect with `try` and apply the function to its result, `f(try x)`, or use one of the four | `EK1803` |

### Meaning

These are TC39's await operations, run with `try` instead of `await`. The names keep JavaScript's choice of result: `try.all` starts everything at once, like `Promise.all`, even though `Effect.all` defaults to one at a time. Unlike Promises, the Effects that lose are interrupted, and an empty operand to `try.race` or `try.any` never completes, where `Promise.any([])` rejects.

| VibeLang | Effect TypeScript | Gives |
| --- | --- | --- |
| `try.all [a(), b()]` | `yield* Effect.all([a(), b()], { concurrency: "unbounded" })` | every success, in operand order; the first failure fails the whole and interrupts the rest. Operands start in order, and one that fails before it suspends stops later ones from starting, as `Effect.all` does: `try.all [fail(e), log("hi")]` doesn't log |
| `try.race [a(), b()]` | `yield* Effect.raceAllFirst([a(), b()])` | the first to finish: success, failure or defect; the losers are interrupted |
| `try.any [a(), b()]` | `yield* Effect.raceAll([a(), b()])` | the first to succeed; the losers are interrupted. A defect does not end it; it waits for the others, as for a failure. If none succeeds and none dies, the whole fails with all their failures in its `Cause`, in the order they occurred, and `catch` receives the first to occur, not the first operand's. If any operand dies, the whole dies: the `Cause` holds every failure and defect, in order, all as defects, and `catch` sees nothing |
| `try.allSettled [a(), b()]` | `yield* Effect.all([Effect.exit(a()), Effect.exit(b())], { concurrency: "unbounded" })`; any other operand `xs`: `const $xs = xs; yield* Effect.all($xs.map(Effect.exit), { concurrency: "unbounded" })` | every element's `Exit` (success, failure, defect or interruption), a tuple for an array literal, as `Promise.allSettled` keeps one; the whole never fails, as `Promise.allSettled` never rejects; it can still be interrupted from outside. A non-literal tuple whose elements differ in type is TypeScript's error there, as in Effect TypeScript; write the elements out: `try.allSettled [t[0], t[1]]`. A literal with a spread element is built once, natively, in element order, as `[a(), ...xs, b()]` is: each spread uses its value's own iterator, so any iterable works and an array's own `Symbol.iterator` decides its elements. The counterpart then wraps that one array by index, `const $source = [a(), ...xs, b()]; yield* Effect.all($source.map(Effect.exit), { concurrency: "unbounded" })`, and iterates no array the compiler creates, so a changed `Array.prototype[Symbol.iterator]` sees exactly the calls `[a(), ...xs, b()]` makes (decided detail 252); `try.allSettled [...new Set([a()])]` gives `[Exit]` for `a()`. TypeScript types the spread part as an array, not a tuple; the `.map` describes evaluation and widens no literal's type |

```vibe es
// compiler-gap: pending VIP-18
effect function page(id: string) {
  const [u, o] = try.all [fetchUser(id), fetchOrders(id)]
  const both = try all({ u: fetchUser(id), o: fetchOrders(id) }, { concurrency: "unbounded" })   // an object: the all global
  const first = try.race [fetchUser(id), fetchUser("cache")]
  const ok = try.any [fetchUser(id), fetchUser("cache")]
  const exits = try.allSettled [fetchUser(id), fetchOrders(id)]   // [Exit<User, NotFound>, Exit<Order[], DbError>]
  return [u, o, both, first, ok, exits]
}
```

```ts effect
// fragment
function page(id: string) {
  return Effect.gen(function* () {
    const [u, o] = yield* Effect.all([fetchUser(id), fetchOrders(id)], { concurrency: "unbounded" })
    const both = yield* Effect.all({ u: fetchUser(id), o: fetchOrders(id) }, { concurrency: "unbounded" })
    const first = yield* Effect.raceAllFirst([fetchUser(id), fetchUser("cache")])
    const ok = yield* Effect.raceAll([fetchUser(id), fetchUser("cache")])
    const exits = yield* Effect.all([Effect.exit(fetchUser(id)), Effect.exit(fetchOrders(id))], { concurrency: "unbounded" })
    return [u, o, both, first, ok, exits]
  })
}
```

## `for concurrent`

### Syntax

[ForConcurrent](900-appendices.md#forconcurrent). JavaScript's `for` can only be followed by `(` or `await`, so `for concurrent` has one reading, and Appendix A says when the first parenthesized group is the limit: `for concurrent (const x of xs) (try f(x));` has no limit.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `for concurrent` outside effect code | `EK1902` |
| `break` that would leave head binding initialization or the body: `for concurrent (const x of xs) { break }` | `EK1903` |
| `return` targeting the enclosing function in head binding initialization or the body: `for concurrent (const x of xs) { return x }` | `EK1904` |
| a labeled `continue` in head binding initialization or the body naming a statement that encloses the `for concurrent` | `EK1905` |
| an operand that is not an `Iterable`, `for concurrent (const x of 5) { }`; a Stream uses `for try` | `EK1901` |
| a head other than a `const` or `let` declaration: `var`, `using`, `await using` or an assignment head, `for concurrent (x of xs)` | `EK1906` |
| a limit not assignable to Effect's `Types.Concurrency`, `number \| "unbounded"`: `for concurrent("fast") (const x of xs) { }` | `EK1907` |

`continue`, and a labeled `continue` naming the `for concurrent` itself, end that one item: each is `return` from the item's generator, as the example shows. The others are errors because the body runs in `Effect.forEach`'s callback, not in the enclosing loop or function (VIP-19). A loop or `switch` nested in the body keeps its own `break` and `continue`.

### Meaning

Items run concurrently by default. With a positive integer `n`, `for concurrent(n)` runs at most `n` items at once; under Effect `4.1.0`, numeric limits below `1` run every item sequentially as `1` does. Other numbers retain Effect's native behavior. `n` is any Effect `Concurrency`, which in Effect 4.1.0 is a number or `"unbounded"`, passed unchanged to `concurrency`, without range checks or rounding (VIP-19, amended). Evaluate the limit once before entering the operand's head environment. Whether an item gets its own fiber is `Effect.forEach`'s choice. Effect 4.1.0 resolves a numeric limit `n` to `Math.max(1, n)` and takes its sequential branch exactly when that is `1`: every limit at or below `1` runs the items in order on the enclosing fiber. Every other limit, `NaN` and `"unbounded"` included, takes its parallel branch, which forks one fiber per item and starts another item only while fewer are running than the resolved limit: at most `ceil(n)` at once, and one at a time for `NaN`. So a `fork` child in the body is owned by the item's fiber, and interrupted when the item ends, in the parallel branch, and by the enclosing fiber under `for concurrent(1)`. All items join before the loop ends, and one failure interrupts the rest. Results are discarded; `try.all ids.map(…)` keeps them.

```vibe es
// compiler-gap: pending VIP-19
effect function numericLimit(limit: number | "unbounded") {
  let active = 0
  let maximum = 0
  const seen: number[] = []
  for concurrent(limit) (const id of [1, 2, 3]) {
    active++
    maximum = Math.max(maximum, active)
    try sleep("1 millis")
    seen.push(id)
    active--
  }
  return { seen, maximum }
}
// At 0, -1, 0.5 or 1: Success({ seen: [1, 2, 3], maximum: 1 }).
```

```ts effect
import { Effect, type Types } from "effect"

function numericLimit(limit: Types.Concurrency) {
  return Effect.gen(function* () {
    let active = 0
    let maximum = 0
    const seen: number[] = []
    yield* Effect.forEach([1, 2, 3], id => Effect.gen(function* () {
      active++
      maximum = Math.max(maximum, active)
      yield* Effect.sleep("1 millis")
      seen.push(id)
      active--
    }), { concurrency: limit, discard: true })
    return { seen, maximum }
  })
}
// On Effect4.1.0, 0, -1, 0.5 and 1 each succeed after visiting all items with maximum 1.
// 2 yields maximum 2; "unbounded" yields maximum 3 for this three-item fixture.
```


Pulling and iterator closing are also those of pinned `Effect.forEach`, not native `for…of`. At effective concurrency `1`, it pulls incrementally and does not call the iterator's `return()` merely because an item Effect fails. In the parallel branch, which every limit not resolving to `1` takes, `NaN` included, `Array.fromIterable` materializes a non-array iterable before any item Effect starts; an existing array is reused by reference, with later indexed reads and without invoking its custom iterator. A limit bounds running items, not pulling. An endless non-array iterable cannot finish that initial parallel materialization, so a would-be item failure cannot stop it. The omitted limit is `"unbounded"`; numeric limits retain Effect's own behavior without a new validation or normalization rule. No additional `IteratorClose`, streaming prefetch or snapshot copy is introduced. Native iteration errors retain their defect behavior. See the [finite lifecycle witness](008-runtime.md#iterable-lifecycle).

```vibe es
// compiler-gap: pending VIP-19
effect function syncAll(ids: string[]) {
  for concurrent (const id of ids) { if (id === "") continue; try syncOne(id) }
  for concurrent(limit()) (const id of ids) { if (id === "") continue; try syncOne(id) }   // limit() first
  for concurrent("unbounded") (const id of ids) { try syncOne(id) }
}
effect function run(ids: string[]) {
  for concurrent(1) (const id of ids) { fork sync(() => id) }   // each child is owned by run's fiber
  for concurrent(2) (const id of ids) { fork sync(() => id) }   // each child is interrupted when its item ends
  for concurrent(NaN) (const id of ids) { fork sync(() => id) } // one item at a time, each on its own fiber, as at 2
}
```

```ts effect
// fragment
function syncAll(ids: string[]) {
  return Effect.gen(function* () {
    yield* Effect.forEach(ids, ($item) => Effect.gen(function* () { const id = $item; { if (id === "") return; yield* syncOne(id) } }), { concurrency: "unbounded", discard: true })
    const $n = limit(), $xs = ids
    yield* Effect.forEach($xs, ($item) => Effect.gen(function* () { const id = $item; { if (id === "") return; yield* syncOne(id) } }), { concurrency: $n, discard: true })
    yield* Effect.forEach(ids, ($item) => Effect.gen(function* () { const id = $item; { yield* syncOne(id) } }), { concurrency: "unbounded", discard: true })
  })
}

function run(ids: string[]) {
  return Effect.gen(function* () {
    yield* Effect.forEach(ids, id => Effect.gen(function* () { yield* Effect.forkChild(Effect.sync(() => id)) }), { concurrency: 1, discard: true })
    yield* Effect.forEach(ids, id => Effect.gen(function* () { yield* Effect.forkChild(Effect.sync(() => id)) }), { concurrency: 2, discard: true })
    yield* Effect.forEach(ids, id => Effect.gen(function* () { yield* Effect.forkChild(Effect.sync(() => id)) }), { concurrency: NaN, discard: true })
  })
}
// run succeeds with undefined; the limits keep their existing child ownership.
```

The head is a `const` or `let` declaration, destructuring included: ECMAScript's `ForDeclaration`, `LetOrConst ForBinding` (VIP-19, amended). `var` and an assignment head, `for concurrent (x of xs)`, are syntax errors (`EK1906`). In both `for concurrent` and `for try`, head bindings are uninitialized in a separate lexical environment while evaluating the right-hand operand, as in ECMA-262's [ForIn/OfHeadEvaluation](https://tc39.es/ecma262/2025/multipage/ecmascript-language-statements-and-declarations.html#sec-runtime-semantics-forinofheadevaluation). In `for concurrent(n)`, the limit is evaluated before entering this head environment. A closure created there captures those uninitialized cells, which are distinct from the bindings initialized for each item; calling it after the loop still encounters their temporal dead zone. The item arrives under a fresh parameter, and the head's declaration runs first in the item's generator, so a default or computed key in it may run Effects and a failure there fails that item. The body keeps its own block scope:

```vibe es
// compiler-gap: pending VIP-19
effect function saveAll(entries: Array<[string, number]>) {
  for concurrent (let [k, v] of entries) { try save(k, v) }
}
```

```ts effect
// fragment
function saveAll(entries: Array<[string, number]>) {
  return Effect.gen(function* () {
    yield* Effect.forEach(entries, ($item) => Effect.gen(function* () {
      let [k, v] = $item
      { yield* save(k, v) }
    }), { concurrency: "unbounded", discard: true })
  })
}
```

```vibe es
// compiler-gap: pending VIP-19, VIP-20
effect function headScope() {
  let read = (): number => 0
  let x = 42
  for concurrent (let x of (read = (): number => x, [1])) { x = 7 }
  return read() // Die(ReferenceError); the RHS closure did not capture the outer or item x
}
// The same head in for try, with Stream.make(1) as its operand, has the same head scope.
```

The limit in `for concurrent(x) (const x of [2]) { }` reads the outer `x` before the head environment exists, so with outer `x = 1` it selects concurrency `1`.

```ts effect
import { Effect } from "effect"

const limitBeforeHead = Effect.sync(() => {
  const x = 1
  const limit = x
  for (const x of [2]) { /* the separate item binding does not shadow the earlier limit */ }
  return limit
})
const concurrentHeadScope = Effect.sync(() => {
  let read = (): number => 0
  let x = 42
  for (let x of (read = (): number => x, [1])) { x = 7 }
  return read()
})
const streamHeadScope = Effect.promise(async () => {
  let read = (): number => 0
  let x = 42
  for await (let x of (read = (): number => x, [1])) { x = 7 }
  return read()
})
// Both Die(ReferenceError): RHS closures keep the uninitialized head binding.
function limitReturn() { return Effect.gen(function* () { return 7 }) } // Success(7)
```

## `for try`

### Syntax

[ForTry](900-appendices.md#fortry).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `for try` outside effect code | `EK2001` |
| `return` targeting the enclosing function in head binding initialization or the body: `for try (const x of s) { return x }` | `EK2002` |
| a labeled `break` or `continue` in head binding initialization or the body naming a statement that encloses the `for try`: `outer: for (const s of streams) { for try (const x of s) { continue outer } }` | `EK2003` |
| an operand that is not a `Stream`, `for try (const x of [1, 2]) { }`; convert an AsyncIterable with `Stream.fromAsyncIterable` first | `EK2004` |
| a head other than a `const` or `let` declaration: `var`, `using`, `await using` or an assignment head, `for try (x of s)`; write `for try (const v of s) { x = v }` | `EK2005` |
| a legacy `for...of` or `for await` loop over a `Stream`, `for await (const x of s) { }`; `vibelang --fix` writes `for try (const x of s) { }` | `EK2007` |

### Meaning

`for try (const x of stream)` consumes a Stream, pulling one element at a time, in order. It mirrors `for await` over AsyncIterables, which keeps its JavaScript meaning. `continue` skips one element, `break` stops consuming and closes the stream's scope, so a producer still running is interrupted and its finalizers run, and a failure in the body fails the loop.

The item callback runs on the current consuming fiber; an item or source callable activation creates no new fiber owner. A plain `fork` child may outlive the item and successful loop completion while its owning fiber continues, is not implicitly joined, and is interrupted when that owner terminates. The consuming fiber can itself be a concurrent item's fiber or another explicitly created child. `fork.in`, `fork.scoped` and `fork.detached` retain their own native owners; `Stream` finalization and the loop's `break` and failure behavior are unchanged. This ownership rule adds no child-start ordering or per-item scope. See the [gated ownership witness](008-runtime.md#for-try-fiber-owner).

```vibe es
// compiler-gap: pending VIP-20
effect function saveAll(rows: Stream.Stream<Row>) {
  for try (const row of rows) {
    if (row.skip) continue
    if (row.last) break
    try save(row)
  }
}
```

```ts effect
// fragment
function saveAll(rows: Stream.Stream<Row>) {
  return Effect.gen(function* () {
    yield* Stream.runForEachWhile(rows, ($item) => Effect.gen(function* () {
      const row = $item
      {
        if (row.skip) return true
        if (row.last) return false
        yield* save(row)
      }
      return true
    }))
  })
}
```

A `break` or `continue` naming the `for try` itself means the unlabeled one, as in JavaScript and as `for concurrent` rules:

```vibe es
// compiler-gap: pending VIP-20
effect function first(rows: Stream.Stream<number>) {
  scan: for try (const row of rows) {
    if (row === 0) break scan   // return false
    continue scan               // return true
  }
}
```

The head and its lowering are as for `for concurrent` (VIP-20, amended): a `const` or `let` declaration, run first in the element's generator.

```vibe es
// compiler-gap: pending VIP-20
effect function first() {
  let out = 0
  for try (const [n = try succeed(7)] of Stream.make([undefined] as const)) { out = n }   // one element, the tuple [undefined]
  return out                                         // 7; a failing default fails the loop
}
```

```ts effect
// fragment
function first() {
  return Effect.gen(function* () {
    let out = 0
    yield* Stream.runForEachWhile(Stream.make([undefined] as const), ($item) => Effect.gen(function* () {
      const [n = yield* Effect.succeed(7)] = $item
      { out = n }
      return true
    }))
    return out
  })
}
```

## Producers

### Syntax

[Producer](900-appendices.md#producer) and [ProducerMethod](900-appendices.md#producermethod), with TypeScript's class-member [Modifiers](900-appendices.md#modifiers), as for an `async` method. The shorthand `effect *name()` exists only for methods, as `async *gen()` does in TypeScript; at top level it could parse as multiplication. A plain `function*` stays a JavaScript generator.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `return value` in a producer, `effect function* p() { return 1 }` (a bare `return` is allowed and ends the stream) | `EK2128` |
| a written return type that is not a `Stream.Stream<A, E, R>`, `effect function* p(): number[] { }`, as TypeScript requires an `AsyncGenerator` type for `async function*` | `EK2102` |
| `yield*` in a producer, `effect function* p() { yield* other() }`: no VIP specifies delegation | `EK2103` |
| `yield` in nonproducer effect code (an `effect` function, arrow or block), whether or not an outer producer exists, or in directly evaluated formal-parameter initialization of an Effect callable or producer | `EK2104` |

`EK2104` does not require an outer producer:

```vibe
// compiler-gap: pending VIP-1, VIP-21
effect function invalid() { yield 1 } // EK2104: no producer body owns this yield
effect function* outer() {
  const p = effect { yield 1 }       // EK2104: the block is a separate activation
  yield 2                            // belongs to outer
}
effect function permitted() {
  function* native() { yield 1 }     // belongs to the native generator
  return 7
}
```

### Meaning

`effect function*` returns a Stream, as `async function*` returns an AsyncIterable. Its body is effect code: `yield x` emits `x`, and `try` and the other constructs run Effects. A `yield` expression belongs to a producer or native generator body of its own activation, as in JavaScript: a nested callable cannot yield through an outer producer. In an `effect` function, effect arrow or `effect` block that is not itself a producer, it is `EK2104`, whether or not an outer producer exists. `yield` in a nested `effect` block, an arrow or an `effect function` handler is a syntax error; each of those bodies is a nonproducer activation. A nested native generator retains its own TypeScript `yield`; a plain nongenerator function or arrow retains TypeScript’s own restrictions and diagnostics. A `provide` block, an interruption block, a `for try` body and a `for concurrent` body are not producers: `yield x` there is `yield* Queue.offer(queue, x)` on the enclosing producer's queue, as `yield` in a nested block of an `async function*` yields from that function. In a `for concurrent` body, each item's fiber offers its own elements, so elements arrive in offer order. It compiles to `Stream.callback` with one element of buffer. For one sequential emitter, the producer may run up to two elements ahead of its consumer: one in the buffer and one waiting to be offered. With concurrent yields, each active item fiber can evaluate a value before waiting in `Queue.offer`; the one-element buffer does not bound all pending offers or upstream work. Unbounded concurrency has no constant global lead bound. A finite concurrency limit bounds active pending emitters in addition to the buffered element and work already consumed. Exact pull semantics are not provided. `yield x` evaluates to `undefined`, as in an `async function*` consumed by `for await`: it is `(yield* Queue.offer(queue, x), undefined)`. A `yield` with no operand is `yield undefined`, so it offers `undefined`. A failure run by `try` in the body fails the stream. The return type, when written, is `Stream.Stream<A, E, R>`, and each `yield x` requires `x` assignable to `A`. When it is not written, `A` is the union of the `yield` operands' types, widened as for an `async function*`, or `never` with no `yield`; `E` and the body requirements `RBody` are inferred as for an `effect` function ([Functions](001-functions.md#return-types)); the resulting `Stream` requires `Exclude<RBody, Scope.Scope>` because `Stream.callback` supplies its own `Scope.Scope`. All other service requirements remain. Written `Stream` annotations keep their ordinary contract checks; this subtraction does not apply to ordinary Effect functions, foreign `Stream` values or values of type `Scope.Scope`. So `effect function* f() { yield 1; yield "a" }` returns `Stream.Stream<number | string>`. The callback takes the body types as `Stream.callback<A, E, RBody>`; its resulting environment is `Exclude<RBody, Scope.Scope>`. Effect 4.1.0 needs these type arguments because it cannot infer them from the callback. The generator gets the function's `this`, `super` and `new.target` as an `effect` function's does ([Functions](001-functions.md#meaning)); how the compiler passes these bindings is its choice.

```vibe es
// compiler-gap: pending VIP-21
effect function* ticks() {
  yield 1
  try sleep("1 second")
  yield 2
}
effect function consume() { for try (const t of ticks()) { try log(t) } }
class Feed {
  effect *items(ids: string[]) {
    for concurrent (const id of ids) { yield try fetchUser(id) }
  }
}
```

```ts effect
// fragment
function ticks() {
  return Stream.callback<number, never, never>((queue) => Effect.gen(function* () {
    yield* Queue.offer(queue, 1)
    yield* Effect.sleep("1 second")
    yield* Queue.offer(queue, 2)
  }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
}
function consume() {
  return Effect.gen(function* () {
    yield* Stream.runForEachWhile(ticks(), ($item) => Effect.gen(function* () { const t = $item; { yield* Effect.log(t) }; return true }))
  })
}
class Feed {
  items(ids: string[]) {
    return Stream.callback<User, NotFound, never>((queue) => Effect.gen(function* () {
      yield* Effect.forEach(ids, ($item) => Effect.gen(function* () {
        const id = $item
        { yield* Queue.offer(queue, yield* fetchUser(id)) }
      }), { concurrency: "unbounded", discard: true })
    }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
  }
}
```


## Interruption blocks

### Syntax

[Uninterruptible](900-appendices.md#uninterruptible), [Restore](900-appendices.md#restore) and [Interruptible](900-appendices.md#interruptible): contextual keywords followed by `{` on the same line, and statements in effect code.

`uninterruptible { }` is always `Effect.uninterruptibleMask(($restore) => Effect.gen(…))`, as VIP-22 writes it, whether or not a `restore` block is inside it. The callback's parameter has a fresh name, so a user variable `restore` stays visible. `restore` selects the innermost enclosing `uninterruptible` block in the same source activation. Its entry state may already be uninterruptible, so restoring does not necessarily enable interruption. Intervening `restore`, `interruptible` or `provide` blocks do not rebind that capability.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `uninterruptible { }`, `interruptible { }` or `restore { }` outside effect code, `function f() { uninterruptible { } }`; `EK2201` fires, not `EK2111` | `EK2201` |
| `restore { }` outside an `uninterruptible` block, `effect function f() { restore { } }`; one inside an `interruptible` block nested in it is inside, as `$restore` is in scope there | `EK2111` |
| `restore { }` that captures an outer mask across an independent `effect` function declaration/expression, arrow, method, producer or block, as in `uninterruptible { const e = effect { restore { try poll() } }; try e }`, or inside any `for concurrent` body: the nested Effect, or each item's Effect, is outside the enclosing mask's control. Mask per item with `Effect.uninterruptibleMask` inside the body, or use a plain `for` | `EK2202` |

### Meaning

```vibe es
// compiler-gap: pending VIP-22
effect function pay(card: Card, user: User) {
  uninterruptible {
    const receipt = try charge(card)
    restore { try notify(user) }        // the interruptibility from before the mask
    try record(receipt)
  }
  interruptible { try poll() }
}
```

```ts effect
// fragment
function pay(card: Card, user: User) {
  return Effect.gen(function* () {
    yield* Effect.uninterruptibleMask(($restore) => Effect.gen(function* () {
      const receipt = yield* charge(card)
      yield* $restore(Effect.gen(function* () { yield* notify(user) }))
      yield* record(receipt)
    }))
    yield* Effect.interruptible(Effect.gen(function* () { yield* poll() }))
  })
}
```

`restore` inside a `provide` block, an `interruptible` block or a `for try` body applies, because those run on the masked fiber.

Resolve `restore` in the same source activation as its lexical mask. A nested effect callable or `effect` block may introduce its own `uninterruptible` mask and restore that one. Generated callbacks for transparent regions and `for try` do not create a source activation boundary; the separate `for concurrent` ban above remains unchanged.

```vibe es
// compiler-gap: pending VIP-22
effect function invalidCapture() {
  uninterruptible {
    effect function later() { restore { return 7 } } // EK2202: outer mask
  }
}
effect function ownMask() { uninterruptible { restore { return 7 } } } // Success(7)
const delayedOwnMask = effect { uninterruptible { return ownMask } }
```

```ts effect
import { Effect } from "effect"

function ownMask() {
  return Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    return yield* restore(Effect.succeed(7))
  }))
}
// Success(7), including when this function is called after another mask has ended.
const delayedOwnMask = Effect.uninterruptibleMask(() => Effect.succeed(ownMask))
```


The following reference enters interruptibly and requests interruption while both masks are active. The inner `restore` keeps its masked entry state, so the two recorded statements run; leaving the outer mask delivers the pending interruption. The fixture observes both the interruption Exit and the named `events` trace.

```vibe es
// compiler-gap: pending VIP-22
effect function nestedRestore(events: string[]) {
  const self = try Effect.withFiberSucceed(fiber => fiber)
  uninterruptible {
    uninterruptible {
      try orDie(Effect.try(() => self.interruptUnsafe()))
      restore { events.push("inner") }
    }
    events.push("after inner")
  }
  events.push("after outer") // not reached with interruptible entry
}
// With interruptible entry: interruption Exit; events is ["inner", "after inner"].
```

```ts effect
import { Effect } from "effect"

function nestedRestore(events: string[]) {
  return Effect.gen(function* () {
    const self = yield* Effect.withFiberSucceed(fiber => fiber)
    yield* Effect.uninterruptibleMask(restoreOuter => Effect.gen(function* () {
      yield* Effect.uninterruptibleMask(restoreInner => Effect.gen(function* () {
        yield* Effect.orDie(Effect.try(() => { self.interruptUnsafe() }))
        yield* restoreInner(Effect.sync(() => { events.push("inner") }))
      }))
      events.push("after inner")
    }))
    events.push("after outer")
  })
}
// Under interruptible entry, the pending interruption yields an interruption Exit.
// The inner restore keeps its uninterruptible entry state: events is ["inner", "after inner"].
// The interruption is delivered when the outer mask restores interruptible entry.
```


The keywords remove the globals of the same name ([VIP-6](../vips/0006-effect-globals.md)), so Effect's functions are written `Effect.uninterruptible` and `Effect.interruptible`.


## Region bodies

A *region body* is source code that the lowering moves into a generated callback: the block of `provide`, `uninterruptible`, `restore` and `interruptible`, and head binding initialization and the body of `for try` and `for concurrent`. Its names and jumps mean what they mean in the source, as ECMAScript defines them: `provide` and interruption blocks are ordinary blocks, so `return`, `break` and `continue` inside them reach the enclosing function, loop, `switch` or label, as in any TypeScript block (VIP-12 and VIP-22, amended). This section is the one lowering rule for both; [Services](005-services.md#provide-blocks), [Functions](001-functions.md#meaning) and [Runtime guarantees](008-runtime.md) refer to it.

For either loop, its whole item region includes head binding initialization and the body, excluding nested source functions. The existing outward-jump restrictions cover that whole region. Limit and iterable/Stream operand evaluation remain in the enclosing activation before item work; a `return` in a `do` there keeps its ordinary enclosing target. The pinned `do` proposal's independent early errors for `break` and `continue` in heads still apply.

```vibe es
// compiler-gap: pending VIP-19, VIP-20
effect function rejectedHeads(rows: Array<{ n?: number }>, stream: Stream.Stream<{ n?: number }>) {
  for concurrent (const { n = do { return 7 } } of rows) {} // EK1904
  for try (const { n = do { return 7 } } of stream) {}       // EK2002
}
effect function limitReturn() {
  for concurrent(do { return 7 }) (const n of [1]) {}
} // Success(7), before any item starts
```

**Bindings.** Every name is resolved on the source before lowering. `var` is a compile error in `.vibe` ([Legacy JavaScript](001-functions.md#direct-eval)), so every declaration in a region body (`let`, `const`, `class`, a function declaration) is scoped to its block, as in strict module code, and stays in it; the callback closes over every outer binding, so an assignment to one is seen outside. `this`, `super` and `new.target` are the source function's, passed in as for an `effect` arrow ([Functions](001-functions.md#meaning)).

**Jumps.** Across `provide`, `uninterruptible`, `restore` and `interruptible`, a statement retains its ECMAScript completion kind, value (including `empty`) and target. A `provide` or interruption block has its source block's normal completion value, observable from `do`; local labels and loops consume jumps with their source values under `UpdateEmpty`. Label targets are empty when unlabeled. LabelledEvaluation decides which statement consumes a `break` or `continue`: an unlabeled `break` is consumed by the innermost iteration or `switch` statement, an unlabeled `continue` by the innermost iteration statement, and a labeled one by the statement whose label set holds the label (any statement for `break`, an iteration statement for `continue`). A `return` is consumed by the function. The compiler preserves that behavior; how it transports completions is its choice:

- A completion consumed inside the region body stays as written.
- A normally completed `provide` or interruption block contributes its source block's normal value or empty completion. An outward `return`, `break` or `continue` keeps its kind, value and target, including a value inherited before a jump. An empty completion remains distinct from an explicit `undefined`.
- A completion continues from the source region's position to the same consumer, even across further regions. A consumed jump can therefore supply a `do` result; crossing a generated callback does not discard that value.
- The item protocol remains the API's: a `for try` consumes `continue`, or a `continue` naming it, as `return true` and `break`, or a `break` naming it, as `return false`; a `for concurrent` consumes its own `continue` by ending that item. Nested source functions keep their own completion boundaries.
- A `for concurrent` head's binding initialization or body can't produce a `break` it doesn't consume, a `return` or a `continue` naming an enclosing statement, and a `for try` head's binding initialization or body can't produce a `return` or a labeled `break` or `continue` naming a statement that encloses it: their static rules make these errors, because the body runs in `Effect.forEach`'s or `Stream.runForEachWhile`'s callback, not in the enclosing loop or function (VIP-19, VIP-20).
- A completion transfers to the surrounding source expression only after the region Effect and its finalizers succeed. A failure, defect or interruption stays in Effect's `Cause`. The region's own finalizers, such as releasing a `provide`'s layers, run before the jump, because `Effect.provide` and the masks complete before `yield*` returns.

Syntax-directed `do` checks traverse these transparent source blocks as ordinary `BlockStatement`s, respecting source activation boundaries rather than generated callbacks.


**Effect observers.** Source completion transport is private. At every observable Effect or Scope boundary, `provide` and interruption regions keep the accepted generator's success payload:

| Source completion leaving the region | Primitive Effect success payload |
| --- | --- |
| normal, whether its source value is empty, `undefined` or another value | `undefined` |
| `return value` | that value, with its identity preserved |
| bare `return` | `undefined` |
| outward `break` or `continue`, including a labeled jump with an inherited completion value | `undefined` |

The source completion, including its value and target, remains separate from that payload. Thus a normal region ending in `7` can supply a `do` result of `7` while its layer's finalizer sees `Exit.succeed(undefined)`. A return crossing nested transparent regions supplies its value at each boundary, after inner finalizers succeed. Compiler control records never appear in the primitive success channel, and a real returned record-shaped object or Effect remains ordinary data. Tracking is fresh per execution and item, preserving cold reruns and reentrancy. A body or finalizer that fails, dies or is interrupted transfers no pending source completion; Effect decides the resulting Exit and cause combination. An inner transparent region finishes before an enclosing item's separate `for try` or `for concurrent` callback protocol runs.

```vibe es
// compiler-gap: pending VIP-2, VIP-12, VIP-22
effect function regionValues() {
  const provided = do { provide Layer.empty { 7 } }
  const masked = do { uninterruptible { 7 } }
  const restored = do { uninterruptible { restore { 7 } } }
  const interruptibleValue = do { interruptible { 7 } }
  const inherited = do { 5; provide Layer.empty {} }
  const jumped = do { label: { provide Layer.empty { 7; break label; } 99; } }
  const undefinedValue = do { 5; uninterruptible { undefined } }
  return [provided, masked, restored, interruptibleValue, inherited, jumped, undefinedValue] as const
} // Success([7, 7, 7, 7, 5, 7, undefined])
const cleanupLayer = Layer.effectDiscard(addFinalizer(() => die("cleanup")))
effect function cleanupBeforeValue() { return do { provide cleanupLayer { 7 } } } // Die("cleanup")
```

```ts effect
import { Effect, Layer } from "effect"

const providedCompletion = Effect.gen(function* () {
  let value = 0
  yield* Effect.provide(Effect.gen(function* () { value = 7 }), Layer.empty)
  return value
})
const maskedCompletion = Effect.gen(function* () {
  yield* Effect.uninterruptibleMask(() => Effect.gen(function* () { 7 }))
  return 7
})
const restoredCompletion = Effect.gen(function* () {
  yield* Effect.uninterruptibleMask(restore => restore(Effect.gen(function* () { 7 })))
  return 7
})
const interruptibleCompletion = Effect.gen(function* () {
  yield* Effect.interruptible(Effect.gen(function* () { 7 }))
  return 7
})
const inheritedCompletion = Effect.gen(function* () {
  const earlier = 5
  yield* Effect.provide(Effect.void, Layer.empty)
  return earlier
})
const jumpedCompletion = Effect.gen(function* () {
  let value = 0
  label: {
    yield* Effect.provide(Effect.gen(function* () { value = 7 }), Layer.empty)
    break label
  }
  return value
})
const undefinedCompletion = Effect.uninterruptibleMask(() => Effect.void)
const cleanupLayer = Layer.effectDiscard(Effect.addFinalizer(() => Effect.die("cleanup")))
const cleanupBeforeValue = Effect.gen(function* () {
  yield* Effect.provide(Effect.gen(function* () { 7 }), cleanupLayer)
  return 7
})
const regionCompletions = Effect.gen(function* () {
  return [
    yield* providedCompletion, yield* maskedCompletion, yield* restoredCompletion,
    yield* interruptibleCompletion, yield* inheritedCompletion, yield* jumpedCompletion, yield* undefinedCompletion
  ] as const
})
// Success([7, 7, 7, 7, 5, 7, undefined]); cleanupBeforeValue dies with "cleanup".
```


```vibe es
// compiler-gap: pending VIP-2, VIP-12
effect function observedNormal() { return do { provide observed { 7 } } }
effect function observedReturn(value: unknown) { provide observed { return value } }
effect function observedBreak() { outer: while (true) { provide observed { break outer } }; return 7 }
// A layer finalizer sees Success(undefined), Success(value), Success(undefined), respectively.
```

```ts effect
import { Effect, Layer } from "effect"

const observingLayer = (seen: unknown[], label?: string) =>
  Layer.effectDiscard(Effect.addFinalizer(exit => Effect.sync(() => {
    const value = exit._tag === "Success" ? exit.value : exit
    seen.push(label === undefined ? value : [label, value])
  })))
function observedNormal(seen: unknown[]) {
  return Effect.gen(function* () {
    let value = 0
    yield* Effect.provide(Effect.gen(function* () { value = 7 }), observingLayer(seen))
    return value
  })
}
function observedReturn<A>(seen: unknown[], value: A) {
  return Effect.provide(Effect.gen(function* () { return value }), observingLayer(seen))
}
function observedBreak(seen: unknown[]) {
  return Effect.gen(function* () {
    let stopped = false
    outer: while (true) {
      yield* Effect.provide(Effect.gen(function* () { stopped = true }), observingLayer(seen))
      if (stopped) break outer
    }
    return 7
  })
}
function observedNested(seen: unknown[], returning: boolean) {
  return Effect.gen(function* () {
    let value = 0
    yield* Effect.provide(Effect.gen(function* () {
      const result = yield* Effect.provide(Effect.gen(function* () {
        value = 7
        if (returning) return value
      }), observingLayer(seen, "inner"))
      if (returning) return result
    }), observingLayer(seen, "outer"))
    return value
  })
}
const observerCleanupFailure = Effect.gen(function* () {
  yield* Effect.provide(Effect.gen(function* () { 7 }),
    Layer.effectDiscard(Effect.addFinalizer(() => Effect.die("cleanup"))))
  return 7
})
// observedNormal/observedBreak: outer Success(7), observer Success(undefined).
// observedReturn: both Exits carry the same value and identity.
// observedNested: inner then outer see undefined normally, or 7 on return.
// observerCleanupFailure dies with "cleanup" instead of transferring 7.
```

```vibe es
// compiler-gap: pending VIP-12
effect function find(ids: string[]) {
  outer: for (const id of ids) {
    provide Users = testUsers {
      if (id === "skip") continue outer
      if (id === "stop") break outer
      if (try (try Users).has(id)) return id
    }
  }
  return "none"
}
```

```ts effect
// fragment
function find(ids: string[]) {
  return Effect.gen(function* () {
    outer: for (const id of ids) {
      const $control: { kind: "Normal" | "Return" | "Break" | "Continue"; value: string } =
        { kind: "Normal", value: "" }
      yield* Effect.provide(Effect.gen(function* () {
        if (id === "skip") { $control.kind = "Continue"; return }
        if (id === "stop") { $control.kind = "Break"; return }
        if (yield* (yield* Users).has(id)) {
          $control.kind = "Return"
          $control.value = id
          return id
        }
      }), Layer.succeed(Users, testUsers))
      if ($control.kind === "Return") return $control.value
      if ($control.kind === "Break") break outer
      if ($control.kind === "Continue") continue outer
    }
    return "none"
  })
}
```

```vibe es
// compiler-gap: pending VIP-22
effect function f(xs: number[]) {
  let n = 0
  for (const x of xs) {
    switch (x) { case 1: uninterruptible { n = n + 10; break } }   // leaves the switch
    n++
  }
  return n                                      // [1, 2] gives 12
}
```

```ts effect
// fragment
function f(xs: number[]) {
  return Effect.gen(function* () {
    let n = 0
    for (const x of xs) {
      $s: switch (x) {
        case 1: {
          yield* Effect.uninterruptibleMask(($restore) => Effect.gen(function* () {
            n = n + 10
          }))
          break $s
        }
      }
      n++
    }
    return n
  })
}
```

## The pipe operator

`|>` follows the pinned TC39 Hack pipe proposal with the [snapshot reconciliations](../vips/tc39-pipeline-operator/README.md) and effective [PipeExpression](900-appendices.md#pipeexpression) and [PipeBody](900-appendices.md#pipebody). `%` is the topic: the left input value, evaluated once at its source position. The input is the declared [ShortCircuitExpression](900-appendices.md#shortcircuitexpression), read with `GetValue`; the printed evaluator's [ConditionalExpression](900-appendices.md#conditionalexpression) is a stale reference, not a change of precedence.

The missing-topic early error applies `ContainsOuterTopic` to the body's `AssignmentExpression` child; the [PipeBody](900-appendices.md#pipebody) boundary still returns `false`, so an inner topic cannot satisfy an outer body. A body whose whole unparenthesized expression is a pipe is also an early error, making a chain sequential and left-associated. Parenthesized nested pipes retain their separate topic scopes. The existing conditional, yield, assignment and arrow covering-production errors remain. `GetPrimaryTopicValue` reads `topicEnv.[[TopicValues]]`, the environment it just acquired. Binary XOR `^` and XOR assignment `^=` keep their TypeScript meanings; the snapshot's duplicated `%` does not remove them, and `%` remains the topic or modulo according to its syntactic position.

```vibe es
// compiler-gap: pending VIP-23
effect function run(id: string) {
  const n = fetchUser(id) |> retry(%, policy) |> timeout(%, "1 second")
  return try n
}
```

```ts effect
// fragment
function run(id: string) {
  return Effect.gen(function* () {
    const $t1 = fetchUser(id); const $t2 = Effect.retry($t1, policy); const n = Effect.timeout($t2, "1 second")
    return yield* n
  })
}
```

```vibe es
// compiler-gap: pending VIP-23
const one = 1 |> % + 1                     // 2
const chain = 1 |> % + 1 |> % * 2           // 4: left-associated
const nested = 1 |> (% + 1 |> % * 2)        // 4: explicit nesting
const a = true ? 1 : 2 |> % + 10            // 1: only the alternate is piped
const b = (true ? 1 : 2) |> % + 10          // 11: the whole conditional is piped
const value = 7 |> %                       // 7
const obj = {}; const same = obj |> % === obj // true
const xor = 1 ^ 3; let assigned = 1; assigned ^= 3 // both 2
const modulo = 7 |> % % 4                  // 3
const bad = 1 |> f()                       // syntax error: missing topic
const outer = 1 |> (2 |> % + 1)            // syntax error: outer body has no topic
```

An unparenthesized conditional at either end of a pipe is `EK2301`: `x |> % ? 1 : 2 // EK2301`; write `(x |> %) ? 1 : 2` or `x |> (% ? 1 : 2)`.

The admitted controls have the following Effect TypeScript counterpart, with `Success([2, 4, 4, 1, 11, 7, true, 2, 2, 3])`:

```ts effect
// Pipe reconciliation controls
import * as Effect from "effect/Effect"
const controls = Effect.gen(function* () {
  const one = 1 + 1
  const first = 1 + 1; const chain = first * 2
  const nested = (1 + 1) * 2
  const a = true ? 1 : 2 + 10
  const b = (true ? 1 : 2) + 10
  const value = 7
  const obj = {}; const same = obj === obj
  const xor = 1 ^ 3; let assigned = 1; assigned ^= 3
  const modulo = 7 % 4
  return [one, chain, nested, a, b, value, same, xor, assigned, modulo]
})
console.log(JSON.stringify(Effect.runSync(controls)))
```

Effect's `pipe(x, f, g)` function stays available ([VIP-14](../vips/0014-effect-modules-in-scope.md)).

The pinned snapshot is the [vendored copy](../vips/tc39-pipeline-operator/README.md) of `tc39/proposal-pipeline-operator` at commit `5ac4dfd624e68b649e6f947885bf5ef67bac19f4`, the head on 2026-10-28 (UTC), as pattern matching is pinned.

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. Principles are numbered as in [the introduction's Details](000-intro.md#details).

### Detail 61

(NW 23; VIP-5) `(try x) catch h` is allowed: it catches the Effect that `x` succeeds with. VIP-5's "never both" covers only the unparenthesized `try x catch h`.
    ```vibe
    (try x) catch (e) => y   // ok when x succeeds with an Effect
    try x catch (e) => y     // error (VIP-5)
    ```
    Effect TS: `Effect.catch(yield* x, (e) => Effect.succeed(y))`. Decided by the agent from principles 3 and 4 (parentheses mean what they say; no extra rule); 2026-10-29.


    **61/99 catch-head argument execution, decide-live, 2026-11-02.** The current accepted `002-running.md` catch static rule explicitly states that a `try` inside arguments is outside the `EK0505` head search and `g(try a) catch h` catches `g`'s failure. Together with this detail's `Effect.catch(yield* x, h)` counterpart, VIP-5's native evaluation order and99/199's caller-side operand evaluation, this settles the Alchemy K2 catch-scope attribution question without a new language choice.

    ```vibe
    effect function read(text: string) {
      return decode(try parse(text)) catch effect (cause) => { throw remap(cause) }
    }
    ```

    Effect TypeScript: `function read(text: string) { return Effect.gen(function* () { return yield* Effect.catch(decode(yield* parse(text)), cause => Effect.fail(remap(cause))) }) }`. Here `parse` and `decode` return actual Effects. Evaluate the callee/receiver and arguments once in native order; running the argument `parse(text)` happens before `decode` is invoked and before the handler for its returned program is installed. Its failure propagates and does not enter this decode handler. A source `effect { const json = try parse(text); return try decode(json) } catch h` deliberately constructs a cold head program covering both runs and has a different catch extent. Do not silently substitute that wider generator for the ordinary head expression.

    The auditor's original `a.pipe(Effect.flatMap(x => b(x).pipe(Effect.mapError(f))))` and written `b(try a) catch effect (e) => { throw f(e) }` match this accepted boundary in an enclosing Effect activation, subject to the actual surrounding syntax/bindings. A blanket claim that the written form must widen the catch is incorrect. The observed pre-flip emit's double mapping is real owner evidence, but actual parser/AST, compiler identity/version, generated run sites and emitted protection boundary must locate whether the product fault is lowering, a different codemod source shape or another legacy transformation. Do not attribute it to the codemod solely from the excerpt, weaken error/cause checks, or revive implicit running. Retention/refusal remains appropriate until the actual artifact preserves the native behavior.

    Own native Effect4.1.0 controls (`catch-argument-native-reference/receipt.json`): original flatMap/mapError, accepted argument-before-catch counterpart and deliberately widened whole-generator catch, each on invalid JSON, schema mismatch and success (nine runs). The first two agree in every case. Invalid JSON preserves `SyntaxError` as the original cause, with zero decoder/handler calls; the widened variant calls the mapper once and nests a `K2SchemaError`. Schema mismatch and success agree across all three. This is native reference execution, not a Vibe compiler/Alchemy reproduction or a product attribution.

    Decided by the agent as an application of existing61/99/199/277, accepted VIP-5's explicit head rule and principles1/2/3 (native Effect behavior, evaluation order and syntax-selected execution), 2026-11-02 under the 2026-10-29 delegation. No new code, numbered detail, Will question, compiler/target edit or oracle change. The owner should retain the exact Alchemy witness and add a quoted regression/fuzz neighborhood across head arguments, receivers/computed accesses, parentheses, nested cold blocks and parse/decode failure paths, without reclassifying ordinary native errors.


    **Alchemy-63 channel boundary, decide-live, 2026-11-02 (existing61).** For `(try block) catch h`, the outer run completes before the returned Effect is protected. The handler receives only the error channel of the Effect in the outer run's successful value. A tag in the outer block's own error channel is not evidence that this handler must accept that tag. If the successful value is not an Effect, reject the catch operand instead of inventing implicit running or widening its error union. This is exactly `Effect.catch(yield* block, h)`; the enclosing generator propagates `block`'s failure before installing `h`. Recover the original native program, actual AST, nested success/error types, compiler identity and emitted protection boundary before attributing the reported tc3/tc6 difference. Preserve the owner's four TypeScript reversions and require a discriminating witness; the admitted non-discriminating repro cannot settle product attribution. Existing61/99/199/277 and principles1/2/3 settle scope; no cast, error-union widening, new decision or throw-expression retirement is authorized. Detail284 was pending at this receipt; its later recorded Will answer retains throw expressions under the pinned TC39 proposal. Decided by the agent from those existing rules, 2026-11-02 under the 2026-10-29 delegation.


    **Alchemy-63 attribution update, 2026-11-02T11:00 owner receipt.** The owner now supplies a discriminating old/new example and native twins: an `Effect.gen` channel absorbs a tagged `Error` subclass into broader `Error`, while the original `flatMap` composition preserves an unreduced union. This supersedes the earlier absence of a discriminating witness. Apply61 as the accepted scope rule, not as a diagnosis of this separate generator/channel conversion defect. The legacy `(try effect { ... }) catch ...` excerpt alone does not establish a valid final-syntax AST or the successful nested Effect channel. Root has not replayed those compiler/static twins. Class-pattern conversion is separately bounded by277 below.


    **61/99 program-argument clarification, decide-live, 2026-11-02.** A `catch` expression runs its head and gives the handled success value, even when its head is an `effect { ... }` block and the whole expression appears in another call's argument. It is not a cold `Effect.catch` composition. Thus the numeric caught expression in the first example below supplies a number to `withSpan`, not a program; parentheses around the caught expression do not change that. No call-site contextual reclassification is permitted.

    ```vibe
    effect function rejected() {
      return try withSpan(effect { return 1 } catch effect () => 0, "read")
    }
    effect function coldComposition() {
      return try withSpan(effect {
        return (effect { return 1 }) catch effect () => 0
      }, "read")
    }
    ```

    The rejected native Effect TypeScript counterpart is `Effect.gen(function* () { return yield* Effect.withSpan(yield* Effect.catch(Effect.succeed(1), () => Effect.succeed(0)), "read") })`. The cold counterpart is `Effect.gen(function* () { return yield* Effect.withSpan(Effect.gen(function* () { return yield* Effect.catch(Effect.succeed(1), () => Effect.succeed(0)) }), "read") })`; direct native `Effect.withSpan(Effect.catch(Effect.succeed(1), () => Effect.succeed(0)), "read")` is also a program composition.

    Own native TypeScript5.9.3 controls in `catch-program-argument-reference/receipt.json`: executed and parenthesized executed arguments each get `TS2769` plus the outer delegation's `TS2488`; cold-wrapper, native-composition and uncaught-program controls compile. These are five native static controls, not a Vibe/compiler/target or runtime-timing replay. The reported old8ecc/newe525 matched-runtime difference is evidence of compatibility behavior, not grounds to accept the invalid final source. Recover the original native producer and preserve its actual program argument, evaluation/span/error scope and declarations through274/277's migration; use a cold wrapper only when that reproduces the original, otherwise refuse/retain native source. Do not silently change new authored source or normalize away independent errors. Existing VIP-5's explicit execution rule,61/99, principle1 (idiomatic native Effect), principle3 (syntax selects execution), principle4 (one catch rule) and principle8 settle this; no new detail, language choice or Will question. Decided by the agent from those accepted rules, 2026-11-02 under the 2026-10-29 delegation.

### Detail 89

**One test for "is an Effect" and "is a Promise" in the four result diagnostics** (NW 53; Opus r16 M1; r17-003; replaces the integrator's every-member rule in 002 "Result tests"). `EK0103`, `EK0508`, `EK0404` and `EK0507` all ask the same question: may this value be an unrun Effect (or an unrun Promise)? A type answers yes when it is not `never`, `any` or `unknown` and **at least one** union member is an Effect (for `EK0103`, `EK0508`) or `PromiseLike` (for `EK0404`, `EK0507`). Detail 36 keeps its every-member test, because it asks the opposite question (may this call be exempt from throw tracking?), whose conservative answer is no. `try` (`EK0502`), `catch` (`EK0506`), `try.all` (`EK1801`) and detail 88 keep assignability.
    ```vibe
    effect function f() {
      const p = maybeQuery()                      // maybeQuery(): Promise<number> | undefined: EK0404
      const q = try tryPromise(async () => maybeQuery())   // ok
    }
    async function g(e: Effect.Effect<number> | undefined) {
      return await e                              // EK0103: e may be an Effect
    }
    x catch (e) => (cond ? fetchUser("g") : null) // EK0508 warning: the fallback may be an unrun Effect
    ```
    Effect TS: `Effect.tryPromise(async () => maybeQuery())`. Decided by the agent from principle 8 (an error can be relaxed later), principle 4 (one test for four rules instead of two opposite ones) and principle 2 (typescript-eslint's `no-floating-promises` treats a union with any thenable member as a Promise); the four reviewers and the integrator recommend it for Promises; 2026-10-29.

### Detail 99

**`EK0505` covers `fork` and `join` heads** (NW 62; audit 002 interactions m2; amends VIP-5's "never both" and the `EK0505` row; VIP-17). `fork` and `join` run an Effect as `try` does and bind as tightly (detail 32), so `join f catch h` catches the Effect the fiber *succeeded with*, not the fiber's failure, and `fork e catch h` puts a handler on the fork, which never fails. Both are the misreading `EK0505` exists for. A `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join` reachable from a `catch` head through unary and binary operator nodes only is `EK0505`, by the same tree rule as `try`. Quick fixes: for `join f catch h`, `Fiber.join(f) catch h` (handle the fiber's failure); for `fork e catch h`, detail 199's `fork Effect.catch(e, ($e) => Effect.succeed(h($e)))` (handle inside the fiber). The parenthesized forms `(join f) catch h` and `(fork e) catch h` are allowed, as detail 61 allows `(try x) catch h`.

    Erased-wrapper source: applied in3861eba6cf53 (spec-fix-b; queued, not a main receipt). Complete five-kind transparent class, explicit source-parenthesis barrier and native admission checks; Node3/Bun3, strict .ts plus actual TS-emitted Node reference, regen183/forms/spec/docs pass. v16/v17 leftmost/binary/unary Circle generalized to erased wrappers without a lowering recipe.
    ```vibe
    join f catch (e) => 0        // EK0505: write Fiber.join(f) catch (e) => 0
    fork e catch (e) => 0        // EK0505: write fork Effect.catch(e, () => Effect.succeed(0))
    Fiber.join(f) catch (e) => 0 // ok
    ```
    Effect TS: `Effect.catch(Fiber.join(f), () => Effect.succeed(0))` and `Effect.forkChild(Effect.catch(e, () => Effect.succeed(0)))`. Decided by the agent from principle 4 (one rule for every operator that runs an Effect), detail 61's parenthesized precedent and principle 8 (an error relaxes later); no `.vibe` in the repository writes either form (grep, 2026-10-29); 2026-10-29. Restore the round-18 lane's 002 row with these quick fixes.

    **Erased-wrapper clarification, 2026-10-30 (Opus r22 m19).** For the `EK0505` head search, runtime-erased TypeScript expression wrappers are transparent along the existing unary/binary path: `as`, angle-bracket assertions where admitted, `satisfies`, non-null `!`, and type-only instantiation expressions that add no call. This supplements the incomplete AST-kind list above. Actual source parentheses retain detail 61's boundary; runtime calls and source callable boundaries remain barriers. A compiler-added parenthesis in emitted JavaScript is not a source grouping choice.
    ```vibe
    declare const nested: (number!!)!!
    effect function bad() { return try nested as (number!!) catch () => 0 } // EK0505
    effect function explicit() { return (try nested) as (number!!) catch () => 0 } // allowed
    ```
    Effect TS for the explicit form is `yield* Effect.catch(yield* nested, () => Effect.succeed(0))`. Type wrappers still receive ordinary TypeScript checking and do not catch the outer execution or change its head. Quick fixes remain as superseded by detail 199. Decided by the agent from VIP-5's unparenthesized never-both rule, detail 61, principle 3 (syntax-selected execution without a type-only escape) and principle 4 (one traversal through erased wrappers), 2026-10-30. Add rejection controls for the erased wrappers and accepted explicit-parenthesis controls in the fixing tests; no new detail number or Will question is needed. `root-catch-wrapper-erasure.log` verifies all five native TypeScript 5.9.3 wrappers erase to the same operand. The first probe assertion was corrected to allow emitter-added grouping for an instantiation expression; its initial log is retained. This is erasure evidence, not VibeLang diagnostic conformance.

### Detail 109

**Both custom for-of heads retain the RHS head environment and its uninitialized bindings.** (live `002-loop-head-rhs-tdz`; owner `spec-fix-b`; VIP-19/VIP-20; detail 48.) For `for concurrent` and `for try`, evaluate the operand in ECMAScript's separate `ForDeclaration` lexical environment, with all head-bound names in their TDZ. Closures created there retain that environment, whose head cells never become the initialized per-item cells. In `for concurrent(n)`, evaluate `n` before entering it. Preserve per-item fresh declarations and the body's separate block. Use hygienic cells if callbacks require them, preserving ReferenceError timing and const writes; do not resolve an RHS capture to an outer or per-item binding.
    **Immutable-main source receipt (54182a, 109).** Immutable main `54182a644026` contains the source head lexical environment/TDZ, limit-before-head evaluation and whole-item jump rules in002 plus public VIP19/20 (history `d2f2bc108caf`). These are landed source rules; compiler parity is not inferred.
    Status: applied in 8e5d16b01847 (spec-fix-b; queue accepted/held, not a main receipt). Replaces1ecc6d7f52ee with explicit limit-before-head environment, full initialization/body checks, and public VIP-19/20 amendments; Node6/Bun6 and strict5.9.3 pass.
    ```vibe
    let read = (): number => 0
    const xs = [1]; let x = 42
    for concurrent (let x of (read = (): number => x, xs)) { x = 7 }
    read() // ReferenceError: the captured RHS-head x is still uninitialized
    ```
    Effect TS: the source lexical environment of `for (let x of (read = () => x, xs)) { x = 7 }`, with iteration work driven by `Effect.forEach` or `Stream.runForEachWhile`. Decided by the agent from principle 2 (ECMAScript ForDeclaration scope), VIP-19/VIP-20's adopted head, and 008's source-binding guarantee, 2026-10-29. No new diagnostic or source restriction.

    **109 ordinary-loop preservation application, decide-live, 2026-11-02 (RC-37).** Detail109 mirrors the native `for-in`/`for-of` lexical-head rule; lowering a `do` in an ordinary loop's RHS must preserve that original environment too. A closure created in a lexical-declaration head's RHS retains its distinct uninitialized head cell forever. It must not capture an outer same-name variable or the later initialized per-iteration binding. A local declaration inside the `do` still shadows the head normally. Assignment heads introduce no new lexical head cells.

    ```vibe
    export function probe(): unknown {
      const x = 7
      let read: () => number = () => 0
      for (const x of do { read = (): number => x; [1] }) {}
      try { return read() }
      catch (e) { return e instanceof Error ? e.name : String(e) }
    }
    ```

    The ordinary TypeScript/Effect TypeScript counterpart retains the native loop and replaces only this no-jump RHS with `((): number[] => { read = (): number => x; return [1] })()`. It returns `"ReferenceError"`, not `7`; body initialization or reassignment cannot initialize the separate captured head cell. This is a plain-function binding control, not an Effect Exit. That plain arrow is illustrative only: a general lowering must also retain outward abrupt completions, source callable context and any admitted suspension rather than introducing a callback boundary. Preserve source binding identity and TDZ read/write timing for simple/pattern `const`/`let` heads, `for-in`/`for-of`, local/outer shadows, deferred/immediate reads, body captures and native assignment-head controls.

    Reviewer pass125 reports25 compiler calls and25 runtime commands, all exit0 but six semantic mismatches on current `fe7b802fbf05`; five positive pairs and three older `509a2110` controls distinguish the scope regression. Paired declarations agree, which does not prove runtime binding identity. The already repaired RC24 destructured-head `closing.go` issue remains separately fixed; this is parser RHS hoisting, also affecting ordinary simple heads and `for-in`. Concurrent/`for try` reports keep their existing identities. Chapter002/impl-hunt-run, core-block and chapter008 own implementation and failing-main regression/keyed corpus/spec-quoted neighbourhood coverage. No root compiler execution, source/test edit, competing fix, closure or new diagnostic is claimed.

    Decided by the agent from existing109's native lexical-head model, `000-intro.md`'s native plain/async guarantee, `002-running.md`'s source lexical-environment/evaluation rule, `008-runtime.md`'s binding preservation and principle2 (mirror TypeScript/ECMAScript), 2026-11-02 under the 2026-10-29 delegation. No new numbered detail or Will question. Source: `loop/scoped/rev-compiler/FINDINGS.md` pass125/`002:do-loop-head-loses-lexical-environment`; `pass125-loop-head.json` and `pass125-loop-controls.json`.

### Detail 114

**An outer restore capability cannot cross any independent effect activation.** (live `002-restore-function-boundaries`; generalizes detail 51's examples, retains 51a.) Crossing a nested `effect` function declaration/expression, arrow, method, producer, or block cannot capture an enclosing mask's restore: `EK2202`. A nested activation can introduce its own `uninterruptible` and restore that mask. Transparent region blocks and for-try callback lowering do not add a source function boundary; keep them allowed. A for-concurrent item retains detail 51a's ban even at limit 1.
    **Immutable-main source portion (7ac03, 114).** Chapter002/AppendixB/publicVIP22 now distinguish an invalid capture of an outer mask across an independent source Effect activation from a valid own mask in that activation. Transparent regions and `for try` do not create boundaries; the separate `for concurrent` prohibition remains. This does not certify the separately queued detail51 nested-interruptible runtime repair. Full four-file,15,963-character diff independently read; documentation only, no own compiler/native/gate check. `main-7ac-source-receipt.json` records limits.
    Status: applied inaa4bdb667ac2, landed as main7ac03c20d3a3 (spec-fix-b). Public VIP-22 publishes all callable forms and own-mask permission;002/AppendixB qualify outer capture and retain51a. Node2/Bun2, strict TS/native delayed-local-mask7, regen/forms/spec/docs pass.
    ```vibe
    uninterruptible {
      effect function delayed() { restore { try sleep("1 millisecond") } } // EK2202
    }
    ```
    Effect TS: a callback's `restore` belongs to the lexical `Effect.uninterruptibleMask`; do not export its use through a separately runnable Effect. Decided by the agent from detail 51's reason (a nested Effect can run after the mask ends), principle 4 (one activation-boundary rule for every callable spelling) and principle 8, 2026-10-29. Apply to 002, Appendix B, and VIP-22.

    **Historical source-oracle quotation repair (later rejected and withdrawn as redundant).** Spec-fix-b reports `5d59b28a0976`/bookmark33 changes only the stale normative quotation after the7ac source publication. All six negative cases, positive lexical control, source-derived2202 and12 known pending records remain. Focused Go now reaches those cases with12 known skips and no XPASS; regen/forms/spec/docs pass as attributed. This is neither compiler conformance nor a main/green-postmerge or separate nested-mask observation receipt.

    **Immutable-main quotation repair (9a7f385aa855).** The selected698-character `functions_spec_fuzz_test.go` diff changes only the stale source quotation; the case programs/assertions in that file remain untouched. The source owner identifies independently landed187eff99d94e as the equivalent quotation repair; overlappingB33/5d59b28a0976 was later rejected and withdrawn as redundant, so no copy relationship is claimed. This verifies source publication, not execution of pending cases, compiler behavior or a green postmerge. `root-main9a7-source-receipt.json` records the read.

### Detail 125

**Per-item jump restrictions cover head binding initialization as well as the loop body.** (live `002-loop-head-outward-return`; VIP-19/VIP-20, detail 48.) A source-function return in a `for concurrent` head's per-item defaults/computed binding keys is `EK1904`; the corresponding `for try` return is `EK2002`. Apply the existing per-item outward-jump restrictions to the entire head-initialization/body region, resolving nested source function boundaries independently. Do not discard the return as a callback result or invent cross-fiber return delivery. Limit and iterable/Stream operand evaluation remain in the enclosing activation, before item work, so a `do` return there keeps its ordinary enclosing target. Preserve the pinned do proposal's independent break/continue early errors in heads.
    **Immutable-main source receipt (54182a, 125).** Immutable main `54182a644026` contains the whole head-initialization/body region scope and jump checks in002 plus public VIP19/20 (history `d2f2bc108caf`); nested source functions/limit/RHS retain their own source targets. Source landing only, not compiler conformance.
    Status: applied in 8e5d16b01847 (spec-fix-b; queue accepted/held, not a main receipt). Replaces1ecc6d7f52ee with explicit limit-before-head environment, full initialization/body checks, and public VIP-19/20 amendments; Node6/Bun6 and strict5.9.3 pass.
    Status: applied in 1ecc6d7f52ee (spec-fix-b; queued, not yet a main landing receipt).
    ```vibe
    for concurrent (const { n = do { return 7 } } of rows) {} // EK1904
    for try (const { n = do { return 7 } } of stream) {}      // EK2002
    for concurrent(do { return 7 }) (const n of rows) {}     // returns before launching work
    ```
    Effect TS: per-item initialization belongs to the `Effect.forEach`/`Stream.runForEachWhile` callback, whose return protocol cannot carry an enclosing-function return; operand evaluation precedes those calls. Decided by the agent from VIP-19/VIP-20's no-outward-return rule, principle 4 (one restriction for the whole per-item source region), and principle 8 (reject an unsupported cross-fiber exit), 2026-10-29. Apply to 002's tables/region rule and Appendix B; no new diagnostic code.

    **Concurrent head mask boundary (Sol round25 M3).** The same per-item boundary also covers existing non-jump restrictions: a `restore` in a `for concurrent` binding default/computed-key initializer is `EK2202` under detail 51a, just as in its body, regardless of concurrency limit. It may not silently target the caller's mask because lowering put initialization in another callback. Limit/iterable expressions remain caller-side, so they keep any independently valid surrounding mask context. This is the already-decided source boundary from VIP-19/VIP-22 applied consistently, not a new restore form or a new per-item callback protocol. Decided by the agent from details 51a/109/125, principles 2 and 4, 2026-10-30.

### Detail 131

**The Hack pipe's missing-topic early error checks its AssignmentExpression child.** (live `900-pipe-body-early-error`; VIP-23 pinned snapshot reconciliation.) For `PipeBody : AssignmentExpression`, reject when that AssignmentExpression's `ContainsOuterTopic` is false, not when the wrapping PipeBody's is false. Keep `ContainsOuterTopic(PipeBody) = false` to stop a nested pipeline's topic from satisfying the outer one. The original printed early error otherwise rejects every accepted pipe. Record the erratum in the vendored README, 002 and Appendix A; keep the upstream spec.html unchanged.
    **Immutable-main source receipt (695576, 131).** Verified at immutable main `695576acb44b`: 002/AppendixA and the pipe snapshot README apply the missing-topic check to the AssignmentExpression child while preserving nested topic boundaries. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in cb3692683d7d (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const a = 1 |> % + 1       // ok: 2
    const b = 1 |> f()         // syntax error: missing topic
    const c = 1 |> (2 |> % + 1) // syntax error: outer pipe has no topic
    ```
    Effect TS: for the admitted example `const a = 1 + 1`, with a hygienic topic temporary for a general left operand. Decided by the agent from VIP-23's accepted topic-bearing examples and nested-call meaning, principle 2 (syntax-directed operation applied to its intended child), and principle 4 (repair the mistaken node rather than special-case all valid pipelines), 2026-10-29. No new topic scope is introduced.

Landing receipt: source cb3692683d7d landed in main 695576acb44b (queue 1793370871-spec-fix-a, gate mq-10302026-7).

### Detail 136

**Transparent regions preserve normal completion values and distinguish empty from undefined.** (live `002-region-normal-completion`; VIP-2/VIP-12/VIP-22.) `provide`, `uninterruptible`, `restore` and `interruptible` are source-transparent ordinary blocks. Extend their completion records (or an equivalent hygienic value tracker) to carry a normal completion's value and whether it is empty. A real value `undefined` differs from empty. Transfer that completion to the surrounding source expression only after the region Effect and its finalizers succeed; failure/defect/interruption transfers none. The enclosing do applies the pinned StatementList/UpdateEmpty semantics: an empty normal completion retains the previous statement-list value. Return/break/continue retain their existing value/target records.
    **Immutable-main source scope (d0cdbe, 136).** 002/008 and VIP2/12/22/31 preserve source completion values, empty values and targets through transparent regions; implementation transport stays private. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in 804106b55fb6 (spec-fix-b; queue accepted, now held for diagnostic alignment, not a main landing receipt). Supersedes the source in c9df09482a10; preserves source types/completions plus original generator payloads and public VIP-12/22/31 amendments.
    Status: applied in c9df09482a10 (spec-fix-b; queued, not yet a main landing receipt). Public VIP amendments are included.
    Representation clarification: detail 217 supersedes this item's displayed record-as-Effect-success recipe. Its source completion/Empty/UpdateEmpty guarantee remains required; primitive observers must not see compiler carriers.
    ```vibe
    effect function a() { return do { uninterruptible { 7 } } }    // 7
    effect function b() { return do { 5; uninterruptible {} } }    // 5
    effect function c() { return do { 5; uninterruptible { undefined } } } // undefined
    ```
    Effect TS: execute the region via its existing Effect function, returning e.g. `{ _tag: "Normal", hasValue: true, value: 7 }` or `{ _tag: "Normal", hasValue: false }`; then update the source do's completion tracker. Source syntax-directed do checks traverse each transparent region's block as an ordinary BlockStatement, respecting actual nested source function boundaries, never the generated callback boundary. Per-item loops keep their separate discarded-result/jump rules. Decided by the agent from VIP-2's exact do semantics, VIP-12/VIP-22's ordinary-block control flow and principle 2 (ECMAScript Completion/UpdateEmpty), 2026-10-30. Choosing void regions would discard the already-promised ordinary-block completion and is not adopted.

### Detail 145

**Pipe evaluation follows the declared ShortCircuitExpression production.** (live `002-pipe-evaluation-production`; VIP-23 snapshot reconciliation, alongside detail 131.) Keep the snapshot's declared `PipeExpression : ShortCircuitExpression |> PipeBody` syntax. Attach Evaluation to that production and evaluate its actual ShortCircuitExpression child once, then GetValue and the existing EvaluateWithTopics operation. The printed evaluator's ConditionalExpression child is a stale production reference, not permission to change pipe precedence. Keep topic scope and the missing-topic early error unchanged.
    **Immutable-main source receipt (695576, 145).** Verified at immutable main `695576acb44b`: 002/AppendixA and the pipe snapshot README evaluate the actual ShortCircuitExpression input once, preserving conditional precedence. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in cb3692683d7d (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const a = true ? 1 : 2 |> % + 10   // 1: only the alternate is piped
    const b = (true ? 1 : 2) |> % + 10 // 11: parenthesized whole conditional is piped
    ```
    Effect TS: `const a = true ? 1 : 2 + 10; const b = (true ? 1 : 2) + 10`, with hygienic once-only topic temporaries for general operands. Decided by the agent from VIP-23's adopted grammar, principle 2 (an evaluator operates on children its production defines), and principle 4 (correct the stale evaluator head rather than introduce a second grammar), 2026-10-30. List the erratum in the snapshot README, 002 and Appendix A; keep the upstream HTML unchanged.

Landing receipt: source cb3692683d7d landed in main 695576acb44b (queue 1793370871-spec-fix-a, gate mq-10302026-7).

### Detail 156

**GetPrimaryTopicValue reads the topic environment it just acquired.** (live `002-pipe-topic-environment-read`; VIP-23 snapshot reconciliation.) Read topicEnv.[[TopicValues]] after GetTopicEnvironment returns and validates topicEnv; the printed envRec name belongs to a separate operation and is not in scope here. Keep existing topic lookup, binding and nested-pipeline scope unchanged. Record this local-name erratum alongside details 131/145 in README/002/Appendix A; retain the upstream HTML.
    **Immutable-main source receipt (695576, 156).** Verified at immutable main `695576acb44b`: 002/AppendixA and the snapshot README read the acquired topicEnv instead of the stale unbound envRec. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in cb3692683d7d (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const n = 7 |> % // 7
    const same = obj |> % === obj // true, without reevaluating obj
    ```
    Effect TS: bind the input value once to a fresh topic temporary and read that same value at each permitted topic reference. Decided by the agent from VIP-23's once-bound topic meaning, principle 2 (an abstract operation uses its own bound variables), and principle 4 (correct the local name rather than invent another environment), 2026-10-30.

Landing receipt: source cb3692683d7d landed in main 695576acb44b (queue 1793370871-spec-fix-a, gate mq-10302026-7).

### Detail 157

**The incorporated pipe punctuators retain TypeScript's binary XOR token.** (live `002-pipe-xor-punctuator`; VIP-23 snapshot erratum.) Keep ^ alongside ^= in the lexical inventory. The vendored OtherPunctuator table's duplicated % does not remove the existing XOR operator from TypeScript. Retain % as modulo and as the topic where pipe syntax permits it; no arithmetic/operator meaning changes. Document the table correction in README/002/Appendix A without editing upstream HTML.
    **Immutable-main source receipt (695576, 157).** Verified at immutable main `695576acb44b`: 002/AppendixA and the snapshot README retain native XOR/XOR-assignment and topic-versus-modulo roles. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in cb3692683d7d (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const a = 1 ^ 3 // 2
    let b = 1; b ^= 3 // 2
    const c = 7 |> % % 4 // 3: topic followed by modulo
    ```
    Effect TS: the same native XOR, XOR-assignment and modulo expressions with one topic temporary for the pipe. Decided by the agent from principle 2 (unchanged TypeScript operators), VIP-23's additive Hack pipe decision, and principle 4 (repair a token-table omission, no new exception), 2026-10-30.

Landing receipt: source cb3692683d7d landed in main 695576acb44b (queue 1793370871-spec-fix-a, gate mq-10302026-7).

### Detail 170

**Pipe syntax is reachable from ShortCircuitExpression, with left-associated unparenthesized chains.** (live `900-pipe-grammar-entry`; VIP-23 snapshot reconciliation, extends details 131/145.) Add `PipeExpression[?In, ?Yield, ?Await]` to the effective `ShortCircuitExpression` alternatives alongside LogicalORExpression, CoalesceExpression and the effect-context CatchExpression. Keep the pinned `PipeExpression : ShortCircuitExpression |> PipeBody` and `PipeBody : AssignmentExpression`, carrying the enclosing VibeLang grammar parameters consistently. Extend the existing PipeBody covering-production early errors to reject a body whose whole unparenthesized expression is a `PipeExpression`. This excludes the right-associated alternative of an unparenthesized chain, leaving its unique sequential left-associated derivation. A parenthesized nested pipe remains allowed, with the pinned separate topic environment. The restriction concerns the whole body: do not ban every nested occurrence of a pipe. Retain detail 131's missing-topic correction, detail 145's evaluator on the actual ShortCircuitExpression child, and the existing conditional/yield/assignment/arrow restrictions.
    **Immutable-main source receipt (695576, 170).** Verified at immutable main `695576acb44b`: 002/AppendixA and the snapshot README provide a reachable ShortCircuitExpression pipe entry, sequential left-associated chains and explicit nested topic scopes. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in cb3692683d7d (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const one = 1 |> % + 1 // 2
    const chain = 1 |> % + 1 |> % * 2 // 4: (1 |> % + 1) |> % * 2
    const nested = 1 |> (% + 1 |> % * 2) // 4: explicit nested pipe, separate topic scopes
    ```
    Effect TS: `const t1 = 1; const t2 = t1 + 1; const chain = t2 * 2`; for explicit nesting, bind the outer topic once, compute the nested input from it, then bind the inner topic once. Decided by the agent from VIP-23's accepted sequential temporary counterpart, principle 2 (the pinned ShortCircuitExpression precedence and topic environments), and principle 4 (one reachable grammar with one chain derivation), 2026-10-30. This repairs the missing grammar reference and ambiguity rather than selecting a new operator meaning. Reconcile Appendix A, 002 and the vendored README while retaining upstream `spec.html`. Add one-stage, multi-stage, parenthesized-nesting and conditional-precedence witnesses; a reduced atom/pipe derivation probe is evidence for that fragment, not a full-language ambiguity proof.

Landing receipt: source cb3692683d7d landed in main 695576acb44b (queue 1793370871-spec-fix-a, gate mq-10302026-7).

### Detail 177

**An empty switch case block is false in the do-ending early-error predicate.** (live `900-do-empty-switch`; VIP-2 pinned-draft reconciliation.) Define `EndsInIterationOrBareIfOrDeclaration` for `CaseBlock : { }` to return `false` for either value of `isLast` and any `labelSet`, just as the operation already returns false for an empty ordinary block. This supplies the missing zero-child production; implicit chain-production forwarding cannot supply it. Do not skip the operation only for a final statement: the statement-list prefix is checked with `isLast = false` too. Retain ordinary switch evaluation/completion and the existing forbidden loop/declaration/bare-if endings. An empty switch does not itself supply a value; its ordinary normal completion is `undefined` where the switch algorithm supplies it.
    **Current do-predicate conflict-repair source (ddcc0580).** Source `ddcc0580e1e6` is reported queued by spec-fix-a, superseding rejected `3d60171bb38d`. It retains both the complete empty-switch and added-loop static predicates/publicVIP2 amendment while preserving current main's call evaluation/source naming. Seven focused checks, exact strictTypeScript,43citations, regeneration/docs/tokens and the four-package spec target (30selected,27active passes,3retired skips) are attributed passes. No matching ORIGINS Circle, main landing or compiler conformance is claimed. Earlier29-target selection evidence remains historical rather than being silently reused as the current count.
    Status: applied in fdb225af998c (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const value = do { switch (0) {} 7 } // 7
    const empty = do { switch (0) {} }   // undefined
    ```
    Effect TS: the first is a same-activation statement sequence `switch (0) {}; return 7`, while the second ends after the empty switch and returns `undefined`; no new Effect operation is involved. Decided by the agent from VIP-2's admission of ordinary TypeScript statements inside `do`, principle 2 (the existing ECMAScript empty case-block production/completion), and principle 4 (one explicit false base case alongside the operation's empty-block case), 2026-10-30. State the reconciliation in the do snapshot README, 002 and Appendix A without editing upstream `spec.emu`. Evidence: `decide-live-scratch/root-do-empty-switch-reference.log` confirms the pinned predicate has neither an empty nor optional-no-default CaseBlock rule and records `Success(7)` from the ordinary-statement Effect `4.1.0` counterpart. Add both final/nonfinal witnesses; this is static-algorithm/reference evidence, not native-do or VibeLang compiler conformance.

**Replacement source queued:** 3fbdc9cdd5d3 (same bookmark9) supersedes rejectedfdb225af998c after rebasing onto main d50d73b32354. All three final tests fail against immutable raw-main inputs and six focused/grammar checks pass after; strict TypeScript5.9.3 and Effect4.1.0 controls pass. Fresh29 selected spec/cost functions, regen183/docs9/tokens/forms pass, no moved decisions. The repaired source preserves the current completion prose and explicitly acknowledges the snapshot reconciliations. ORIGINS grep finds no predicate/empty-switch Circle; earlier jump-target circles are outside this rule. Evidence do-predicates-refresh-* in spec-fix-a-scratch. This is queued source/native-reference evidence, not a main or compiler-emission receipt.

**Earlier complete replacement receipt (before corrected `ddcc0580e1e6`):** 3d60171bb38d (bookmark9) supersedes3fbdc9cdd5d3 and the original rejectedfdb225af998c. Includes the explicit public VIP2 static-predicate amendment required under213. Four final regressions fail on immutable raw main d50; seven focused/grammar checks pass after. Strict TS5.9.3/Effect4.1 controls, regen183/docs9/tokens/forms pass with no form moves. Final Go selection29 exits0 on daf7ddaa51ff:26 top-level passes,3 explicitly retired legacy-oracle skips, plus one intentional superseded fixture subtest skip; native worker dependencies are required. Earlier all29 wording meant the configured target exit0, not29 executed passes. No tests/gates were weakened. Rebased onto fetched f10f3e12c5bb with only generated token conflicts, regenerated and repeated focused7/docs9/tokens before enqueue. Evidence do-predicates-publication-* and final-spec-receipt.json. Queued source/native-reference receipt only; no main or compiler-conformance claim.

### Detail 182

**The added for loops use the native iteration rules in the do static predicates.** (live `002-do-iteration-predicate`; VIP-2/VIP-19/VIP-20 integration, distinct from detail 177's empty switch.) Define `EndsInIterationOrBareIfOrDeclaration` explicitly for every `ForTry` and `ForConcurrent` production: if `isLast` is true, return true; otherwise if `IsBreak` of its body Statement with the same `labelSet` is true, return true; otherwise recurse into that body with the same `labelSet` and `isLast`. These are the pinned native iteration steps, including the nonfinal body traversal; a blanket false fallback is insufficient. The added iteration statement itself has `IsEmpty = false` and `IsBreak = false`, matching native loop statements. Carry existing grammar parameters and loop jump restrictions unchanged. No implicit one-child forwarding exists for these multi-child productions.
    **Current do-predicate conflict-repair source (ddcc0580).** Source `ddcc0580e1e6` is reported queued by spec-fix-a, superseding rejected `3d60171bb38d`. It retains both the complete empty-switch and added-loop static predicates/publicVIP2 amendment while preserving current main's call evaluation/source naming. Seven focused checks, exact strictTypeScript,43citations, regeneration/docs/tokens and the four-package spec target (30selected,27active passes,3retired skips) are attributed passes. No matching ORIGINS Circle, main landing or compiler conformance is claimed. Earlier29-target selection evidence remains historical rather than being silently reused as the current count.
    Status: applied in fdb225af998c (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    effect function first(rows: Stream.Stream<number>) {
      return do { for try (const row of rows) {} 7 } // succeeds with 7
    }
    effect function second(rows: number[]) {
      return do { for concurrent (const row of rows) {} 7 } // succeeds with 7
    }
    // do { for try (const row of rows) {} } and final for concurrent are early errors, like a final native loop.
    ```
    Effect TS: run the existing `Stream.runForEachWhile` or `Effect.forEach(..., { concurrency, discard: true })` counterpart, discard its item results, then return `7`. Decided by the agent from VIP-2's adopted prohibition on iteration endings, principle 2 (the pinned native-loop predicate and IsEmpty/IsBreak behavior), and principle 4 (one iteration classification for native and added loop statements), 2026-10-30. Reconcile the do snapshot README, 002 and Appendix A without modifying upstream `spec.emu`; cover both nonfinal successes and final-loop rejection, plus required body traversal. `decide-live-scratch/root-do-iteration-reference.log` verifies the missing multi-child cases, the primary ECMAScript chain-production definition and both `Success(7)` Effect `4.1.0` counterparts. This is static-algorithm/reference evidence, not native-do or VibeLang compiler conformance.

**Replacement source queued:** 3fbdc9cdd5d3 (same bookmark9) supersedes rejectedfdb225af998c after rebasing onto main d50d73b32354. All three final tests fail against immutable raw-main inputs and six focused/grammar checks pass after; strict TypeScript5.9.3 and Effect4.1.0 controls pass. Fresh29 selected spec/cost functions, regen183/docs9/tokens/forms pass, no moved decisions. The repaired source preserves the current completion prose and explicitly acknowledges the snapshot reconciliations. ORIGINS grep finds no predicate/empty-switch Circle; earlier jump-target circles are outside this rule. Evidence do-predicates-refresh-* in spec-fix-a-scratch. This is queued source/native-reference evidence, not a main or compiler-emission receipt.

**Earlier complete replacement receipt (before corrected `ddcc0580e1e6`):** 3d60171bb38d (bookmark9) supersedes3fbdc9cdd5d3 and the original rejectedfdb225af998c. Includes the explicit public VIP2 static-predicate amendment required under213. Four final regressions fail on immutable raw main d50; seven focused/grammar checks pass after. Strict TS5.9.3/Effect4.1 controls, regen183/docs9/tokens/forms pass with no form moves. Final Go selection29 exits0 on daf7ddaa51ff:26 top-level passes,3 explicitly retired legacy-oracle skips, plus one intentional superseded fixture subtest skip; native worker dependencies are required. Earlier all29 wording meant the configured target exit0, not29 executed passes. No tests/gates were weakened. Rebased onto fetched f10f3e12c5bb with only generated token conflicts, regenerated and repeated focused7/docs9/tokens before enqueue. Evidence do-predicates-publication-* and final-spec-receipt.json. Queued source/native-reference receipt only; no main or compiler-conformance claim.

### Detail 192

**A do expression uses source completion-value typing with ordinary expression literal treatment (class B, timed default A applied).** (live `002-do-result-type`; timed default A applied; originally class B because VIP-2's untyped runtime algorithm does not select literal-preserving expression typing over return-style widening.) Applied A: compute the type from the values that can reach a normal completion of the source do block, following its actual ECMAScript value/empty/UpdateEmpty flow, including handled local jumps. Union the normal value alternatives. Convert a final empty normal completion to `undefined`; do not add undefined merely because a statement's empty completion inherited an earlier value. A path leaving outward by return/throw/break/continue supplies no normal do value; if no normal path remains the expression type is `never`. Its outward return/typed failure is still checked and inferred at the enclosing activation under the existing rules. No generated function boundary is introduced.
    **Immutable-main source scope (d0cdbe, 192).** 002/VIP2 publish source UpdateEmpty completion typing, ordinary fresh literal/const/let treatment and never for no normal path. This publishes the resolved A default, not compiler admission. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in 804106b55fb6 (spec-fix-b; queue accepted, now held for diagnostic alignment, not a main landing receipt). Supersedes the source in c9df09482a10; preserves source types/completions plus original generator payloads and public VIP-12/22/31 amendments.
    Status: applied in c9df09482a10 (spec-fix-b; queued, not yet a main landing receipt). Public VIP amendments are included.
    ```vibe
    const exact = do { 1 } // A: type 1; B: number under uncontextualized return-style widening
    let ordinary = do { 1 } // A: number, from ordinary TypeScript let widening
    const checked: number = do { 1 } // declared/contextual type follows TypeScript
    ```
    Under A, contextual typing applies to expression alternatives whose values can reach the do result as it does for conditional/match result alternatives; intermediate discarded expressions and outward return expressions retain their own source contexts. Preserve the usual fresh-literal behavior through the source do node: an uncontextualized const initializer above retains `1`, a let initializer widens normally, and written annotations/const assertions obey normal TypeScript rules. Generated temporaries must not choose the source type or overload. Emit declarations from this source-level type. Alternative B applies ordinary function-return-style widening to the collected normal values, while preserving the same empty/abrupt/runtime rules.
    Effect TS: runtime `do { 1 }` is an immediate evaluation of `1`; a source-level const initialized with that literal has type `1`, while `let tmp; tmp = 1; const result = tmp` has type `number`. With overloads `pick(1): Effect.Effect<number>` and `pick(number): Promise<number>`, those types select different signatures even though both values are 1. **Timed default A applied effective 2026-10-30 09:00 PT; processed 2026-10-30T16:00:22.159322+00:00. No Will answer was recorded at handling**. Recommended by the agent on 2026-10-30 because A matches expression alternatives and detail 79's match-result model and keeps emitter choices out of static dispatch. Class B is justified: TypeScript has no native do-expression typing rule, VIP-2 supplies runtime completions rather than this static policy, neither overload-sensitive alternative is uniformly more conservative, and choosing one can change a callable's selected type/declaration. This is not a request to reconfirm the settled runtime behavior. Add the chosen rule to 002/VIP-2 and expression-lowering contracts, with const/let/contextual, branch, empty, abrupt-only and overload witnesses. `do-result-type-reference.log` passes strict TypeScript with expected-error checks distinguishing literal versus temporary types and Effect versus Promise overloads. Existing parser representation as an invoked arrow is implementation evidence, not authority to infer a source rule. No VibeLang compiler typing result is claimed.



    **192 current contextual-result application, decide-live, 2026-11-02.** The settled A policy applies through `do` to a surrounding return annotation, annotated binding, call parameter and match result. Give only the normal-result alternatives their actual source context; do not first widen object discriminants through an uncontextualized generated return/temporary. Discarded intermediate expressions and outward returns keep their own contexts.

    ```vibe
    type Selection =
      | { readonly _tag: "SelectedEdge"; readonly value: number }
      | { readonly _tag: "IgnoredEdge"; readonly reason: "GuardFailed" }
    function select(condition: boolean): Selection {
      return do {
        ({ _tag: "Unrelated" })
        condition
          ? { _tag: "SelectedEdge", value: 1 }
          : { _tag: "IgnoredEdge", reason: "GuardFailed" }
      }
    }
    ```

    Effect TS: the same plain function and `Selection` type, evaluating `({ _tag: "Unrelated" });` then returning the conditional expression directly. The return context preserves the two literal tags; it does not require the discarded object's tag to inhabit `Selection`. This is an illustration of existing192, not a new static policy or permission to add casts/const assertions.

    Own primary postmerge receipt for `c9b86d733a10` is RED at17:17:51Z: `TestDoContextualResult` names25 failing variants. All25 diagnostic first lines and the first complete fixture were read:20 `TS2322` reports and five call-argument `TS2345` reports expose `_tag: string` instead of the required literal tags. This records compiler diagnostics, not execution of rejected programs or a proven code-level cause. The graph contains prefixed streaming output and an unprefixed complete copy; those were deduplicated, with no invented log truncation. Existing claims identify fuzz-findings and `main-red-docontext`; this lane starts no competing repair. Preserve the failing regression and neighbourhood under the accepted source rule. There is no new Will question, reversal of the applied default, numbered decision or root compiler/gate execution.

### Detail 198

**A `do` or `match` runs where JavaScript evaluates the expression that holds it.** (Replaces chapter 2's expression-lowering recipe.) Everything to its left runs first, in source order, callee and receiver included. How the compiler keeps this is its choice. Decided by the agent from the same reasoning as 68c, 2026-10-30.
    **Immutable-main source scope (59c774, 198).** 002/publicVIP2 preserve native call references, receiver/callee/argument order and abrupt/noncallable errors without observable helper lookup. The illustrative mutable-global Reflect.apply recipe is replaced by a native call expression; no compiler emitter implementation/conformance is certified. `main-59c-source-receipt.json` records the complete five-file read; no own compiler/gate/native rerun.

    Main receipt (spec-fix-b): 81a494b2a537 landed in59c77493d848; source verified on fetched main and native/spec/docs/forms proofs retained. This is not a compiler-conformance or all-green postmerge claim.
    Partial source receipt: the normative ordering paragraph is present at main12d6a3b9ce5e, as revalidated by spec-fix-c. The concrete `total` counterpart at 002 line266 still invokes source-resolved mutable `Reflect.apply`; Sol r21/r22/r23 M1 therefore remains a source defect. `main-total-order-receipt.json` independently checks the immutable main source. This is not completed counterpart delivery or compiler-conformance evidence.

    **Round26 native-call source receipt:** spec-fix-b reports `792e2c7347ee` queue-accepted for the actual native call counterpart and a public VIP-2 amendment. The original `total` example is still present at independently fetched main `b0387e3558d9`; the source repair is therefore queued, not verified landed. Fixer validation is attributed to live `002-reflect-apply-call-mapping`; decide-live did not run those regressions or query the queue.

    **JSX prefix order for an outward-jumping `do` (Loop r4 Opus OPUS-5, existing198/VIP-2 plus acceptedVIP-39).** A JSX container creates no source function boundary. If an outward-jumping `do` must be materialized as statements, first preserve every source evaluation that precedes it, including tag/receiver reads, earlier attributes, spreads and earlier children, with their order, once-only evaluation and abrupt completions. Then execute the `do` and its jump; do not move it alone ahead of that prefix. In `preserve`/`react-native` output, the materialized prefix is passed as values, so an earlier property read in this witness is a snapshot rather than a framework's later reactive getter. That follows VIP-2's existing source jump/order contract, not a promise to preserve framework-specific laziness for a construct with no native `.tsx` outward-jump expression. Do not mandate unrelated hoisting where the existing lowering can preserve the source position and context.
    ```vibex
    function f(props: { a: number }, c: boolean) {
      return <Box a={props.a} v={do { if (c) return 7; 1 }} />
    }
    ```
    Effect TS for this minimized plain-function witness: `function f(props: { a: number }, c: boolean) { const Box0 = Box; const a0 = props.a; if (c) return 7; const v0 = 1; return <Box0 a={a0} v={v0}/> }`, with fresh hygienic helper names and the ordinary native JSX emit thereafter. This is a bounded counterpart, not an algorithm for all JSX constructs. Decided by the agent from existing198/VIP-2's everything-to-the-left-first rule and VIP-39's transparent containers, principle4 (one source-order rule, no JSX jump protocol), 2026-10-31. Reuses198, no new number or IIFE/function boundary. Add source-order/abrupt/once-only and prefix-getter/spread/child controls plus spec-quoted fuzz mutations across preserved/transformed modes; no compiler/framework behavior was tested here.

### Detail 199

**`fork` evaluates its operand on the caller, and its quick fix keeps it there.** (Replaces the fix text of 99, 105 and 161, with 161's Exit.) The fix for `fork e catch h` is `fork Effect.catch(e, ($e) => Effect.succeed(h($e)))`, or `fork Effect.catch(e, h)` for an `effect` handler: no temporary, source order kept for `fork.in`, valid in any expression position.
    ```vibe
    const c = fork Effect.catch(worker(try id()), (e) => Effect.succeed(recover(e)))
    ```
    Effect TS: `yield* Effect.forkChild(Effect.catch(worker(yield* id()), (e) => Effect.succeed(recover(e))))`. Decided by the agent from Will's mapping (`fork e` is starting a Promise without awaiting it) and detail 161's intent, 2026-10-30.

### Detail 216

**Class field and enum initializers reset the enclosing Effect context; static blocks do not execute Effects.** (Opus round24 corrected M3/m30; VIP-1/VIP-5/VIP-17; detail 32.) Mirror the pinned TypeScript parser's own source boundaries: a class field initializer and an enum member initializer are outside the enclosing Effect execution and contextual-keyword reservation context. Thus a `join(...)`/`fork(...)` there can call a source identifier even when the class/enum is written inside an effect function; it does not execute VibeLang's fiber operator. Explicit `try e`/fiber-execution syntax there retains the existing outside-effect diagnostic (`EK0501`/`EK1701` through recovery), and there is no implicit async or Effect initializer. Class heritage and computed class element names still evaluate in their enclosing source context, separately from the field initializer. Plain source method/function boundaries still reset context, and a nested explicit Effect callable/block creates its own normal context.
    **Immutable-main source scope (d0cdbe, 216).** 001/002/AppendixA/VIP17 publish source field/enum reset, contextual static-block reservation and separate execution permission. Later service-default235 application remains separate. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in 554f60ee7e77 (spec-fix-a; queued, not yet a main landing receipt). One source parsing/reservation/execution rule, public VIP-17 amendment and examples with Success([2,3,7]); ordinary TypeScript computed-field restrictions retained. Nine parser controls, eight strict fixtures, the TS1166 field control, exact strict counterpart and all19 configured spec functions pass.
    Static blocks are also outside Effect execution. Preserve the accepted enclosing contextual reservation where Appendix A already propagates `+Effect`: a static block of a class written in that reserved source context cannot use a bare `join`/`fork` as an identifier call and receives `EK1701` for the recognized construct. In a plain source context with no enclosing Effect reservation, keep VIP-17's explicit outside-code identifier promise: an ordinary user `join`/`fork` in a static block remains an identifier. Do not copy ECMAScript's unconditional `+Await` static-block grammar into a new global `fork`/`join` ban; VIP-17 did not reserve these names throughout a module or every plain class. Qualify the claimed 'exactly ECMAScript Await' analogy accordingly: keyword reservation and permission to execute are separate, and source module classification does not globally reserve the two VibeLang words. This preserves the existing plain-call meaning and static-block reservation while correcting the field/enum reset, rather than introducing an unapproved global restriction.
    ```vibe
    import { join } from "./helpers.vibe"
    effect function build() {
      class C { value = join(1) } // ordinary imported call in the field initializer
      enum E { A = join(1) } // ordinary call; native enum type/constant rules still apply
      class D { static { join(1) } } // EK1701: enclosing Effect reservation, no static-block execution
    }
    class Plain { static { join(1) } } // ordinary identifier call under VIP-17
    effect function bad() { enum E { A = try task() } } // EK0501
    ```
    Effect TS: field/enum calls remain the source helper calls in ordinary generated initializer code; an enclosing Effect function returns `Effect.gen` without placing `yield*` into those initializers. Source fiber operations only lower inside a permitted Effect activation. Decided by the agent from VIP-1's async placement/boundary precedent, VIP-17/detail 32's contextual-only reservation and explicit outside-code identifiers, principle 2 (pinned TypeScript field/enum parsing), principle 4 (source boundaries before lowering), and principle 8 (no implicit initializer execution), 2026-10-30. TypeScript 5.9.3 `parsePropertyDeclaration` clears Yield/Await for the initializer; `parseEnumDeclaration` uses `doOutsideOfYieldAndAwaitContext`; static blocks set Await but cannot execute it. `root-await-class-reference.log` and forced-execution `root-await-class-force.log` show script field `await(1)` calls the ordinary identifier even inside an async function, while modules globally reserve await and static blocks reject it. `root-enum-await-reference.log` distinguishes ordinary identifier calls from an actual forbidden await operand. These are native parser/runtime references, not VibeLang conformance. Amend 001/002/Appendix A/VIP-17 consistently; supersede earlier panel recommendations that reserved field-initializer identifiers or proposed unconditional plain-class static reservation.


    **Native module await identifier receipt (Fable29).** The reviewer's TypeScript5.9.3 checker accepts an await-named parameter of a plain function in a module, including one nested in an async function. This is checker admission, not executable native-module proof: root-round29-await-identifier.log independently gets zero checker diagnostics, then Node rejects TypeScript's emitted .mjs with SyntaxError (expected negative check; stderr retained). Preserve the existing32/216 custom fork/join reset at a plain source callable; those ordinary JavaScript identifiers do not inherit the native module-wide await reservation. Do not infer a new VibeLang ban from ECMAScript's reserved await spelling, or claim the invalid native emit runs. This is reference-quality clarification only, with no new syntax, diagnostic or decision count.

Landing receipt: source 554f60ee7e77 landed in main d0cdbe5a0a7f (queue 1793386345-spec-fix-a, gate mq-10302149-2).

    **Catalog follow-up (decide-live; immutable main `969ea00c4aa3`).** The216 source boundary is published, but AppendixB's short `EK1702` row still limits its named-binding trigger to “effect code” and listed parameter contexts, while AppendixA explicitly excludes static blocks from effect execution. Align that row with002's existing `[+Effect]` reservation trigger, including inherited static blocks. For example, `effect function f() { class C { static { const join = 1 } } }` requires `EK1702`; a plain-context static block may still bind/call a helper named `join`, and an operation in a reserved static block remains `EK1701`. This is the already-settled216 rule, not a new prohibition or diagnostic allocation. The earlier source landing is valid for its published portions; it does not establish complete catalog alignment or compiler conformance. Existing `spec-fix-a` source ownership is retained; no source patch was made. `main-216-catalog-followup.json` preserves the exact contrasting main lines.

    **Immutable-main source publication (773bddb1d57f, 216).** Chapter 002 and Appendix B explicitly include reserved `fork`/`join` shorthand properties under existing `EK1702`, while property keys and member access remain names. This follows the already-published `await`-like reservation; it is not a new rule or VibeLang compiler proof. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.

### Detail 217

**Transparent-region completion transport is private; observers see the accepted generator payload.** (live `002-region-exit-payload`; VIP-12/VIP-22/VIP-31; clarifies 136 and supersedes only its record-as-Effect-success recipe.) Preserve the original `Effect.provide(Effect.gen(B), layer)`/interruption-region counterpart at every observable Effect/Scope boundary. A normally completed source region yields primitive Effect success `undefined`, even when its ordinary source block completion is `7`, another value, or Empty. A source `return v` that exits the region yields primitive success `v`, including a legitimate Effect or record-shaped object returned as data; bare return yields `undefined`. An outward source `break`/`continue` exits the region successfully with primitive payload `undefined`: neither is a source return, and its source completion value/target belongs to control flow, not the Effect success channel. Preserve that source completion separately, including Empty versus explicit `undefined` and UpdateEmpty values/labels, and reissue it only after the region and its Effect finalizers succeed. Normal source completion `7` can therefore make the enclosing `do` evaluate to `7` while the region layer's finalizer observes `Exit.succeed(undefined)`. Nested transparent regions obey the same rule individually; an outward `return v` crosses each still-active region with logical payload `v`, after inner finalizers have succeeded.
    **Immutable-main source scope (d0cdbe, 217).** 002/008 and VIP12/22/31 publish private source-completion transport with primitive observer payloads: normal/jumps undefined, returns their actual values, pending transfer only after successful finalization. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in 804106b55fb6 (spec-fix-b; queue accepted, now held for diagnostic alignment, not a main landing receipt). Supersedes the source in c9df09482a10; preserves source types/completions plus original generator payloads and public VIP-12/22/31 amendments.
    Do not expose `{ _tag: "Normal" }`, a hasValue/value carrier, a Return/Break/Continue record, or any other compiler control representation as the primitive success value. An equivalent hygienic per-execution tracker is allowed, but its identity, lifetime and reset must preserve cold reruns, reentrancy and per-item isolation; construction-time shared state cannot leak a prior run's completion. Do not identify compiler control by a user-visible string/tag shape or unwrap a real returned user object. Preserve source value identity, ordinary evaluation order and the original failure/defect/interruption Exit. A failing, dying or interrupted body/finalizer transfers no pending source completion; Effect's own finalization/error-combination/interruption rules decide the final Exit. Do not retrofit observer Exits after finalizers already saw a private carrier. The separate per-item native callback protocols (`for try` true/false; `for concurrent` discard) remain their own contracts: an inner transparent region completes before the enclosing callback emits that protocol result.
    ```vibe
    effect function normal() { return do { provide observed { 7 } } }
    // outer Success(7); observed layer finalizer sees Success(undefined)
    effect function early() { provide observed { return 7 } }
    // outer Success(7); observed layer finalizer sees Success(7)
    effect function stop() { outer: while (true) { provide observed { break outer } }; return 7 }
    // outer Success(7); observed layer finalizer sees Success(undefined)
    ```
    Effect TS: keep a hygienic source-completion tracker outside each region's body Effect. For normal `7`, record that source completion and let `Effect.gen(function* () { 7 })` fall through with `undefined`; for `return 7`, the body generator returns `7` and the caller reissues the source return after `yield* Effect.provide(...)`. For an outward jump, record its source target/value and return `undefined` from the body generator, then perform the source jump after the primitive finishes. This is an observational contract, not a prescribed record layout. Decided by the agent from VIP-12/VIP-22's original exact `Effect.gen(B)` counterpart, VIP-2/detail 136's already-promised source completion, principle 1 (idiomatic generator return versus fallthrough), principle 3 (only source return supplies the result, never a compiler record's spelling), and principle 4 (separate source control from the runtime API value), 2026-10-30. It is class A: choosing source normal-completion values or private records as primitive success would change the accepted counterpart's finalizer observations; preserving it requires no new Will choice. `root-region-exit-reference.log` has 22 asserted Effect4.1 controls: leaking-record versus out-of-band observations for eight source-completion models, real returned record identity, body/finalizer failure suppression, and nested normal/return observations. Break/continue controls are the chosen source reconciliation model, not execution of native VibeLang jumps. The fixer's independently read `region-release-values.log` shows all four outer Success(7) results with four different finalizer payloads. Add public VIP amendments per213 and 002/008 paired observer examples; no compiler-conformance or landing claim is made here.

### Detail 221

**Dynamic `import()` keeps native Promise failure timing and the explicit Effect bridge.** (Opus round27 m38; VIP-4; details74/89/219.) In Effect code a dynamic `import(specifier, options?)` is subject to `EK0404` under the existing Promise-result predicate, independently of whether the import can reject. Add `import()` explicitly to the prose/catalog invocation list; TypeScript5.9.3 actually represents this intrinsic as a `CallExpression` with `ImportKeyword`, not a distinct node outside call checking. The intrinsic import operation's own synchronous thrown type is `never`: loading, linking, evaluation and specifier-coercion failures follow native rejected-Promise behavior. Independently evaluated source argument expressions keep their existing thrown contracts and source evaluation order; do not erase a synchronous throw from evaluating `makeSpecifier()` merely because its consumer is `import()`. An explicit `tryPromise` thunk encloses the complete native import expression, including its arguments, once per execution. This neither auto-runs an import nor changes native async/plain-function rules. Static import declarations and type-only `import(...)` queries are not runtime import expressions. Existing literal specifier bans (detail74/VIP33) stay independent; bridging does not admit a forbidden module or a literal `data:`/`blob:` program.
    Current source replacement: `33b84089aed0` is fixer-reported queued on `daf7ddaa51ff`, superseding rejected `0609b6610a2d` through the guarded queue API. It preserves main’s async contracts, tagged-template and eager-handler rules. Node5/Bun5, 183 kernel cases, regeneration/forms/spec/docs checks are attributed to spec-fix-b; no main landing or own compiler/native rerun is claimed.
    Earlier source verification: superseded/rejected `0609b6610a2d` (spec-fix-b; checked on earlier aligned main `e0671f94`; this is historical, not the replacement base). Public003/AppendixB/VIP-4 reconciliation; Node2/Bun2, strict TS5.9.3 AST/runtime-import/type-query checks, native Node/Bun all failure-phase controls; regeneration/forms/spec/docs pass after rebase.
    ```vibe
    effect function bad() { const module = import("./worker.js") } // EK0404: Promise-producing runtime invocation
    effect function good() { return try tryPromise(() => import("./worker.js")) }
    type Worker = typeof import("./worker.js") // a type query, no runtime invocation
    ```
    Effect TS: `Effect.gen(function* () { return yield* Effect.tryPromise(() => import("./worker.js")) })`. Decided by the agent from VIP-4's always-explicit Promise bridge, principle2 (native dynamic-import Promise and evaluation semantics), principle3 (intrinsic syntax rather than a spelling-resolved function), and principle4 (one Promise-result rule for runtime invocations), 2026-10-30. `root-round27-reference.log` passes strict TypeScript5.9.3 AST/type/signature checks, an Effect4.1.0 import bridge returning the fixture's7, and a specifier-coercion failure that returns a Promise and rejects with the same marker exactly once. This is a native/reference receipt, not VibeLang compiler conformance or a landed source fix.

    **Argument-phase native control.** `root-round27-import-arguments.log` additionally passes native assertions that both a throwing specifier argument expression and a throwing options argument expression throw synchronously before the intrinsic import operation. This directly verifies the argument/operation distinction above; it is separate from the specifier object's coercion failure, which rejects the returned Promise.

    **Independent ImportCall operand-boundary receipt:** `round27-reference.log` checks a throwing specifier expression escapes synchronously before producing a Promise, while a throwing specifier `toString` rejects the returned Promise. `import-call-ecma-primary.txt` saves published ECMAScript2025 `EvaluateImportCall`: specifier/options Evaluation/GetValue precede PromiseCapability creation; later coercion/attribute failures use Promise rejection. The same batch confirms TypeScript CallExpression/ImportKeyword, bridge Success(7), and that `Effect.try` alone returns the Promise as data. Its initial contrary operand assertion failed and was corrected before any policy write; `round27-import-initial.log` preserves it. These independent native controls corroborate this rule, with no VibeLang test or new decision count.

    Applied in 4789b0de2693 (spec-fix-b source queued; no main landing receipt): complete import runtime/argument-phase clarification, published inventory preserved; Node5/Bun5, strict native, regen183/forms/spec/docs and Go quotations/coverage pass. Replaces rejected33b84089aed0 with guarded supersession.

    **221 dynamic-import lowering clarification, decide-live, 2026-11-02 (RC-36).** The runtime `ImportKeyword` is intrinsic syntax, not a first-class callee value. Lowering a `do` in either dynamic-import argument must retain the complete native `import(specifier, options?)` node and evaluate its arguments once in their source order. Never emit `const temporary = import` or replace the intrinsic with a captured function call. This applies the existing native plain/async guarantee and this detail's actual TypeScript AST identity; it adds no import form or permission.

    ```vibe
    export async function probe(): Promise<unknown> {
      const m = await import(do { "./dep.js" })
      return m.value
    }
    ```

    For this no-jump witness, the native TypeScript counterpart is `export async function probe(): Promise<unknown> { const m = await import((() => "./dep.js")()); return m.value }`. That illustrative plain arrow is not a general lowering recipe: preserve outward jumps, source callable context, argument exceptions, native Promise/coercion/attribute rejection timing, import contextual types and module checks. Source `super`, direct `eval` where a native boundary admits it, and dynamic `import` are each governed by their native syntax/identity, never an ordinary-call rewrite based only on their common AST category. This does not relax VIP-33's literal-module bans or its native-boundary requirement for `eval`.

    The review owner reports current `fe7b802fbf05` emits `const $do_t1 = import;` with compile exit0 and subsequent Node parse failure, while preceding `509a2110` and native controls execute the applicable witnesses. Cases cover specifier/options/both, async/plain/top-level and hoisted/typed-arrow controls. Its27 compiler calls and25 runtime attempts are attributed receipts, not this lane's execution or a full-suite claim. A secondary unannotated callback error and a pre-flip inferred-Effect callback control remain separated. Queued `971c7f13b2c4` still has the super-only exclusion and is not proof of this repair. Owners chapter002/impl-hunt-run, core-block and chapter003 retain the failing-main regression, keyed corpus and spec-quoted neighbourhood fuzz for those contexts, outer jumps, argument failures, import attributes and unchanged native calls. No compiler/source-test edit, new diagnostic, new detail or Will question here.

    Decided by the agent from existing221, accepted VIP-2's source-position `do` semantics, `002-running.md`'s native evaluation rule, principle2 (mirror TypeScript/ECMAScript) and principle3 (syntax and intrinsic identity), 2026-11-02 under the 2026-10-29 delegation. Source: `loop/scoped/rev-compiler/FINDINGS.md` pass124/`002:do-dynamic-import-callee`, `pass124-dynamic-import.json`, `pass124-import-matrix.json` and `pass124-import-corrections.json`.

### Detail 238

**A pipe is never an unparenthesized conditional test.** (Opus r31 M9; VIP-23 pinned explainer precedence; extends details 145/170.) Keep detail 170: `PipeExpression` stays a `ShortCircuitExpression` alternative and chains stay left-associated. Add one early error: in `ConditionalExpression : ShortCircuitExpression ? AssignmentExpression : AssignmentExpression`, it is a Syntax Error if the `ShortCircuitExpression` is an unparenthesized `PipeExpression`. The pinned explainer gives `|>` the precedence of `=>`, assignment and `yield`, looser than `?:`, and rejects a conditional as a pipe head or body. Babel 7.29.11 and 8.0.4 (Hack pipes, `%`) reject `x |> f(%) ? 1 : 2` with "Hack-style pipe body cannot be an unparenthesized conditional expression". With this error the program has one answer, a syntax error, and 002 "not a change of precedence" becomes true. Unchanged: a pipe inside either branch (`c ? x |> % : y`, `c ? a : b |> % + 10`, detail 145), a parenthesized test and a parenthesized body. It is the syntax error `EK2301`, like the pinned pipe early errors (detail 247).
    ```vibe
    const a = x |> f(%) ? 1 : 2     // syntax error: write (x |> f(%)) ? 1 : 2 or x |> (f(%) ? 1 : 2)
    const b = (x |> f(%)) ? 1 : 2   // the pipe result is the test
    const c = x |> (f(%) ? 1 : 2)   // the conditional is the body
    const d = ok ? x |> % + 1 : 0   // a pipe in a branch stays valid
    ```
    Effect TS: `const t1 = x; const b = f(t1) ? 1 : 2`; `const t2 = x; const c = f(t2) ? 1 : 2`; `const d = ok ? x + 1 : 0`, with once-only topic temporaries for general operands. The rejected line has no counterpart. Decided by the agent from principle 2 (mirror the pinned TC39 proposal and its reference parser), principle 8 (a syntax error can be relaxed later) and principle 4 (one parse per program), 2026-10-30. Reconcile Appendix A (beside the CatchExpression `?` early error), the 002 pipe examples and the snapshot README reconciliation list; keep upstream `spec.html` unchanged. Native evidence: `r31probe/pipe-cond.log` (both Babel versions; parenthesized and branch controls parse) and `r31probe/r31-counterparts.log` (`[1, 1, 5]` for x = 4); not VibeLang parser conformance.
    Status: applied in bb50c30ea831, landed in main f58798560fe7 (spec-fix-a, gate mq-10310743-2). Appendix A early error beside the catch one, snapshot receipt row; 002 unchanged.

    **Diagnostic-owner correction (Loop r3, detail 247).** The earlier “No `EK` code” sentence is superseded by accepted public VIP-34/detail 232: this adopted/reconciled pipe rejection uses `EK2301`. Syntax, precedence and admitted controls stay unchanged; detail 247 owns the catalog completion.

### Detail 252

**An `allSettled` literal preserves its source spreads without iterating compiler-created arrays.** (Follow-up to loop r1 ASTRA-1 and main `e3cf1d779348` `002-running.md:814`; accepted VIP-18 exact Effect sugar and literal-tuple amendment; principles 1 and 2, native source-array evaluation.) Evaluate source literal elements and each source spread once in native left-to-right construction order. A source spread uses that value's actual iterator, including an inherited or own array iterator, just as native `[...xs]` does. Wrapping yielded Effects in `Effect.exit` must not introduce an additional observable `Array.prototype[Symbol.iterator]` call on a generated array. In particular, `...[...$xs].map(Effect.exit)` is not an exact counterpart: the outer spread iterates its generated mapped array and can reverse values again, add side effects or throw through a user-modified prototype. Preserve source order and cold Effect construction, then run `Effect.all` with `concurrency: "unbounded"`. Preserve VIP-18's existing literal tuple typing, spread-as-array typing and non-literal heterogeneous-tuple restriction; a runtime reference using `.map` is not a request to widen every literal to an array. The operand remains an array expression; this admits no bare Set operand or new call mode.

    ```vibe
    effect function collected(xs: ReadonlySet<Effect<number>>) {
      return try.allSettled [...xs] // one source spread; no hidden array re-spread
    }
    ```

    Effect TS:

    ```ts
    function collected(xs: ReadonlySet<Effect.Effect<number>>) {
      return Effect.gen(function* () {
        const source = [...xs]
        return yield* Effect.all(source.map(Effect.exit), { concurrency: "unbounded" })
      })
    }
    ```

    Bounded native evidence: `allsettled-hidden-array-iteration-reference.json` compares the published projection with the source-array counterpart in 64 cases over Sets, generators, own-iterator arrays and ordinary arrays, lengths 0–7 and counting/reversing prototype iterators. All64 published projections add one observable iterator call;24 change element/run order. Prefix/spread/suffix construction stays ordered and Effects stay cold in both controls. The temporary prototype change is restored before Effects execute. This establishes a source-counterpart defect, not a VibeLang compiler defect or a delivered fuzz generator. The fixer must retain the minimized foreign-TypeScript prototype fixture, add a failing regression and spec-quoted keyed fuzz coverage for protocol-call counts, order, input iterable shapes, empty/multiple spreads, coldness and tuple typing. Do not ban native prototype changes to hide the discrepancy. Current `sl1-apply` source and `fuzz-findings` coverage receipts are historical work on the earlier own-iterator hole; this new protocol edge needs their normal claim/implementation process.

    Decided by the agent from principles 1 and 2 and accepted VIP-18's exact-sugar/source-order contract, 2026-10-31. Class A; no Will question.

### Detail 304

**`do` lowering preserves TypeScript's source-branch flow facts.** (RC-38 `002:do-short-circuit-loses-narrowing`; accepted VIP-2, native plain-function guarantee and principle2.) A `do` body in a short-circuit operand is checked with the ordinary TypeScript narrowing supplied by the original source guard in that branch. A synthesized writable result/completion temporary must not sever the guard's relation to the source variable. Keep guard evaluation once, source short-circuit/side-effect order, native result types and the actual invalidation of a narrowing after source writes. Each operator retains its own native branch facts; this grants no extra non-nullability for a nullish-coalescing RHS.

    ```vibe
    export function probe(x: { n: number } | undefined): number | undefined {
      return x && do { x.n }
    }
    export function invalid(x: { n: number } | undefined) {
      return x && do { x = undefined; x.n } // retains the native error
    }
    ```

    Effect TS: these remain ordinary TypeScript functions; the valid no-jump counterpart is `export function probe(x: { n: number } | undefined): number | undefined { return x && (() => x.n)() }`. TypeScript5.9.3 accepts it. The invalidating-assignment counterpart still rejects the property read. An illustrative immediate arrow is not a general lowering recipe: retain source callable bindings, outward jumps and any admitted suspension. Do not require an assertion, annotation, different target source or weakened strictness to recover an originally valid guard.

    Reviewer pass126 reports six falsely rejected guard shapes on `fe7b802fbf05`: truthiness, null check, positive/negative `typeof`, discriminant and const guard alias; their native counterparts accept and older `509a2110` controls agree. Explicit ternary, surrounding `if` and inside-`do` guard controls accept; unguarded/invalidated accesses retain real `TS18048`. Its28 compiler calls include17 accepts and11 rejections (seven current false rejections including the duplicate initial witness, four intentional negative-control rejections). Fifteen runtime calls cover accepted programs only. These are attributed receipts, not this lane's Vibe/compiler execution, implementation or a full-suite claim. RC10's inference cycle and contextual-literal reports remain distinct.

    Chapter002/impl-hunt-run, core-block and checker owners retain a failing-main regression and keyed spec-quoted fuzz/property neighbourhood: both branch outcomes, truth/type/discriminant/alias guards, nested logical/nullish forms, effectful guard evaluation once, source mutation invalidation, valid ordinary/conditional controls and real unsafe-access rejection. Preserve the actual source flow rather than suppressing diagnostic codes. No new diagnostic or public package API. Decided by the agent from principle2 (mirror TypeScript), accepted VIP-2 and `000-intro.md`/`002-running.md`'s native flow/conditional-evaluation guarantee, 2026-11-02 under the 2026-10-29 delegation. Class A; no Will question.

    Sources: `loop/scoped/rev-compiler/FINDINGS.md` pass126; `pass126-narrow.json`, `pass126-narrow-matrix.json` and source/config controls.

### Detail 305

**Erased callee wrappers preserve a native method reference and its receiver.** (RC-39 `002:do-erased-callee-wrapper-loses-this`; accepted VIP-2, `002-running.md`'s method-call rule, principle2; related native Reference preservation178/199.) When a method callee is wrapped in native TypeScript non-null `!`, `as`, `satisfies`, admitted angle-bracket assertion or their reference-preserving combinations, a lifted `do` argument must not turn the reference into a detached function value. Preserve receiver/key/callee evaluation once in native order, before argument work, then invoke with the captured source receiver. Keep the written wrappers' ordinary static checks and callable type.

    ```vibe
    export function probe(): number {
      const obj = { n: 5, m(x: number): number { return this.n + x } }
      return obj.m!(do { 2 })
    }
    ```

    Effect TS: the ordinary TypeScript counterpart is `export function probe(): number { const obj = { n: 5, m(x: number): number { return this.n + x } }; return obj.m!((() => 2)()) }`, returning `7`. If the argument sets `obj.n = 10` before yielding `2`, the same captured receiver observes `10` and the call returns `12`. The immediate arrow illustrates this no-jump witness only, not a general lowering with different callable/jump/suspension semantics.

    A comma or other native value-producing operation can deliberately detach a method. Preserve that behavior: `(events.push("detach"), obj.m)(argument)` remains a plain function-value call with the same native receiver/error behavior. Do not bind every expression that contains a member, re-read a getter/receiver after its arguments, or invoke observable user-owned `call`/`bind` properties as a shortcut. Parentheses and actual erased reference wrappers keep their distinct native checking/Reference behavior; source call-site syntax and resolved identity still govern.

    Reviewer pass128 reports26 compiler calls and26 runtime commands, all exit0 because fixtures catch exceptions, yet seven current/native wrapped dot/element pairs mismatch on `fe7b802fbf05`. Native and older `509a2110` controls retain the receiver; bare/parenthesized and intentionally detached controls discriminate the defect. Matching declarations and caught-process exit0 do not prove equivalence. Queued `971c7f13b2c4` still peels only parentheses in its method helper and is not a verified repair. This is distinct from RC29's earlier GetValue/tag/constructor timing issue. These are attributed reviewer receipts, not own Vibe execution or implementation.

    Chapter002/impl-hunt-run, core-block and rc25-do-order own failing-main regression, keyed corpus and spec-quoted neighbourhood fuzz: all wrappers/combinations, dot/element, source typings/generics, receiver reassignment, mutable receiver state, getter/key order, intentional detachment and source abrupt completions. No new syntax, diagnostic or public package API. Decided by the agent from principle2 (mirror TypeScript/ECMAScript), accepted VIP-2 and the existing native receiver/evaluation rule, 2026-11-02 under the 2026-10-29 delegation. Class A; no Will question.

    Sources: `loop/scoped/rev-compiler/FINDINGS.md` pass128; `pass128-wrapped-method.json`, `pass128-wrapper-matrix.json` and emitted/native controls.
