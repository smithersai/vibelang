# The VibeLang specification

This specification defines VibeLang as the accepted VibeLang Improvement Proposals (VIPs) define it, and nothing more. Each VIP lives in [`docs/design/vips/`](../vips/README.md), with the reasons for the decision and its history. Where this text and an accepted VIP disagree, the VIP wins and this text is the bug. Where a VIP is silent, the TypeScript or pinned TC39 counterpart applies.

The previous specification and its decision log (`D1` to `D558`) are in `docs/design/history/`. They are historical and not normative: nothing in them is part of the language unless a VIP adds it.

## Principles

VibeLang is TypeScript with a small set of constructs for writing Effect programs. Four principles decide every rule.

1. **Syntax decides.** A keyword on a function, a block or an expression decides what it means. A type never chooses what code runs: a function literal never becomes an Effect because a parameter expects one, and a type never decides whether a loop consumes a Stream (VIP-1, VIP-2, VIP-20).
2. **Exact sugar for Effect.** Every construct means one specific piece of Effect TypeScript, shown beside it in this specification. Compiled code gives the same `Exit` as that Effect TypeScript, with finalizers in the same order (VIP-31). Failures, defects, interruption and `Cause` combination follow Effect. VIP-7 adds exhaustiveness checking and generated error matchers to TC39 matching, and retains compiler fixed checks for Effect's `Option`, `Exit`, `Result` and tagged errors until Effect ships custom matchers; none patches Effect at runtime. The retained tagged-error checks are each module's own guard, listed in [Retained Effect tagged-error patterns](004-match.md#retained-effect-tagged-error-patterns).
3. **No ambiguity.** Every new keyword has exactly one reading. Each is contextual, except `fork` and `join`, which are reserved words in effect code exactly as `await` is in an `async` function ([the grammar's Effect parameter](900-appendices.md#the-effect-parameter); VIP-17, amended). "A little bit of ambiguity is unacceptable" (VIP-8). A proposal that can't meet that bar is denied (VIP-8, VIP-10, VIP-11, VIP-24).
4. **TypeScript's meaning outside Effect code.** Plain functions, `async` functions, `await`, `throw`, `using`, classes, `do` expressions and the pipe operator keep their TypeScript or pinned TC39 meaning. The additional static checks still apply: [throw tracking and `@throws`](003-failures.md#thrown-types) apply only to non-effectful functions; functions returning an `Effect`, `Stream` or `Layer` cannot throw (VIP-4, amended). [Legacy JavaScript restrictions](001-functions.md#direct-eval) also apply throughout `.vibe`, including plain functions (VIP-1, VIP-4, amended). [Platform restrictions](005-services.md#the-platform-standard-library) apply throughout `.vibe`, including plain functions and wrapper arrows (VIP-33).

## The language at a glance

| Construct | Means exactly | VIP | Chapter |
| --- | --- | --- | --- |
| `effect function f() { }`, `effect function (x) { }` (an expression), `effect () => …`, `effect m() { }` (a method) | a function returning `Effect.gen(function* () { … })` | 1 | [Functions](001-functions.md) |
| `A!E!R` | `Effect.Effect<A, E, R>` | 3 | [Functions](001-functions.md) |
| `try e` | `yield* e` | 5 | [Running Effects](002-running.md) |
| `e catch (err) => y`, `e catch effect (err) => …` | `yield* Effect.catch(e, …)` | 5 | [Running Effects](002-running.md) |
| `effect { … }` | `Effect.gen(function* () { … })` | 2 | [Running Effects](002-running.md) |
| `fork e`, `fork.in(s) e`, `fork.scoped e`, `fork.detached e`, `join f` | `Effect.forkChild`, `forkIn`, `forkScoped`, `forkDetach`, `Fiber.join` | 17 | [Running Effects](002-running.md) |
| `try.all [ … ]`, `try.race`, `try.any`, `try.allSettled` | `Effect.all(…, { concurrency: "unbounded" })`, `raceAllFirst`, `raceAll`, … | 18 | [Running Effects](002-running.md) |
| `for concurrent (const x of xs) { }` | `Effect.forEach(xs, …, { concurrency, discard: true })` | 19 | [Running Effects](002-running.md) |
| `for try (const x of stream) { }` | `Stream.runForEachWhile` | 20 | [Running Effects](002-running.md) |
| `effect function* p() { yield x }` | `Stream.callback` | 21 | [Running Effects](002-running.md) |
| `uninterruptible { restore { } }`, `interruptible { }` | `Effect.uninterruptibleMask`, `Effect.interruptible` | 22 | [Running Effects](002-running.md) |
| `throw e` in an `effect` function | `return yield* Effect.fail(e)` | 4 | [Failures](003-failures.md) |
| `error E { fields }` | `class E extends Data.TaggedError("E")<…> {}` | 13 | [Failures](003-failures.md) |
| `schema error E { fields }` | `class E extends Schema.TaggedError<E>()("E", { … }) {}` | 29 | [Failures](003-failures.md) |
| `match (x) { when P: …; }` | TC39 pattern matching, plus an exhaustiveness check, generated error matchers and fixed Effect pattern checks | 7 | [Pattern matching](004-match.md) |
| `service S { members }` | `class S extends Context.Service<S, { … }>()("key") {}` | 9 | [Services](005-services.md) |
| `provide L, K = v { … }` | `yield* Effect.provide(Effect.gen(…), [L, Layer.succeed(K, v)])` | 12 | [Services](005-services.md) |
| `retry`, `sleep`, `Schema`, `Layer`, … | Effect's exports and modules, in scope without an import | 6, 14, 33 | [Services](005-services.md) |
| `schema S { fields }` | `const S = Schema.Struct({ … }); type S = typeof S.Type` | 15 | [Data](006-data.md) |
| `data D { V; W { f: T } }` | `Data.TaggedEnum` and `Data.taggedEnum` | 16, 28 | [Data](006-data.md) |

The table abbreviates the full translations: preserve [source function bindings](001-functions.md#meaning), dispatch [outward jumps](002-running.md#region-bodies) after `provide` and interruption blocks, and add the [custom matcher](004-match.md#class-patterns) to error classes. All Effect TypeScript meanings use the [pinned `effect` 4.1.0](007-tooling.md#the-effect-version).

What VibeLang leaves out is just as deliberate. The [appendix](900-appendices.md#denied-vips) lists the denied VIPs: no Effect meaning for `using`, no `Users.find(id)` shorthand, no trailing blocks, no `wire`, no inline modules. The open VIPs (handlers, the declaration manifest, Effectify the universe) are not part of the language.

## How to read this specification

Each construct has four parts:

- **Syntax**, as links to the productions of [Appendix A](900-appendices.md#appendix-a-grammar), the only place the grammar is written, with prose and examples.
- **Static rules**, with the diagnostic each rule reports and its code in [Appendix B](900-appendices.md#appendix-b-diagnostics). VIP-34 requires every diagnostic to have a code; the code mapping for imported Effect language-service rules remains **Undecided (pending VIP)**. VIP-38 keeps their existing Effect language-service configuration.
- **Meaning**, as the exact Effect TypeScript the construct equals, beside the VibeLang.
- **Examples.**

A detail that neither a VIP, a ruling nor the TypeScript or pinned TC39 counterpart decides is marked **Undecided (pending VIP)**. Such details are not part of the language until decided.

### Examples are pending

The compiler is being changed to match the VIPs. Until it does, every VibeLang example here starts with a `// compiler-gap: pending VIP-N` line, which the snippet checker (`docs/tools/check-snippets.ts`) reports as a known gap rather than a failure. The Effect TypeScript beside it is marked `// fragment`, because it names functions such as `fetchUser` that the example doesn't declare. [Appendix D](900-appendices.md#appendix-d-flipping-pending-examples) says how to flip an example once its VIP is implemented.

## Chapters

1. [Functions and Effect types](001-functions.md): VIP-1, VIP-3, VIP-26, VIP-27.
2. [Running Effects](002-running.md): VIP-5, VIP-2, VIP-17 to VIP-23.
3. [Failures](003-failures.md): VIP-4, VIP-13, VIP-29.
4. [Pattern matching](004-match.md): VIP-7.
5. [Services and the environment](005-services.md): VIP-9, VIP-12, VIP-6, VIP-14, VIP-33.
6. [Data](006-data.md): VIP-15, VIP-16, VIP-28.
7. [Configuration and tooling](007-tooling.md): VIP-30, VIP-32, VIP-34, VIP-38.
8. [Runtime guarantees](008-runtime.md): VIP-31.
9. [Appendices](900-appendices.md): the grammar, the diagnostics, the denied and open VIPs, and flipping pending examples.
