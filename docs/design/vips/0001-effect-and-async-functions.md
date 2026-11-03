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
  effect function load(id): User!NotFound!Users { return try fetchUser(id) }             // written
  effect function load(id) { return try fetchUser(id) }                                  // inferred: the same type
  async function get(q): Promise<Row[]> { return await queryDb(q) }                      // as in TypeScript
  ```

- A Promise used inside an `effect` function is wrapped with `tryPromise` or `promise`. An Effect used inside an `async` function goes through `runPromise`. All three are VIP-6 globals.
- **Amended 2026-10-29: `new f()` on a `.vibe` function** gets TypeScript's own error only, with no stricter VibeLang check (the old EK1020 check is deleted). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: recursive inference** reports only TypeScript's own errors (TS7022, TS7023, TS7024); the old partial-slot rules of EK2102 are deleted. Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: no direct `eval` or `arguments`.** Direct `eval` and `arguments` are compile errors anywhere in a `.vibe` file, plain functions included; code that needs them lives in a `.ts` or `.js` file. Will: "anything problematic from js legacy should be forced to be wrapped in js either coming from a ts or js file … Even writing a normal sync js function should be banning things like eval arguments etc." Decided by Will on factory.vibelang.sh, 2026-10-29 ~14:20–14:25 ("revisit-r5"). Whether `new Function`, `var` and `with` are banned too was pending his confirmation; the next amendment decides it.
- **Amended 2026-10-29: legacy JavaScript banned in all `.vibe` code.** Direct and indirect `eval`, `new Function` (and `Function(...)`), `arguments` (use rest parameters), `var` (use `let`/`const`) and `with` are each a compile error with a quick fix anywhere in a `.vibe` file, plain functions included. Legacy JavaScript lives in `.ts`/`.js` files. Inline `module {}` stays denied (VIP-25). This replaces the previous amendment's pending list. Decided by Will, 2026-10-29 15:57: "I don't have every api memorized that's on the agent to do a good job."
- **Amended 2026-10-29: every reference to the global `Function`.** The legacy-JavaScript ban covers every `IdentifierReference` that resolves to the global `Function`, except the right operand of `instanceof` and the object of a member access: `const F = Function` is an error; `x instanceof Function` and `Function.prototype.toString.call(f)` are allowed. The type `Function` stays TypeScript's. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 33).
- **Amended 2026-10-29: `effect` and `async` together.** `effect` and `async` on one function is a compile error, with quick fixes that remove one modifier: no Effect TypeScript function is both an `Effect.gen` and a Promise-returning `async` function. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 46).
- **Amended 2026-10-29: `Function` through `.constructor`.** Reading a property named `constructor` from a value whose static type is a function type or `Function` is `EK0107`; `(async () => {}).constructor` reaches the `AsyncFunction` constructor. Values typed `any` are not tracked. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 75).
- **Amended 2026-10-29: the `Function` member-access exemption covers `.prototype` only.** The exemption for the object of a member access narrows to a statically named `prototype` (`Function.prototype`, `Function?.prototype`, `Function["prototype"]`, and the same through `globalThis.Function`). Every other member of the global `Function` (`Function.call(null, "return 7")`, `Function.name`) is `EK0107`; the `instanceof` exemption stays. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 97).

- **Amended 2026-10-30: bindings behave as in an `async` body.** An `effect` body reads `this`, `super` and `new.target` exactly as the same body reads them in an `async` function of the same form: the same bindings, at the same step of evaluation, with the same errors. Building the Effect reads none of them. This replaces the helper recipe: how the compiler passes them in is its choice, and the spec keeps the reviewers' counterexamples as checked examples. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later".

## Amendment: modifier placement diagnostics

A recognized `effect` modifier follows the valid and diagnostic recovery positions of TypeScript’s `async`. On an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member, it is `EK0108`. TypeScript parses `async` as a modifier on an `interface` or type literal member before a member name or `[` (TS1070, TS1071); `effect` is recognized there, so this code reports it. Valid function/class overload signatures follow ordinary TypeScript admission and compatibility; the code does not reject a valid overload or admit a generator overload. A starred bodyless signature keeps TypeScript’s `TS1222`. A signature without a return annotation exposes `any`, with `TS7010` under `noImplicitAny`, as the bodyless `async` signature does; a written Effect type gives it a checked contract. Recognition is syntactic: an identifier-named method such as `interface Ordinary { effect(): number }` has no Effect modifier. Ordinary TypeScript syntax retains its native diagnostics. The existing getter/setter/constructor rejection is `EK0104`, and combining `async` and `effect` is `EK0105`; both may apply to one accessor. An error or schema-error member retains these applicable diagnostics without an extra member-category error (VIP-13).

## Amendment: mixed block modifier recovery

`effect async { B }` and `async effect { B }` remain rejected, with `EK0105`, as mixed function modifiers are. The parser recognizes both block heads for that diagnostic. A function repair can remove either modifier; the block repair removes `async`, keeping VIP-2’s `effect { B }`. No `async { B }` or runtime hybrid is added.

## Amendment: formal-parameter diagnostics

A forbidden `await` expression in directly evaluated formal-parameter initialization of an Effect callable or producer is `EK0102`. A forbidden `yield` expression there has the [producer diagnostic](../src/002-running.md#producers), and `try` keeps its [outside-Effect diagnostic](../src/002-running.md#static-rules). Defaults, destructuring defaults and computed binding keys use the same source boundary. Nested source callable or context boundaries keep their own native rules; this permits no parameter suspension.

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

*Corrected 2026-11-02: the written return type is `User!NotFound!Users` (VIP-3), as chapter 1 writes the same example; a bare `Effect<A, E, R>` type is not a VibeLang form (decided detail 260), and with Effect's modules in scope `Effect` names the namespace (found by the round-7 review).*

## Alternative considered and withdrawn (2026-10-29)

Will proposed, then withdrew, making every function effectful by default, with `sync function` for plain functions and `async function` for Promises. His reason was that the docs' first page "was way less intimidating when it had function keyword". `effect function` keeps the `function` keyword visible instead. Effectful-by-default would have required `sync` on most callbacks (`xs.map(sync (x) => x + 1)`). A context-dependent default (declarations effectful, argument arrows plain) was rejected as "too complex".

> "I think we should use effect modifier and default should be a plain function but should we do effect function or should we do effect nameOfFunction() {}?" … "Yea let's do it"

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


D550 (a function's kind inferred from `await` in its body), D541, the form rules of D500, and D456's "`async` only in a hatch".

## Left to later VIPs

- What `using` and Stream iteration mean inside an `effect` function. (`throw` is VIP-4, and `try`/`catch` is VIP-5.)
- Top-level `await` and `main`.

### Amendment: recursion depth (2026-11-01)

Plain functions have JavaScript's stack limit; recursion that must be stack-safe is written as an `effect` function. Running a recursive Effect with `try` uses Effect's stack-safe execution, as `yield*` does inside `Effect.gen`. A plain recursion's stack overflow is an implicit `RangeError`; its exact failing depth depends on the runtime. This clarifies VIP-1's ordinary-JavaScript function model and adds no explicit-throw permission.

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. Principles are numbered as in [the introduction's Details](../src/000-intro.md#details).

### Detail 30a

(Will 15:57: "I don't have every api memorized that's on the agent to do a good job.") Banned in **all** `.vibe` code, plain functions included, each a compile error with a quick fix: direct and indirect `eval`, `new Function` (and `Function(...)`), `arguments` (use rest parameters), `var` (use `let`/`const`), and `with`. Legacy JavaScript lives in `.ts`/`.js` files. Inline `module {}` stays denied (VIP-25). Record this as a VIP-1/VIP-4 amendment with this provenance.

    **Source restriction versus pinned do predicate (decide-live, 2026-11-02):** main cdc392859da9 chapter002 and the vendored README newly say a nonfinal `var` remains legal. That admission contradicts this item and VIP-4's accepted 2026-10-29 amendment. The pinned `VariableStatement` predicate can still describe the underlying TC39 form, including final-statement rejection and native hoisting, but does not lift VibeLang's independent `var` source restriction. A nonfinal `do { var value = 1; value }` in a `.vibe` file remains a compile error; use `let`/`const` for Vibe code or keep legacy source in `.ts`/`.js`. This is an application of30a/principle5, not a new prohibition or Will question. No compiler failure is inferred from docs alone.


    **Fresh compiler evidence (decide-live, 2026-11-02T20:07Z):** reviewer pass145 on matching cdc compiler/runtime reports two nonfinal var forms still compile/run, returning [1,1]. This is an observed source-restriction gap under30a/VIP4, not permission created by the final-var EK0201 predicate fix; parameter EK0203 also does not replace the global ban. Existing do-var:source-restriction ownership remains separate. Root read the report, not executed the witness.

### Detail 33

(NW 39; VIP-1/VIP-4 amendment 30a) The `Function` ban covers every `IdentifierReference` that resolves to the global `Function`, except the right operand of `instanceof` and the object of a statically named `prototype` access (detail 97). The type `Function` stays TypeScript's.
    ```vibe
    new Function("a", "return a")        // error (30a)
    Function("return 1")                 // error (30a)
    const F = Function                   // error: an alias reaches the constructor
    x instanceof Function                // allowed
    Function.prototype.toString.call(f)  // allowed
    ```
    Effect TS: none; `typeof x === "function"` and `x instanceof Function` are ordinary TypeScript. Decided by the agent from 30a's intent (no functions built from strings) and principle 8, taking the option Opus M2 and r11-001 both recommend; 2026-10-29.

### Detail 46

(NW 6; VIP-1) `effect` and `async` on one function is a compile error, with quick fixes that remove one modifier.
    ```vibe
    effect async function f() { }   // error: pick effect or async
    ```
    Effect TS: no function is both an `Effect.gen` and a Promise-returning async function. Decided by the agent from principles 7 and 8; 2026-10-29.

### Detail 97

**The `Function` member-access exemption covers `.prototype` only** (NW 60; Fable r17 m4; r18-001; amends detail 33, keeping its `instanceof` exemption). Detail 33's purpose is "no functions built from strings", and `Function.call(null, "return 7")`, `Function.apply(null, [s])` and `Function.bind(null, s)` all build one. So the object-of-a-member-access exemption narrows to a statically named `prototype`: `Function.prototype`, `Function?.prototype`, `Function["prototype"]`, and the same through `globalThis.Function` (detail 73). Every other member of the global `Function` is `EK0107`. `Function.prototype.constructor` stays `EK0107` (detail 75).
    Public VIP33 reconciliation landed as c080051ae52b from439c77582723 (spec-fix-c; globalThis platform code and VIP1 Function exemptions only).
    **Immutable-main source receipt (54182a, 97).** Immutable main `54182a644026` reconciles public VIP33 platform EK4402 versus legacy EK0107 and explicitly retains the existing qualified Function instanceof/prototype exemptions (history `5e0a70f5333a`). Source publication only, without extending the exemptions or asserting compiler parity.
    ```vibe
    x instanceof Function                 // ok (detail 33)
    Function.prototype.toString.call(f)   // ok
    Function.call(null, "return 7")()     // EK0107
    Function.name                         // EK0107
    ```
    Effect TS: none; `typeof x === "function"` is ordinary TypeScript. Decided by the agent from 30a's intent, detail 33's stated purpose and principle 8 (relaxing to another member later breaks no code); 2026-10-29. Apply to 001's `Function` row and Legacy JavaScript list.

### Detail 118

**Eager parameter-initialization defects in source effect callables become cold defects, not synchronous call throws.** (NW 67, v19/NEEDS-WILL; Fable round-19 design cost 1; r20-001/r20-008; refines detail 68.) Choose NW 67 option B from Will's explicit rule “an effectful function literally cannot throw” and the existing async-function analogy; there is no need to ask him the same rule again. Parameter/default/destructuring work still runs eagerly, once per call, before the cold body. If that initialization—including a moved-default prologue—abruptly throws an implicit JavaScript exception, construction returns `Effect.die(e)` (a producer returns `Stream.die(e)`) instead of throwing to its caller. Preserve the original thrown value. A tracked throwing call is still `EK0401`; this introduces no typed failure. An outward default `return v` still returns `Effect.succeed(v)`, and a producer's bare return gives `Stream.empty`. Keep legal parameter-default returns; NW 67 option C's extra ban is not adopted.
    **Immutable-main source scope (59c774, 118).** 002/publicVIP5 pair await in async bodies with try in Effect bodies; transparent expressions inherit the corresponding source context. This is table/context source publication, not new operator permission. `main-59c-source-receipt.json` records the complete five-file read; no own compiler/gate/native rerun.
    Status: applied in 5bc0a245ca38 (spec-fix-d; queued, not yet a main receipt). The normal-form table now delegates abrupt initialization to one boundary, with executed Effect/Stream exception counterparts.
    ```vibe
    effect function f({ a } = do { const v = undefined; v }) { return a }
    const p = f() // no synchronous throw; running p dies with the initialization TypeError
    ```
    Effect TS: perform eager initialization inside a generated synchronous boundary, `try { /* bind source parameters, moved defaults */; return Effect.gen(body) } catch (e) { return Effect.die(e) }`; for a producer use `Stream.die(e)`. A catch inside an ordinary function body cannot catch its own native parameter failures: move the whole fallible binding/prologue into the boundary using hygienic parameters/helper activation while preserving source parameter environments, function length, this/new.target, and evaluation order. Argument-expression throws before the call remain the caller's throws. This applies to source `effect` callables, not an inserted catch around arbitrary foreign Effect-returning functions, which retain detail 36's trusted static contract. Decided by the agent from principle 6 (Will's cannot-throw rule), principle 2 (async-function parameter abrupt completions reject), and principle 4 (one boundary for original and moved initializers), 2026-10-29. Every affected moved-do example remains compiler-gap; record this as a VIP-1/VIP-2/VIP-4 amendment, with the existing detail-68 TDZ caveat unchanged.

    **Foreign effectful initializer clarification (Fable30m16).** Apply the existing containment by the enclosing source callable's kind, even when the callee evaluated by a default is a trusted .ts Effect-returning function whose implementation violates its static never-throws contract. That trust suppresses a tracked-call rejection; it does not bypass the enclosing initializer boundary. An admitted runtime initializer exception gives an Effect that dies for an enclosing Effect callable, a Stream that dies for a producer, and a rejected Promise for an ordinary nongenerator async callable. An enclosing plain synchronous callable or ordinary sync/async generator retains its native synchronous construction throw. Source caller argument expressions remain outside the called declaration's parameter-initialization guard, and actual evaluation stays eager/once-only before its body. Preserve the actual thrown value and all existing scope/TDZ/reuse rules. Qualify003's older generic "a JavaScript exception at the call in a parameter default" sentence by its enclosing kind, rather than reviving that behavior for Effect/producer construction or exempting foreign effectful calls. This applies118's containment and108/185's native callable phases, retaining197's separate default-jump/parameter-environment rules; no new permission, runtime wrapper policy or Will question. Decided by the agent from the accepted initializer containment and VIP4's already-chosen static foreign-contract trust, 2026-10-30.

    **Corresponding body contexts (Fable rounds28–30 m14).** The002 parity table compares native `await` in an async body with `try` in the corresponding Effect body. Transparent expressions inherit that respective context; ordinary nested callable/class boundaries and the separately stated top-level case retain their existing rules. It does not permit both operators in both kinds of body. This is the accepted VIP-1/VIP-5 context rule, not a new permission or diagnostic. Source clarification applied in `bc1882972f2e` (spec-fix-b; fixer-reported queued, not main), including a separate public VIP-5 clarification that preserves the original receipt. One baseline documentation failure/one native pass then Node2/Bun2/strict TypeScript5.9.3 and regeneration/forms/spec/docs pass are attributed to the fixer; no compiler conformance or independent rerun is claimed.

    Applied in 8deb35e468a5485f9c5fe71424a971e314b8d127 (spec-fix-d/bookmark35; accepted independent replacement, not main). Original five regressions/runtime witness retained; immutable-main4docfail/native1pass, afterNode5/Bun5/strict/native and24 native async controls pass. Fresh final spec/docs/regen/forms pass without decision moves; originalbb9d retired only after acceptance. Preserves permitted default returns and native ordinary generator phases.

    Applied in f7f461bc9fc5564902d9e65c65da88ffb397b38a (spec-fix-d/bookmark39; complete35 replacement, queued not main). All original source/tests/runtime retained; stale quotation repair preserves programs/diagnostics/pending records and enables existing quote/coverage tests in fast gate. Rebasedfb3 expanded spec/docs/forms pass; queued8deb retired only after replacement acceptance.

    **Immutable-main source publication (013cfa002833, 118).** Chapter 001 now explicitly covers eager parameter-binding exceptions: the source Effect callable returns a cold Effect or producer Stream that dies with the thrown value; the call itself does not throw. Its simple lowering table describes successful binding only. This publishes the existing detail 118 boundary, not a new evaluation phase or compiler-conformance result. The full six-file diff was read; `source-013-publication.json` retains its hash and exact scope.

### Detail 175

**Effect overload signatures follow TypeScript's async declaration positions.** (live `900-effect-overload-bodies`; VIP-1's accepted placement rule, not a new feature.) Admit a bodyless overload-signature alternative for an effect function declaration and an effect class method wherever TypeScript admits the corresponding `async` overload signature. Preserve TypeScript's signature ordering, adjacent implementation requirement, overload/implementation compatibility, modifiers and semicolon/automatic-semicolon rules, replacing the Promise result by the specified Effect result. Split declaration/method productions by syntactic position rather than making every `Block` optional. Function expressions, object-literal methods and arrows still require bodies. Do not add starred effect-function/method overload signatures: TypeScript rejects starred generator overload signatures with TS1222. Ambient async positions rejected by TypeScript do not become new effect-modifier positions. Ordinary inherited overload mechanisms remain as TypeScript defines them; a bodyless signature itself executes no code.
    **Immutable-main source receipt (695576, 175).** Verified at immutable main `695576acb44b`: 001/AppendixA state native async-like effect overload positions, ordering/compatibility/ASI, and class-versus-object method boundaries. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in 2a1c089083b1 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    effect function pick(x: string): string!!;
    effect function pick(x: number): number!!;
    effect function pick(x: string | number) { return x }
    class C {
      effect m(x: string): string!!;
      effect m(x: number): number!!;
      effect m(x: string | number) { return x }
    }
    ```
    Effect TS: the same ordinary function/class overload lists returning `Effect.Effect<string>` or `Effect.Effect<number>`, with one implementation returning `Effect.gen(function* () { return x })`. Declaration output preserves each exposed signature and its Effect return type; effectful signatures still carry no synchronous `@throws`, and detail 138's implementation-bound checks remain. Decided by the agent from VIP-1's explicit rule that `effect` goes exactly where TypeScript allows `async`, principle 2 (inherit overload syntax/checking), and principle 4 (separate bodyless declaration positions instead of a universal optional body), 2026-10-30. Reconcile 001 and Appendix A with these alternatives and provide declaration-output witnesses. Evidence: `effect-overload-types.log` exits 0 under strict TypeScript and `effect-overload-reference.log` gives `Success("ok")`/`Success(7)` on Effect 4.1.0. `overload-position-check.log` independently accepts the function/class async overloads and rejects bodyless expressions/object methods, starred overloads and ambient async declarations (TS1005/1222/1040). These are native TypeScript/Effect reference checks, not VibeLang compiler-conformance evidence.

Landing receipt: source 2a1c089083b1 landed in main 695576acb44b (queue 1793370440-spec-fix-a, gate mq-10302026-7).


    **Unannotated effect overloads and recovery cover (Opus31m61/m63/m64).** Preserve TypeScript's bodyless-signature behavior: an omitted return annotation exposes `any`, with native `TS7010` when `noImplicitAny` is enabled. Do not infer that exposed signature from its implementation or invent `E`/`R`; an explicit Effect annotation supplies the checked contract. The source callable's effect kind, eager initialization and returned cold Effect stay unchanged. Unsupported interface/type-literal method and `abstract`/`declare` effect positions already assigned `EK0108` must be recognized by the rejection cover, without admitting them. Native independent errors remain native, and a starred bodyless generator signature retains `TS1222` under this detail.
    ```vibe
    effect function untyped(x: string); // TS7010 with noImplicitAny
    effect function untyped(x: string) { return x }
    effect function typed(x: string): string!!;
    effect function typed(x: string) { return x }
    ```
    Effect TS: `function untyped(x: string); function untyped(x: string) { return Effect.succeed(x) }`, with the same implicit-any/TS7010 behavior; annotate the typed overload `Effect.Effect<string>`. Decided by the agent from accepted VIP-1's written-or-inferred rule and async positions, detail175, principle2 (native signature/configuration checks), and principle4 (no new mandatory-annotation exception), 2026-10-30. `r31-overload-tdz-asi-reference.log` independently checks TypeScript5.9.3 native async and ordinary Effect-returning overloads: both expose any and report TS7010 only with noImplicitAny. This is native reference evidence, not VibeLang declaration, compiler, source-publication or cross-package conformance.

### Detail 184

**Effect arrow heads mirror TypeScript's separate bare and parenthesized async forms.** (live `900-effect-arrow-heads`; VIP-1 grammar repair, distinct from detail 175's overload signatures.) Split `EffectArrow` into a bare `BindingIdentifier` head and a parenthesized-formal-parameters head. Only the parenthesized branch may carry type parameters or a return annotation. Keep the simple bare-identifier arrow and its contextual parameter typing. Do not take an independent cross-product of optional type parameters, bare-or-parenthesized parameters and an optional return annotation. Preserve existing no-LineTerminator restrictions, Effect return-type checking, generic parameter rules and the two-modifier `EK0105` recovery; no new arrow position or ambiguity rule is introduced.
    **Immutable-main source scope (d0cdbe, 184).** 001/AppendixA now preserve complete is/as/satisfies expression-operator readings after ordinary effect/async identifiers; this publishes the later complete-head source clarification in addition to earlier695 arrow-head shapes. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    **Immutable-main source receipt (695576, 184).** Verified at immutable main `695576acb44b`: 001/AppendixA split bare Effect arrows from parenthesized generic/annotated heads. This verifies that source-head portion, not every later complete-head identifier-operator clarification or parser behavior. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in 7b23123f61e5 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const f: (x: number) => (number!!) = effect x: number!! => x // syntax error: parenthesize x
    const g: (x: number) => (number!!) = effect <T> x => x       // syntax error: parenthesize parameters
    const a: (x: number) => (number!!) = effect (x): number!! => x // allowed
    const b = effect <T>(x: T) => x                              // allowed
    const c: (x: number) => (number!!) = effect x => x             // allowed
    ```
    Effect TS: ordinary function values returning `Effect.succeed(x)` with the same checked heads/types; the native async syntax oracles are `async (x): Promise<number> => x`, `async <T>(x: T) => x` and `async x => x`. TypeScript rejects the two bare decorated heads with TS1005. Decided by the agent from VIP-1's explicit rule that `effect` occurs exactly where TypeScript permits `async`, principle 2 (inherit its async-arrow head grammar), and principle 4 (two existing head shapes rather than independently optional decorations that admit unapproved forms), 2026-10-30. Reconcile 001 and Appendix A and add both rejection witnesses and all three controls. `decide-live-scratch/root-effect-arrow-heads-reference.log` verifies those parser results with the installed TypeScript primary compiler API. This is grammar/reference evidence, not a VibeLang parser-conformance result; no runtime Exit claim is needed for this syntax distinction.

    **Complete-head lookahead preserves ordinary identifier operators (live `900-effect-is-head-disambiguation`).** The existing contextual expression rule selects an effect arrow/function/block only for its complete grammar head. Otherwise `effect` remains an ordinary identifier, including valid `effect as T`, `effect satisfies T`, and VIP-7 `effect is P` expressions. The identifier-spelled operators `as`, `satisfies` and `is` must not be consumed by invalid-shorthand recovery before that ordinary expression can parse. This restates VIP-1/VIP-7 and principle 3, not a new shorthand or a symbol-based parsing rule. Source repair reported queued as `64cc01266def`; its strict counterpart `Success(2)` is the fixer's receipt, not an independent compiler run by this lane. Decided by the agent from the accepted expression grammar and principles 2/3/4, 2026-10-30.

Landing receipt: source 7b23123f61e5 landed in main 695576acb44b (queue 1793369968-spec-fix-a, gate mq-10302026-7).

    Landing scope clarification: main `695576acb44b` publishes the ordinary bare-versus-parenthesized arrow-head shapes via `cf67082254d1`. This does not independently verify the later complete-head `is`/`as`/`satisfies` clarification or its separate `64cc01266def` source receipt. Preserve those distinct scopes rather than reading the earlier landing line as full delivery of every later184 follow-up.

Landing receipt: source 64cc01266def landed in main d0cdbe5a0a7f (queue 1793378613-spec-fix-a, gate mq-10302149-2).

### Detail 203

**Retire the legacy any-call-result warning `EK4409`; execution remains explicit.** (live c9 Appendix-B finding, 2026-10-30 12:25Z; retires D24/D321's old implicit-call-dispatch advisory, not a new language feature.) Stop emitting `EK4409` for a returned call through a value of type `any`, including the old locally-erased-program special case. Retire its legacy note that suggests changing a callee's declared return type to make a call run: under VIP-1/VIP-5, a type annotation never supplies the missing execution operator. An ordinary call returns its ordinary value; `return` keeps that value as the success value, and only written execution syntax such as `try` runs a returned Effect. `effect` marks an Effect function; `await` retains Promise/JavaScript meaning and does not classify an Effect function. `any` remains accepted by the existing execution-operand assignability test and excluded from detail 89's unrun-value result tests. This retirement does not suppress unknown-throw checks, actual known-Effect/Promise diagnostics, ordinary TypeScript diagnostics or independently configured imported lint rules, and does not turn `any` into a proof of a nonthrowing callable.
    ```vibe
    effect function keep(callee: any) {
      return try Effect.try(() => callee()) // calling may throw; a returned Effect stays the success value
    }
    effect function execute(callee: any) {
      const returned = try Effect.try(() => callee())
      return try returned // explicit execution, if the runtime value is an Effect
    }
    ```
    Effect TS: `Effect.gen(function* () { return yield* Effect.try(() => callee()) })` preserves a returned Effect as data, while adding `yield* returned` executes it. Native `async function f() { return await anyValue() }` is legal TypeScript; awaiting a non-thenable Effect does not run it either. Decided by the agent from VIP-1's explicitly marked function kinds, VIP-5's explicit execution/ordinary-await rule, decided detail 89's deliberate `any` exclusion, principle 3 (call-site syntax decides execution), and principle 7 (drop an obsolete implicit-call advisory rather than invent replacement syntax), 2026-10-30. This relaxes a legacy warning in favor of already-accepted VIP semantics and changes no runtime meaning or public API, so no Will choice is needed. Mark the code retired without reusing it; remove its emission and old positive expectations, replace them with regressions asserting the absence of `EK4409` plus preserved explicit-execution and ordinary-diagnostic behavior, and add the retirement/migration line and relevant 001/002/007/Appendix-B or VIP-1/VIP-5 cross-references in the fixing commit. Where a retired-code severity override would become unknown, the migration removes that obsolete entry while retaining unrelated settings. A transitional compatibility catalog may accurately say an identified older compiler still emits the retired warning; it must not restore it as a current VIP-38 language warning. Primary source: `typescript/tsc/internal/vibelang/anycalls.go` explicitly cites D24 and still emits warning-category `EK4409`; its message and attached note assume return-type-driven execution. Historical D24, D241 and D321 are retained in the pre-VIP decision snapshot; current VIPs 1/5 and detail 89 supersede that premise. `ek4409-reference.log` passes strict native TypeScript 5.9.3 and verified Effect 4.1.0: the raw call and native await keep the Effect cold, explicit execution returns `7`, and the body runs once. This is source/policy/reference evidence, not VibeLang compiler-conformance or a landed removal.

### Detail 274

**A legacy migration preserves the old call's result/run phase, not the post-migration result's structural Effect shape.** (Round7 OPUS-1; earlier sourceFileMigrationFixes:default-mode inquiry; accepted VIP-1/VIP-5/VIP-34, existing186/89/104/254/266, principles1/3/4/8.) When the VIP-1 migration removes a known legacy plain-variant wrapper, an old `try make()` ran that wrapper to obtain its success datum. The replacement plain call produces that datum directly, so remove that legacy `try` even when the datum is itself an `error`, a `schema error`, another Effect or an adapter object. Keeping the run merely because the new value passes the Effect operand test can turn success data into failure or execute a nested program. A call that already returned the intended Effect under its native/written contract keeps its explicit run, including an annotated generated-error type that is structurally an Effect. Use the original resolved callable/contract and migration provenance; do not classify by callee spelling, a member named `asEffect`, or the final type alone. A written annotation is evidence for the documented native-return case, not a new general language dispatch rule.


    **274 toolchain-switch clarification, decide-live, 2026-11-01.** A toolchain version change alone is not evidence that a source needs a function-kind migration. Use the established source phase and actual old callable/callback contract to choose a required migration; preserve already-valid plain callbacks and already-written Effect callables. The reported alchemy-56 `Array.map`/`Stack.useSync` arrows must not become Effect-valued callbacks if that changes their old immediate results. A blanket rule that a body with no Effect operation can never receive or retain an `effect` modifier is also wrong: VIP-1 explicitly permits a pure Effect function, such as `effect function constant() { return 1 }`, whose call still returns a cold Effect. The presence or absence of body operations cannot substitute for the original kind/contract. Do not run the breaking flip pass solely because an unlanded flip exists or reinterpret valid final source as legacy without its established provenance.

    Effect TypeScript counterparts distinguish `[1].map((x) => x + 1)`, giving numbers immediately, from `const constant = () => Effect.succeed(1)`, giving a cold program. The migration must preserve the appropriate one, including result nesting and evaluation timing. This applies accepted VIP-1/VIP-34 and principles1/3/8 through existing274; no new numbered decision, syntax or Will question. Owners add failing-old regression and keyed corpus/property coverage for same-rule toolchain switches, actual flip transitions, contextually plain callbacks, intentionally pure Effect callables, explicit contracts and nested Effect success data. The owner reports48changed arrows in16files before stopping its switch; this lane read that report, not the actual diff or a running compiler, and does not certify all48as independently reproduced failures.

    This is a legacy-migration rule, not a change to final VibeLang execution. In final source, `try makeError()` is still an intentional run if its operand passes VIP-5, whether the plain callee has an annotation or not. An ordinary safe fix must not strip that valid execution solely because the callee is unannotated. Ambiguous old/new source is not reinterpreted unconditionally by ordinary `--fix`: use the existing explicitly selected legacy migration pass and its known pre-migration model, or refuse when that model cannot be established. `--fix-vip-only` selects the VIP-1/VIP-2 pass; `--fix-migration-only` selects its documented legacy migration family. Neither adds a language mode or a new flag. Recognizable obsolete syntax/diagnostics may still receive ordinary fixes; the entry point and documented scope switches remain186. In particular, do not broaden the no-diagnostic legacy schema/data readonly-upgrade guard so ordinary `--fix` rewrites valid new writable source to its historical readonly meaning. The old/native comparison belongs to the explicit migration intent, and current valid source retains its current meaning by default.

    ```vibe
    error Missing { id: string }
    function make(id: string) { return new Missing({ id }) }
    effect function finalData() { return make("x") }       // success data
    effect function finalRun() { return try make("x") }    // intentional typed failure
    // A legacy wrapper-success try migrates to finalData's direct call, not finalRun.
    ```

    Effect TypeScript:

    ```ts
    class Missing extends Data.TaggedError("Missing")<{ readonly id: string }> {}
    const error = new Missing({ id: "x" })
    const oldWrapper = () => Effect.gen(function* () { return error })
    const oldCall = Effect.gen(function* () { return yield* oldWrapper() })
    const newData = Effect.gen(function* () { return error })       // same success datum
    const intentionalRun = Effect.gen(function* () { return yield* error }) // Fail(error)
    ```

    Decided by the agent from VIP-34's behavior-preserving migration requirement, VIP-1's explicit function kinds, VIP-5's explicit execution, principle1 (the native Effect result), principle3 (resolved identity and source syntax), principle4 (separate migration provenance from runtime semantics) and principle8 (refuse an ambiguous rewrite), 2026-11-01. Class A; no new Will question or change to accepted final programs. Six bounded native Effect4.1 controls/9Exit checks pass for error success versus failure, nested Effect success data versus execution, existing explicit execution and an adapter whose method is never called. They are models, not an old/new VibeLang ABI or codemod/default-mode run. Receipt: `native-loop-r3/migration-value-phase-reference.json`. Main's `fix_effect.go` and VIPOnly dispatch were read, not executed. Correct both sentences at007:372 and publish the VIP-34 migration distinction. Owners retain actual CLI regression and spec-quoted keyed fuzz over phase/kind/annotation/aliases/error/nested-Effect/adapter/readonly cases, including ordinary-current-source noninterference. Protected target tests remain unchanged under272.




    **274 READY-toolchain switch application, decide-live, 2026-11-01.** An official toolchain/flow producing a tree-wide `--fix` diff is evidence of what ran, not proof of the diff's old/new callable phase or scope. For the reported Foldkit60 switch, prefer the smallest pin/generated-artifact update that passes the actual whole-tree original gates with other source bodies unchanged. Regenerate every required artifact under the pinned compiler and deterministic declaration mode; do not leave stale outputs merely to keep an update lane-local.

    Necessary version ports of already-Vibe sources remain allowed under272 when the actual approved transition and original semantics are established. A wider function-kind/`try` migration must use that real source-phase proof and the existing designated migration handoff; neither a version change nor clean compilation proves it. The11:25Ztarget ruling specifically forbids hand-adding flip `try` before `flip-pass-arms` posts; it does not repeal properly verified official codemods. Keep an unproved switch as a candidate while those gates/handoff complete, and continue independent work. This is not a new approval ceremony or a language question for Will.

    Product script/config wiring still preserves original source/test/lint coverage and failure outcomes. For example, `--no-error-on-unmatched-pattern` cannot be accepted as a way to hide a now-unselected source set; demonstrate actual inventory and bridge coverage. This applies existing274/272/278/292 and principles3/4/8 to the reported options, not a blanket authorization for the35rewritten sources or a ban on all pre-flip mechanical preparation. No target source/gate was inspected or executed by this lane.

    **Historical initial flip-readiness summary; superseded by the next ruling (platform transmits a proxy decision, `inbox/flip-pass-arms.md`, 2026-11-01T16:41:22Z).** Refused sites need not delay the VIP-1 flip once the owner proves each remains a loud failure: the post-flip source fails compilation, or the migration pass stops and names the refused site. It must never silently change behavior. The specifically required regression is Foldkit's refused `relayRegistry*.vibe` shape; record each Foldkit refused file and reason in the assigned migration inbox. This is a conditional readiness ruling, not evidence that its regression has passed or the flip has landed. Preserving actual call/run phase remains the contract; refusal is not successful conversion and does not count as one.

    This records the transmitted proxy ruling without attributing an unobserved direct Will answer. It does not close `throw-expressions` or `legacy-forms`, supply new syntax, authorize guessed effect markers/casts, weaken a protected target test or mark incomplete target migration green. Normal queue and required validation remain applicable. The owner may continue finding a preserving rewrite, but should not hold the flip solely for this refused pattern once the required loud-failure proof is complete. Compiler/codemod owners retain regression and spec-quoted keyed neighbourhood coverage for compile-failure versus named-pass-failure outcomes, multiple refusal sites, no partial silent behavior changes and successful preserving controls. This policy lane ran no product test or enqueue.


    **Superseding flip-refusal ruling (orchestrator relays Will's proxy with spec's ruling, `inbox/flip-pass-arms.md`, observed 2026-11-01T16:42Z).** This replaces the preceding initial summary and any weaker refusal advice. Foldkit's refused shape can compile with only warning `EK4802` and return a program, so refusing a rewrite or printing a warning is not by itself loud enough. Before the flip is handed off, prove all four conditions:

    1. `--fix-vip-only` exits nonzero and names **every** refused site.
    2. If anything was refused, the pass writes `"vibe": { "severities": { "EK4802": "error" } }` into that project's configuration, with an explanation. Every refused position must then be a compile error until cleared; the owner removes the temporary setting when the refusal count reaches zero. Preserve unrelated configuration and pre-existing user severity choices rather than deleting an original author-selected entry as though it were temporary. This is the explicitly ruled migration config edit within detail 270's owned-project boundary, not permission to modify dependencies or foreign projects.
    3. The regression proves a refused site fails compilation; after a preserving repository fix, removing the temporary setting compiles and yields an Exit identical to the original before the flip.
    4. First run the pass on all 44 Foldkit sites and verify **each** reports `EK4802` or another error. A site compiling without a diagnostic needs a rule before the flip. Do not substitute one representative failing site or an aggregate count for the per-position gate.

    Track each refused shape as a VIP-34 codemod gap, with a rewrite rule or written reason it cannot be rewritten. Retain file/reason lists for the migration owner and flip report/PR. The owner can hand off once conditions 1–4 pass while continuing further preserving rewrites; no completed proof, handoff or landing is asserted here. The earlier “compile failure **or** named-pass failure” is superseded by these combined conditions. These conditions neither close the open owner questions nor weaken existing migration/test/queue requirements. Product owners retain regressions and keyed neighbourhood coverage across diagnostic positions, multiple refusals, config inheritance/cleanup, nonzero status and preserved successful Exits; this policy lane ran no such product tests.


    **Implicit cleanup is part of the native migration counterpart (RC-9, decide-live, 2026-11-01).** The selected pinned Effect TypeScript program governs Option-generator normalization, even when its original generator spelling is rejected in current VibeLang. Pinned Effect 4.1.0 `Option.gen` stops at delegated `None` by abandoning the suspended generator. A plain-IIFE `return` instead performs the enclosing `for...of` iterators' `return()` hooks. Equal Option results, declarations and successful typechecking do not excuse these added effects.

    Before offering editor or CLI conversion, track the yield's enclosing control-flow cleanup regions, not only explicit `try`/`finally` syntax. If an Option yield could short-circuit through such a region, refuse the automatic rewrite with a reason until equivalence is established. Preserve nested iterator-close order, thrown cleanup behavior and genuine all-Some controls. Do not infer safety from API spelling or final result shape. Ordinary iterator cleanup and the existing resource/finally cases all remain governed by their actual native counterpart.

    The witness uses plain iterables and no Effect computation or `using`: native None events are `["outer:next","body"]`, whereas the bad rewrite adds `"outer:close"`; two nested loops add inner then outer closes. This is a plain Option result, not an Effect Exit. A safe retained TypeScript boundary or an independently proved preserving manual port remains available; no syntax exposing generator abandonment is added. The comparison is to the original valid native TypeScript, not a claim that the legacy Vibe generator compiled before migration.

    Decided by the agent from principles 1, 3, 7 and 8, VIP-34 and detail 274's native phase/provenance contract, 2026-11-01. It clarifies the universal preserving-codemod rule, not a new language behavior or Will choice. Owners need failing-old/passing-guard editor and CLI regressions plus keyed native differential properties over Some/None, one/nested cleanup regions, callback/evaluation order, iterator-return hooks and safe controls. This lane read the executed witness receipts but ran no Option-generator test or implementation.

### Detail 279

**A default migration plan leaves Effect type-only users in native TypeScript; ownership and automatic eligibility have separate counts.** (Foldkit planner question for `packages/foldkit/src/html/runtimeSingleton.ts`, inbox/migrate-foldkit.md headed 2026-11-01T06:00Z; principles 1, 4 and 8; accepted VIP-1/VIP-27/VIP-34 and existing 270/272/277.) A module whose Effect use is confined to types does not become an automatic migration candidate merely because it imports `effect`. Keep the current conservative default: migrate Effect value users through the ordinary plan and retain a value-free Effect type user as its original native TypeScript file. A rename and generated sidecar, by themselves, do not require changing that default. Type-only Effect use can coexist with ordinary runtime JavaScript; it does not mean the entire module erases.

    Keep the full owned-source inventory and its original identities. Report automatic candidates, converted files and deliberately retained native files separately, with the retention reason; do not silently shrink the ownership total, discard a file from tool/test coverage, or call a type-only native boundary a compiler failure. If `SCOPE.md` is used as a conversion denominator, qualify its candidate count rather than treating every Effect import as a required rename. For the reported `runtimeSingleton.ts`, retain the native file on the reported premise that it has no Effect value operation to migrate. The owner verifies that premise from the actual module: the spelling `import type` alone is not proof that there is no separately resolved Effect value use through another import or helper. A real missed value user is a classifier issue under the existing plan, not a new language exception.

    Preserve the current explicit-selection path: a valid, explicitly selected type-only source can still enter a plan with its existing type-only warning and every original compilation, declaration, runtime/tool and protected-test gate. No new option or blanket rename pass is introduced. Plain VibeLang source remains legal under VIP-1; this is the default migration workflow and honest accounting, not a language admission restriction. Keep original native file kinds and binding/runtime behavior. Do not manufacture Effect operations, change a public API, or bypass a gate to satisfy a file-count quota.

    ```vibe
    // keep.vibe; the native runtimeSingleton.ts is retained.
    import type { RuntimeState } from "./runtimeSingleton.js"
    export effect function keep(state: RuntimeState) {
      return state
    }
    ```

    Effect TypeScript, preserving the native type-only boundary:

    ```ts
    // runtimeSingleton.ts
    import type { Context } from "effect"
    export type RuntimeState = Context.Context<never>

    // keep.ts
    import { Effect } from "effect"
    import type { RuntimeState } from "./runtimeSingleton.js"
    export function keep(state: RuntimeState) {
      return Effect.gen(function* () { return state })
    }
    ```

    Decided by the agent from principle 1 (keep idiomatic native TypeScript where no Effect value rewrite is needed), principle 4 (retain one simple default and the existing explicit path) and principle 8 (avoid an unnecessary automatic file-kind change), 2026-11-01. Class A; no Will question, language change or public package API change. Existing main flow source confirms distinct `effectFiles`/`effectValueFiles`/`effectTypeOnlyFiles` inventory counts, a value-use default candidate filter and a type-only warning in explicit plan validation; those observations support this workflow choice, not a new language rule. Four bounded controls over the captured planner pass: value-only default selection, unchanged complete inventory, explicitly selected type-only admission/warning, and the separate no-Effect refusal. Receipt: `type-only-planner-controls.json`. They use synthetic inventory records and do not classify the actual 249-line module, execute a conversion, or prove compiler/target conformance.

    Ownership remains with the Foldkit scope/flow owners for the exact source classification, count/report wording and any regression or fast-check coverage over value/type/none records, import aliases/re-exports, ordinary non-Effect runtime code, source-looking strings, file kinds, explicit selections and retained tool/test identities. This lane edits no target source, test, compiler, plan or SCOPE file and enqueues no commit.

### Detail 290

**A plain catch handler preserves its immediate value; a native Promise may already be running.** (Round11 Astra ASTRA-1, frozen main4dfd9a19cad2; accepted VIP-1/VIP-5 return-values amendment, detail89, principles1/2/3.) Correct the explanation of `EK0507` in chapter002 and the shared result-test wording in chapter002, VIP-5 and detail89's application: a plain handler returning a Promise or thenable does not await or assimilate it. Calling the handler still calls its body normally. An ordinary async function starts executing when called and its Promise can continue without being awaited. A generic lazy thenable is not assimilated merely by `Effect.succeed`. An Effect returned as success data instead stays unrun. These are distinct runtime explanations, not one category of cold values.

    Keep the existing `PromiseLike` static predicate, union-member rule, `any`/`unknown`/`never` exclusions, diagnostic severity, explicit bridge and handler-syntax rules unchanged. Describe Promise results as possibly unhandled or unawaited, rather than unrun. This correction does not admit a rejected Promise-valued handler, implicitly schedule work, assimilate a returned thenable or permit `await` in Effect code. The direct-return example below remains a diagnostic witness, not admitted execution syntax.

    ```vibe
    // fragment: queryDb is an approved Promise-returning import from a .ts boundary.
    effect function fallback(work: Effect.Effect<number, string>) {
      return work catch (e) => queryDb(e) // EK0507: returned Promise is not awaited.
    }
    ```

    Effect TypeScript: `Effect.catch(work, (e) => Effect.succeed(queryDb(e)))` calls `queryDb` only when that failure handler runs; the resulting Effect succeeds with the identical Promise without assimilating it. Already-started Promise work may continue. Replacing `queryDb(e)` with a lazy thenable leaves its `then` uncalled; replacing it with a cold Effect leaves that Effect unrun. For the accepted Effect-handler bridge, use the existing explicit `Effect.tryPromise` contract and preserve its error mapping rather than inventing automatic wrapping.

    Decided by the agent from principle1 (idiomatic Effect success data), principle2 (native JavaScript async/Promise execution), principle3 (written handler syntax controls execution) and accepted VIP-1/VIP-5, 2026-11-01, under Will's 2026-10-29 delegation. Class A, factual documentation correction; no new language permission or Will question. The reviewer reports pinned Effect4.1.0 controls observing query-start before the Effect exit, query-finish after a microtask and zero lazy-then calls. This lane read that complete receipt but did not rerun it or claim compiler conformance. Publication owners must add a failing-old-text reference test and keyed spec-quoted neighbourhood coverage for plain versus effect handlers, success versus failure heads, eager async prefixes, continuation microtasks, lazy thenables, nested Effect success values, and union/type exclusions without weakening the existing rejected-program oracle.

### Detail 293

**Stream-loop repairs use the existing placement or native TypeScript diagnostics; the unapproved `EK2007` rows add no new rejection.** (Round13 Opus OPUS-1 at frozen `cd8d8fb8ca22`; accepted VIP-1/VIP-20/VIP-34, chapter007's diagnostic-authority and safe-fix rules; principles2/4/8.) Remove the recently introduced normative `EK2007` rows from002 and AppendixB and stop using that code as a substitute for existing rejections. A `for await` inside Effect code has VIP-1's existing `EK0102` placement error. Ordinary `for...of`/`for await` outside Effect code keep their native TypeScript checks and codes; a noniterable Stream receives `TS2488`/`TS2504` as appropriate. An ordinary `for...of` inside Effect code also retains its native operand checking. Preserve independent native errors; invent no duplicate migration warning or type-selected loop execution.

    Native loops that TypeScript admits, including an `any` operand or an ordinary iterable whose binding happens to be named `Stream`, gain no VibeLang Stream-loop rejection. Do not transfer `for try`'s Stream operand-domain test to native loop syntax: the explicit `for try` form retains288's existing `any`/`never` assignability rule. This decision does not change that rule or authorize implicitly running Streams.

    Attach a `for try` quick fix to an appropriate existing diagnostic only where the source is already in a permitted Effect execution context and the actual Stream/head/body/jump/evaluation contract can be preserved. Do not rewrite a native async/plain function's loop into forbidden `for try` or silently make the enclosing function effectful. Recognized older implicit-Stream loops may migrate under the existing explicit legacy-phase provenance and safe-fix rules274; a toolchain switch, structural `any`, or absence of a diagnostic is not that proof. If the repair is not mechanically preserving, refuse it and explain the boundary rather than write invalid code.

    ```vibe
    effect function badPlacement(rows: Stream.Stream<number>) {
      for await (const row of rows) {} // EK0102; safe for-try repair only if all loop checks hold
    }
    async function badNative(rows: Stream.Stream<number>) {
      for await (const row of rows) {} // native TS2504; do not write for try here
    }
    function native(values: any) { for (const value of values) {} } // native admission unchanged
    effect function consume(rows: Stream.Stream<number>) {
      for try (const row of rows) {} // existing explicit Stream consumption
    }
    ```

    Effect TS: the native functions retain their ordinary TypeScript syntax and diagnostics; the admitted empty consuming loop is `const consume = (rows: Stream.Stream<number>) => Stream.runForEachWhile(rows, () => Effect.succeed(true))`. VIP-20 already decides the explicit syntax, context, control-flow and consumption contract. The compiler commit adding a row is not a separate VIP approval.

    Decided by the agent from principle2 (native TypeScript syntax keeps native checks), principle4 (reuse the already assigned context/native diagnostics rather than add overlapping rules), principle8 (refuse an unproved repair), accepted VIP-1/VIP-20 and007's explicit diagnostic-authority rule, 2026-11-01, under Will's 2026-10-29 delegation. Class A; no new syntax, execution permission, public runtime API or Will question. Six stock TypeScript5.9.3/Effect4.1.0 loop controls confirm native Stream `TS2488`/`TS2504`, valid `any`, arrays, AsyncIterables and a same-named iterable binding. Receipt `r13-native-reference/receipt.json`; no VibeLang compiler/fixer/fuzz test was executed. Publication/compiler owners need a failing-old-text regression, actual-main diagnostic/fix controls and spec-quoted keyed corpus/properties across contexts, native valid iterables, aliases/shadowing, `any`/`never`, unions, destructuring, invalid heads, outward jumps and fix idempotence. Keep known product gaps pending and preserve actual before/after outcomes. Delivery ownership is unclaimed by this decision-only lane.


    **293 dual-protocol clarification (Round13 ASTRA-1).** Preserve a valid native loop even when its operand also implements `Stream`. For `Stream.Stream<A> & Iterable<A>`, written `for...of` selects `Symbol.iterator`; for a compatible `AsyncIterable<A>`, native `for await` keeps its native async-iteration protocol. Structural Stream recognition must not replace either with Stream consumption. The pinned native dual-protocol witness yields `[2]` synchronously, `[3]` asynchronously and `[1]` through `Stream.runForEachWhile`. Thus changing the loop can change its actual values, not merely a diagnostic. Accepted VIP-20, principle3 (written call/iteration syntax selects semantics) and293's native-admission rule already settle it; no new number. Add distinct-value/error/side-effect protocol intersections to the owner corpus and preserve the selected native completion/closing behavior.

### Detail 303

**VIP-1 replaces return-type-directed callable form rejection; native Effect factories remain ordinary values.** In the current language, a function's kind comes only from its written modifier, never from its inferred or declared return type. An ordinary TypeScript factory returning an Effect is a plain callable; assigning or passing it as data follows ordinary TypeScript assignability. A union's callable member returning `any` does not itself run, wrap, relabel or reject that value. Historical D430/D513 supply no current `EK4301` authority for that case: accepted VIP-1 makes old VibeLang reference-only unless adopted. Preserve genuine TypeScript incompatibilities, applicable foreign-call contracts and source binding identity. This is no new exemption for a prohibited call or permission to implicitly run an Effect.

    ```vibe
    import { Thing, take } from "./lib.ts"
    export const taken = take(Thing) // ordinary native factory passed as data
    ```

    The Effect TypeScript provider is:

    ```ts
    import * as Effect from "effect/Effect"
    interface Res<R> { (id: string): Effect.Effect<R>; readonly witness: R }
    interface Like<R> { readonly witness: R }
    interface Plat<R> { (id: string, props: number): any; readonly platform: true }
    export const Thing: Res<number> & { readonly platform: true } =
      Object.assign((_id: string) => Effect.succeed(1), { witness: 1, platform: true as const })
    export const take = <W>(cls: Like<W> | Plat<W>): number => 1
    ```

    The consumer's Effect TypeScript counterpart is the same import and `export const taken = take(Thing)`. Nothing invokes `Thing`, and no Effect is run. A target `(id: string) => number` still rejects the Effect-returning factory with native `TS2322`. Preserve the union/data-only, generic constraint, array and ordinary `Function` controls against native behavior; do not erase their coverage or assume native `Function` and every callable type are universally interchangeable. Test written `effect` functions separately with their actual Effect-returning types, without restoring retired destination-directed form adaptation. Existing `@throws` and platform bans retain their own scopes. Old-mode migration evidence stays historical.

    Decided by the agent from accepted VIP-1, chapter001's explicit keyword-only rule, principle1 (idiomatic Effect values) and principle2 (native TypeScript assignability), 2026-11-02 under the 2026-10-29 delegation. Class A; no new Will choice. Root's seven TS5.9.3 controls accept direct/constrained/array/`Function`/`any`/`unknown` assignments and retain the native number-return error (`union-native-reference/static-receipt.json`); no Vibe compiler or fuzz execution here. The existing implementation claim remains impl-hunt-func's, not a duplicate fix.

    **Implementation-version receipt (2026-11-02T14:18Z):** main `fe7b802fbf05` operationally reverts the VIP-1 implementation, migration and related gate/oracle commits; its full tree equals pre-flip `61878b40234e` by own `jj diff`. This does not withdraw accepted VIP-1 or this native callable rule. Above native-conformance results describe the explicitly named post-flip revisions; the current pre-flip implementation retains its known gaps. Do not use this detail as proof of current-main conformance, waive native timing/public declarations, or land dependent post-flip oracle/warning changes before the coordinated reland. At14:18a freshfe7postmergewasstillrequired. Subsequentownprimaryreceipt records `2026-11-02T14:28:24Z fe7b802fbf05 GREEN`; this is operational validation of the rollback and closes none of the accepted-language conformance gaps. Older618GREEN remains historical.

    **Name of the accepted behavior, 2026-11-02:** Will's naming rule, relayed by the Smithers, Alchemy and OpenCode owners at18:47Z, calls VIP-1's final behavior **explicit effects**: a function is Effect code only when marked `effect`. Use that name in new reports, status lines and commit descriptions. Existing file, bookmark and lane names retain their names, and historical quotations/receipts retain their wording. This changes terminology, not the accepted VIP-1 semantics or the source-equivalent replay/validation requirements. Recorded by the agent from Will's relayed naming instruction, 2026-11-02; existing303, no new Class B choice.

    **Implementation availability, 2026-11-02T19:18Z fetch:** explicit effects has relanded on public main `e4cbc61d9c436b9ed1a75425af2108dfa9871041`, carrying `a67560eeeea1` (“a function is an Effect function exactly when marked effect”) plus migration/gate/fuzz updates. This supersedes the earlier implementation-reverted status for source availability. The full design delta is two pages/2748characters, both read:007 preserves each established legacy run phase, refuses unknown sites with a nonzero migration outcome, and uses the documented own `EK4802` warning as a project error tripwire when calls remain refused;900 publishes that trigger. This is distinct from imported Effect lint activation under77.

    Old source-equivalent5e/b93 compiler probes remain evidence for those earlier implementations, not conformance tests of this new compiler. Fresh matching build/replay/target receipts are required for current claims. The earlier whole-train rollback and its exact-tree/health receipts remain historical; accepted VIP-1 meaning was never withdrawn. This lane read design text and bounded commit metadata, not the full compiler patch, and ran no compiler, gate or target test. No automatic target-test permission or blanket failure waiver follows from the landing.

### Detail 308

**Resolved Class B (RUN2): permit two upgrade-only protected-test ports, or retain their old SDK baseline.** (Foldkit17071/17072; existing272 protected assertions/fixtures and the narrowly allowed language-version ports; VIP-1/VIP-33/VIP-34.) The accepted language behavior is settled. The unresolved choice is an exception to the target's stronger unchanged-test rule, not whether host-state access is permitted or whether a plain Effect factory must have the same generated JavaScript as an explicit Effect function.

    ```vibe
    const cleanup = () => Effect.promise(close) // A: keep the old fixture and exact-JS gate
    const cleanup2 = effect () => { return try Effect.promise(close) } // B: port the fixture; preserve types and call/run behavior
    ```

    **Effect TS:** a plain function returning `Effect.promise(close)` and an explicitly constructed cold Effect program can have different JavaScript representations. The reported paired controls preserve raw declarations, cold construction, repeated cleanup runs and changing state across runs. This does not establish equality for arbitrary rewrites. The metadata test's legacy `import.meta.env` before-fixture is correctly rejected by current VIP-33; its versioned-before or official native-boundary migration must retain the original selection/identity oracle.

    **A, current policy:** retain the protected tests and fixtures unchanged, with no new-SDK green-baseline claim while they fail. Continue independent migration work and preserve the failed receipts. **B, recommendation:** authorize only `packages/website/scripts/siteColdCallbacks.test.mjs` and `packages/website/scripts/viteMetadataBoundary.test.ts` and their deliberately legacy generated fixtures to be ported in a separate SDK-upgrade baseline. Replace the former's exact JavaScript-AST equality requirement with its original raw-declaration and cold/call/run/repeated-run oracles plus discriminating negative controls. Give the latter a genuine versioned-before or approved native-boundary fixture route, preserving module selection and identity checks. Keep original generators, seeds, budgets, behavior coverage and unrelated assertions. This is no general permission to edit target tests or waive a failed runtime, type, API or platform check.

    **Recommend B** because the accepted SDK changes representation and rejects old host-state syntax while the intended behavior oracles can remain strong. **Pending explicit answer to `pending-foldkit-two-sdk-test-ports`.** A stays in force until answered. The original2026-10-30 deadline predates this new protected-gate exception and authorizes no retroactive test edit; no automatic default applies. No compiler, target test or fixture was edited by this lane.

    Question text is on the Mac monitor; `foldkit-test-port-question-prepared.json` and `foldkit-test-port-question-verified.json` retain its exact scope and verified insertion. The target owner reports the minimized current-main failures and valid phase/declaration controls. Existing272 explicitly preserves test intent, assertions and coverage; the supplied finding also records the no-test-edit instruction. Those constraints require a real scope answer rather than an agent silently weakening an oracle. Recorded by the agent, 2026-11-02: Class B, pending Will. Implementation remains with the target coordinator after authorization.



    **RUN2 scoped resolution, 2026-11-02:** Resolved by the verified RUN2 scoped coordinator ruling: B for the two migration-added upgrade tests/fixtures only; preserve every runtime/declaration assertion, original generators/seeds/budgets and the native TypeScript host boundary. Original Foldkit tests remain protected. Separate ruling-named upgrade commit and all actual baseline/preservation/final gates are still required. No personal Will answer or timed default is inferred. The earlier pending/A disposition above is historical and superseded for these migration-added files. The verified task brief identifies their pristine absence and authoring commits; its scope is not a general permission to edit target tests. Findings17071/17072 are append-only renumbered135/136;17068 becomes134. This lane changes decision notes only. Authority receipt: `foldkit-test-port-run2-authority.json`.
