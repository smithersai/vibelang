# VIP-5: `try` runs an Effect; `await` is only for Promises

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
async function get(q) { return await queryDb(q) }          // await: Promises only, exactly as in JavaScript

effect function load(id) {
  const u = try fetchUser(id)                     // runs the Effect; a failure propagates
  const g = fetchUser(id) catch guest             // runs it; on a failure, gives guest
  const h = fetchUser(id) catch effect (e) => match (e) {
    when NotFound: guest;
    when DbError: throw e;                        // fails again, typed (VIP-4): the handler is an effect function
  }
  try sleep("1 second")                           // an Effect that can't fail is still run with try
  await queryDb(q)                                // error: await belongs to async functions
}
```

- `try e` runs the Effect `e` inside an `effect` function or block and gives its success value. A failure propagates to the enclosing Effect, as Zig's `try x` means `x catch |e| return e`.
- **Amended 2026-10-30: completed Effects and scheduling.** `try e` uses the accepted `yield* e` execution under Effect's scheduler; it adds no Promise job, implicit `yieldNow` or mandatory suspension. A synchronously completing operand may continue in the same turn, while suspension or the cooperative scheduling budget can run other fibers. The `await` analogy governs source placement, precedence and evaluation order. Explicit `try yieldNow` requests a cooperative yield without promising a global order for unrelated fibers. See [Running Effects](../src/002-running.md#try-follows-await).

- **Amended 2026-10-30: corresponding execution contexts.** Comparisons with `await` pair an `async` body with an `effect` body; neither operator becomes permitted in the other kind of function, and transparent expressions inherit their source context.
- `e catch y` runs `e`, and on a failure evaluates `y`, as Zig's `catch` takes a value or `|err|`. As in Zig, you write `try x` or `x catch y`, never both. **Amended 2026-10-29:** the handler's syntax decides whether it runs Effects, as VIP-1 decides for any function:

  | Written | Effect TS |
  | --- | --- |
  | `x catch (e) => f(e)` (a plain function; a `throw` inside is a JavaScript exception, so a defect) | `Effect.catch(x, (e) => Effect.succeed(f(e)))` |
  | `x catch effect (e) => …` (an effect function; it runs its Effects, and `throw` fails again, typed) | `Effect.catch(x, (e) => Effect.gen(…))` |

  Recorded under Will's standing approval of recommendations, after the differential fuzz suite found that the earlier example's `throw` was a defect. *Superseded 2026-10-29 15:57: the handler is always a function literal (below).*
- **Amended 2026-10-29: `catch` binds like `??`.** It has the same precedence and is left-associative: `a catch b catch c` means `(a catch b) catch c`, and `x = a catch b` assigns the result. Mixing it with `??`, `||` or `&&` without parentheses is a compile error, as JavaScript requires for `??`. Recorded under Will's standing approval of recommendations.
- `try` is only for Effects. A call that may throw, and a Promise, is first wrapped into an Effect with Effect's own functions (VIP-6: `Effect.try`, `tryPromise`), then run with `try`.
- An `effect` function has no `try`/`catch` statement. It handles failures with `catch` and `match`.
- **Amended 2026-10-29: no `try` statements of any kind**, `try`/`finally` included. Cleanup uses Effect's `ensuring` or `onExit` (VIP-6 globals): `try ensuring(write(x), close())`. Effect code has exactly one `try`, the one that runs an Effect. Recorded under Will's standing approval of recommendations.
- `await` keeps exactly JavaScript's meaning and belongs only to `async` functions:
  - `await` inside an `effect` function is an error;
  - `await` on an Effect inside an `async` function is an error.
- An Effect that can't fail is still run with `try`, and that is fine.

*Corrected 2026-10-29: the examples call `queryDb`, a Promise-returning function imported from a `.ts` module, because VIP-33 forbids platform calls such as `fetch` anywhere in a `.vibe` file.*
- **Amended 2026-10-29: a non-literal function fallback.** In `x catch f`, where `f` is a non-literal function value, the fallback is the value `f`: syntax decides. A VIP-38 lint warning, with quick fixes to `catch (e) => …` or `catch effect { … }`, flags a fallback whose type is an Effect or a function. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00. *Superseded 2026-10-29 15:57: a value fallback no longer exists (below).*
- **Amended 2026-10-29: `try` works like `await`.** It is a unary operator with `await`'s precedence, and where `await` can't appear in an `async` function (its parameter list, a class field initializer, a `static` block), `try` can't appear in an `effect` function. Will, 2026-10-29: "try works like await."
- **Amended 2026-10-29: annotated handler parameters.** In `catch (e: NotFound) => …`, the parameter's type annotation is allowed and checked as for a TypeScript arrow parameter: the error type must be assignable to it (the old EK2112 no longer fires for it). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: `await fiber`.** In async code, `await` on a `Fiber` has TypeScript's behavior, plus a VIP-38 lint warning suggesting `join` (EK4609 becomes that lint). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: `await deferred`.** In async code, `await` on a `Deferred` has TypeScript's behavior, plus a VIP-38 lint warning suggesting `try Deferred.await(d)` (EK4610 becomes that lint). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: the handler is always a function literal.** Its syntax decides its kind: `x catch (e) => v` (also function expressions) is plain, and its result is the fallback value; `x catch effect (e) => …` runs an Effect and may fail again. `x catch () => guest` replaces the value form `x catch guest`, which is removed. A named function needs a wrapper, `x catch (e) => f(e)`, so syntax alone decides. This replaces the handler table above (including `x catch effect { … }`) and the non-literal function fallback amendment. *Corrected 2026-10-30: this amendment also listed `async` arrows as plain handlers; the amendment below makes them syntax errors (decided detail 85; found by the round-19 Fable review).* Decided by Will, 2026-10-29 15:57: "It asked me to confirm a decision I already made."
- **Amended 2026-10-29: a throwing call in a plain handler.** A known throwing call in a plain `catch` handler's eager parameter/default/destructuring initialization (computed binding keys included) or body is a compile error, with the quick fix `catch effect (e) => try Effect.try(() => …)`. An explicit `throw` in a plain handler keeps its defect meaning. Use nonthrowing effect-handler parameters and bridge throwing initialization inside its body; keeping the throwing work in its parameters is still an eager-parameter error. Implicit initialization exceptions retain their defect policy, and merely defining a nested source function adds no initialization calls. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 39).
- **Amended 2026-10-29: `(try x) catch h`.** `(try x) catch h` is allowed: it catches the Effect that `x` succeeds with. "Never both" covers only the unparenthesized `try x catch h`. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 61).
- **Amended 2026-10-29: a plain handler returning an Effect.** A plain `catch` handler whose result type is an Effect gets a VIP-38 lint warning, with the quick fix `catch effect (e) => try …`: `fetchUser(id) catch (e) => fetchUser("guest")` gives the unrun Effect. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 62).
- **Amended 2026-10-29: no generator or `async` handlers.** `async` arrows, `async` function expressions, generator expressions and async generator expressions are syntax errors as `catch` handlers, with the quick fix "remove `async`" or "remove `*`". Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 85).
- **Amended 2026-10-29: one test for an unrun Effect or Promise.** `EK0103`, `EK0508`, `EK0404` and `EK0507` ask whether a value may be an unrun Effect (or Promise): a type answers yes when it is not `never`, `any` or `unknown` and at least one union member is an Effect (or `PromiseLike`). `try`, `catch` and `try.all` keep assignability. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 89).
- **Amended 2026-10-29: `fork` and `join` heads before `catch`.** `EK0505` covers a `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join` reachable from a `catch` head through unary and binary operator nodes only, by the same rule as `try`: `join f catch h` is `EK0505` (write `Fiber.join(f) catch h`), and `fork e catch h` is `EK0505` (write `fork Effect.catch(e, ($e) => Effect.succeed(h($e)))`, or `fork Effect.catch(e, h)` for an `effect` handler, so `e` stays on the caller and the handler runs on the forked fiber; `fork (e catch h)` runs `e` here and forks its result, `EK1703` unless that result is an Effect). *Corrected 2026-10-30: the quick fix was `fork (e catch h)`, which contradicted decided detail 99's own Effect TypeScript, `Effect.forkChild(Effect.catch(e, …))` (found by the round-19 Fable review).* `(join f) catch h` and `(fork e) catch h` are not `EK0505`; `(fork e) catch h` is still `EK0506`, as a `Fiber` is not an Effect in Effect 4.1.0. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 99). *Corrected again 2026-10-30: the fix wrapped `e` in an `effect` block, which moved `e` onto the forked fiber, so a failure of `try id()` in `e` stopped being the caller's. `fork e` evaluates `e` on the caller, as `const p = work(await id())` does.*
- **Amended 2026-10-30: the value and effect-block rows are removed.** The table rows `x catch guest` and `x catch effect { … }`, removed from the table above, are superseded by the function-literal rule (decided detail 31a): write `x catch () => guest` and `x catch effect () => { … }`; `x catch effect { return 7 }` is a syntax error. Recorded by the agent from Will's decision 31a (decided detail 31b).

*Corrected 2026-10-29: the example ends every `match` arm with `;`, the last one included, as the pinned TC39 grammar requires; a newline is not a separator (found by the round-3 review).*

- **Amended 2026-10-30: unchecked operands retain native delegation.** After the static Effect-assignability check, `try e` is still `yield* e`, with no dynamic Effect guard, Promise conversion or non-Promise identity. An unchecked noniterable produces its native `TypeError` as a defect. An unchecked iterable can instead complete normally, delegate Effects or return a value; no blanket rejection of all runtime non-Effects is added. Ordinary typed arrays and generators still fail the static operand check. See [Running Effects](../src/002-running.md#meaning) and the [runtime witness](../src/008-runtime.md#unchecked-delegation).

- **Amended 2026-10-30: diagnose the missing handler function first.** A parameter list followed directly by a block after `catch`, as in `try x catch (e) { B }`, is the existing `EK0509` malformed-handler error. Do not also report `EK0505` for that same incomplete handler. Once a function literal is present, the ordinary head check applies; independent context and separate syntax errors remain. Repair explicitly to `x catch effect (e) => { B }` or a plain fallback `x catch (e) => { B }` under their distinct existing throw/result rules. A mechanical repair must preserve valid parameters, bindings and source jump targets; it does not create block-handler syntax or auto-run a plain handler's returned Effect. See [the handler rule](../src/002-running.md#catch).

## Prior art

- Zig's `try` and `catch`.
- Rust's `?`.
- Swift's `try`, which marks each call that can fail.
- Effect's `yield*`.

## Will's words

> "using try and catch like zig seem like they really make a lot of sense to me. Then await can stay a promise thing … So then rather than overloading anything. We don't overload await it just means promise await. We instead [have] try be how you unwrap an effect. And then we have a concise way to wrap an sync or a promise in an effect. Sync that does not throw you can just callIt() normally otherwise it yells at you for not try if it has error type or error is unknown. promise you must wrap in an effect and then you can try it too."

> "I don't think effect functions should allow try catch statements nor do they need try catch statements nor would it be idiomatic to use them if we did support them. I think the cost for can't fail is fine."

> "Ok I accept that VIP"

> "for 2 yea it works pretty much like zig" (on `catch` taking a value or a function of the error)

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


- VIP-1's "await unwraps both". VIP-1 has been updated to match this VIP.
- D540's `await`, which ran Effects.
- The `try`/`catch` statement in Effect code.



## Later VIPs

- `for await` over a Stream, and `await.all` / `await.race`, need new spellings. They are decided in their own VIPs.
