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
  - It always wraps a Promise, whether or not the Promise can reject. Tagged-template invocations use the same selected-signature Promise/thenable result test and explicit bridge; the native tag invocation remains in the thunk, preserving its receiver, template identity, substitutions and evaluation order. Runtime `import()` uses the same explicit bridge. Its intrinsic operation has synchronous own thrown type `never`, while source argument expressions keep their separate contracts/order; coercion, attributes, loading, linking and evaluation failures reject the Promise. Keep the complete native expression inside the thunk; type queries/static declarations are not runtime invocations, and literal module bans remain independent.
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
- **Amended 2026-10-29: recursion.** The thrown type of recursive and mutually recursive plain functions is the least fixed point over the strongly connected component, starting from `never`: `fib` throws `never`, and `walk`, which throws `Error` at its base case, throws `Error`. If an expanding summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected inferred strongly connected component to `unknown` and emit `@throws {unknown}`; never truncate its union or emit an invalid circular alias. This applies to mutual recursion too. A written checked upper bound cuts the corresponding inference dependency and is checked normally; unrelated source type errors retain TypeScript's diagnostics. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 43).
- **Amended 2026-10-29: dynamic and union calls.** A call through `any`, an `unknown`-typed callable or `Function` throws `unknown`. A call of a union of callables throws the union of the alternatives' thrown types. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 44).
- **Amended 2026-10-29: a written `@throws`.** A written `@throws {T}` on a `.vibe` plain function is a checked upper bound, as a written return type is: the body may throw only subtypes of `T`, callers see `T`, and declaration output copies the tag. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 45).
- **Amended 2026-10-29: correction: the `Promise` executor does not rethrow.** This corrects the rethrows amendment above. `new Promise(() => { throw e })` rejects; it never throws at the construction site. `new Promise(exec)` is not throw-tracked, and the executor's throws become the rejection. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 64).

*Corrected 2026-10-29: in effect 4.1.0, `Schema.decodeUnknownSync(schema)` only builds a decoder and throws nothing; the decoder it returns is what throws `SchemaError`. The annotation amendment above means that returned decoder (found by the round-4 review).*

- **Amended 2026-10-30: compose thrown-type contracts (decided detail 66).** First, an effectful callee has synchronous thrown type `never`, with no `@rethrows` contribution. Otherwise determine its own thrown type from its written signature contract, then shipped annotation, then local body inference or the foreign/type-position default. Shipped annotations are installed before defaults. A foreign callable, including an interface method or callable constant with a written type, defaults to `unknown` from source and declarations alike; a function type in a `.vibe` type position defaults to `never`. Finally union the own thrown type with the actual callback thrown types for each `@rethrows` parameter; `@throws {never}` does not erase callback throws. Argument evaluation belongs to the caller. Decided by the agent from VIP-4 and detail 37 (principles 2 and 8), 2026-10-30, under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later".
- **Amended 2026-10-29: which built-in throws are implicit.** A throw specified for a `lib.d.ts` global is implicit when it comes from the receiver's or environment's state (a frozen receiver, a proxy, a user getter or `valueOf`, a detached buffer, a resource limit); every other specified throw is argument validation and is tracked with its class (`JSON.stringify` on a cycle, `BigInt("x")`, `repeat` counts, …). Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 81).
- **Amended 2026-10-30: declared built-in domains.** A selected declaration/overload has one own thrown bound for its full admitted receiver and parameter types. Safe literals or local range proofs at an individual call do not erase that contract. Receiver/environment state, coercion/protocol hooks and resource failures remain implicit under the rule above. String `padStart`/`padEnd` use `ToLength` and have no own count-validation throw; their well-typed signatures have own thrown type `never`, unlike `repeat`'s count validation. See [Implicit throws](../src/003-failures.md#implicit-throws). Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later".
- **Amended 2026-10-30: the thrown-signature inventory is a generated artifact.** The generator writes `docs/design/inventory/throws.json`, keyed by module, declaration and overload signature, with own throws, `@rethrows` parameters, callback admission, returned callable contracts and the TypeScript lib and Effect versions it read. Regenerating it is part of an Effect or TypeScript bump. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 81a).
- **Amended 2026-10-29: throws from the pattern protocol are implicit.** A `match` with no matching arm (`TypeError`), the implicit read and call of `Symbol.customMatcher`, and the draft's protocol checks are implicit throws: never tracked, a defect in effect code. Calls the author writes in a subject, guard or arm, or as a predicate pattern, are tracked. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 95).
- **Amended 2026-10-29: `@throws` on an effectful callable.** In a `.vibe` file a `@throws` or `@rethrows` tag on an effectful callable (an `effect` function, arrow, method or producer, or a callable whose return type is wholly `Effect`, `Stream` or `Layer`) is `EK0406`, with the quick fix "remove the tag". In `.ts`, `.d.ts` and JavaScript inputs such a tag is ignored. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 96).

