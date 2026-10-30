# VIP-4: `throw`, and calls that may throw

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
function parse(s) { if (!s) throw new Error("empty"); return s }   // may throw Error (inferred)
function add(a, b) { return a + b }                                 // doesn't throw
async function get(url) { return Promise.reject(new Error("no")) }           // allowed, as in TypeScript

effect function load(id) {
  if (!user) throw new NotFound(id)            // the same as failing with Effect.fail(new NotFound(id))
  add(1, 2)                                    // ok: doesn't throw
  parse(s)                                     // error: may throw, so wrap it and run it with try
  try Effect.try(() => parse(s))               // ok: Effect.try (a reserved word, so not a global)
  try tryPromise(() => queryDb(q))             // a Promise is always wrapped (VIP-6 global)
}
```

- `throw` and `Promise.reject` are allowed:
  - in a plain or `async` function, `throw` is JavaScript's throw;
  - in an `effect` function, `throw e` fails the Effect with `e`, a typed error, exactly as `Effect.fail(e)` does.
- The type system tracks whether a function may throw, and what it throws.
  - A `.vibe` function's throws are inferred from its body: an uncaught `throw`, or an unwrapped call of a function that may throw. Koka infers its `exn` effect the same way.
  - A plain function may call a function that may throw, and then may throw itself.
- An `effect` function may call a function that may throw only through an Effect wrapper. The wrapped call is then run with `try` (VIP-5). The wrappers are Effect's own functions, which VIP-6 makes global: `Effect.try` for sync code, and `tryPromise` for a Promise.
  - It always wraps a Promise, whether or not the Promise can reject.
  - It calls a function that does not throw directly.
- **Amended 2026-10-29: throw tracking applies only to functions that don't return an Effect.** A function that returns an Effect, whether an `effect` function or a `.ts` function whose return type is `Effect`, can't throw: calling it is never throw-tracked, and its failures are its Effect's error channel (Will: "@throws only applies to non effectful functions[;] an effectful function literally cannot throw").
- Library and global functions say what they throw with the JSDoc tag `@throws {ErrorType}`. A function with no `@throws` is assumed to throw `unknown`.
  - JavaScript's globals carry no such tags; `lib.d.ts` doesn't say that `JSON.parse` throws.
  - VibeLang ships its own annotations for the globals, so that `JSON.parse` throws `SyntaxError` and `Math.max` is known not to throw.
- A call given a callback that may throw may itself throw. Swift calls this `rethrows`.
- Implicit throws, such as reading a property of `undefined` or a stack overflow, are not tracked. They are defects, as in `Effect.sync`.
- **Amended 2026-10-29: `Stream`- and `Layer`-returning functions count as effectful.** Like a function that returns an Effect, they can't throw and are never throw-tracked. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: annotations for Effect's exports.** VibeLang ships `@throws` annotations for Effect's exports that don't return an Effect, as it does for `JSON.parse`: `Option.some` throws `never`, and `Schema.decodeUnknownSync` throws `SchemaError`. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: function types.** A function type or interface member with no `@throws` is non-throwing, as Swift's non-`throws` function type is. `@throws` on the declaration opts in. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: rethrows.** A function declares that it rethrows with a `@rethrows <param>` JSDoc tag. VibeLang ships the rethrowing globals: `map`, `forEach`, `filter`, `reduce`, `find`, `some`, `every`, `sort`, `Array.from` and the `Promise` executor. `setTimeout` does not rethrow, because it stores the callback. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: constructors and accessors.** `new X()` is throw-tracked; getters and setters are not. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: `try` only in effect code.** `try` is allowed only in effect code; plain functions may throw. The old part of EK2003 that made a plain return annotation forbid throws is deleted. Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: legacy JavaScript banned in all `.vibe` code.** Direct and indirect `eval`, `new Function` (and `Function(...)`), `arguments` (use rest parameters), `var` (use `let`/`const`) and `with` are each a compile error with a quick fix anywhere in a `.vibe` file, plain functions included. Legacy JavaScript lives in `.ts`/`.js` files. Inline `module {}` stays denied (VIP-25). Recorded in VIP-1 too. Decided by Will, 2026-10-29 15:57: "I don't have every api memorized that's on the agent to do a good job."
- **Amended 2026-10-29: which return types are effectful.** Only a return type that is wholly `Effect`, `Stream` or `Layer` exempts a function from throw tracking. `any`, `unknown` and a union with a non-effectful member (`Effect.Effect<number> | undefined`) are throw-tracked. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 36).

- **Amended 2026-10-30: generic declaration contracts.** Classify a generic declaration's return before type-argument substitution, using its constraints for assignability. An unconstrained `T` is not wholly effectful; a return constrained wholly to `Effect`, `Stream` or `Layer` can be. Instantiation substitutes types inside the existing own-throws/rethrows contract and preserves its classification through aliases and declaration output, even when the instantiated result is effectful. See [Thrown types](../src/003-failures.md#thrown-type-by-kind-of-callable).
- **Amended 2026-10-30: possible default callbacks.** A synchronous callable's `@rethrows` parameter admits a throwing default callback. Infer that value's thrown contract before assignment to its parameter type and include it conservatively in the callable's own bound, in addition to immediate throws from evaluating the default expression. Emit the bound in `@throws`; calls retain it even with a supplied safe callback, and a written bound must cover it. No conditional-default annotation is added. Ordinary `async` invocation instead keeps its never synchronous bound and callback admission without active synchronous rethrows; its initialization and callback throws reject the Promise. See [Calls in effect code](../src/003-failures.md#calls-in-effect-code).

- **Amended 2026-10-29: foreign callables.** Every callable declared in a `.ts`, `.d.ts` or JavaScript module (a `function`, a `const` of function type, a class method, each overload) throws `unknown` unless annotated. A function type with no `@throws` stays non-throwing. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 37).
- **Amended 2026-10-29: contracts sit on call signatures.** `@throws` and `@rethrows` attach to a call signature, as TypeScript attaches JSDoc to each overload; a returned function's contract sits on its own signature. Declaration output writes the contract on every emitted call signature. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 38).
- **Amended 2026-10-29: generated annotations.** The remaining annotations of `lib.d.ts` globals and effect 4.1.0's non-Effect exports are generated: `@throws {never}` only when the source has no `throw` reachable from well-typed input, a named class when one is known (`SchemaError`), otherwise `unknown`. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 40).
- **Amended 2026-10-29: only two wrappers take a throwing thunk.** Only `Effect.try` and `Effect.tryPromise` admit a throwing thunk. `sync`, `promise`, `callback` and `suspend` take `LazyArg`, which has no `@throws`, so a throwing thunk there is a compile error with a quick fix to the matching wrapper. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 41).
- **Amended 2026-10-29: recursion.** The thrown type of recursive and mutually recursive plain functions is the least fixed point over the strongly connected component, starting from `never`: `fib` throws `never`, and `walk`, which throws `Error` at its base case, throws `Error`. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 43).
- **Amended 2026-10-29: dynamic and union calls.** A call through `any`, an `unknown`-typed callable or `Function` throws `unknown`. A call of a union of callables throws the union of the alternatives' thrown types. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 44).
- **Amended 2026-10-29: a written `@throws`.** A written `@throws {T}` on a `.vibe` plain function is a checked upper bound, as a written return type is: the body may throw only subtypes of `T`, callers see `T`, and declaration output copies the tag. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 45).
- **Amended 2026-10-29: correction: the `Promise` executor does not rethrow.** This corrects the rethrows amendment above. `new Promise(() => { throw e })` rejects; it never throws at the construction site. `new Promise(exec)` is not throw-tracked, and the executor's throws become the rejection. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 64).

*Corrected 2026-10-29: in effect 4.1.0, `Schema.decodeUnknownSync(schema)` only builds a decoder and throws nothing; the decoder it returns is what throws `SchemaError`. The annotation amendment above means that returned decoder (found by the round-4 review).*

- **Amended 2026-10-30: compose thrown-type contracts (decided detail 66).** First, an effectful callee has synchronous thrown type `never`, with no `@rethrows` contribution. Otherwise determine its own thrown type from its written signature contract, then shipped annotation, then local body inference or the foreign/type-position default. Shipped annotations are installed before defaults. A foreign callable, including an interface method or callable constant with a written type, defaults to `unknown` from source and declarations alike; a function type in a `.vibe` type position defaults to `never`. Finally union the own thrown type with the actual callback thrown types for each `@rethrows` parameter; `@throws {never}` does not erase callback throws. Argument evaluation belongs to the caller. Decided by the agent from VIP-4 and detail 37 (principles 2 and 8), 2026-10-30, under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later".
- **Amended 2026-10-29: which built-in throws are implicit.** A throw specified for a `lib.d.ts` global is implicit when it comes from the receiver's or environment's state (a frozen receiver, a proxy, a user getter or `valueOf`, a detached buffer, a resource limit); every other specified throw is argument validation and is tracked with its class (`JSON.stringify` on a cycle, `BigInt("x")`, `repeat` counts, …). Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 81).
- **Amended 2026-10-30: the thrown-signature inventory is a generated artifact.** The generator writes `docs/design/inventory/throws.json`, keyed by module, declaration and overload signature, with own throws, `@rethrows` parameters, callback admission, returned callable contracts and the TypeScript lib and Effect versions it read. Regenerating it is part of an Effect or TypeScript bump. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 81a).
- **Amended 2026-10-29: throws from the pattern protocol are implicit.** A `match` with no matching arm (`TypeError`), the implicit read and call of `Symbol.customMatcher`, and the draft's protocol checks are implicit throws: never tracked, a defect in effect code. Calls the author writes in a subject, guard or arm, or as a predicate pattern, are tracked. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 95).
- **Amended 2026-10-29: `@throws` on an effectful callable.** In a `.vibe` file a `@throws` or `@rethrows` tag on an effectful callable (an `effect` function, arrow, method or producer, or a callable whose return type is wholly `Effect`, `Stream` or `Layer`) is `EK0406`, with the quick fix "remove the tag". In `.ts`, `.d.ts` and JavaScript inputs such a tag is ignored. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 96).

## Prior art

- Swift: `throws` in the type, `try` at each call, `rethrows`.
- Koka: the inferred `exn` effect.
- Java's checked exceptions, the cautionary tale: they were declared by hand, whereas VibeLang infers them.
- TypeScript's long-standing request for `throws` types.

## Will's words

> "Ok we can allow throw and we can allow Promise.reject. But here is the catch. Our type system pays attention to if a function is known to throw. And we do NOT allow you to call a function that may throw without properly wrapping it in an effect. Promises you have to wrap always even if they don't throw but sync functions that do not throw are allowed to be called without wrapping"

> "correct throw in an effect function is the same as returning Effect.fail(error)"

> "this is exactly right but later we will make try a keyword instead of Effect.try(). … Any javascript globals like JSON.parse must have no annotation. We add this annotation via @throws {ErrorType} in jsdoc. [Anything] that doesn't have this automatically throws unknown. But for globals like Math.max we can go through and self annotate it ourselves so that this language experience is great."

*Updated by VIP-5 and VIP-6 (2026-10-28): wrapped calls run with `try`, and the wrappers are Effect's own functions.*

*Corrected 2026-10-29: the examples call `queryDb`, a Promise-returning function imported from a `.ts` module, because VIP-33 forbids platform calls such as `fetch` anywhere in a `.vibe` file.*

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


R8 (2026-10-28, "no throw in .vibe"), and the form rules that made `throw` an Effect form (D550).

## Later VIPs

- "Effectify the universe": replace non-Effect functions such as `Array.map` with Effect-aware versions. Will: "a very complex and controversial one that we might not even do and won't be in our initial release". It will be proposed, but not accepted right away.
