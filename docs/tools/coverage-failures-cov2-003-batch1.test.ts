// Rule-specific pending compiler/runtime obligations for cov2-003.
// TODO means conformance has not been checked; it does not assert a compiler defect.
// Keep each declaration separate so the census attributes only its own stable ID.
import { test } from "bun:test"

// rule-evidence: docs/design/src/003-failures.md#2716e6a5f8f54ac1
// Chapter 003: synchronous no-throw boundary
// Spec: Synchronous VibeLang code never throws (VIP-4, amended 2026-10-31): a function that throws is an `effect` function, or TypeScript.
test.todo("Chapter 003: synchronous no-throw boundary — Check plain function throw is EK0401; effect and foreign TypeScript controls compile.")

// rule-evidence: docs/design/src/003-failures.md#1dd83cc191ccf082
// Chapter 003: throw expression syntax restriction
// Spec: Its syntax restriction is `EK1010`; [Appendix A](900-appendices.md#throwexpression) gives the grammar.
test.todo("Chapter 003: throw expression syntax restriction — Check invalid operator followers report EK1010 independently of placement.")

// rule-evidence: docs/design/src/003-failures.md#59627e58c37f5bcc
// Chapter 003: synchronous context matrix
// Spec: *Synchronous code outside effect code* is every part of a `.vibe` or `.vibex` file that is not effect code and not in an `async` function or `async match` boundary (nested source callables keep their own contexts): plain functions and arrows (one nested in effect code included), plain methods, constructors, accessors, plain generators, class field initializers, `static` blocks, every parameter list except an ordinary `async` function's, plain `catch` handlers (parameters and body), and the module top level.
test.todo("Chapter 003: synchronous context matrix — Cross .vibe/.vibex with plain nested arrow, method, constructor, accessor, generator, field, static, parameter, handler and top-level sites; async boundaries are controls.")

// rule-evidence: docs/design/src/003-failures.md#7fa7aef05984f807
// Chapter 003: known throwing calls
// Spec: Its callee has a written `@throws {T}` other than `@throws {never}` (`@throws {unknown}` included), or has a `@rethrows` parameter given a callback known to throw.
test.todo("Chapter 003: known throwing calls — Cross foreign @throws {Error}, {unknown}, {never} and @rethrows callbacks; only known non-never calls are rejected in plain code.")

// rule-evidence: docs/design/src/003-failures.md#540e02328b94f091
// Chapter 003: unknown foreign call context
// Spec: A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call ([VIP-40](../vips/0040-module-declarations.md)); in effect code the same call has thrown type `unknown` and needs its wrapper (`EK0403`).
test.todo("Chapter 003: unknown foreign call context — An unannotated foreign call is admitted in a plain function but reports EK0403 in effect code without a bridge.")

// rule-evidence: docs/design/src/003-failures.md#4a4344b285ca2744
// Chapter 003: effectful callable strictness
// Spec: A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401` ([Effectful callables](#effectful-callables)).
test.todo("Chapter 003: effectful callable strictness — Foreign unknown calls in a plain Effect-returning body or effectful parameter list report EK0401; never calls compile.")

// rule-evidence: docs/design/src/003-failures.md#bf7fefc21b65787d
// Chapter 003: contextual throwing thunk
// Spec: A function literal passed where the parameter's function type admits throws, as the thunks of `Effect.try` and `Effect.tryPromise` and the `Promise` executor do, or passed to a `@rethrows` parameter, may contain calls known to throw: they belong to the enclosing call.
test.todo("Chapter 003: contextual throwing thunk — Effect.try, Effect.tryPromise, Promise executor and @rethrows callback allow known throwing calls; () => value control does not.")

// rule-evidence: docs/design/src/003-failures.md#4bdb8467a6d930b9
// Chapter 003: plain try catch statement
// Spec: TypeScript's `try { } catch { }` statement stays allowed.
test.todo("Chapter 003: plain try catch statement — A plain function containing try { JSON.parse(s) } catch { return fallback } compiles and catches; a direct throw remains EK0401.")

