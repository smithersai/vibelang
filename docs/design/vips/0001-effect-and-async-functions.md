# VIP-1: `effect` and `async` functions

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
effect function load(id) { return try fetchUser(id) }   // an Effect function
effect (id) => try fetchUser(id)                        // arrow

async function get(q) { return await queryDb(q) }      // a Promise function, as in TypeScript

class Users {
  effect find(id) { … }                                  // method
  async load() { … }
}

const c = (id) => fetchUser(id)   // neither keyword: plain JavaScript; returns the Effect unrun
```

- `effect` marks an Effect function, and `async` marks a Promise function. **Amended 2026-10-29: `effect` goes exactly where TypeScript allows `async`** (`effect function f()`, `effect function (x) {}`, `effect (x) =>`, `effect find()` in a class or object literal). The top-level shorthands `effect f()` and `async f()` are removed, because neither is TypeScript and Will wanted `function` visible. Outside those positions `effect` is an ordinary identifier, so `Layer.effect` and `const effect = …` still work.
- Inside an `effect` function, `try` runs an Effect (VIP-5). Inside an `async` function, `await` waits for a Promise, exactly as in JavaScript. Either keyword used in the other kind of function is an error.
- Calling an `effect` function returns its Effect unrun, just as calling an `async` function returns a Promise.
- An `effect` function's return type is an Effect, just as an `async` function's is a Promise. Like any function's return type, it can be written or left out, in which case it is inferred. An inferred type takes its success from what the function returns, and its errors and requirements from the Effects its body runs, as `Effect.gen` infers them.

  ```ts
  effect function load(id): Effect<User, NotFound, Users> { return try fetchUser(id) }   // written
  effect function load(id) { return try fetchUser(id) }                                  // inferred: the same type
  async function get(q): Promise<Row[]> { return await queryDb(q) }                      // as in TypeScript
  ```

- A Promise used inside an `effect` function is wrapped with `tryPromise` or `promise`. An Effect used inside an `async` function goes through `runPromise`. All three are VIP-6 globals.
- **Amended 2026-10-29: `new f()` on a `.vibe` function** gets TypeScript's own error only, with no stricter VibeLang check (the old EK1020 check is deleted). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: recursive inference** reports only TypeScript's own errors (TS7022, TS7023, TS7024); the old partial-slot rules of EK2102 are deleted. Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: no direct `eval` or `arguments`.** Direct `eval` and `arguments` are compile errors anywhere in a `.vibe` file, plain functions included; code that needs them lives in a `.ts` or `.js` file. Will: "anything problematic from js legacy should be forced to be wrapped in js either coming from a ts or js file … Even writing a normal sync js function should be banning things like eval arguments etc." Decided by Will on factory.vibelang.sh, 2026-10-29 ~14:20–14:25 ("revisit-r5"). Whether `new Function`, `var` and `with` are banned too was pending his confirmation; the next amendment decides it.
- **Amended 2026-10-29: legacy JavaScript banned in all `.vibe` code.** Direct and indirect `eval`, `new Function` (and `Function(...)`), `arguments` (use rest parameters), `var` (use `let`/`const`) and `with` are each a compile error with a quick fix anywhere in a `.vibe` file, plain functions included. Legacy JavaScript lives in `.ts`/`.js` files. Inline `module {}` stays denied (VIP-25). This replaces the previous amendment's pending list. Decided by Will, 2026-10-29 15:57: "I don't have every api memorized that's on the agent to do a good job."

## Prior art

- JavaScript and TypeScript `async function`, C# `async`, Rust `async fn`, Kotlin `suspend fun`. In each, a keyword on the function, never its body, decides its kind.
- Effect's `Effect.fn` and `Effect.gen`.

## Will's words

> "We should keep async await meaning promises. We should have effectful function use the keyword effect … await unwraps both. … awaiting a promise is not allowed in an effect function and awaiting an effect is not allowed in a async function."

> "I like your suggestion of having effect function load and just effect load. Let's do same with async so you can do async function get() or just async get()."

> "Going between effect and async already has existing support in promise if you are suggesting we should have more concise syntax for that keep that in mind but for another proposal."

> "obviously the return type of an effect function is an Effect. Just update VIP-1 to include this detail. Mention also that like any other function it can be inferred" (added 2026-10-28)

*Updated by VIP-5 (2026-10-28): `try`, not `await`, runs an Effect, and `await` means only what it means in JavaScript.*

*Corrected 2026-10-29: the return-type example uses `effect function` and `async function`, as the 2026-10-29 amendment requires.*

*Corrected 2026-10-29: the examples call `queryDb`, a Promise-returning function imported from a `.ts` module, because VIP-33 forbids platform calls such as `fetch` anywhere in a `.vibe` file.*

## Alternative considered and withdrawn (2026-10-29)

Will proposed, then withdrew, making every function effectful by default, with `sync function` for plain functions and `async function` for Promises. His reason was that the docs' first page "was way less intimidating when it had function keyword". `effect function` keeps the `function` keyword visible instead. Effectful-by-default would have required `sync` on most callbacks (`xs.map(sync (x) => x + 1)`). A context-dependent default (declarations effectful, argument arrows plain) was rejected as "too complex".

> "I think we should use effect modifier and default should be a plain function but should we do effect function or should we do effect nameOfFunction() {}?" … "Yea let's do it"

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


D550 (a function's kind inferred from `await` in its body), D541, the form rules of D500, and D456's "`async` only in a hatch".

## Left to later VIPs

- What `using` and Stream iteration mean inside an `effect` function. (`throw` is VIP-4, and `try`/`catch` is VIP-5.)
- Top-level `await` and `main`.
