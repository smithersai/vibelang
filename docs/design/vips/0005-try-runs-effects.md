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
- `e catch y` runs `e`, and on a failure evaluates `y`, as Zig's `catch` takes a value or `|err|`. As in Zig, you write `try x` or `x catch y`, never both. **Amended 2026-10-29:** the handler's syntax decides whether it runs Effects, as VIP-1 decides for any function:

  | Written | Effect TS |
  | --- | --- |
  | `x catch guest` (a value) | `Effect.catch(x, () => Effect.succeed(guest))` |
  | `x catch (e) => f(e)` (a plain function; a `throw` inside is a JavaScript exception, so a defect) | `Effect.catch(x, (e) => Effect.succeed(f(e)))` |
  | `x catch effect (e) => …` (an effect function; it runs its Effects, and `throw` fails again, typed) | `Effect.catch(x, (e) => Effect.gen(…))` |
  | `x catch effect { … }` (an effect block; runs the fallback) | `Effect.catch(x, () => Effect.gen(…))` |

  Recorded under Will's standing approval of recommendations, after the differential fuzz suite found that the earlier example's `throw` was a defect.
- **Amended 2026-10-29: `catch` binds like `??`.** It has the same precedence and is left-associative: `a catch b catch c` means `(a catch b) catch c`, and `x = a catch b` assigns the result. Mixing it with `??`, `||` or `&&` without parentheses is a compile error, as JavaScript requires for `??`. Recorded under Will's standing approval of recommendations.
- `try` is only for Effects. A call that may throw, and a Promise, is first wrapped into an Effect with Effect's own functions (VIP-6: `Effect.try`, `tryPromise`), then run with `try`.
- An `effect` function has no `try`/`catch` statement. It handles failures with `catch` and `match`.
- **Amended 2026-10-29: no `try` statements of any kind**, `try`/`finally` included. Cleanup uses Effect's `ensuring` or `onExit` (VIP-6 globals): `try ensuring(write(x), close())`. Effect code has exactly one `try`, the one that runs an Effect. Recorded under Will's standing approval of recommendations.
- `await` keeps exactly JavaScript's meaning and belongs only to `async` functions:
  - `await` inside an `effect` function is an error;
  - `await` on an Effect inside an `async` function is an error.
- An Effect that can't fail is still run with `try`, and that is fine.

*Corrected 2026-10-29: the examples call `queryDb`, a Promise-returning function imported from a `.ts` module, because VIP-33 forbids platform calls such as `fetch` anywhere in a `.vibe` file.*
- **Amended 2026-10-29: a non-literal function fallback.** In `x catch f`, where `f` is a non-literal function value, the fallback is the value `f`: syntax decides. A VIP-38 lint warning, with quick fixes to `catch (e) => …` or `catch effect { … }`, flags a fallback whose type is an Effect or a function. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: `try` works like `await`.** It is a unary operator with `await`'s precedence, and where `await` can't appear in an `async` function (its parameter list, a class field initializer, a `static` block), `try` can't appear in an `effect` function. Will, 2026-10-29: "try works like await."

*Corrected 2026-10-29: the example ends every `match` arm with `;`, the last one included, as the pinned TC39 grammar requires; a newline is not a separator (found by the round-3 review).*

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