// rule-evidence: docs/design/src/003-failures.md#d503e5408127de1c
// Chapter 003: ordered no-throw repairs
// Spec: Quick fixes, in order: make the function `effect`, so `throw` is `Effect.fail` and a call known to throw runs with `try Effect.try(() => …)`; make it `effect` and write `return try die(e)`; or move the code to a `.ts` file.
test.todo("Chapter 003: ordered no-throw repairs — Inspect ordered code actions for a known throwing call and throw statement; apply effect/fail, effect/die and .ts move and recheck.")

// rule-evidence: docs/design/src/003-failures.md#1628b5a8ea97853e
// Chapter 003: nonconvertible no-throw repairs
// Spec: Code that can't be `effect` (constructors, accessors, plain generators, initializers, `static` blocks, parameter lists, the top level) gets only the `.ts` fix.
test.todo("Chapter 003: nonconvertible no-throw repairs — Constructors, accessors, plain generators, initializers, static blocks, parameter defaults and module top level offer only a preserving .ts move.")

// rule-evidence: docs/design/src/003-failures.md#9d62386869e6b8a8
// Chapter 003: plain handler repairs
// Spec: A plain handler gets `x catch effect (e) => { throw e }` and `x catch effect (e) => { return try die(e) }`.
test.todo("Chapter 003: plain handler repairs — Apply both catch effect repairs to a plain handler throw; compare typed failure versus defect Exit.")

// rule-evidence: docs/design/src/003-failures.md#ad1e10f261c69fc1
// Chapter 003: unary throw expressions
// Spec: A throw expression takes a unary operand: `value ?? throw new Missing()`, `condition ? throw error : fallback`, and unary nesting such as `!throw error` parse.
test.todo("Chapter 003: unary throw expressions — Check nullish, conditional first-arm and unary nesting parse without EK1010.")

// rule-evidence: docs/design/src/003-failures.md#575eaae308ab6f9c
// Chapter 003: throw statement distinction
// Spec: A statement starting with `throw` is still a throw statement.
test.todo("Chapter 003: throw statement distinction — A statement-leading throw consumes the full expression; its newline restriction remains TS1142.")

// rule-evidence: docs/design/src/003-failures.md#4db27e3928c438d7
// Chapter 003: invalid throw followers
// Spec: A token in [ThrowExpressionInvalidPunctuator](900-appendices.md#throwexpressioninvalidpunctuator) immediately after the operand is an error (`EK1010`).
test.todo("Chapter 003: invalid throw followers — Each ThrowExpressionInvalidPunctuator after a unary operand reports EK1010 with the operand span.")

// rule-evidence: docs/design/src/003-failures.md#711279408f8c1168
// Chapter 003: parenthesized throw operands
// Spec: Parenthesize the operand to throw a compound value, `value ?? throw (a + b)`, or parenthesize the throw before another operator, `(throw error) + b`.
test.todo("Chapter 003: parenthesized throw operands — throw (a + b) and (throw error) + b avoid EK1010 and retain different operand extents.")

// rule-evidence: docs/design/src/003-failures.md#297d90c6b514fa45
// Chapter 003: comma throw boundary
// Spec: Commas count: `f(throw error, b)` is invalid; `f((throw error), b)` parses.
test.todo("Chapter 003: comma throw boundary — f(throw error, b) reports EK1010; f((throw error), b) parses with no EK1010.")

// rule-evidence: docs/design/src/003-failures.md#89920c8fcec9cd17
// Chapter 003: conditional colon follower
// Spec: The first arm of `condition ? throw error : fallback` needs no parentheses because `:` is not forbidden.
test.todo("Chapter 003: conditional colon follower — condition ? throw error : fallback parses without EK1010.")

// rule-evidence: docs/design/src/003-failures.md#0dd0afa84a6ba552
// Chapter 003: keyword throw followers
// Spec: Neither are the keyword operators `in` and `instanceof`, or TypeScript's `as` and `satisfies`.
test.todo("Chapter 003: keyword throw followers — in, instanceof, as and satisfies after a throw operand remain admitted syntax.")

// rule-evidence: docs/design/src/003-failures.md#4114898507c954c6
// Chapter 003: throw placement
// Spec: Where a throw is allowed at all remains [VIP-4's no-throw rule](#plain-code-never-throws) (`EK0401`).
test.todo("Chapter 003: throw placement — Plain code throw expression reports EK0401; corresponding effect and async forms are controls.")

