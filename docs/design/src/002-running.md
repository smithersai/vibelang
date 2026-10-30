# Running Effects

Sources: [VIP-5](../vips/0005-try-runs-effects.md), [VIP-2](../vips/0002-effect-blocks-and-do.md), [VIP-17](../vips/0017-fork.md), [VIP-18](../vips/0018-concurrent.md), [VIP-19](../vips/0019-for-concurrent.md), [VIP-20](../vips/0020-for-try.md), [VIP-21](../vips/0021-producers.md), [VIP-22](../vips/0022-interruption-blocks.md), [VIP-23](../vips/0023-pipe.md).

A call never runs anything. Calling an `effect` function, or any function that returns an Effect, gives the Effect unrun. An Effect runs only where one of these constructs runs it, in effect code (an `effect` function, a producer or an `effect` block):

| Construct | Runs |
| --- | --- |
| `try e` | one Effect, giving its success |
| `e catch (err) => y` | one Effect, handling its failure |
| `fork e` and its forms | one Effect, in a new fiber |
| `try.all`, `try.race`, `try.any`, `try.allSettled` | several Effects at once |
| `for concurrent` | one Effect per item, at once |
| `for try` | one Effect per Stream element, in order |
| `provide`, `uninterruptible`, `interruptible`, `restore` | a block of statements ([Services](005-services.md#provide-blocks) for `provide`) |
| `yield x` in a producer | one `Queue.offer`, waiting for buffer room |

"Effect code" means the body of an `effect` function, a producer or an `effect` block, not counting nested functions, class field initializers or `static` blocks, as `await` is not allowed there in an `async` function. A computed class key and an `extends` clause are effect code, as `await` is allowed there: in `effect function f() { class C { [try key()]() { } } }`, `try key()` runs. It is the code Appendix A parses with [the grammar's Effect parameter](900-appendices.md#the-effect-parameter), minus parameter lists, class field initializers and `static` blocks. Parentheses, `do` and `match` are not boundaries; an `async match` is one, as a nested `async` function is ([Pattern matching](004-match.md)), so `try` inside it is an error. Outside effect code a parser still parses these constructs, as TypeScript parses `await x` outside an `async` function, and reports the construct's "outside effect code" error; tokens that are also valid TypeScript, such as `fork(x)` or `join(x)`, keep their TypeScript meaning.

Every operand is evaluated once, left to right as written, with two exceptions: a `catch` handler is evaluated only on failure, and the body of an `effect` block or function is evaluated on each run. Where Effect's argument order differs from the source order (`fork.in(scope) e`, `for concurrent(n) (… of xs)`), the Effect TypeScript evaluates the operands into temporaries first, in source order, then calls Effect's function: `const $s = scope` before `Effect.forkIn(e, $s)`, and `const $n = n, $xs = xs` before `Effect.forEach($xs, …, { concurrency: $n })` (decided detail 84).

## `try`

### Syntax

[TryExpression](900-appendices.md#tryexpression).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `try` outside effect code | `EK0501` |
| `try e` where `e` is not an Effect. A call that may throw, and a Promise, must first be wrapped with `Effect.try`, `tryPromise` or `promise` | `EK0502` |
| a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())` | `EK0503` |

<a id="operand-test"></a>**Operand test.** `e` is an Effect when its type is assignable to `Effect.Effect<any, any, any>`. In Effect 4.1.0 a `Context.Service` key, a `Context.Reference` and an `error` instance (`Data.TaggedError` or `Schema.TaggedError`) are, so `try new NotFound({ id })` fails like `throw`; `Option` and `Result` are not. An Effect that can't fail is still run with `try`. `never` and `any` pass this test, `never` as the success of an Effect that only fails; `unknown` does not, as TypeScript doesn't assign it to `Effect.Effect<any, any, any>`; it is the operand test, not [Failures](003-failures.md)' test of which callables are effectful.

`try` works like `await`: it is a unary operator with `await`'s precedence, so `try a.b()` runs `a.b()` and `try f() + 1` adds 1 to the success. As with `await`, the operand may start on the next line. At the start of a statement, `try` followed by `{`, on the same line or not, begins a `try` statement, as in JavaScript, and that is an error in effect code.

### Meaning

`try e` is `yield* e`. It runs `e` and gives its success value. A failure propagates to the enclosing Effect, as Zig's `try x` means `x catch |err| return err`.

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
| `x catch (e) => { throw e }` | plain function | a defect; no `EK0507` or `EK0508`, since the result type is `never` |
| `x catch guest` | syntax error | quick fix: `x catch () => guest` |
| `x catch onErr` (`onErr` a function) | syntax error | quick fix: `x catch (e) => onErr(e)` |
| `x catch effect { return 7 }` | syntax error | quick fix: `x catch effect () => { return 7 }` |
| `x catch async (e) => 7` | syntax error | quick fix: `x catch (e) => 7` |
| `x catch function* (e) { }` | syntax error | quick fix: `x catch function (e) { }` |

An arrow handler's body is TypeScript's concise body, which extends as far as an assignment expression does, as in `(e) => a ?? b`: `a catch () => b ? c : d` means `a catch (() => (b ? c : d))`. So `a catch effect (e) => b catch () => c` means `a catch (effect (e) => (b catch (() => c)))`. With a plain arrow, `b catch () => c` is in a plain function, so `a catch (e) => b catch () => c` is the error "`catch` outside effect code". Parenthesizing the arrow, `a catch ((e) => b) catch ((e) => c)`, parses, but the outer `catch` then needs an Effect operand (below).

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
| `try x catch h`: write `try x` or `x catch h`, never both. It fires when a `try` or `try.all` is reachable from the head through unary and binary operator nodes only: `try a + b catch h`, `-try a catch h` and `x + try a catch h` are each `EK0505`; the quick fix removes `try`. One inside arguments, an array or object literal, a template substitution, parentheses, a function body or a `match` arm does not count, so `g(try a) catch h` catches `g`'s failure. `try.all x catch h` and the other three operations get this error too, not the one below. A `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join` head gets it by the same rule, since each runs an Effect as `try` does (decided detail 99): `join f catch h` (quick fix `Fiber.join(f) catch h`, which handles the fiber's failure) and `fork e catch h` (quick fix `fork Effect.catch(e, ($e) => Effect.succeed(h($e)))`, or `fork Effect.catch(e, h)` for an `effect` handler: `e` stays on the caller and the handler runs on the forked fiber, as [`fork`'s operand](#fork-operand) says). `fork (e catch h)` runs `e` here and forks its result: `EK1703` unless the result is an Effect. `(try x) catch h` and `(join f) catch h` are allowed: each catches the Effect its parenthesized operand succeeds with. `(fork e) catch h` is not `EK0505`, but its head is a `Fiber`, which is not an Effect in Effect 4.1.0, so it is `EK0506` | `EK0505` |
| `e catch h` where `e` is not an Effect | `EK0506` |
| a non-function handler, or an `async`, generator or `async` generator handler (table above) | `EK0509` |
| a plain handler whose result type is a Promise or thenable (`x catch (e) => queryDb(e)`): the Promise is never run, as for an unwrapped Promise in effect code ([Failures](003-failures.md)) | `EK0507` |

<a id="result-tests"></a>**Result tests.** `EK0103` and `EK0508` ask: may this value be an unrun Effect? A type answers yes when it is not `never`, `any` or `unknown` and at least one union member is an Effect. `EK0404` and `EK0507` ask the same of Promises, with `PromiseLike` for Effect, as typescript-eslint's `no-floating-promises` does (decided detail 89). Detail 36 keeps its every-member test, because it asks the opposite question. Only the [operand test](#operand-test) of `try` (`EK0502`), `catch` (`EK0506`), `try.all` (`EK1801`) and `fork` (`EK1703`) uses assignability to `Effect.Effect<any, any, any>`, which `never` and `any` pass. Every other chapter names one of these two tests.

```vibe es
// compiler-gap: pending VIP-5
// fragment
async function a(x: any) { return await x }                         // ok: any fails the result test
async function b(e: Effect.Effect<number> | undefined) { return await e }   // EK0103: e may be an Effect
effect function c() { const p = maybeQuery() }                      // EK0404: Promise<number> | undefined
```

### Meaning

`e catch h` runs `e`. On a failure in its error channel it calls `h` with the error, as Zig's `catch |err|` does. `h` runs only when the `Cause` holds no defect: a `Cause` with both a failure and a defect, as `try.any` gives when an operand dies, passes through with its failures re-raised as defects, as `Effect.catch` does in Effect 4.1.0. The handler's kind decides whether its result runs Effects, as for any function. `h` is evaluated only on failure. An `effect` block is an ordinary operand, so `effect { try write(x); try close() } catch effect (e) => try log(e)` replaces the banned `try { } catch { }` statement:

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

A handler's parameter may have a type annotation, checked as for a TypeScript arrow parameter: the error type must be assignable to it, so `x catch (e: NotFound) => guest` is an error when `x` can also fail with `DbError` (VIP-5, amended).

A plain handler whose result type is an Effect gets a VIP-38 lint warning (`EK0508`), with the quick fix `catch effect (e) => try …`:

```vibe es
// compiler-gap: pending VIP-38
// fragment: inside an effect function
fetchUser(id) catch (e) => fetchUser("guest")              // warning: the fallback is an unrun Effect
fetchUser(id) catch effect (e) => try fetchUser("guest")   // the fix: Effect.catch(fetchUser(id), () => fetchUser("guest"))
```

## `await`

`await` keeps exactly JavaScript's meaning and belongs to `async` functions and the module top level. `await`, `for await` and `await using` inside effect code are errors, and so is `await` on an Effect inside an `async` function ([Functions](001-functions.md#static-rules)). `await fiber` and `await deferred` keep TypeScript's behavior and get a VIP-38 lint warning suggesting `join fiber` (`EK4609`) or `try Deferred.await(deferred)` (`EK4610`) (VIP-5, amended).

<a id="try-follows-await"></a>`try e` is allowed, forbidden and ordered exactly where `await e` is, and every rule that differs is listed here with its reason:

| Position | `await` | `try` |
| --- | --- | --- |
| the body of an `async` or `effect` function, a `do`, a `match` arm or guard, parentheses | allowed | allowed |
| a computed class key, an `extends` clause | allowed | allowed |
| a parameter default, a class field initializer, a `static` block | SyntaxError | error |
| a nested plain function | SyntaxError | error |
| the module top level | allowed | error: the top level is not effect code, and nothing runs an Effect implicitly (VIP-26). Write `await runPromise(e)` |

The other constructs follow the Promise they mirror: `effect { }` is `async do { }`, `fork e` is starting a Promise without awaiting it, `e catch h` is `.catch(h)`, and a failure is a rejection. They differ where an Effect isn't a Promise:

| Promise | Effect | Why |
| --- | --- | --- |
| A rejected `await` resumes the function with a throw, so `using`, iterator closing and `finally` run | A failed `try` never resumes the generator, so none of them run | [Abandonment](008-runtime.md#abandonment): `try e` is `yield* e` |
| A thrown error and a rejection are one channel, and `.catch` sees both | A failure and a defect are two channels, and `catch` sees failures only | Effect's typed error channel |
| A Promise starts when it is created and runs once | An Effect is cold, and each `try e` runs it again | An Effect is a value (VIP-1) |
| Nothing cancels a Promise | Interruption ends a fiber: the generator is abandoned and Effect's finalizers run | Promises have no counterpart |
| `async do { return 1 }` is a syntax error | `effect { return 1 }` ends the block's Effect | The block is `(effect () => { … })()` (VIP-2) |
| A function's body starts at the call | A forked fiber starts later, and a child that never got a step is interrupted when its parent ends | Fibers are scheduled and owned |

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

## `do` expressions

`do { … }` is exactly TC39's do expression, pinned to a dated snapshot of the proposal, everywhere, with no exceptions. It runs now and gives its last statement's value. Its type is the union of the types of the values it can complete with, as TypeScript types `c ? 1 : "a"`: each path ending in an expression statement contributes that expression's type, a path that completes empty contributes `undefined`, and a path that leaves by `return`, `break`, `continue` or `throw` contributes nothing; literals widen as in a `let` initializer. `do { if (c) 1; else "a" }` is `number | string`, and `do { }` is `undefined`. It is not a function: as TC39 specifies, `await` inside `do` belongs to the enclosing function, and so does `try`, so a `try` in a `do` or `match` suspends the enclosing generator.

<a id="evaluation-order"></a>**Evaluation order.** A `do` or `match` is an expression, and this is the one rule for it inside a larger expression: it runs where JavaScript evaluates the expression that holds it, never earlier or more often. Everything to its left runs first, in source order, the callee and a method's receiver included, so `o.m(try a(), match (x) { … })` reads `o.m`, runs `a()`, runs the `match`, and calls the method with `this` as `o`. In a conditional position (one side of `&&`, `||`, `??`, `?:`, `&&=`, `||=`, `??=`, after `?.`, a `case` test, a loop condition or update) it runs only when JavaScript evaluates that position. How the compiler keeps this is its choice. Destructuring and parameter defaults follow [their own rule](#destructuring-and-parameter-defaults). As the snapshot's explainer says, an unlabeled `break` or `continue` in a `do` in a loop head is an early error.

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
    const $r = o, $f = $r.add, $t1 = yield* a()      // receiver, callee, then the first argument
    const $s = n()
    let $t2
    if ($s === 1) $t2 = 10
    else $t2 = 0
    return Reflect.apply($f, $r, [$t1, $t2])          // this is o
  })
}
```

The pinned snapshot is the [vendored copy](../vips/tc39-do-expressions/README.md) of `tc39/proposal-do-expressions` at commit `3ef6d463b8163cbf222846b40d17178cca36e9e1`, the head on 2026-10-28 (UTC), as pattern matching is pinned.

### Destructuring and parameter defaults

A destructuring or parameter default runs only when it applies. In effect code a destructuring pattern behaves exactly as the same pattern in JavaScript with the pinned `do` proposal: ECMA-262's BindingInitialization, IteratorBindingInitialization and DestructuringAssignmentEvaluation, with GetIterator and IteratorClose for array patterns. Evaluation order, getters, the iterator protocol, temporal dead zones, closing, and the `name` and `message` of every protocol error are that algorithm's on the same host, and the canonical `Exit` compares them ([Runtime guarantees](008-runtime.md)). How the compiler achieves it (native destructuring with an inline `yield*`, a runtime helper, or any other lowering) is its choice; the examples below, the VIP-31 differential suite and the fuzz suite check it.

Three things can happen in a default:

- **A jump.** A `return`, `break` or `continue` in a default's `do` acts on the enclosing function or loop, as TC39 specifies. It leaves an array pattern as the same jump leaves a `for…of` body: ECMA-262 gives IteratorClose the jump's completion, so the iterator closes unless it is done, and an error from closing replaces the jump.
- **A suspension.** A `try` or `yield` in a default runs in the enclosing effect function.
- **A failure.** A `try` that fails, dies or is interrupted, or a `throw`, [abandons](008-runtime.md#abandonment) the generator, so nothing closes. A JavaScript throw, such as a getter's, unwinds it: the iterator closes, the throw wins over any error from closing, and it becomes a defect.

<a id="parameter-defaults"></a>**Parameter defaults.** A parameter default can't run an Effect, as `async function g(x = await p)` is a SyntaxError. Everything else JavaScript with the `do` proposal allows there stays, including a `return` in a default's `do`. The pinned proposal allows it and stops there, so it acts as `return` at the top of the body, whatever the kind of function:

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

## `fork` and `join`

### Syntax

[ForkExpression](900-appendices.md#forkexpression) and [JoinExpression](900-appendices.md#joinexpression). In effect code and in the parameters of an `effect` function, arrow, method or producer, `fork` and `join` are reserved words, exactly as `await` is in an `async` function and its parameters ([the grammar's Effect parameter](900-appendices.md#the-effect-parameter); VIP-17, amended): they can't name a variable, parameter or label there, and where an expression can start they begin a `fork` or `join` expression. As property names they stay names, as `await` does. Outside effect code they are ordinary identifiers. So an imported function named `join` can't be called in effect code; rename it at the import: `import { join as joinPath } from "node:path"`. The owner forms `fork.in(…)`, `fork.scoped` and `fork.detached` are productions in JavaScript's `keyword.name` shape, like `new.target` and `import.meta`, not property reads. Their tokens may be separated as `new . target`'s may ([TryAll](900-appendices.md#tryall)). As with `await`, the operand may start on the next line. A [ForkOperand](900-appendices.md#forkoperand) never contains a top-level comma, so `const f = fork a(), g = fork b()` declares two fibers.

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

A line break after `fork` or `join` changes nothing, as after `await`: `join` then `f` on the next line joins `f`. After `join`, `/` begins a regular expression and `- 1` is a negation, as after `await` (VIP-17, amended).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `fork` or `join` outside effect code | `EK1701` |
| a `fork` or `join` naming a variable, parameter or label in effect code or in the parameters of an `effect` function, arrow, method or producer, including a plain arrow's parameters written in effect code, as `(await) => 1` is an error in an `async` function: `effect function bad(join: number) { }`, and `const k = (join) => 1` in effect code; a nested `function h(join) { }` resets it, as it does for `await` | `EK1702` |
| a `fork`, `fork.in(s)`, `fork.scoped` or `fork.detached` operand that fails the [operand test](#operand-test): `fork n` with `n: number`; write `fork effect { … }` or call the function (decided detail 88) | `EK1703` |
| a `join` operand not assignable to `Fiber.Fiber<any, any>`: `join p` with `p: Promise<number>`; `join` the value `fork` gave (decided detail 88) | `EK1704` |

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
| an operand that is not an array of Effects, `try.all [1, a()]`; an object of Effects uses the `all` global instead | `EK1801` |

### Meaning

These are TC39's await operations, run with `try` instead of `await`. The names keep JavaScript's choice of result: `try.all` starts everything at once, like `Promise.all`, even though `Effect.all` defaults to one at a time. Unlike Promises, the Effects that lose are interrupted, and an empty operand to `try.race` or `try.any` never completes, where `Promise.any([])` rejects.

| VibeLang | Effect TypeScript | Gives |
| --- | --- | --- |
| `try.all [a(), b()]` | `yield* Effect.all([a(), b()], { concurrency: "unbounded" })` | every success, in operand order; the first failure fails the whole and interrupts the rest. Operands start in order, and one that fails before it suspends stops later ones from starting, as `Effect.all` does: `try.all [fail(e), log("hi")]` doesn't log |
| `try.race [a(), b()]` | `yield* Effect.raceAllFirst([a(), b()])` | the first to finish: success, failure or defect; the losers are interrupted |
| `try.any [a(), b()]` | `yield* Effect.raceAll([a(), b()])` | the first to succeed; the losers are interrupted. A defect does not end it; it waits for the others, as for a failure. If none succeeds and none dies, the whole fails with all their failures in its `Cause`, in the order they occurred, and `catch` receives the first to occur, not the first operand's. If any operand dies, the whole dies: the `Cause` holds every failure and defect, in order, all as defects, and `catch` sees nothing |
| `try.allSettled [a(), b()]` | `yield* Effect.all([Effect.exit(a()), Effect.exit(b())], { concurrency: "unbounded" })`; any other operand `xs`: `const $xs = xs; yield* Effect.all($xs.map(Effect.exit), { concurrency: "unbounded" })` | every element's `Exit` (success, failure, defect or interruption), a tuple for an array literal, as `Promise.allSettled` keeps one; the whole never fails, as `Promise.allSettled` never rejects; it can still be interrupted from outside. A non-literal tuple whose elements differ in type is TypeScript's error there, as in Effect TypeScript; write the elements out: `try.allSettled [t[0], t[1]]`. A spread element `...xs` in the literal is `...$xs.map(Effect.exit)`, with `const $xs = xs` evaluated in element order; TypeScript types that part as an array, not a tuple |

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
| `break` that would leave the body: `for concurrent (const x of xs) { break }` | `EK1903` |
| `return` in the body: `for concurrent (const x of xs) { return x }` | `EK1904` |
| a labeled `continue` naming a statement that encloses the `for concurrent` | `EK1905` |
| an operand that is not an `Iterable`, `for concurrent (const x of 5) { }`; a Stream uses `for try` | `EK1901` |
| a `var` or assignment head: `for concurrent (x of xs)` | `EK1906` |

`continue`, and a labeled `continue` naming the `for concurrent` itself, end that one item: each is `return` from the item's generator, as the example shows. The others are errors because the body runs in `Effect.forEach`'s callback, not in the enclosing loop or function (VIP-19). A loop or `switch` nested in the body keeps its own `break` and `continue`.

### Meaning

Items run at once, or at most `n` at a time with `for concurrent(n)`. `n` is any Effect `Concurrency`, which in Effect 4.1.0 is a number or `"unbounded"`, passed straight to `concurrency` (VIP-19, amended). Whether an item gets its own fiber is `Effect.forEach`'s choice: in Effect 4.1.0 a limit above 1, or `"unbounded"`, forks one fiber per item, and `for concurrent(1)` runs the items in order on the enclosing fiber. So a `fork` child in the body is owned by the item's fiber, and interrupted when the item ends, under a limit above 1, and by the enclosing fiber under `for concurrent(1)`. All items join before the loop ends, and one failure interrupts the rest. Results are discarded; `try.all ids.map(…)` keeps them.

```vibe es
// compiler-gap: pending VIP-19
effect function syncAll(ids: string[]) {
  for concurrent (const id of ids) { if (id === "") continue; try syncOne(id) }
  for concurrent(limit()) (const id of ids) { if (id === "") continue; try syncOne(id) }   // limit() first
  for concurrent("unbounded") (const id of ids) { try syncOne(id) }
}
effect function run(ids: string[]) {
  for concurrent(1) (const id of ids) { fork sync(id) }   // each child is owned by run's fiber
  for concurrent(2) (const id of ids) { fork sync(id) }   // each child is interrupted when its item ends
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
```

The head is a `const` or `let` declaration, destructuring included: ECMAScript's `ForDeclaration`, `LetOrConst ForBinding` (VIP-19, amended). `var` and an assignment head, `for concurrent (x of xs)`, are syntax errors (`EK1906`). The item arrives under a fresh parameter, and the head's declaration runs first in the item's generator, so a default or computed key in it may run Effects and a failure there fails that item. The body keeps its own block scope:

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

## `for try`

### Syntax

[ForTry](900-appendices.md#fortry).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `for try` outside effect code | `EK2001` |
| `return` in the body: `for try (const x of s) { return x }` | `EK2002` |
| a labeled `break` or `continue` naming a statement that encloses the `for try`: `outer: for (const s of streams) { for try (const x of s) { continue outer } }` | `EK2003` |
| an operand that is not a `Stream`, `for try (const x of [1, 2]) { }`; convert an AsyncIterable with `Stream.fromAsyncIterable` first | `EK2004` |
| a `var` or assignment head: `for try (x of s)`; write `for try (const v of s) { x = v }` | `EK2005` |

### Meaning

`for try (const x of stream)` consumes a Stream, pulling one element at a time, in order. It mirrors `for await` over AsyncIterables, which keeps its JavaScript meaning. `continue` skips one element, `break` stops consuming and closes the stream's scope, so a producer still running is interrupted and its finalizers run, and a failure in the body fails the loop.

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
| `yield` in an `effect` block, arrow or `effect function` nested in a producer, where no generator encloses it | `EK2104` |

### Meaning

`effect function*` returns a Stream, as `async function*` returns an AsyncIterable. Its body is effect code: `yield x` emits `x`, and `try` and the other constructs run Effects. `yield` belongs to the innermost producer, as in JavaScript, so `yield` in a nested `effect` block, an arrow or an `effect function` handler is a syntax error (`EK2104`). A `provide` block, an interruption block, a `for try` body and a `for concurrent` body are not producers: `yield x` there is `yield* Queue.offer(queue, x)` on the enclosing producer's queue, as `yield` in a nested block of an `async function*` yields from that function. In a `for concurrent` body, each item's fiber offers its own elements, so elements arrive in offer order. It compiles to `Stream.callback` with one element of buffer, so the producer may run up to two elements ahead of its consumer: one in the buffer and one waiting to be offered (VIP-21, corrected). Exact pull semantics are not provided. `yield x` evaluates to `undefined`, as in an `async function*` consumed by `for await`: it is `(yield* Queue.offer(queue, x), undefined)`. A `yield` with no operand is `yield undefined`, so it offers `undefined`. A failure run by `try` in the body fails the stream. The return type, when written, is `Stream.Stream<A, E, R>`, and each `yield x` requires `x` assignable to `A`. When it is not written, `A` is the union of the `yield` operands' types, widened as for an `async function*`, or `never` with no `yield`; `E` and `R` are inferred as for an `effect` function ([Functions](001-functions.md#return-types)). So `effect function* f() { yield 1; yield "a" }` returns `Stream.Stream<number | string>`. The lowering writes all three as type arguments, `Stream.callback<A, E, R>`, since Effect 4.1.0 can't infer them from the callback. The generator gets the function's `this`, `super` and `new.target` as an `effect` function's does ([Functions](001-functions.md#meaning)), with `Effect.gen({ self: this }, …)` when the body reads `this`.

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

`uninterruptible { }` is always `Effect.uninterruptibleMask(($restore) => Effect.gen(…))`, as VIP-22 writes it, whether or not a `restore` block is inside it. The callback's parameter has a fresh name, as `$c` does, so a user variable `restore` stays visible.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| any of the three, or `restore { }`, outside effect code, `function f() { uninterruptible { } }`; `EK2201` fires, not `EK2111` | `EK2201` |
| `restore { }` outside an `uninterruptible` block, `effect function f() { restore { } }`; one inside an `interruptible` block nested in it is inside, as `$restore` is in scope there | `EK2111` |
| `restore { }` inside any nested `effect` function, arrow, method, producer or `effect` block in the `uninterruptible` block, `uninterruptible { const e = effect { restore { try poll() } }; try e }`, or inside any `for concurrent` body: `restore` is lexical, and the nested Effect, or each item's Effect, runs outside the mask's control (decided details 51 and 51a). Mask per item with `Effect.uninterruptibleMask` inside the body, or use a plain `for` | `EK2202` |

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

The keywords remove the globals of the same name ([VIP-6](../vips/0006-effect-globals.md)), so Effect's functions are written `Effect.uninterruptible` and `Effect.interruptible`.


## Region bodies

A *region body* is source code that the lowering moves into a generated callback: the block of `provide`, `uninterruptible`, `restore` and `interruptible`, and the body of `for try` and `for concurrent`. Its names and jumps mean what they mean in the source, as ECMAScript defines them: `provide` and interruption blocks are ordinary blocks, so `return`, `break` and `continue` inside them reach the enclosing function, loop, `switch` or label, as in any TypeScript block (VIP-12 and VIP-22, amended). This section is the one lowering rule for both; [Services](005-services.md#provide-blocks), [Functions](001-functions.md#meaning) and [Runtime guarantees](008-runtime.md) refer to it.

**Bindings.** Every name is resolved on the source before lowering. `var` is a compile error in `.vibe` ([Legacy JavaScript](001-functions.md#direct-eval)), so every declaration in a region body (`let`, `const`, `class`, a function declaration) is scoped to its block, as in strict module code, and stays in it; the callback closes over every outer binding, so an assignment to one is seen outside. `this`, `super` and `new.target` are the source function's, passed in as for an `effect` arrow ([Functions](001-functions.md#meaning)).

**Jumps.** In ECMAScript every statement completes with a Completion Record: normal, `return` with a value, or `break` or `continue` with a target label, empty when unlabeled. LabelledEvaluation decides which statement consumes a `break` or `continue`: an unlabeled `break` is consumed by the innermost iteration or `switch` statement, an unlabeled `continue` by the innermost iteration statement, and a labeled one by the statement whose label set holds the label (any statement for `break`, an iteration statement for `continue`). A `return` is consumed by the function. The lowering keeps that resolution:

- A completion consumed inside the region body stays as written.
- Any other completion ends the body's generator with a record: `{ _tag: "Return", value }`, `{ _tag: "Break", label }` or `{ _tag: "Continue", label }`, under fresh names, and `{ _tag: "Normal" }` when the body completes normally. `return e` evaluates `e` once, inside the body.
- Where the region stands, after `yield*` returns, the code re-issues the record: `return $c.value`, `break L` or `continue L`, where `L` is the consumer's label; the lowering gives an unlabeled consumer a fresh label. Inside an enclosing region body the re-issued jump is again a record, so it passes outward until it reaches its consumer.
- When the consumer is itself a callback, the record becomes that callback's own completion: a `for try` consumes `continue`, or a `continue` naming it, as `return true` and `break`, or a `break` naming it, as `return false` from the element's callback; a `for concurrent` consumes `continue`, or a `continue` naming it, as `return` from the item's callback.
- A `for concurrent` body can't produce a `break` it doesn't consume, a `return` or a `continue` naming an enclosing statement, and a `for try` body can't produce a `return` or a labeled `break` or `continue` naming a statement that encloses it: their static rules make these errors, because the body runs in `Effect.forEach`'s or `Stream.runForEachWhile`'s callback, not in the enclosing loop or function (VIP-19, VIP-20).
- Only a body that completes gives a record. A failure, defect or interruption stays in Effect's `Cause`. The region's own finalizers, such as releasing a `provide`'s layers, run before the jump, because `Effect.provide` and the masks complete before `yield*` returns.

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
      const $c = yield* Effect.provide(Effect.gen(function* () {
        if (id === "skip") return { _tag: "Continue", label: "outer" } as const
        if (id === "stop") return { _tag: "Break", label: "outer" } as const
        if (yield* (yield* Users).has(id)) return { _tag: "Return", value: id } as const
        return { _tag: "Normal" } as const
      }), [Layer.succeed(Users, testUsers)])
      if ($c._tag === "Return") return $c.value
      if ($c._tag === "Break") break outer
      if ($c._tag === "Continue") continue outer
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
          const $c = yield* Effect.uninterruptibleMask(($restore) => Effect.gen(function* () {
            n = n + 10
            return { _tag: "Break", label: "$s" } as const
          }))
          if ($c._tag === "Break") break $s
        }
      }
      n++
    }
    return n
  })
}
```

## The pipe operator

`|>` is exactly TC39's Hack pipe operator, pinned to a dated snapshot of the proposal. `%` is the topic: the left side's value, evaluated once into a fresh temporary. The topic-versus-modulo grammar is TC39's, unchanged.

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

Effect's `pipe(x, f, g)` function stays available ([VIP-14](../vips/0014-effect-modules-in-scope.md)).

The pinned snapshot is the [vendored copy](../vips/tc39-pipeline-operator/README.md) of `tc39/proposal-pipeline-operator` at commit `5ac4dfd624e68b649e6f947885bf5ef67bac19f4`, the head on 2026-10-28 (UTC), as pattern matching is pinned.