- **Amended 2026-10-30: synchronous call phases.** Ordinary synchronous and async generator construction infers synchronous throws from parameter initialization only; the suspended body belongs to iterator resumption. A nongenerator `async` callable instead rejects its Promise for body, parameter/default and callback throws. A source `@rethrows` parameter still admits throwing callbacks, but declaration output preserves that admission on its parameter callable with `@throws {unknown}`, emits callee `@throws {never}`, and omits an active synchronous `@rethrows`. A plain function returning a Promise keeps its ordinary synchronous thrown contract. Returned callables keep their own contracts.

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

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 1

(VIP-4) `Stream`- and `Layer`-returning functions count as effectful: they can't throw and are never throw-tracked, like Effect.

### Detail 2

(VIP-4) VibeLang ships `@throws` annotations for Effect's exports that don't return an Effect, as it does for `JSON.parse`. Examples: `Option.some` throws never; `Schema.decodeUnknownSync` throws `SchemaError`.

### Detail 3

(VIP-4) A function type or interface member with no `@throws` is non-throwing (Swift's non-`throws` function type). `@throws` on the declaration opts in.

### Detail 4

(VIP-4) Rethrows is declared with a `@rethrows <param>` JSDoc tag. VibeLang ships the rethrowing globals: `map`, `forEach`, `filter`, `reduce`, `find`, `some`, `every`, `sort`, `Array.from` and the `Promise` executor. `setTimeout` does not rethrow, because it stores the callback.

### Detail 5

(VIP-4) `new X()` is throw-tracked; getters and setters are not.

### Detail 20

(VIP-4/5) `try` is allowed only in effect code. Plain functions may throw (VIP-4). Delete the old "plain return annotation forbids throws" part of EK2003.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.

### Detail 36

(NW 1; VIP-4, decided detail 1) Only a return type that is wholly `Effect`, `Stream` or `Layer` exempts a function from throw tracking. `any`, `unknown` and any union with a non-effectful member (`Effect.Effect<number> | undefined`) are throw-tracked.

    Earlier Chapter002/003 subtype example receipt (before queued `81189ed245c1`): applied infb49f8835ff6 (spec-fix-b; queued, not a main receipt). Lists are nonexhaustive; Exit/Config positives and Stream/Layer/Fiber execution negatives retain structural assignability and separate function-return categories. Native strict matrix, Node2/Bun2, Success15, regen183/forms/spec/docs pass; final focused/docs checks pass after main rebase.
    ```vibe
    declare function g(): any                                 // tracked: try g() needs a wrapper if g throws
    declare function h(): Effect.Effect<number> | undefined   // tracked
    declare function k(): Effect.Effect<number>               // exempt
    ```
    Effect TS: `Effect.try(() => g())` where VibeLang requires the wrapper. Decided by the agent from principles 6 and 8; 2026-10-29.

    **Effect subtype examples (Opus round30 m53).** The operand predicate is structural assignability to `Effect.Effect<any, any, any>`, not an exhaustive list of names or syntax. Pinned Effect4.1.0 `Exit.Exit<number>` and `Config.Config<number>` pass, alongside the already-listed tagged-error instances and service/reference values. A concrete plain function whose declared return type is wholly such an Effect subtype is therefore already effectful and cannot throw (`EK0401`). Keep detail 115's pre-instantiation classification and every existing `any`/`unknown`/mixed-return exclusion; a later generic instantiation does not erase an established throws contract. `Stream`, `Layer` and `Fiber` do not pass the Effect execution operand predicate. Stream/Layer-returning functions still belong to the separate effectful-return categories accepted in detail1; Fiber does not acquire that exemption. Examples in002/003 must identify their lists as nonexhaustive rather than defining a second nominal whitelist.
    ```vibe
    effect function operands() { const a = try Exit.succeed(8); const b = try Config.succeed(7); return a + b }
    function bad(): Exit.Exit<number> { throw "x" } // EK0401: wholly Effect subtype
    ```
    Effect TS: `Effect.gen(function* () { const a = yield* Exit.succeed(8); const b = yield* Config.succeed(7); return a + b })`; a VibeLang-effectful function has the already-required never-throws contract. Decided by the agent from VIP-4/detail36's existing structural effectful-return test, VIP-5/detail88's operand assignability, principle1 (native Effect yieldable values) and principle2 (pinned Effect4.1.0 types), 2026-10-30. Saved `root-round30-reference.log` independently checks strict TypeScript5.9.3 assignability positives/negatives and native Exit8/Config7 execution; this continuation read those receipts without rerunning them. No VibeLang compiler behavior or source landing is claimed.


    Updated applied source receipt: 81189ed245c1 (spec-fix-b29 queued, not main), superseding fb49f8835ff6 with its full original source and9exact quotation companions preserved. Node2/Bun2 strict/native15, regen183/forms0moves/GoQuotes+Coverage/formalSpec+Docs pass onmain098. Compiler conformance remains separate.

### Detail 37

(NW 2; VIP-4) Every callable *declared* in a `.ts`, `.d.ts` or JavaScript module (a `function`, a `const` of function type, a class method, each overload) has thrown type `unknown` unless annotated. A function *type* with no `@throws` is non-throwing (decided detail 3). Appendix E's shipped annotations cover Effect's `dual` exports.
    ```vibe
    // lib.d.ts: export declare const parse: (s: string) => string
    effect function f(s: string) { return parse(s) }   // error: parse may throw unknown; wrap with Effect.try
    ```
    Effect TS: `Effect.try(() => parse(s))`. Decided by the agent from principle 8 and VIP-4's library-function default; 2026-10-29.

### Detail 41

(NW 25; VIP-4, decided detail 3) Only `Effect.try` and `Effect.tryPromise` admit a throwing thunk. `sync`, `promise`, `callback` and `suspend` take `LazyArg`, which has no `@throws`, so a throwing thunk there is a compile error with a quick fix to the matching wrapper.
    **Immutable-main source portion (098e7a, 41).** Both for-concurrent ownership examples now pass a thunk to `sync`, with the matching Effect TypeScript counterpart and existing child-ownership distinction. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    ```vibe
    try sync(() => parse(s))                 // error: use Effect.try
    try promise(() => queryDb(q))            // error when queryDb may throw: use tryPromise
    try tryPromise(() => queryDb(q))         // ok
    ```
    Effect TS: `Effect.try(() => parse(s))`, `Effect.tryPromise(() => queryDb(q))`. Decided by the agent from principles 6 and 8 and decided detail 3; 2026-10-29.

    **Approved bridge retained after the new ruling.** Will explicitly keeps the foreign-call bridge. `Effect.try(() => foreignParse(s))` and `Effect.tryPromise(() => foreignAsync(s))`, including their options-object thunk forms, remain that bridge; removing local throws inference must not reject the approved foreign-call thunk pattern or make it execute during construction. A source `throw` inside a synchronous VibeLang thunk remains forbidden; neither wrapper grants a local throwing-function annotation or permits an arbitrary plain source helper to throw. Resolve imported wrappers/contracts hygienically and preserve aliases according to their actual symbols. Decided by the agent from Will's unchanged foreign bridge and the already-accepted VIP-4 wrappers, principle1 (idiomatic Effect), 2026-10-31. Native Effect4.1.0 controls confirm cold construction, one foreign call and the expected typed failure with an identity catch mapper (`nothrow-ruling-native-reference.json`); they do not prove new compiler enforcement.

### Detail 43

(NW 34; VIP-4) The thrown type of recursive and mutually recursive plain functions is the least fixed point over the strongly connected component, starting from `never`.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    ```vibe
    function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) }   // throws never
    function walk(n: number) { if (n) walk(n - 1); else throw new Error("end") }     // throws Error
    ```
    Effect TS: `fib` is called directly; `walk` needs `Effect.try`. Decided by the agent from principle 1 (a non-throwing `fib` must not need a wrapper; all four reviewers recommend it); 2026-10-29.

### Detail 44

(NW 36; VIP-4) A call through `any`, `unknown`-typed callables or `Function` throws `unknown`. A call of a union of callables throws the union of the alternatives' thrown types; an object type's members are checked member by member (decided detail 3).
    ```vibe
    const f: any = parse; f(s)        // throws unknown
    (cond ? parse : add)(s)           // throws BadInput | never = BadInput
    ```
    Effect TS: `Effect.try(() => f(s))`. Decided by the agent from principle 8 (`unknown`) and principle 2 (TypeScript unions a union call's return types); 2026-10-29.

### Detail 45

(NW 37; VIP-4) A written `@throws {T}` on a `.vibe` plain function is a checked upper bound, as a written return type is in TypeScript: the body may throw only subtypes of `T`, callers see `T`, and declaration output copies the tag.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    ```vibe
    /** @throws {Error} */
    function parse(s: string) { if (!s) throw new BadInput(); return s }   // ok: BadInput extends Error
    /** @throws {never} */
    function bad(s: string) { throw new BadInput() }                       // error: BadInput is not never
    ```
    Effect TS: none (types only). Decided by the agent from principle 2 (a written return annotation is checked against the body); 2026-10-29.

### Detail 66

**Thrown-type classification is a procedure, not an ordered table** (resolves round 13's Sol M1, Astra M1, Opus M1; replaces round 13's "the rows apply in order and the first that matches decides"). For a call, in this order:
   1. **Effectful callee:** an effectful function cannot throw (VIP-4 amendment); its synchronous thrown type is `never`, and `@rethrows` adds nothing.
   2. **The callee's own thrown type**, by where the callable is declared:
      - a written `@throws {T}` on the declaration, or on its declared type, gives `T` (a checked upper bound in `.vibe`);
      - else a shipped annotation (JavaScript globals, Effect exports) gives its `T`; shipped annotations are installed on their signatures before any default applies;
      - else a plain function declared in `.vibe` gives the type inferred from its body (decided details 1-4);
      - else a callable declared in a `.ts`, `.d.ts` or JavaScript module gives `unknown`, whether or not its type is written (a `function`, a `const` of function type with or without an annotation, a class or interface method, each overload; detail 37). An emitted `.d.ts` and its source agree;
      - else a function type written in a `.vibe` type position (a parameter, alias, interface member or annotation) gives `never`.
   3. **Rethrows:** at each invocation, union the callee's own thrown type with the thrown types of the arguments passed for each `@rethrows` parameter, whichever case in step 2 applied. Evaluating the argument expressions is the caller's code.
   Witness (Sol r13): `/** @rethrows f */ function invoke(f: () => number) { return f() }`; in effect code `invoke(() => { throw "bad" })` throws `"bad"` (EK0403), while `try Effect.try(() => invoke(() => { throw "bad" }))` is accepted. Write it as these three steps, not a table with precedence. Decided by the agent from VIP-4 and detail 37 (principles 2 and 8), 2026-10-30.

### Detail 81

**Which built-in throws are implicit** (NW 47; Opus M4; r16-003; extends details 2, 40 and VIP-4's implicit throws). A throw specified by ECMA-262 or the web/Node lib for a `lib.d.ts` global is implicit (untracked, a defect in effect code) when it comes from the receiver's or environment's state, not from the documented contract on the arguments: a frozen, sealed or non-extensible receiver; a revoked or trapping proxy; a user getter, setter, `valueOf`, `toString` or `Symbol.toPrimitive`; a detached buffer; or a resource limit (length overflow, stack, memory). Every other specified throw is argument validation and is tracked with its class: `JSON.parse`, `JSON.stringify` on a cycle or a `bigint`, `BigInt("x")`, `new RegExp(bad)`, `decodeURI*`, `atob`, `structuredClone`, `repeat`/`padStart` counts, `toFixed`/`toPrecision`/`toString(radix)` ranges, `new Array(-1)`, `normalize(form)`. Detail 40's generator applies this classification to the `lib.d.ts` globals, and the next spec round publishes its table in Appendix E with the generator's command.
    ```vibe
    effect function f(xs: number[], s: string, v: object) {
      xs.push(1)                                       // implicit: frozen receiver is receiver state
      const n = s.length                               // no throw
      const t = JSON.stringify(v)                      // error EK0403: may throw TypeError (cycle, bigint)
      const u = try Effect.try(() => JSON.stringify(v))   // ok
      return "ab".repeat(n)                            // error EK0403: may throw RangeError
    }
    ```
    Effect TS: `Effect.try(() => JSON.stringify(v))`. Decided by the agent from VIP-4 (its implicit examples, a property of `undefined` and a stack overflow, are receiver state and resource limits), detail 2 (`JSON.parse`, an argument validator, is tracked) and principle 8 (tracking more is the side that can be relaxed later); 2026-10-29.
    **Expanded throws artifact source receipt (f6fe7).** The previous global-only snapshot has been replaced by16,258 unique module/declaration/kind/signature entries across417modules:7,400global/8,858Effect, with319entries carryingrethrows,3,578callbacksand2,401returnedcontracts. Requiredfields/keyuniquenesschecked,116immutableTypeScriptlibhashes and1,144centralpinnedEffect4.1.0declaration/sourcehashes pluspackagehashallmatch. BundledTypeScriptversion7.1.0-dev/parser5.9.3 recorded. Fouroldfalsecoverageflagsarenolongerthisartifactformat. Full27,227-character nongenerateddocdiffread; raw9,191,285-character diffNOTfullyread. Generatorpath/pin/proof/extractionmetadataexcerpts andtestnamesonlyread; nogenerator/test/compiler/Go/LS/gaterun,no claim that every classification or the detail205 native-catch repair is verified. `main-f6f-throws-consistency.json` and`main-f6f-source-receipt.json` retain exactscope.

### Detail 95

**Throws from the pattern protocol are implicit** (NW 58; audit 003 interactions M1; r18-003; extends details 81 and 66). A `match` with no matching arm throwing `TypeError`, the implicit read and call of `Symbol.customMatcher`, and the draft's protocol checks (a matcher result that isn't iterable, an extractor arity mismatch inside the protocol, iterator closing) are implicit throws: never tracked, a defect in effect code. Calls the author writes in a subject, guard, arm, or as a detail 94 predicate are ordinary calls and are tracked. The static side is `EK4701`: an exhaustive `match` on a checked subject (detail 78) cannot reach the no-match `TypeError`.
    ```vibe
    function f(x: unknown) { return match (x) { when 1: "a"; } }        // f throws never
    function g(s: string) { return match (s) { when let t and if (JSON.parse(t)): 1; default: 0; } }   // g throws SyntaxError
    ```
    Effect TS: `Effect.sync(() => f(x))` (a no-match is a defect, as in `Effect.sync`). Decided by the agent from detail 81, which already classes user hooks the engine invokes implicitly (getters, `valueOf`, `Symbol.toPrimitive`) as implicit, VIP-4's implicit examples, and principle 6; 2026-10-29. Apply to 003 at the marker after "Thrown types".

### Detail 204

**Duplicate receipt: retire the legacy `EK4409` warning; use detail 203.** The same rule was recorded concurrently as detail 203 before this receipt was appended under a shorter spelling of the same live-finding key. This item introduces no independent decision and does not supersede 203; exclude it from decision counts. Preserve the additional independent reference evidence in `root-ek4409-reference.log` and `root-ek4409-receipt.json`; the original duplicate text is retained in `decide-live-scratch/ek4409-duplicate204-original.md`. Both receipts retire the old implicit-execution advisory, preserve VIP-4 unknown-throw checking and require explicit execution under VIP-1/VIP-5. Consolidated by decide-live, 2026-10-30.

### Detail 205

**Built-in argument-validation throws are classified per declared signature, not by the values at each call.** (live effectscript-f3 14:27Z; clarifies details 38/40/66/81/81a.) In the generator's “reachable from well-typed input” test, quantify over values admitted by the selected declaration/overload's receiver and parameter types under TypeScript `strict`. If any such input can reach an argument-validation throw, include that class in that signature's own thrown contract. A safe literal, prior local range check, literal-typed argument or compiler constant fold at a particular call does not replace that contract with `never`. Ordinary overload resolution still selects the actual signature, and written/shipped contracts plus existing generic substitution and `@rethrows` composition still follow detail 66; no new value-dependent throws specialization is introduced.
    Historical source receipt: applied in853bb410f35d (spec-fix-b; now rejected on the published inventory context, with own repair pending; not a main landing receipt), superseding rejected3a1a6901ad98 after current-main source reconciliation. The full signature/padding rule and every original example change are retained; qualified service keys and match punctuation from main are preserved. Node8/Bun8, regen183/forms/spec/docs and full docs-tools pass. No form decisions move and no compiler-conformance claim is added.

    Landed: f47be3e707a3 (spec-fix-b, bookmark 6) in main 86b5972e0cfb.

    Status update: applied in3a1a6901ad98 (spec-fix-b; queue accepted/held, not main). Replaces444d02f145fb with public VIP-4 declared-domain/padding amendment and current unreleased note; Node4/Bun4 and regen/forms/spec/docs pass.
    Status: applied in 444d02f145fb (spec-fix-b; queued, not yet a main landing receipt).
    ```vibe
    effect function format(s: string) {
      const fixed = try Effect.try(() => (1.5).toFixed(2)) // signature may throw RangeError
      const text = try Effect.try(() => "x".repeat(81))   // signature may throw RangeError
      const url = try Effect.try(() => new URL(s))       // signature may throw TypeError
      return [fixed, text, url]
    }
    ```
    Effect TS: each line is the corresponding `yield* Effect.try(() => call())`. The proposed generated `toFixed`/`repeat` contracts include `RangeError`, even for the safe arguments shown; `URL` construction includes `TypeError` for invalid strings. Conversely, a signature such as `Object.keys(o: object)` does not gain a tracked null/undefined-argument throw that its admitted types cannot reach. Preserve detail 81's separate exclusions for receiver/environment state, user coercion/proxy hooks and resource limits: a bounded safe repeat count does not alter the signature's argument-validation contract, while allocation/length exhaustion remains an implicit defect. This rule changes neither plain-function native execution nor how a bridge captures an actual exception.

    Decided by the agent from VIP-4 and details 38/66 (contracts are on call signatures and supplied by the selected signature), details 40/81/81a (the generated per-overload input-domain inventory), principle 4 (one signature contract rather than a call-site partial evaluator), and principle 8 (never infer a nonthrowing permission from an unapproved value proof), 2026-10-30. Update chapter 003, Appendix E, the generator and the affected user examples consistently; a thunk invoking one of these tracked signatures uses `Effect.try`, not a `sync` thunk whose callback contract forbids tracked throws. Add generator/annotation checks for both safe and failing argument values selecting the same signature, with a genuinely nonthrowing-signature control. At main `0c8154763044`, `throws.json` is still absent: these are required generated classifications, not a claim that an unpublished artifact exists or that today's compiler already reports those exact classes. Missing annotations retain detail 66's existing inference/default behavior; absence is not evidence for `never`. `root-builtins-signature-reference.log` verifies TypeScript `5.9.3` selects the same declaration for the safe/unsafe pairs and Effect `4.1.0` captures their actual `RangeError`/`TypeError` failures. This is signature/reference evidence, not VibeLang compiler conformance or a landed inventory.



    **Native JavaScript catch clarification (late migration inquiry).** The existing final paragraph's preservation of plain-function native execution applies to the JavaScript `try { ... } catch (...) { ... } finally { ... }` statement. It catches any native thrown completion reaching that handler, including untracked implicit property/getter exceptions; annotation presence, inferred `never` and a historical expected-error channel do not add a runtime filter. Native binding initialization, handler rethrows, `finally` and ordinary async `await` rejection behavior remain TypeScript's. This is distinct from the VibeLang `effect catch` expression and its typed-failure/defect separation; native try statements remain rejected in Effect code.
    ```vibe
    function catchesImplicit(): string {
      const o = { get value(): string { throw "implicit" } }
      try { return o.value } catch { return "caught" }
    }
    // "caught": the implicit property-access exception is not a tracked call.
    ```
    Effect TS: the identical plain TypeScript function followed by `Effect.runSync(Effect.sync(catchesImplicit))` succeeds with `"caught"`. `@throws` is a static call-signature contract, not a runtime JavaScript-catch selector. Detail56 permits the pure `URL` utility; it does not claim its constructor never throws. The existing81/205 classification requires `TypeError` for native invalid-URL argument validation; a missing or stale shipped annotation is an implementation/inventory gap.
    Decided by the agent from principle2 (native TypeScript/ECMAScript try/catch), VIP-4's throw-tracking amendment, this detail's explicit native-execution guarantee, the native TryStatement rules in002/AppendixA and213's public authority, 2026-10-30. Historical D282 does not enter the accepted language through a migration report or skill. Publish the clarification in the relevant VIP-4 amendment and affected chapters/skill under213. Keep transitional migration refusal/verification safeguards until runtime equivalence is actually established; the current legacy compiler's filtering is not claimed repaired. Existing migfix-t3code incident ownership is retained, with no duplicate implementation by decide-live.
    Native reference receipt: `root-native-catch-reference.log` passes strict TypeScript5.9.3 and Effect4.1.0 controls for implicit getter/null exceptions, original exception identity, finally/rethrow, ordinary async rejection and valid/invalid URL calls. These are native counterpart checks, not VibeLang compiler conformance.

### Detail 206

**String padding has no tracked count-validation throw for its well-typed signature.** (Erratum to detail 81's over-broad `padStart` example; supplements detail 205 without a call-site literal exemption.) For the standard `String.prototype.padStart` and `padEnd` signatures with a well-typed string receiver, `maxLength: number` and optional string filler, the generated own thrown contract is `never` under VIP-4's existing implicit-throw exclusions. Both use `ToLength`, which clamps nonpositive lengths, and the shared padding operation has no `repeat`-style argument-range rejection. Remove `padStart` from the tracked count-validator list in detail 81's copies, chapter 003 and Appendix E. Keep `String.prototype.repeat` tracked as `RangeError`: its declared numeric domain includes negative counts and positive infinity, which its algorithm explicitly rejects. This is classification of each declaration's whole admitted domain, not a safe-literal or narrowed-call exception to 205.
    Historical source receipt: applied in853bb410f35d (spec-fix-b; now rejected on the published inventory context, with own repair pending; not a main landing receipt), superseding rejected3a1a6901ad98 after current-main source reconciliation. The full signature/padding rule and every original example change are retained; qualified service keys and match punctuation from main are preserved. Node8/Bun8, regen183/forms/spec/docs and full docs-tools pass. No form decisions move and no compiler-conformance claim is added.

    Landed: f47be3e707a3 (spec-fix-b, bookmark 6) in main 86b5972e0cfb.

    Status update: applied in3a1a6901ad98 (spec-fix-b; queue accepted/held, not main). Replaces444d02f145fb with public VIP-4 declared-domain/padding amendment and current unreleased note; Node4/Bun4 and regen/forms/spec/docs pass.
    Status: applied in 444d02f145fb (spec-fix-b; queued, not yet a main landing receipt).
    ```vibe
    effect function padded(n: number) { return "x".padStart(n, "0") } // no tracked throw; resource errors remain defects
    const deferred = Effect.sync(() => "x".padEnd(-1, "0")) // allowed; succeeds with "x" when run
    ```
    Effect TS: an ordinary string-padding call in `Effect.gen`, or `Effect.sync(() => "x".padEnd(-1, "0"))`. A native allocation/length limit may still raise an exception; it remains an implicit resource defect under detail 81. Receiver/proxy/coercion-hook state retains the existing implicit treatment, and values outside the declared argument domain do not invent an argument-validation contract for a well-typed signature.

    Decided by the agent from principle 2 (the published ECMAScript algorithms), VIP-4/detail 81's explicit resource/coercion exclusions, and principle 4 (apply the actual per-signature criterion rather than infer validators from a numeric parameter or similar method name), 2026-10-30. The [ECMAScript 2025 padding algorithms](https://tc39.es/ecma262/2025/multipage/text-processing.html#sec-string.prototype.padstart) use [ToLength](https://tc39.es/ecma262/2025/multipage/abstract-operations.html#sec-tolength); [repeat](https://tc39.es/ecma262/2025/multipage/text-processing.html#sec-string.prototype.repeat) has an explicit range check. No Will choice is needed: this corrects an example contradicting its own already-approved classification rule and adds no runtime behavior or public API. Add generator/annotation controls for both padding methods beside the tracked-repeat control and repair affected prose/examples. The inspected legacy annotation table already lists both padding methods as `never`; do not change them to `RangeError` just to match the mistaken list. `padding-ecma-primary.txt` captures the published-source steps; `padding-reference.log` passes strict native TypeScript 5.9.3 and Effect 4.1.0, with negative/nonpositive padding returning the original string and negative/infinite repeat throwing `RangeError`. No huge allocation was attempted; this is primary-source/reference evidence, not a VibeLang compiler-conformance or generator-delivery claim.

### Detail 250

**JSX keeps VIP-4 call-signature assignability; an untracked element operation is not a callback-contract exemption.** (Loop r4 Opus OPUS-1; accepted VIP-4 function-type/signature amendments, VIP-39 every-VibeLang-rule clause; details37/38/45/66.) Apply the ordinary thrown-contract comparison wherever native JSX checking actually compares one call signature against another. This includes a callback value checked against a prop's function type and an actual component-call-signature comparison against `JSX.ElementType`. Untagged destination function signatures admit `never`; `@throws {U}` admits subtypes of `U`; admitted `@rethrows`, `any`, unions, overloads and ordinary native assignment rules retain their existing treatment. Do not invent an extra callable comparison for an intrinsic string tag or a native check that only compares result types. Preserve native independent JSX/type diagnostics and report existing `EK0402` for an otherwise-native-compatible signature whose thrown bound does not fit.
    **Current JSX consequence:** the local callback-summary and `Loud` examples below are historical. A VibeLang callback does not acquire an inferred thrown bound from its body; `runFork(save())` cannot trigger `EK0402` through removed local inference. Direct foreign-call legality follows the new ruling and the existing Effect bridge. Synchronous source `throw` is rejected at its own site. Native JSX checking and no synthetic element call remain; imported foreign function values retain their actual foreign contracts.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    VIP-39's element operation remains untracked for inference: evaluating a tag does not add a synthetic tracked factory/component invocation or propagate its declared thrown type into the enclosing function. That separate rule does not remove signature assignability. Consequently an event callback containing an uncaught `runFork(save())` with own thrown bound `unknown` does not fit an untagged nonthrowing callback prop. Changing its expression body to a block does not erase the bound, and a helper that merely forwards it retains that bound. Correct the VIP's `SaveButton` example rather than treating it as an exception to VIP-4. A prop type that deliberately admits throws, or a callback that actually handles all synchronous tracked exceptions, uses the existing rules; do not automatically swallow exceptions or falsify a `@throws {never}` annotation. An Effect-returning callback remains subject to native `void` callback assignability and still returns an unrun Effect; this rule adds no implicit execution.
    ```vibex
    // JSX fixture: button.onClick is () => void; JSX.ElementType's callable slot is untagged.
    // The JSX elements below are in a .vibex file.
    declare const text: string
    const bad = <button onClick={() => JSON.parse(text)}>Save</button> // EK0402: SyntaxError does not fit never
    const handled = <button onClick={() => { try { JSON.parse(text) } catch {} }}>Save</button>
    function Loud(): never { throw new Error("loud") }
    const badTag = <Loud/> // EK0402 when native ElementType compares Loud's signature to an untagged callable
    ```
    Effect TS: the JSX expressions and ordinary plain `try`/`catch` remain the same `.tsx` source after contract metadata is erased; TypeScript itself does not enforce `@throws`. The handled callback has no escaping synchronous exception from `JSON.parse`; the empty catch is an illustrative explicit policy, not a quick-fix prescription. Native TypeScript5.9.3 controls accept these JSX shapes and independently reject a wrongly typed prop and a return-incompatible tag (`TS2322`/`TS2786`) in `native-loop-r3/jsx-contracts-*.tsx`. Those controls identify native comparison sites only; they do not prove VibeLang `EK0402` emission. Decided by the agent from accepted VIP-4's function-signature contract and VIP-39's explicit preservation of every VibeLang rule, principle4 (one signature rule without a JSX exception), and principle8 (do not grant an unspecified throwing-callback escape), 2026-10-31. Reconcile public VIP-39/VIP-4, chapter003 and tooling/examples under213. No existing `.vibe` contract is relaxed and no new diagnostic code is allocated. Required regression/spec-quoted fuzz coverage: intrinsic/custom props, component tags with/without an actual callable comparison, admitted/untagged/unknown thrown bounds, handled/escaping calls, overloaded/union/generic signatures, foreign callbacks, block/expression wrappers, native type-error controls and unrun Effect-returning `void` callbacks.

    **Tag clause superseded by VIP-39 (sl4-apply, 2026-11-01, loop r4 apply):** the comparison of a tag against `JSX.ElementType` or `JSX.ElementClass` is not a VIP-4 assignability site. Accepted VIP-39 rejects elements as tracked calls because "Tracking would make every component throw `unknown` under VIP-4's foreign-callable rule, which `.tsx` never imposes", and promises zero JSX errors on the migrated witnesses; under this detail's tag clause every untagged imported component (`<Suspense>`, `<Link>`) would be `EK0402`. A VIP wins over a decided detail (000:3), so the `badTag` line above is historical. The attribute clause stands and is published as VIP-39's "An attribute is an object member under VIP-4" bullet.

### Detail 282

**A migration preserves a foreign call's original defect contract with an explicit Effect bridge; export status never grants automatic trust.** (T3Code `codemod-gap:throwing-plain-helper-boundaries` / proposed exported-call `trusted(f, [])` quick fix, 2026-11-01; Will's retained foreign `Effect.try` bridge, VIP-4/VIP-5/VIP-27/VIP-34, existing 41/255/274/277; principles 1, 3 and 8.) A first-party import, an exported enclosing declaration, or pressure to keep its public error channel unchanged does not establish that a foreign callable is trusted. Do not automatically insert a trust declaration on that basis. Existing explicit trust approvals retain only their own stated scope.

    The claimed conflict is not inherent: when the original native synchronous call ran inside `Effect.gen` and an exception was a defect, preserve it using the existing native operations `Effect.orDie(Effect.try({ try: () => foreign(x), catch: (error) => error }))`. The identity mapper preserves the actual thrown value; `orDie` removes only the bridge's new failure channel. This both uses the required explicit foreign bridge and preserves that original defect contract without adding `UnknownError` to the public `E`. Default `Effect.try(() => foreign(x))` followed by `orDie` instead defects with the `UnknownError` wrapper, so it is not the exact-identity repair.

    Select this repair from the original resolved call and its failure/defect behavior, never from exportedness alone. Preserve call-time/run-time phase, argument and receiver evaluation, lexical captures and declarations. Keep the conversion around this synchronous foreign call only: do not turn unrelated existing typed failures into defects, change a deliberately typed foreign failure into a defect, or apply the synchronous pattern to Promise/iterator phases. The ordinary existing `Effect.try` failure form remains appropriate when that is the original or explicitly approved contract. If provenance, exact source transformation or the original declaration gate cannot establish preservation, refuse the automatic rewrite and retain the native module/boundary. No broad gate tolerance, local-source throw permission, new wrapper API, or new trust inference is introduced.

    ```vibe
    import { foreign } from "./foreign.ts"
    export effect function load(x: number) {
      return try Effect.orDie(Effect.try({
        try: () => foreign(x),
        catch: (error) => error
      }))
    }
    ```

    Effect TypeScript, for the original defect-producing contract:

    ```ts
    import { Effect } from "effect"
    import { foreign } from "./foreign.ts"
    export function load(x: number) {
      return Effect.gen(function* () {
        return yield* Effect.orDie(Effect.try({
          try: () => foreign(x),
          catch: (error) => error
        }))
      })
    }
    // Native original: Effect.gen(function* () { return foreign(x) })
    // Both declare Effect.Effect<number, never, never> in the bounded witness.
    ```

    Decided by the agent from principle 1 (idiomatic Effect bridge and explicit defect conversion), principle 3 (the actual original operation/contract rather than an export spelling), principle 8 (no inferred trust and refuse unproved migration), Will's retained foreign-call bridge and VIP-34's preservation requirement, 2026-11-01. Class A; no Will question, language admission change or public package API change. Ten native Effect 4.1.0 controls pass for cold execution, exact thrown-value identity across objects/errors/primitives, success values including nested Effect/thenable data, method receiver, and the default-wrapper negative control. TypeScript 5.9.3 strict declaration witnesses show original and identity-mapped defect bridge byte-identical while default `Effect.try` adds `UnknownError`. Receipts: `native-loop-r3/throw-defect-bridge/runtime-receipt.json` and `declaration-receipt.json`. These are native counterpart controls, not a VibeLang compiler/codemod run or proof for the four actual modules.

    Implementation owners retain regression and spec-quoted keyed fuzz/property coverage over export/private status, first-party/package imports, aliases/shadows, receivers/arguments, call phases, thrown primitives, nested success data, pre-existing typed failures, declaration artifacts and safe refusal. Minimize the actual T3Code source as a migration corpus and verify the original full target gates. No compiler/source/test edits, commit or queue action were made by this policy lane.

    - *Fifth addendum to detail 272 (effectscript-11, Will's proxy, decided; recorded 2026-11-01T07:47:35Z): the one allowed assertion edit.* A test that asserts a package's exact dependency list may gain exactly one `"vibelang-runtime"` entry, only in a package that gained that dependency, only in a list or object of dependencies, with each edit listed in the PR under its own heading so a reviewer sees these are assertion edits. This is the one allowed assertion edit, because a real dependency was added and the test exists to state that. Any other assertion change stays forbidden: the module stays `.ts` and the case goes to migfix. Rejected: inlining the runtime (a compiler change, and duplicated tags and fiber refs), leaving packages unmigrated for good, and moving the dependency to `peerDependencies` (it dodges the assertion).