// rule-evidence: docs/design/src/003-failures.md#7a86ed9442ac9c1e
// Chapter 003: no throw-expression migration
// Spec: Throw expressions remain supported; no migration to `do { throw (operand); }` is required.
test.todo("Chapter 003: no throw-expression migration — A valid effect-body throw expression compiles and --fix leaves it unchanged without forcing do syntax.")

// rule-evidence: docs/design/src/003-failures.md#77427b5bb65b125f
// Chapter 003: match direct throw operand
// Spec: VIP-7's direct match-arm body has its separate `"throw" Expression` production: `default: throw a + b;` throws the full operand, as a throw statement does.
test.todo("Chapter 003: match direct throw operand — default: throw a + b consumes the full operand; compare failure value with Effect.fail(a + b).")

// rule-evidence: docs/design/src/003-failures.md#ece597a68058e6e9
// Chapter 003: throw expression never type
// Spec: Its counterpart is `yield* Effect.fail(e)` in the same expression position, with type `never`:
test.todo("Chapter 003: throw expression never type — Compare expression-position throw with yield* Effect.fail in an Effect twin and assert never-valued branch types.")

// rule-evidence: docs/design/src/003-failures.md#9dd4508c09165862
// Chapter 003: required runtime outcomes
// Spec: `required("a")` gives `Success("a")`; `required(undefined)` gives `Failure(Missing)`.
test.todo("Chapter 003: required runtime outcomes — required(a) succeeds with a; required(undefined) fails with Missing; compare complete Exit and A/E/R with the Effect twin.")

// rule-evidence: docs/design/src/003-failures.md#366f4d2ade2450dd
// Chapter 003: foreign callable origins
// Spec: A callable declared outside VibeLang, in a `.ts`, `.js` or `.d.ts` file, an npm package or a `module` body (VIP-40), carries a thrown type by one rule, as TypeScript's own (VIP-4, amended 2026-11-02):
test.todo("Chapter 003: foreign callable origins — Cross .ts, .js, .d.ts, npm and module-body signatures under the same thrown-contract selection rules.")

// rule-evidence: docs/design/src/003-failures.md#c35a3e269fcf8089
// Chapter 003: foreign absent tag
// Spec: | no tag | `unknown` |
test.todo("Chapter 003: foreign absent tag — An unannotated non-effectful foreign signature has unknown thrown type in effect code; a never-tagged control needs no bridge.")

// rule-evidence: docs/design/src/003-failures.md#1b78aaab30799f1a
// Chapter 003: source throws tag ban
// Spec: A written `@throws` or `@rethrows` tag there, on a function, service member or function-type signature, is `EK0406`: remove it and declare failures in the Effect's error type.
test.todo("Chapter 003: source throws tag ban — Source function, service member and function-type @throws/@rethrows tags report EK0406; remove-tag fixes retain foreign annotations.")

// rule-evidence: docs/design/src/003-failures.md#09b2e6d04fdece53
// Chapter 003: declaration thrown contracts
// Spec: Declaration output records `@throws {never}` on non-effectful signatures, not an inferred contract ([Declarations](001-functions.md#declaration-output)); a re-exported foreign callable keeps its contract.
test.todo("Chapter 003: declaration thrown contracts — Emit non-effectful source call signatures with @throws {never}; a foreign re-export retains its original annotation.")

// rule-evidence: docs/design/src/003-failures.md#c5c92023f392a09e
// Chapter 003: alias signature contract
// Spec: `const g = f` preserves `f`'s contract; a tag on an alias of a function type does not attach, so in a foreign declaration write `type Reader = { /** @throws {E} */ (): string }`.
test.todo("Chapter 003: alias signature contract — const g = f retains the contract; a function-type alias tag does not attach but a call-signature tag does.")

// rule-evidence: docs/design/src/003-failures.md#d5ea5110468b9c35
// Chapter 003: effect subtype body throw
// Spec: A plain function whose return type is wholly one of these Effect subtypes is effectful and may not throw: `function bad(): Exit.Exit<number> { throw "x" }` is `EK0401`.
test.todo("Chapter 003: effect subtype body throw — function bad(): Exit.Exit<number> { throw x } reports EK0401; repeat Effect subtype controls.")

// rule-evidence: docs/design/src/003-failures.md#bb846fde5e3e7130
// Chapter 003: foreign effect factory defect
// Spec: A `.ts` function that returns an Effect and throws before returning is a defect inside an Effect generator, as in Effect TypeScript.
test.todo("Chapter 003: foreign effect factory defect — A .ts Effect factory that throws before returning dies in Effect.gen; compare the defect identity and factory timing.")

// rule-evidence: docs/design/src/003-failures.md#3b4eedc52001c887
// Chapter 003: source rethrows callback ban
// Spec: Its callback parameters follow their written callable signatures; a source `@rethrows` tag is `EK0406`, as on any other `.vibe` callable.
test.todo("Chapter 003: source rethrows callback ban — Source @rethrows is EK0406 even on an effectful callable; callback admission still follows its written signature.")

// rule-evidence: docs/design/src/003-failures.md#a2071ee5ada369ee
// Chapter 003: effectful declaration never
// Spec: Declaration output carries callee `@throws {never}`.
test.todo("Chapter 003: effectful declaration never — Emit an effectful callable and assert callee @throws {never} without deriving throws from its callback body.")

// rule-evidence: docs/design/src/003-failures.md#feec4cbf4d1257f5
// Chapter 003: variant intrinsic never
// Spec: Constructing an `error` or `data` variant throws `never`; this is the intrinsic static contract.
test.todo("Chapter 003: variant intrinsic never — Construct error and data variants in plain/effect code without a bridge; their intrinsic own thrown type is never.")

// rule-evidence: docs/design/src/003-failures.md#fe6c683a9e0d73ae
// Chapter 003: variant payload getter effects
// Spec: The Effect 4.1.1 constructors still read and copy the payload fields, including ordinary getters, `Proxy` traps and target property operations ([`Object.assign`](https://tc39.es/ecma262/2025/multipage/fundamental-objects.html#sec-object.assign), [`CopyDataProperties`](https://tc39.es/ecma262/2025/multipage/abstract-operations.html#sec-copydataproperties)).
test.todo("Chapter 003: variant payload getter effects — Compare error/data construction with native Effect 4.1.1 for getter reads, Proxy traps and target operations, including thrown identity and order.")

// rule-evidence: docs/design/src/003-failures.md#c71449e393fa855b
// Chapter 003: data-last outer contract
// Spec: A data-last overload such as `map(f)` returns a function: it is non-effectful, with `@throws {never}` only when its signature carries that annotation; otherwise its thrown type is `unknown`.
test.todo("Chapter 003: data-last outer contract — map(f) returns a non-effectful function; its outer thrown type follows its selected signature annotation, never or unknown.")

// rule-evidence: docs/design/src/003-failures.md#6150a2639fd35135
// Chapter 003: returned callable independent contract
// Spec: The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.
test.todo("Chapter 003: returned callable independent contract — Invoke an annotated returned function independently of its factory contract; Effect globals do not inherit Array.prototype rethrows rules.")

// rule-evidence: docs/design/src/003-failures.md#ded1fc0fcb573a52
// Chapter 003: dynamic import own never
// Spec: The runtime `import()` operation's own synchronous thrown type is `never`: its failures reject the Promise.
test.todo("Chapter 003: dynamic import own never — A runtime import's loading/evaluation failures reject its Promise instead of throwing synchronously.")

// rule-evidence: docs/design/src/003-failures.md#55352c512146ef29
// Chapter 003: dynamic import argument phase
// Spec: Independently evaluated source argument expressions keep their own contracts and left-to-right order; a throwing `makeSpecifier()` can throw before the operation creates a Promise.
test.todo("Chapter 003: dynamic import argument phase — makeSpecifier and options argument evaluation preserve left-to-right order and may throw synchronously before Promise creation.")

// rule-evidence: docs/design/src/003-failures.md#2d17fe681f93961b
// Chapter 003: type-only import query
// Spec: Type-only `import(...)` queries are not runtime import expressions.
test.todo("Chapter 003: type-only import query — type T = import(module).T creates no runtime import, Promise or thrown-type diagnostic.")

// rule-evidence: docs/design/src/003-failures.md#e947b06c4632333a
// Chapter 003: retry data-last unknown
// Spec: For example, an unannotated data-last `retry(p)` returns a function, so its thrown type is `unknown`, despite only building that function.
test.todo("Chapter 003: retry data-last unknown — An unannotated data-last retry(p) reports EK0403 in effect code despite returning only a function; explicit bridge compiles.")
