# Effect feature coverage of the EffectScript proposal

Audit of `docs/design/effectscript-design.md` (proposal dated 2026-10-15, 2,732 lines; not edited) against every section of Effect's documentation. Written 2026-10-15 (America/Los_Angeles). Runtime: `effect@4.0.5`.

EffectScript answers an Effect feature in one of three ways: a language form replaces it (statements, `throw`, `try`, `using`, `service`, producers), a rule lets Effect's own API be used as is (a call runs; a function with no arguments is a program), or the proposal has no answer. This file sorts every documented Effect feature into **Changed**, **Unchanged**, or **Gap**, shows the Effect 4 form beside the EffectScript form, and answers the questions an Effect user will ask first.

> Historical audit. The counts and quoted forms describe the 2026-10-15 proposal. D57 closes partial annotations with explicit `infer Name` slots; D58-D60 settle naming, upstream drafts, and the single-repository layout. Current user guidance is in `docs/user/` and the spec.

## Summary

The proposal answers 266 of the 309 Effect features audited here: 130 with a form of its own and 136 by using Effect's API unchanged, which its call rule makes intentional. The other 43 rows point to 17 gaps, 15 found by this audit and two the audited proposal already listed (G12, former O7, now D57). Two of the new ones are rules that give wrong-looking answers for code Effect users write every day: `Config`, `Exit`, SQL statements, CLI commands, and service references are Effects in 4.0.5, so Chapter 11 runs them where they are built (X1); and a `.es` `try`/`catch` no longer catches an exception from a plain call such as `JSON.parse`, which `Effect.gen` catches today (X2).

EffectScript changes how a program is written and leaves Effect's semantics alone. Functions replace generators; `throw`, `try`, `finally`, and `using` replace the error and resource combinators; `service` and `wire` replace hand-built tags and layer plumbing; and `() => f()` stands wherever Effect expects a program. Concurrency, interruption, scheduling, state, caching, batching, Schema, platform services, HTTP, AI, and RPC keep their Effect APIs. Async needs no new construct, because a call already waits and Promises go through `Effect.tryPromise`; concurrency is always an explicit Effect combinator. The gaps sit at boundaries the rules do not define yet: callbacks passed to pure TypeScript helpers, runners inside `.es` code, Stream interop, and values that are both data and Effects.

| § | Area | Changed | Unchanged | Gap |
| --- | --- | --- | --- | --- |
| 1 | [Getting started](#1-getting-started-the-effect-type-creating-running-generators-pipelines-control-flow) | 16 | 7 | 4 |
| 2 | [Error management](#2-error-management) | 18 | 3 | 1 |
| 3 | [Requirements management](#3-requirements-management-services-default-services-layers-memoization) | 13 | 4 | 4 |
| 4 | [Resource management](#4-resource-management) | 7 | 1 | 1 |
| 5 | [Observability](#5-observability-logging-metrics-tracing-tracking-fibers) | 7 | 11 | 0 |
| 6 | [Configuration](#6-configuration-config-configprovider-redacted) | 1 | 3 | 3 |
| 7 | [Runtime](#7-runtime-running-programs-managedruntime-noderuntime) | 4 | 2 | 3 |
| 8 | [Scheduling](#8-scheduling) | 5 | 4 | 0 |
| 9 | [State management](#9-state-management) | 2 | 3 | 0 |
| 10 | [Caching](#10-caching) | 2 | 2 | 0 |
| 11 | [Batching](#11-batching-requests-and-resolvers) | 1 | 5 | 0 |
| 12 | [Concurrency](#12-concurrency-options-fibers-interruption-coordination) | 17 | 11 | 2 |
| 13 | [Async interop](#13-async-interop-promises-callbacks-asyncawait) | 5 | 3 | 0 |
| 14 | [Streams](#14-streams) | 4 | 8 | 3 |
| 15 | [Sinks](#15-sinks) | 0 | 2 | 1 |
| 16 | [Testing](#16-testing) | 4 | 5 | 2 |
| 17 | [Code style](#17-code-style) | 4 | 3 | 1 |
| 18 | [Data types](#18-data-types) | 5 | 12 | 2 |
| 19 | [Traits and behaviours](#19-traits-and-behaviours) | 0 | 3 | 0 |
| 20 | [Schema](#20-schema) | 2 | 12 | 2 |
| 21 | [Platform](#21-platform-filesystem-path-terminal-stdio-child-processes-keyvaluestore-socket-worker) | 4 | 6 | 2 |
| 22 | [HTTP](#22-http-httpclient-httpserver-httpapi) | 1 | 7 | 1 |
| 23 | [SQL](#23-sql) | 1 | 4 | 3 |
| 24 | [CLI](#24-cli) | 1 | 1 | 2 |
| 25 | [AI](#25-ai) | 3 | 4 | 2 |
| 26 | [Cluster, workflow, RPC](#26-cluster-workflow-and-rpc) | 1 | 4 | 3 |
| 27 | [Removed in Effect 4](#27-effect-3-features-that-effect-4-removed) | 2 | 6 | 1 |
| | **Total** | **130** | **136** | **43** |

The tables cover all 110 pages of the v4 docs, the 22 v3 pages whose paths the v4 site dropped, and the `effect@4.0.5` modules the site does not document (HTTP, SQL, CLI, AI, cluster, workflow, RPC, process, socket, workers); [appendix B](#appendix-b-page-index) maps every page to its section.

Gaps, most frequently hit first ([details](#gaps-ranked-by-how-often-an-effect-user-hits-them)):

1. **X3** Callbacks passed to TypeScript functions: which form a `.es` callback takes in `Option.match`, `Match`, `Stream.runFold`, or `Array.prototype.map`.
2. **X2** A `.es` `try`/`catch` around a plain call that throws does not catch it.
3. **X4** Runners inside `.es` code and Promise boundaries (tests, handlers, `ManagedRuntime`).
4. **G12** Producers and `Stream`: the adapters, and `for...of` over a `Stream` (the proposal's own gap).
5. **X1** Values that are both data and Effects: `Config`, `Exit`, SQL statements, CLI commands, toolkits, `Context.Reference`.
6. **X5** Layer sharing across sibling `provide` calls.
7. **Partial annotations (former O7, closed by D57).** Use `infer Name` for inferred slots in a return annotation with a body; every slot must be present.
8. **X8** `fork` in a function with no Scope region.
9. **X12** `service` lacks Effect 4's `make` option and `Context.Reference` defaults.
10. **X13** Service members that return plain values or are Effect values (`Path.Path.join`).
11. **X9** Parameters that accept either a function or an Effect (`HttpRouter.add`, `RpcGroup.toLayer`).
12. **X6** Configuration: composing `Config` values (X1 applied to the Configuration guide).
13. **X11** Callback adapters in `.es`, and which acquisition policy `using` applies.
14. **X15, X16** Devtools and installation.
15. **X17** Workflow replay.

Seven answers in the proposal look wrong as written; [the list](#answers-that-look-wrong) gives each with its chapter.

A decision log written while this audit ran (`docs/design/history/DECISIONS.md`, D1 to D36, dated 2026-10-16) settles 9 of the 17 gaps with default decisions (X1, X3, X5, X6, X8, X10, X15, X16, and the design half of G12), narrows 4 (X2, X4, X11, X12), and at that time left 4 open (O7, X9, X13, X17); D57, D39, D41, and D42 now settle those four; the gap table's last column gives each status. D24 is X1's option (a) and D9 is X3's proposed rule. The log also changes surface syntax this file quotes from the proposal: services become abstract classes (D1), `TaggedError`, `Schema`, and `Layer` join the prelude (D3, D4), and platform APIs such as `fetch` are not callable from `.es` (D5, ES4402).

## Sources

| # | Source | Version it documents | Fetched or read | Used for |
| --- | --- | --- | --- | --- |
| 1 | Official docs, [effect.website/docs/v4](https://effect.website/docs/v4/onboarding): sidebar, [`llms.txt`](https://effect.website/docs/v4/llms.txt) index (110 pages), [`llms-full.txt`](https://effect.website/docs/v4/llms-full.txt) (36,843 lines, every page's markdown) | Effect 4. The site defaults to v4 ("Effect 4.0 is here" banner, all sidebar links under `/docs/v4/`) and offers a v3/v4 switch | Fetched 2026-10-16 06:09 UTC | The section and feature list; Effect 4 examples |
| 1b | Official docs, [effect.website/docs/v3](https://effect.website/docs/v3/getting-started) sidebar (117 pages) and the v3 pages whose paths v4 dropped (Micro, AI, Supervisor, Command, KeyValueStore, Either, Effect vs Promise) | Effect 3 | Fetched 2026-10-16 06:10 to 06:13 UTC | Features Effect 3 documented that the v4 site dropped |
| 2 | Pinned package `experiments/node_modules/effect`: `CLAUDE.md`, `AGENTS.md`, `ai-docs/`, `src/` module list and JSDoc | 4.0.5 | Read 2026-10-15 | Exact signatures; which values are Effects; modules the site omits (HTTP, SQL, CLI, AI, cluster, workflow, RPC) |
| 3 | Local Effect repo `~/effect-repo`: `ai-docs/src`, `LLMS.md`, `MIGRATION.md`, `migration/*.md`, `packages/` | 4.0.0-rc.108 | Read 2026-10-15 | Effect 3 to 4 renames; areas the site omits |
| 4 | Usage census of two Effect 4 codebases: Smithers (`effect` 4.0.4, 3,604 files import `effect`) and opencode (4.0.0-beta.83, 1,070 files), counted with `rg` over files that import `effect` | Effect 4 | Measured 2026-10-15 | Ranking how often an Effect user would hit each gap (appendix A) |
| 5 | `docs/design/history/DECISIONS.md`, decision log D1 to D36, dated 2026-10-16 | EffectScript | Appeared during this audit; read 2026-10-15 23:50 PT | The status column of the gap ranking and the notes marked "After the decision log". The spec rewrite in `docs/design/src/` that follows the log was in progress and was not audited |

Where the v4 site and `effect@4.0.5` disagree, this file follows 4.0.5 and says so. The site has stale Effect 3 text in places: it says `Option`, `Result`, and `Deferred` can be yielded as Effects, but in 4.0.5 `yield* Option.some(1)` dies with "Not a valid effect" and `Deferred` is not an Effect subtype; it documents `Effect.whileLoop` with a signature 4.0.5 does not have; and its "PlatformLogger" page describes `Logger.toFile`, since 4.0.5 has no `PlatformLogger` module.

## How to read the tables

| Mark | Meaning |
| --- | --- |
| **Changed** | EffectScript has its own form: a statement replaces a combinator, `throw`/`try`/`finally`/`using`/`service`/`fork`/a producer replaces an Effect construct, or the program argument is written `() => f()` (rule R2). The proposal chapter that gives the form is cited. |
| **Unchanged** | The Effect API is used with the same arguments. A call that returns an Effect runs (R1); a call that returns a value builds the value (R3). Nothing new is needed, and that is intentional. |
| **Gap** | The proposal does not answer it, or its rules give an unclear or wrong-looking answer. The row names a gap ID; [Gaps](#gaps-ranked-by-how-often-an-effect-user-hits-them) states the question and what would decide it. |
| Ch. N | Chapter N of the proposal. O#, P#, G# are its Part V decision, proposal, and gap numbers. |
| (derived) | The proposal never names this API; the row applies the cited rule to it. |
| (uncertain) | Not verified against 4.0.5 source or by running code. |

Effect 4 names are used throughout. Where Effect 3 differs, the row says "v3:".

## The rules that decide most rows

These are the proposal's own rules, restated so each row can cite them.

| Rule | Statement | Proposal |
| --- | --- | --- |
| R1 | A call runs. `f(x)` on a function that returns an `Effect` runs it on the current fiber and gives its success value; a callee's error becomes the caller's error. An `Effect` value runs when called: `Clock.currentTimeMillis()`. | Ch. 5, 11 (call table) |
| R2 | A program argument is a function with no parameters. Wherever the expected type is `Effect` (including array elements and record fields), `() => f()` is converted to a program; nothing runs until the combinator runs it. **Proposed** (O1). | Ch. 5, 11 |
| R3 | A call to a function that does not return an `Effect` is an ordinary JavaScript call. If it throws, that is a defect, as an uncaught throw inside `Effect.gen` is, and a `.es` `catch` does not see it (gap X2). **Proposed** (O11). | Ch. 10, 11, 15 |
| R4 | `throw` adds the thrown value's type to E. `try`/`catch` catches expected failures only, narrowed by type. `finally` and `using` run on success, failure, interruption, and abandonment. They compile to Effect frames, never to JavaScript `try`. | Ch. 3, 6, 15, 24 |
| R5 | A callback parameter without a written contract accepts any contract (effect-polymorphic). A callback that can pause, or (in v0) that has a nonempty E, may not be passed to plain JavaScript (ES4301). Effect APIs that take Effect-returning callbacks accept EffectScript functions. | Ch. 10, 14 |
| R6 | A call never starts a fiber. Programs start at runners (`Effect.runPromise`, `NodeRuntime.runMain`, `it.effect`) and at `fork` and concurrent combinators. A module's top level may build values but not run a program (ES1001). | Ch. 7, 11, 21 |
| R7 | `function*` declares a producer, consumed with `for...of`. `Effect.gen(function* …)` cannot be written in `.es` files (ES1002). `async`/`await` do not exist in `.es` files. | Ch. 8, 10, O4 |
| R8 | Services: `service S { … }` declares one; `S.method()` calls it; `S()` returns the implementation; providers are Layers (`Layer.effect(S, () => { … })`), composed with `wire` or Effect's Layer functions. | Ch. 4 |

Most **Unchanged** rows follow from R1 and R3 alone; most **Changed** rows follow from R2, R4, R7, or R8.

## Coverage by documentation area

Each table lists the features a docs section teaches. The Effect 4 column is a one-line Effect 4 example; the EffectScript column is the same thing written in a `.es` file.

### 1. Getting started: the Effect type, creating, running, generators, pipelines, control flow

Docs pages: Welcome, Why Effect?, The Effect Type, Installation, Creating Effects, Importing Effect, Running Effects, Using Generators, Building Pipelines, Devtools, Getting Started; v3 Effect vs Promise.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| The `Effect<A, E, R>` type | Changed | `const f = (id: string): Effect.Effect<User, UserNotFound, Users> => …` | inferred for every function; written as a return annotation `Effect<A, E, R>` (ambient, no import), which may be wider than the body, never narrower | Ch. 1, 2, 12 |
| Type helpers (`Effect.Success`, `Effect.Error`, `Effect.Services`) | Unchanged | `type R = Effect.Services<typeof program>` | same, applied to the TypeScript-visible type of an EffectScript function | Ch. 10 (derived) |
| Annotate one channel, infer the rest | Changed (D57) | not needed; TypeScript infers | `Effect<A, infer E, infer R>` in return annotations with bodies; all slots required | Ch. 14, D57 |
| Installation and project setup | Gap X16 | `npm install effect`; TypeScript 5.9+, `strict` | Ch. 25 describes a TypeScript compiler fork and an `@effectscript/runtime` package, with no install, build-tool, or test-runner setup | Ch. 25 |
| Importing Effect | Unchanged | `import { Effect } from "effect"` | same. `Effect<A, E, R>` and the built-ins `pipe`, `wire`, `fork`, `handle`, `resume`, `resumeWith`, `abandon`, `transfer` are ambient; whether they shadow an imported `pipe` is unstated (Fable review, finding 12) | Ch. 1 |
| Succeed (`Effect.succeed`) | Changed | `Effect.succeed(42)` | `return 42` | Ch. 2 |
| Fail (`Effect.fail`, `failSync`) | Changed | `Effect.fail(new HttpError())` | `throw new HttpError()` | Ch. 3 |
| Synchronous side effect (`Effect.sync`) | Changed | `Effect.sync(() => console.log(msg))` | `console.log(msg)`; a throw is a defect (R3) | Ch. 10, 11, 13 |
| Code that may throw (`Effect.try`; v3 `UnknownException`, v4 `UnknownError`) | Unchanged | `Effect.try({ try: () => JSON.parse(s), catch: (e) => new ParseError({ e }) })` | same call; it runs and gives the parsed value | Ch. 10 |
| Promises (`Effect.promise`, `Effect.tryPromise`) | Unchanged | `Effect.tryPromise({ try: (signal) => fetch(url, { signal }), catch: (e) => new HttpError({ e }) })` | same call; it waits and gives the resolved value | Ch. 10 |
| Lazy construction (`Effect.suspend`) | Changed | `Effect.suspend(() => (attempts++ < 3 ? Effect.fail(err) : Effect.succeed("ok")))` | where a program is expected: `() => { if (attempts++ < 3) throw err; return "ok" }` | Ch. 5, 11 |
| Callback APIs (`Effect.callback`; v3 `Effect.async`) | Changed | `Effect.callback<Buffer>((resume) => fs.readFile(p, (e, d) => resume(e ? Effect.fail(e) : Effect.succeed(d))))` | write the adapter in TypeScript with the runtime's `suspend`; how `.es` code would spell `resume(Effect.succeed(d))` is unstated | Ch. 6; gap X11 |
| Effect constants (`Effect.void`, `never`, `yieldNow`, `interrupt`, `Clock.currentTimeMillis`) | Unchanged | `yield* Effect.never` | `Effect.never()`: an `Effect` value runs when called | Ch. 5, 11 |
| Run a program (`runPromise`, `runPromiseExit`, `runSync`, `runSyncExit`, `runFork`, `runCallback`) | Changed | `Effect.runPromise(program)` | the runner receives a program: `Effect.runPromise(() => main())`, at a module's top level or from TypeScript | Ch. 11, 21 |
| Run inside a function or a JavaScript callback | Gap X4 | `test("x", async () => { expect(await Effect.runPromise(p)).toBe(1) })` | `.es` has no `await`, and the proposal does not say whether a runner may be called inside a plain callback | Ch. 10, 11 |
| Generators (`Effect.gen`) | Changed | `Effect.gen(function* () { const amount = yield* fetchAmount; … })` | an ordinary function body. In `.es`, `function*` declares a producer, so `Effect.gen` is ES1002 | Ch. 2, 10; O4 |
| `yield*` | Changed | `const user = yield* users.find(id)` | `const user = Users.find(id)` | Ch. 2 |
| Generators that use `this` (`Effect.gen({ self: this }, …)`; v3 `Effect.gen(this, …)`) | Changed | `Effect.gen({ self: this }, function* () { return this.local + 1 })` | an ordinary method; JavaScript's `this` is kept | Ch. 11 (evaluation order) |
| Named functions (`Effect.fn`, `Effect.fnUntraced`) | Changed | `const welcome = Effect.fn("welcome")(function* (id: string) { … })` | `function welcome(id: string) { … }`, compiled to `Effect.fnUntraced` (no span; see Observability) | Ch. 2, 24 |
| Sequencing (`map`, `flatMap`, `andThen`, `tap`, `as`) | Changed | `pipe(fetchAmount, Effect.map(addServiceCharge))` | `addServiceCharge(fetchAmount())` | Ch. 2, 5 |
| `pipe` and `.pipe` over programs | Changed | `fetchUser(id).pipe(Effect.retry({ times: 3 }), Effect.timeout("2 seconds"))` | `pipe(() => fetchUser(id), Effect.retry({ times: 3 }), Effect.timeout("2 seconds"))`; **Proposed** (O1) | Ch. 5 |
| `pipe` over data | Unchanged | `pipe(items, Array.filter(isActive), Array.map(toRow))` | same | Ch. 5 |
| Combine results (`Effect.all`, `zip`, `zipWith`) | Changed | `Effect.all([fetchAmount, fetchRate])` | `Effect.all([() => fetchAmount(), () => fetchRate()])`, or two statements when order is enough | Ch. 2, 7 |
| `Option`/`Result` into a program (`Effect.fromOption`, `fromResult`, `fromNullishOr`) | Unchanged | `Effect.andThen((x) => Effect.fromOption(parse(x)))` | `const n = Effect.fromOption(parse(x))` | R1 (derived) |
| Control flow (`if`, `for`, `while`, early `return` inside `Effect.gen`) | Changed | `Effect.gen(function* () { for (const id of ids) { … } })` | the same statements in an ordinary function | Ch. 2 |
| Basic concurrency (learning path) | Changed | `Effect.all(tasks, { concurrency: 2 })`, `Effect.forkChild`, `Effect.race` | see [Concurrency](#12-concurrency-options-fibers-interruption-coordination) | Ch. 7 |
| Devtools (`@effect/tsgo` diagnostics and refactors, VS Code debugger panes) | Gap X15 | `npx @effect/tsgo setup` | the fork brings its own language server (inferred contracts on hover, ES diagnostics, quick fixes); whether `@effect/tsgo` and the VS Code extension's fiber and span panes work on `.es` files is unstated | Ch. 25 |

### 2. Error management

Docs pages: Two Types of Errors, Expected Errors, Unexpected Errors, Fallback, Matching, Retrying, Timing Out, Sandboxing, Error Accumulation, Error Channel Operations, Parallel and Sequential Errors, Yieldable Errors.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Expected errors versus defects | Changed | `Effect.fail(e)` versus `Effect.die(e)` or a throw inside `Effect.sync` | `throw e` is expected (in E); an exception from a plain call, or `Effect.die(e)`, is a defect | Ch. 3, 15 |
| A JavaScript `throw` inside a function body | Changed | inside `Effect.gen`, `throw new Error("x")` is a defect | in `.es`, `throw new Error("x")` is a typed failure: `Error` joins E | Ch. 3 |
| JavaScript `try`/`catch` around a throwing plain call | Gap X2 | inside `Effect.gen`, `try { JSON.parse(s) } catch { return null }` catches the `SyntaxError` (verified on 4.0.5) | in `.es`, that `catch` does not run: the exception is a defect and `catch` sees only E. Only `Effect.try` makes it catchable | Ch. 10, 15 |
| Tagged error classes (`Data.TaggedError`, `Data.Error`, `Schema.TaggedError`, `Schema.Error`) | Unchanged | `class UserNotFound extends Data.TaggedError("UserNotFound")<{ readonly id: string }> {}` | same classes | Ch. 3 |
| Error tracking in E | Changed | unions inferred from `Effect.gen` | E = everything thrown, plus callees' E, minus what `catch` handles | Ch. 3, 12 |
| Recover from every typed error (`Effect.catch`; v3 `catchAll`) | Changed | `primary.pipe(Effect.catch((e) => Effect.succeed(fallback)))` | `try { return primary() } catch (e) { return fallback }` | Ch. 3 |
| Recover selectively (`catchTag`, `catchTags`, `catchIf`, `catchFilter`; v3 `catchSome`) | Changed | `request.pipe(Effect.catchTag("NetworkError", (e) => Effect.succeed(cached)))` | `catch (e) { if (e instanceof NetworkError) return cached; throw e }`; the combinators still work with a program: `Effect.catchTag(() => request(), "NetworkError", () => cached)` | Ch. 3 |
| Nested reasons (`catchReason`, `catchReasons`, `unwrapReason`) | Changed | `Effect.catchReason("AiError", "RateLimitError", (r) => retryLater(r))` | narrow both tags in `catch`: `if (e._tag === "AiError" && e.reason._tag === "RateLimitError") return retryLater(e.reason)` | Ch. 3 (derived) |
| Defects (`Effect.die`, `orDie`, `catchDefect`, `catchCause`, `tapDefect`; v3 `catchAllDefect`, `catchAllCause`) | Changed | `effect.pipe(Effect.orDie)` | `Effect.orDie(() => parseId(raw))`; `Effect.catchDefect(() => risky(), (d) => …)` at a boundary | Ch. 3, 15 |
| Errors as values (`Effect.result`, `option`, `exit`; v3 `either`) | Changed | `const r = yield* Effect.result(task)` | `const r = Effect.result(() => task())` | R2 (derived) |
| Fallback (`orElseSucceed`, `firstSuccessOf`; v3 `orElse`, `orElseFail`) | Changed | `Effect.firstSuccessOf([primary, secondary])` | `try { return primary() } catch { return secondary() }`, or `Effect.firstSuccessOf([() => primary(), () => secondary()])` | Ch. 3 |
| Matching (`match`, `matchEffect`, `matchCause`, `matchCauseEffect`) | Changed | `Effect.match(task, { onFailure: f, onSuccess: s })` | `try` with statements; for the whole cause, `const exit = Effect.exit(() => task())` then `Exit.match` | Ch. 3 (derived) |
| Ignore failures (`ignore`, `ignoreCause`; v3 `ignoreLogged`) | Changed | `Effect.ignore(task)` | `try { task() } catch {}`, or `Effect.ignore(() => task())` | Ch. 3 (derived) |
| Retrying (`retry` with options or a Schedule, `retryOrElse`) | Changed | `request.pipe(Effect.retry({ times: 5 }))` | `Effect.retry(() => request(), { times: 5 })`; each attempt reruns the function with fresh locals | Ch. 5, 15 |
| Timing out (`timeout`, `timeoutOption`, `timeoutOrElse`; v3 `timeoutFail`, `timeoutTo`) | Changed | `task.pipe(Effect.timeout("1 second"))` | `Effect.timeout(() => task(), "1 second")`; E gains `TimeoutError`; the program runs on a child fiber, so control operations cannot cross it | Ch. 5, 14, 15 |
| Sandboxing (`Effect.sandbox`; v3 `unsandbox` is gone) | Changed | `Effect.sandbox(task).pipe(Effect.catch((cause) => …))` | `try { return Effect.sandbox(() => task()) } catch (cause) { … }` | Ch. 3 (derived) |
| Error accumulation (`Effect.validate`, `Effect.partition`; v3 `validateAll`) | Unchanged | `Effect.validate(items, (x) => check(x))` | same; the callback is an EffectScript function | R5 (derived) |
| `Effect.all` with `mode: "result"` (v3 `"either"`, `"validate"`) | Changed | `Effect.all([a, b], { mode: "result" })` | `Effect.all([() => a(), () => b()], { mode: "result" })` | Ch. 7 (derived) |
| Error channel operations (`mapError`, `mapBoth`, `tapError`, `tapErrorTag`, `tapCause`, `flip`, `filterOrFail`) | Changed | `task.pipe(Effect.mapError((m) => new Error(m)))` | `try { return task() } catch (m) { throw new Error(m) }`; `if (v < 0) throw new Negative({ v })` replaces `filterOrFail` | Ch. 3 |
| Parallel and sequential errors (v4 `Cause` is a flat `reasons` array) | Unchanged | `Cause.combine(a, b).reasons` | `catch` receives the typed failure `Effect.catch` would receive (derived, uncertain for several parallel failures); the full cause through `Effect.catchCause` | Ch. 24 (`catch` lowers to the `Effect.catch` family) |
| Yieldable errors | Changed | `return yield* new NotFound({ id })` | `throw new NotFound({ id })` | Ch. 3 |
| Promise that nothing escapes | Changed | `const f = (…): Effect.Effect<A, never, R> => …` checked by TypeScript | contract `Effect<A, never, R>`, checked by the compiler (ES2001) | Ch. 3, 12 |

### 3. Requirements management: services, default services, layers, memoization

Docs pages: Managing Services, Default Services, Managing Layers, Layer Memoization.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Declare a service (`Context.Service`; v3 `Context.Tag`, `Effect.Tag`, `Effect.Service`) | Changed | `class Users extends Context.Service<Users, { readonly find: (id: string) => Effect.Effect<User, UserNotFound> }>()("app/Users") {}` | `service Users { find(id: string): Effect<User, UserNotFound, never> }`; **Proposed** (O2). A hand-written `Context.Service` class also works | Ch. 4 |
| Service key identity | Changed | the key string you choose; two services with one key alias silently | the compiler derives `@pkg/path#Users` and rejects duplicates | Ch. 4, 22 |
| Use a service | Changed | `const users = yield* Users; const user = yield* users.find(id)` | `const user = Users.find(id)`; `Users()` gives the implementation | Ch. 4, 11 |
| Accessor helpers (`Users.use`, `useSync`) | Changed | `Notifications.use((n) => n.notify("hi"))` | `Notifications.notify("hi")` (the call form v3's `Effect.Tag` accessors offered) | Ch. 4 |
| Effect-valued service members | Unchanged | `const n = yield* random.next` | `const n = Random().next()` | Ch. 4, 11 |
| Service methods that return plain values | Gap X13 | `const path = yield* Path.Path; path.join(a, b)` | `Path.Path().join(a, b)` works; whether `Path.Path.join(a, b)` is a service call when `join` returns a string is unstated | Ch. 4, 11 |
| Constructor on the key (`Context.Service<S>()(id, { make })` with `static layer = Layer.effect(this, this.make)`; v3 `Effect.Service` with `.Default`) | Gap X12 | `class Cache extends Context.Service<Cache>()("app/Cache", { make: Effect.gen(…) }) { static readonly layer = Layer.effect(this, this.make) }` | `service` has no `make` or `layer` member; write a separate `const CacheLive = Layer.effect(Cache, () => { … })` | Ch. 4 |
| Services with defaults (`Context.Reference`; v3 `FiberRef`) | Gap X12 | `const FeatureFlag = Context.Reference<boolean>("app/Flag", { defaultValue: () => false })` | `service` cannot declare a default, and `Context.Reference(...)` returns an Effect subtype, so Ch. 11 would run the call (at a module's top level, ES1001) | Ch. 4, 11 |
| Optional services (`Effect.serviceOption`) | Unchanged | `const maybe = yield* Effect.serviceOption(Random)` | `const maybe = Effect.serviceOption(Random)` | R1 (derived) |
| Default services (`Clock`, `Console`, `Random`, `Tracer`, `ConfigProvider`, `Scheduler`) | Unchanged | `const now = yield* Clock.currentTimeMillis` | `const now = Clock.currentTimeMillis()`; R stays empty | Ch. 5 |
| Provide one service (`Effect.provideService`) | Changed | `Effect.provideService(program, Random, impl)` | `Effect.provideService(() => program(), Random, impl)`; the override applies only inside | Ch. 4 |
| Contexts by hand (`Context.make`, `Context.add`) | Changed | `Effect.provide(program, Context.make(Random, impl))` | `Effect.provide(() => program(), Context.make(Random, impl))` | Ch. 4 (derived) |
| Layers (`Layer.succeed`, `Layer.effect`, `Layer.sync`) | Changed | `Layer.effect(Users, Effect.gen(function* () { const db = yield* Database; … }))` | `Layer.effect(Users, () => { const db = Database(); return { find(id) { … } } })` | Ch. 4 |
| Layers that hold resources (v3 `Layer.scoped`) | Changed | `Layer.effect(Db, Effect.gen(function* () { const pool = yield* Postgres.connect(url); … }))` | the same body without `using`: `Scope` stays with the layer and closes when the provided program finishes | Ch. 4 |
| Requirements that leak into service methods | Changed | allowed; the docs advise against it | ES3101 rejects a per-call lookup the method's contract does not allow | Ch. 4 |
| Compose layers (`merge`, `mergeAll`, `provide`, `provideMerge`) | Changed | `Layer.mergeAll(UsersLive, MailerLive).pipe(Layer.provideMerge(DatabaseLive))` | `wire(UsersLive, MailerLive, DatabaseLive, ConfigLive)` (**Proposed**, O6), or the same Layer functions | Ch. 4 |
| Missing, duplicate, and cyclic providers | Changed | missing: residual R at the run site; duplicate: the later one wins; cycle: hangs | ES3201, ES3202, ES3203 at compile time | Ch. 4, 22; G13 |
| Provide a layer (`Effect.provide`) | Changed | `program.pipe(Effect.provide(AppLive))` | `Effect.provide(() => program(), AppLive)` | Ch. 4 |
| Layer memoization (by reference; `Layer.fresh`; `{ local: true }`; `Layer.makeMemoMap`) | Gap X5 | `Effect.provide(program, Layer.merge(Layer.provide(B, A), Layer.provide(C, A)))` builds `A` once | Ch. 4 promises one build per `provide`; Ch. 22 measured that sibling provides do not share in 4.0.5, while Effect's migration note says they do; the promised "per application graph" sharing rule is not written | Ch. 4, 22; Fable review, finding 6 |
| Layer tools (`Layer.launch`, `build`, `tap`, `tapError`, `catch`, `unwrap`, `mock`) | Unchanged | `Effect.runFork(Layer.launch(server))` | `Layer.launch(server)` inside `main`; the others build values | R1, R3 (derived) |
| Fake services for tests | Changed | `Layer.succeed(Users, Users.of({ find: (id) => Effect.succeed(ada) }))` | `Layer.succeed(Users, { find: (id) => ada })` | Ch. 4 |

### 4. Resource management

Docs pages: Introduction, Scope.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Scope a block (`Effect.scoped`) | Changed | `Effect.scoped(Effect.gen(function* () { const file = yield* fs.open(p); … }))` | a block that contains `using` is the Scope region | Ch. 6, 24 |
| Acquire and release (`acquireRelease`, `acquireUseRelease`) | Changed | `Effect.acquireRelease(open(p), (f) => close(f))` | `using f = Effect.acquireRelease(() => open(p), (f) => close(f))`; releases run in reverse order on every exit | Ch. 6 |
| Interruptible acquisition (`acquireRelease(…, { interruptible: true })`; v3 `acquireReleaseInterruptible`) | Gap X11 | `Effect.acquireRelease(connect, release, { interruptible: true })` | which policy `using` gives is unstated, and Ch. 6's adapter uses the masked default, so its lost-race branch never runs | Ch. 6; Fable review, finding 2 |
| A resource the caller owns | Changed | `Scope` stays in R | a function that acquires without `using` keeps `Scope` in R; the caller's `using` owns the resource | Ch. 6 |
| Finalizers (`ensuring`, `onExit`, `onError`, `addFinalizer`) | Changed | `task.pipe(Effect.ensuring(cleanup))` | `try { return task() } finally { cleanup() }`; `Effect.onExit(() => task(), (exit) => …)` when the cleanup needs the Exit | Ch. 3, 15 |
| Manual scopes (`Scope.make`, `addFinalizer`, `close`, `Scope.provide`; v3 `Scope.extend`) | Unchanged | `const scope = yield* Scope.make(); yield* Scope.close(scope, Exit.void)` | `const scope = Scope.make(); Scope.close(scope, Exit.void)`; `Scope.addFinalizer(scope, () => log("bye"))` takes a program | R1, R2 (derived) |
| `using` on a TypeScript `Disposable` | Changed | none | `using x = disposable` registers `[Symbol.dispose]()` as a finalizer | Ch. 24 |
| Shared and pooled resources (`RcRef`, `RcMap`, `Pool`, `ScopedRef`, `ScopedCache`, `Resource`, `LayerMap`) | Changed | `const pool = yield* Pool.make({ acquire: connect, size: 10 })` | `using pool = Pool.make({ acquire: () => connect(), size: 10 })`; `using conn = Pool.get(pool)` | Ch. 6; R2 (derived) |
| Cleanup when a handler abandons a program | Changed | no equivalent | `using` and `finally` between the handler and the program run before `handle` returns | Ch. 6, 9, 15 |

### 5. Observability: logging, metrics, tracing, tracking fibers

Docs pages: Logging, Metrics in Effect, Tracing in Effect, Tracking Fibers, PlatformLogger; v3 Supervisor.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Log at a level: `Effect.log`, `logDebug`, `logInfo`, `logWarning`, `logError`, `logFatal` | Unchanged | `yield* Effect.logWarning("disk low")` | `Effect.logWarning("disk low")` | Ch. 1, 2; R1 |
| Minimum log level for a region (`References.MinimumLogLevel`) | Changed | `program.pipe(Effect.provideService(References.MinimumLogLevel, "Debug"))` | `Effect.provideService(() => program(), References.MinimumLogLevel, "Debug")` | Ch. 4 (`provideService` with a program); R2 |
| Log annotations and log spans (`annotateLogs`, `withLogSpan`) | Changed | `program.pipe(Effect.annotateLogs("requestId", id), Effect.withLogSpan("handler"))` | `pipe(() => program(), Effect.annotateLogs("requestId", id), Effect.withLogSpan("handler"))` | Ch. 5; R2 (derived) |
| Scoped annotations (`annotateLogsScoped`) | Unchanged | `yield* Effect.annotateLogsScoped({ requestId })` | `Effect.annotateLogsScoped({ requestId })`; `Scope` joins R unless the block has a `using` | Ch. 6, 12 (derived) |
| Custom loggers and formats (`Logger.make`, `Logger.layer`, `consoleJson`, `consolePretty()`, `formatLogFmt`, `tracerLogger`) | Unchanged | `Effect.provide(program, Logger.layer([Logger.consoleJson]))` | `Effect.provide(() => program(), Logger.layer([Logger.consoleJson]))`; loggers and layers are values | Ch. 4; R3 (derived) |
| Log to a file (v3 `PlatformLogger.toFile`; v4 `Logger.toFile`) | Unchanged | `Logger.layer([Logger.formatLogFmt.pipe(Logger.toFile("/tmp/app.log"))])` | same expression inside `Logger.layer([...])` | R3 (derived) |
| Console module | Unchanged | `yield* Console.log("hi")` | `Console.log("hi")` | R1 (derived) |
| Metric definitions (`Metric.counter`, `gauge`, `histogram`, `summary`, `frequency`, `timer`, `withAttributes`) | Unchanged | `const requests = Metric.counter("requests")` | same; a value, so allowed at module top level | Ch. 11 (top level may build values) |
| Track a program with a metric (`Effect.trackSuccesses`, `trackDuration`) | Changed | `task.pipe(Effect.trackDuration(latency))` | `Effect.trackDuration(() => task(), latency)` | R2 (derived) |
| Update or read a metric (`Metric.update`, `Metric.modify`, `Metric.value`) | Unchanged | `yield* Metric.update(requests, 1)` | `Metric.update(requests, 1)` | R1 (derived) |
| Attributes for a region (`Metric.CurrentMetricAttributes`) | Changed | `program.pipe(Effect.provideService(Metric.CurrentMetricAttributes, { env: "prod" }))` | `Effect.provideService(() => program(), Metric.CurrentMetricAttributes, { env: "prod" })` | R2 (derived) |
| Spans per function (`Effect.fn("name")`) | Changed | `const welcome = Effect.fn("welcome")(function* (id) { … })` | `function welcome(id) { … }` compiles to `Effect.fnUntraced`; no span, no call-site frame. Spans are opt-in because a traced frame costs 10 to 20 times more. Since 4.0.5's `Effect.fn` also accepts a non-generator body (probe, appendix A), `const welcome = Effect.fn("welcome")((id: string) => { … })` may keep a named span per function; the proposal does not discuss it (derived, uncertain) | Ch. 2, 22, 24, 25 |
| Wrap a program in a span (`Effect.withSpan`) | Changed | `program.pipe(Effect.withSpan("load-user"))` | `Effect.withSpan(() => loadUser(id), "load-user")` | Ch. 2, 5 |
| Span attributes and current span (`annotateCurrentSpan`, `currentSpan`, `currentParentSpan`, `linkSpans`) | Unchanged | `yield* Effect.annotateCurrentSpan("userId", id)` | `Effect.annotateCurrentSpan("userId", id)` | R1 (derived) |
| Logs become span events | Unchanged | `Effect.log` inside a span | same | Ch. 20 (spans survive handler capture, G6a) |
| OpenTelemetry export (`@effect/opentelemetry` `NodeSdk.layer`, `OtelTracer.layerGlobal`) | Unchanged | `Effect.provide(program, NodeSdk.layer(() => config))` | `Effect.provide(() => program(), NodeSdk.layer(() => config))`; whether `() => config` is a config thunk or a program depends on the union rule (gap X9) | R3; gap X9 |
| Track a group of fibers (`FiberSet`, `FiberMap`, `FiberHandle`) | Changed | `yield* FiberSet.run(set, task)` | `using set = FiberSet.make<number>()` then `FiberSet.run(set, () => task())` | Ch. 6 (`using` for Scope-requiring constructors), R2 (derived) |
| Supervisors (v3 `Supervisor`, `Effect.supervised`) | Unchanged | none in 4.0.5: no `Supervisor` module | nothing to map; use `FiberSet` or `fork` | Ch. 10 (Effect 4 only) |

### 6. Configuration: Config, ConfigProvider, Redacted

Docs page: Configuration (plus the Redacted data type).

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Read one value (`Config.String`, `Port`, `Int`, `Boolean`, `Duration`, `URL`, `LogLevel`, `Redacted`; v3 lowercase `Config.string`, `Config.integer`) | Gap X6 | `const port = yield* Config.Port("PORT")` | `const port = Config.Port("PORT")` reads at the call, because `Config` extends `Effect` in 4.0.5 (verified). The proposal never mentions Effect's `Config`, and its examples name a user service `Config` (Ch. 4) | Ch. 11; not covered |
| Compose configs (`Config.all`, `withDefault`, `option`, `orElse`, `nested`, `map`, `mapEffect`, `schema`, `Array`, `Record`) | Gap X6 | `Config.all({ host: Config.String("HOST"), port: Config.Port("PORT").pipe(Config.withDefault(8080)) })` | each inner call runs before the combinator sees it, so `withDefault` never applies: reading `PORT` first fails with `ConfigError` (verified on 4.0.5) | Ch. 11 |
| Providers (`ConfigProvider.fromEnv`, `fromUnknown`, `fromDotEnvContents`, `make`, `nested`, `constantCase`, `orElse`, `layer`, `layerAdd`; v3 `fromJson`, `fromMap`, `Layer.setConfigProvider`) | Unchanged | `Effect.provide(program, ConfigProvider.layer(ConfigProvider.fromUnknown({ PORT: 8080 })))` | `Effect.provide(() => program(), ConfigProvider.layer(ConfigProvider.fromUnknown({ PORT: 8080 })))` | Ch. 4 (derived) |
| File-based providers (`ConfigProvider.fromDotEnv()`, `fromDir()`, which return Effects) | Unchanged | `const provider = yield* ConfigProvider.fromDotEnv()` | `const provider = ConfigProvider.fromDotEnv()` inside a function | R1 (derived) |
| Load against an explicit provider in tests (`config.parse(provider)`) | Gap X6 | `Effect.runSync(AppConfig.parse(provider))` | `AppConfig` cannot be built as a composed value in `.es` (X6); define it in TypeScript | X6 |
| A Layer chosen by config (`Layer.unwrap`) | Changed | `Layer.unwrap(Effect.map(Config.LogLevel("LOG_LEVEL"), (l) => Layer.succeed(References.MinimumLogLevel, l)))` | `Layer.unwrap(() => Layer.succeed(References.MinimumLogLevel, Config.LogLevel("LOG_LEVEL")))`: reading inside the program works | R1, R2 (derived) |
| Secrets (`Redacted.make`, `Redacted.value`, `Config.Redacted`) | Unchanged | `Redacted.value(yield* Config.Redacted("API_KEY"))` | `Redacted.value(Config.Redacted("API_KEY"))` | R1, R3 (derived) |

### 7. Runtime: running programs, ManagedRuntime, NodeRuntime

Docs pages: Introduction to Runtime, Running Effects, Platform Runtime, Guidelines.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Run the main program (`NodeRuntime.runMain`, `BunRuntime.runMain`) | Changed | `NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))` | `NodeRuntime.runMain(() => Effect.provide(() => main(), NodeServices.layer))` at a module's top level | Ch. 1, 11 |
| `runMain` options (`disableErrorReporting`, `teardown`) | Changed | `NodeRuntime.runMain(program, { disableErrorReporting: true })` | `NodeRuntime.runMain(() => main(), { disableErrorReporting: true })` | Ch. 11 (derived) |
| One-shot runners (`runPromise`, `runPromiseExit`, `runSync`, `runSyncExit`, `runFork`, `runCallback`) | Changed | `const fiber = Effect.runFork(program)` | `const fiber = Effect.runFork(() => main())`. Ch. 11 names only `runPromise`, `runMain`, and test runners; Ch. 21 treats `runSync` as a foreign frame with an empty Context | Ch. 11, 21; gap X4 |
| Run with an explicit Context (`runPromiseWith(ctx)`, `runForkWith`, `runSyncWith`; v3 `Runtime.runPromise(rt)`) | Gap X4 | `Effect.runSyncWith(context)(program)` | not named as a runner | X4 |
| `ManagedRuntime` for frameworks (React, Express, workers) | Gap X4 | `const rt = ManagedRuntime.make(AppLive); await rt.runPromise(handler(req))` | not named as a runner; it works from a TypeScript file, where an EffectScript function is an ordinary `(…) => Effect` | Ch. 10; X4 |
| The module top level | Changed | top-level `await Effect.runPromise(…)` is allowed | a top-level call may only build values (ES1001); runners are the one exception | Ch. 11 |
| Scheduling and fairness (2048 operations per slice, `References.MaxOpsBeforeYield`, `Scheduler`) | Unchanged | a fiber yields after 2048 operations; `References.MaxOpsBeforeYield` tunes it | same; a plain JavaScript region is atomic, like an `Effect.sync` body | Ch. 13, 22 |
| The process stays alive while fibers wait (new in v4) | Unchanged | the runtime holds a keep-alive timer | same | none needed |
| Error reporting (`ErrorReporter.layer`, `Effect.withErrorReporting`) | Gap X9 | `program.pipe(Effect.withErrorReporting)` | `Effect.withErrorReporting(() => program())`, but the function picks its overload by `Effect.isEffect(arg)` at run time, so the thunk must arrive as an Effect | X9 |

### 8. Scheduling

Docs pages: Using schedules, Choosing and combining schedules, Scheduling work with cron, Schedule cookbook; v3 Introduction, Built-in Schedules, Schedule Combinators, Repetition, Examples.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Schedule constructors (`spaced`, `fixed`, `exponential`, `recurs`, `fibonacci`, `forever`, `cron`) | Unchanged | `Schedule.exponential("250 millis")` | same; a `Schedule` is a value, not an Effect | Ch. 5, 11 |
| Schedule combinators (`upTo`, `while`, `jittered`, `max`, `min`, `concat`, `concatResult`, `setInputType`) | Unchanged | `Schedule.exponential("250 millis").pipe(Schedule.upTo({ times: 5 }))` | same; `.pipe` on a value | Ch. 5 ("pipelines over plain data stay plain") |
| Schedules with effectful callbacks (`modifyDelay`, `tap`, `while` returning an Effect) | Unchanged | `Schedule.tap(({ attempt }) => Effect.log(attempt))` | `Schedule.tap(({ attempt }) => Effect.log(attempt))`; the callback is an EffectScript function, which Effect sees as Effect-returning | R5 (derived) |
| Repeat after success (`Effect.repeat` with a schedule or `{ schedule, until, while, times }`) | Changed | `poll.pipe(Effect.repeat({ schedule: Schedule.spaced("1 second"), until: (s) => s === "done" }))` | `Effect.repeat(() => poll(), { schedule: Schedule.spaced("1 second"), until: (s) => s === "done" })` | Ch. 5; R2 |
| Retry after failure (`Effect.retry`) | Changed | `fetchUser(id).pipe(Effect.retry(Schedule.exponential("100 millis")))` | `Effect.retry(() => fetchUser(id), Schedule.exponential("100 millis"))`; each attempt runs with fresh locals | Ch. 5 |
| Wait for the first slot (`Effect.schedule`), fallbacks (`repeatOrElse`) | Changed | `Effect.schedule(cleanup, Schedule.spaced("1 hour"))` | `Effect.schedule(() => cleanup(), Schedule.spaced("1 hour"))` | R2 (derived) |
| Cron rules (`Cron.parse`, `Cron.sequence`, `Schedule.cron`) | Unchanged | `const cron = yield* Effect.fromResult(Cron.parse("0 3 * * *", "UTC"))` | `const cron = Effect.fromResult(Cron.parse("0 3 * * *", "UTC"))` | R1, R3 (derived) |
| Cron job lifecycle (start on a fiber, stop at shutdown) | Changed | `const job = Effect.runFork(Effect.schedule(report, Schedule.cron(cron)))` | inside `main`: `fork(() => Effect.schedule(() => report(), Schedule.cron(cron)))`, stopped when `main`'s block exits | Ch. 7 (`fork`, **Proposed** O5), Ch. 11 |
| Server-directed delays, hard deadlines, phased retries (cookbook) | Changed | `load.pipe(Effect.retry(policy), Effect.timeout("250 millis"))` | `pipe(() => load(), Effect.retry(policy), Effect.timeout("250 millis"))` | Ch. 5 |

### 9. State management

Docs pages: Ref, SynchronizedRef, SubscriptionRef.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| `Ref` (`make`, `get`, `set`, `update`, `modify`, `getAndUpdate`, …) | Unchanged | `const ref = yield* Ref.make(0); yield* Ref.update(ref, (n) => n + 1)` | `const ref = Ref.make(0); Ref.update(ref, (n) => n + 1)` | R1 (derived). In 4.0.5 a `Ref` is not an Effect, so `yield* ref` is gone; `Ref.get(ref)` |
| Programs stored as object fields | Changed | `this.inc = Ref.update(this.value, (n) => n + 1)` | `inc = () => Ref.update(this.value, (n) => n + 1)`; a bare call would run at construction | Ch. 5 (storing programs) |
| `SynchronizedRef.updateEffect` and other effectful updates | Unchanged | `SynchronizedRef.updateEffect(ref, (xs) => Effect.map(load(), (x) => [...xs, x]))` | `SynchronizedRef.updateEffect(ref, (xs) => [...xs, load()])` | R5 (derived) |
| `SubscriptionRef.changes` (a Stream of values) | Unchanged | `SubscriptionRef.changes(ref)` | same; consume with `Stream.runForEach` | Ch. 8 (derived) |
| Transactional state (v3 STM `TRef`, `STM.commit`, `STM.retry`; v4 `TxRef`, `TxQueue`, `TxHashMap`, `Effect.tx`, `Effect.txRetry`) | Changed | `yield* Effect.tx(TxRef.update(ref, (n) => n + 1))` | `Effect.tx(() => TxRef.update(ref, (n) => n + 1))`; `Effect.txRetry()` blocks until a read value changes | R1, R2 (derived) |

### 10. Caching

Docs pages: Caching Effects, Cache.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Run at most once and share the result (`Effect.cached`) | Changed | `const get = yield* Effect.cached(loadConfig)` then `yield* get` | `const get = Effect.cached(() => loadConfig())` then `get()` | Ch. 5 ("Effect.cached returns a program") |
| Cache with expiry or invalidation (`cachedWithTTL`, `cachedInvalidateWithTTL`) | Changed | `const [get, invalidate] = yield* Effect.cachedInvalidateWithTTL(load, "1 minute")` | `const [get, invalidate] = Effect.cachedInvalidateWithTTL(() => load(), "1 minute")`; `get()`, `invalidate()` | Ch. 5, R1 (an `Effect` value runs when called) |
| Keyed cache (`Cache.make`, `get`, `refresh`, `invalidate`, `invalidateAll`, `size`) | Unchanged | `const cache = yield* Cache.make({ capacity: 100, lookup: fetchUser })` | `const cache = Cache.make({ capacity: 100, lookup: (id) => fetchUser(id) }); Cache.get(cache, "42")` | R1, R5 (derived) |
| Memoize a function (v3 `Effect.cachedFunction`) | Unchanged | absent in 4.0.5; use `Cache` | use `Cache` | Ch. 10 (Effect 4 only) |

### 11. Batching: requests and resolvers

Docs page: Batching.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Request types (`Request.Class`, `Request.TaggedClass`, `Request.tagged`) | Unchanged | `class GetUser extends Request.Class<{ readonly id: number }, User, NotFound> {}` | same | R3 (derived) |
| Resolvers (`RequestResolver.make`, `fromEffect`, `fromFunction`, `makeGrouped`, `setDelay`, `batchN`; v3 `makeBatched`) | Unchanged | `RequestResolver.make((entries) => Effect.forEach(entries, (e) => Request.completeEffect(e, load(e.request.id))))` | `RequestResolver.make((entries) => Effect.forEach(entries, (e) => Request.completeEffect(e, () => load(e.request.id))))` | R2, R5 (derived) |
| Issue a request (`Effect.request`) | Unchanged | `yield* Effect.request(new GetUser({ id }), resolver)` | `Effect.request(new GetUser({ id }), resolver)` | R1 (derived) |
| Batches form only under concurrency | Unchanged | `Effect.forEach(ids, (id) => getUser(id), { concurrency: "unbounded" })` | same; sequential calls never batch, as in Effect | Ch. 7 |
| Request caching (`RequestResolver.withCache`, `asCache`; v3 `withRequestCaching`) | Unchanged | `const cached = yield* RequestResolver.withCache(resolver, { capacity: 256 })` | `const cached = RequestResolver.withCache(resolver, { capacity: 256 })` inside a function or Layer | R1 (derived) |
| A resolver that needs a service (built inside a Layer) | Changed | `Layer.effect(Todos, Effect.gen(function* () { const http = yield* Http; … }))` | `Layer.effect(Todos, () => { const http = Http(); … })` | Ch. 4 |

### 12. Concurrency: options, fibers, interruption, coordination

Docs pages: Basic Concurrency, Fibers, Deferred, Queue, PubSub, Semaphore, Latch.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Concurrency option (`number` or `"unbounded"`; default sequential). v3 also had `"inherit"` and `batching`; 4.0.5 has neither | Changed | `Effect.all([loadProfile(id), recentOrders(id)], { concurrency: 2 })` | `Effect.all([() => loadProfile(id), () => recentOrders(id)], { concurrency: 2 })` | Ch. 7 |
| Struct and record forms of `Effect.all`; `mode: "result"` | Changed | `Effect.all({ profile: loadProfile(id), orders: recentOrders(id) }, { concurrency: "unbounded" })` | `Effect.all({ profile: () => loadProfile(id), orders: () => recentOrders(id) }, { concurrency: "unbounded" })` | Ch. 11 (record fields convert) |
| A computed array of programs | Gap X3 | `Effect.all(stores.map(syncInventory), { concurrency: 4 })` | `Effect.all(stores.map(makeSync), { concurrency: 4 })` is the proposal's own example; an EffectScript function passed to `Array.prototype.map` has no defined calling convention | Ch. 5; Fable review finding 3 |
| `Effect.forEach` with concurrency | Unchanged | `Effect.forEach(images, (image) => resize(image), { concurrency: 8 })` | same | Ch. 7 |
| `Effect.zip`, `zipWith` (`concurrent: true`) | Changed | `Effect.zip(a, b, { concurrent: true })` | `Effect.zip(() => a(), () => b(), { concurrent: true })` | R2 (derived) |
| Races (`race`, `raceFirst`, `raceAll`); the loser is interrupted | Changed | `Effect.race(fromCache(id), fromNetwork(id))` | `Effect.race(() => fromCache(id), () => fromNetwork(id))` | Ch. 5, 7 |
| Fork a supervised child (`Effect.forkChild`) | Changed | `const fiber = yield* Effect.forkChild(task)` | `const fiber = Effect.forkChild(() => task())` | Ch. 7 |
| Background work owned by the block (`fork`) | Changed | `yield* Effect.forkScoped(heartbeat)` inside `Effect.scoped` | `fork(() => heartbeat())`; interrupted and awaited when the block exits, before earlier resources are released | Ch. 7, 24; **Proposed** O5 |
| `fork` in a function with no Scope region | Gap X8 | n/a | unspecified: an error, or `Scope` joins R | Fable review finding 9 |
| Daemon and scope-bound forks (`forkDetach`, `forkScoped`, `forkIn`). v3: `fork`, `forkDaemon` | Changed | `yield* Effect.forkDetach(daemon)` | `Effect.forkDetach(() => daemon())` | Ch. 7 |
| Join, await, interrupt (`Fiber.join`, `await`, `interrupt`, `joinAll`, `interruptAll`) | Unchanged | `const report = yield* Fiber.join(pending)` | `const report = Fiber.join(pending)` | Ch. 7 |
| Fire-and-forget interrupt (`fiber.interruptUnsafe()`) | Unchanged | `fiber.interruptUnsafe()` | same; a plain call | R3 |
| Interruption is not an error | Changed | `Effect.catch` skips it; `catchCause` sees it | `catch` never sees it; `finally` and `using` always run | Ch. 3, 15 |
| Uninterruptible region | Changed | `Effect.uninterruptible(transfer)` | `Effect.uninterruptible(() => { Ledger.debit(a, n); Ledger.credit(b, n) })` | Ch. 15 |
| `uninterruptibleMask`, `interruptibleMask` | Changed | `Effect.uninterruptibleMask((restore) => Effect.flatMap(acquire, (r) => restore(use(r))))` | `Effect.uninterruptibleMask((restore) => { const r = acquire(); return restore(() => use(r)) })` | R2 (derived) |
| Cleanup on interruption (`onInterrupt`) | Changed | `task.pipe(Effect.onInterrupt(() => Console.log("stopped")))` | `Effect.onInterrupt(() => task(), () => Console.log("stopped"))` | R2 (derived) |
| Effect values: `Effect.interrupt`, `Effect.yieldNow`, `Effect.never`, `Effect.void` | Unchanged | `yield* Effect.yieldNow` | `Effect.yieldNow()` | Ch. 11 (an `Effect` value runs when called) |
| Where an interruption can land | Unchanged | at Effect operations | same. A plain JavaScript region (Ch. 13) is atomic, like an `Effect.sync` body; a loop that runs Effect operations keeps its yield points | Ch. 13, 22 |
| Loop forever (`Effect.forever`) | Changed | `Effect.forever(tick)` | `while (true) tick()`, or `Effect.forever(() => tick())` | Ch. 2 |
| `Deferred` (`make`, `await`, `succeed`, `fail`, `done`, `poll`, `isDone`) | Unchanged | `const d = yield* Deferred.make<number>(); yield* Deferred.await(d)` | `const d = Deferred.make<number>(); Deferred.await(d)` | R1. In 4.0.5 a `Deferred` is not an Effect (the docs say it is). Chains of `Deferred` wake-ups overflow in 4.0.5 (Ch. 22, G5) |
| Complete a `Deferred` from a program (`Deferred.complete`, `completeWith`) | Changed | `Deferred.complete(d, task)` | `Deferred.complete(d, () => task())` | R2 (derived) |
| `Queue` (`bounded`, `dropping`, `sliding`, `unbounded`, `offer`, `take`, `takeAll`, `takeBetween`, `poll`, `shutdown`, `end`) | Unchanged | `yield* Queue.offer(queue, 1)` | `Queue.offer(queue, 1)` | R1 |
| `PubSub` subscriptions (scoped) | Changed | `const sub = yield* PubSub.subscribe(pubsub)` inside `Effect.scoped` | `using sub = PubSub.subscribe(pubsub); PubSub.take(sub)` | Ch. 6 |
| `PubSub` publishing and sizing | Unchanged | `yield* PubSub.publish(pubsub, msg)` | `PubSub.publish(pubsub, msg)` | R1 |
| `Semaphore` (`make`, `take`, `release`, `resize`) | Unchanged | `const mutex = yield* Semaphore.make(1)` | `const mutex = Semaphore.make(1)` | R1 |
| Run while holding permits (`sem.withPermits(n)(effect)`) | Changed | `mutex.withPermits(1)(task)` | `mutex.withPermits(1)(() => task())` | R2 (derived) |
| `Latch` (`make`; `open`, `close`, `await`, `release` are Effect-valued properties) | Unchanged | `yield* latch.open` | `latch.open()` | R1 (an `Effect` value runs when called) |
| Gate a program on a latch (`latch.whenOpen`) | Changed | `latch.whenOpen(task)` | `latch.whenOpen(() => task())` | R2 |
| Services seen by a forked fiber | Unchanged | the parent's Context, snapshotted | same; later changes do not cross | Ch. 7, 20 |
| Control operations across fibers | Changed | no equivalent | ES4201 when a `control` operation sits inside a combinator that forks; handle it inside each branch | Ch. 9, 14 |

### 13. Async interop: promises, callbacks, async/await

Docs pages: Creating Effects (promise, tryPromise, callback), Running Effects; v3 Effect vs Promise.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| `async`/`await` | Changed | `Effect.gen` with `yield*`; `async` functions outside Effect | no `async` and no `await` in `.es`; a call already waits | Ch. 10 |
| Wait on a Promise (`Effect.promise`, `Effect.tryPromise`) | Unchanged | `Effect.tryPromise({ try: (signal) => fetch(url, { signal }), catch: (e) => new HttpError({ e }) })` | same call | Ch. 10 |
| Cancel a Promise on interruption (`AbortSignal`) | Unchanged | `try: (signal) => fetch(url, { signal })` | same | Ch. 10 |
| Wrap a callback API (`Effect.callback`) | Changed | `Effect.callback<number>((resume) => { const t = setTimeout(() => resume(Effect.succeed(200)), 10); return Effect.sync(() => clearTimeout(t)) })` | a TypeScript adapter with the runtime's `suspend`, which also tells the producer when it lost a race | Ch. 6; gap X11 |
| Hand a program to Promise code (`Effect.runPromise`) | Changed | `const user = await Effect.runPromise(getUser(id))` | from TypeScript: `await Effect.runPromise(getUser(id))`, since an EffectScript function returns an ordinary Effect. Inside `.es`: gap X4 | Ch. 10, 11 |
| Async iterables and event emitters | Unchanged | `Stream.fromAsyncIterable(iterable, (e) => new ReadError({ e }))`, `Stream.fromEventListener(el, "click")` | same | Ch. 8 (derived) |
| Synchronous code that throws | Changed | `Effect.try({ try, catch })`; a JavaScript `try` inside `Effect.gen` also works | `Effect.try({ try, catch })`; a JavaScript-style `try` in `.es` does not catch it (gap X2) | Ch. 10, 15 |
| Effect 3 libraries | Changed | Effect 3 values die in the Effect 4 runtime | foreign code: `Effect.tryPromise({ try: () => Effect3.runPromise(p), catch })` | Ch. 10 |

### 14. Streams

Docs pages: Introduction to Streams, Creating Streams, Consuming Streams, Error Handling in Streams, Operations, Resourceful Streams.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| A sequence produced by code that waits between values | Changed | `fs.stream(path).pipe(Stream.decodeText(), Stream.splitLines, Stream.filter(isError), Stream.take(3), Stream.runCollect)` | `function* lines(path) { using file = Files.open(path); … yield line }` consumed by `for (const line of lines(path)) { … }`; `break` closes the file | Ch. 8, 24; **Proposed** O4 |
| Streams from data (`make`, `range`, `iterate`, `fromIterable`, `fromArray`, `succeed`, `fail`, `empty`, `tick`, `fromSchedule`) | Unchanged | `Stream.range(1, 10)` | same; a `Stream` is a value, not an Effect | Ch. 8 |
| Streams from programs (`fromEffect`, `fromEffectRepeat`, `fromIterableEffect`) | Changed | `Stream.fromEffect(Random.nextInt)` | `Stream.fromEffect(() => Random.nextInt())` | R2 (derived) |
| Effectful unfolding (`unfold`, `paginate`) | Unchanged | `Stream.paginate(0, (cursor) => Effect.map(fetchPage(cursor), (p) => [p.items, Option.fromUndefinedOr(p.next)] as const))` | `Stream.paginate(0, (cursor) => { const p = fetchPage(cursor); return [p.items, Option.fromUndefinedOr(p.next)] as const })` | R5 (derived) |
| Push sources (`Stream.callback`; v3 `Stream.async`), `fromQueue`, `fromPubSub`, `fromEventListener`, `fromReadableStream`, `fromAsyncIterable` | Unchanged | `Stream.callback<number>((queue) => Effect.sync(() => emitter.on("n", (n) => Queue.offerUnsafe(queue, n))))` | `Stream.callback<number>((queue) => { emitter.on("n", (n) => Queue.offerUnsafe(queue, n)) })`; the inner JavaScript callback may only make calls that cannot pause (ES4301) | R5 (derived) |
| Operators (`map`, `filter`, `take`, `mapEffect`, `flatMap`, `switchMap`, `merge`, `zip`, `groupBy`, `grouped`, `buffer`, `debounce`, `throttle`, `broadcastN`, …) | Unchanged | `Stream.mapEffect(urls, fetchUrl, { concurrency: 2 })` | same; Effect-returning callbacks are EffectScript functions. Pure callbacks depend on gap X3 | Ch. 8; R5 |
| Run a stream (`runCollect`, `runForEach`, `runFold`, `runDrain`, `run(sink)`, `runForEachWhile`) | Unchanged | `yield* Stream.runForEach(events, (e) => Audit.record(e))` | `Stream.runForEach(events, (e) => Audit.record(e))` | Ch. 8 |
| Pull by hand (`Stream.toPull`) | Unchanged | `const pull = yield* Stream.toPull(s)` then `yield* pull` until `Cause.Done` | `using pull = Stream.toPull(s)` then `pull()` per chunk; the end arrives as a `Cause.Done` failure (derived, uncertain) | Ch. 6, R1 |
| Stream error handling (`Stream.catch`, `catchCause`, `retry`, `timeout`, `onError`) | Unchanged | `Stream.catch(primary, () => fallback)` | same. `try`/`catch` applies to the call that runs a stream, not to the stream value | R4 (derived) |
| Resourceful streams (`Stream.scoped`, `acquireRelease` inside a stream, `Stream.ensuring`) | Changed | `Stream.ensuring(app, deleteDir("tmp"))` | `Stream.ensuring(app, () => deleteDir("tmp"))` | R2 (derived) |
| Operations that need a Scope (`Stream.partition`, `broadcastN`) | Changed | `const [evens, odds] = yield* Stream.partition(s, isEven, { capacity: 5 })` | `using parts = Stream.partition(s, isEven, { capacity: 5 })`, then `const [evens, odds] = parts` (uncertain: `using` cannot destructure) | Ch. 6 (derived) |
| Producer to `Stream` (`Stream.fromProducer`) | Gap G12 | n/a | proposed adapter; producer cancellation through Stream untested | Ch. 8, G12 |
| `for...of` over a `Stream` | Gap G12 | n/a | needs the reverse adapter. Today's rules already allow the `Stream.toPull` loop above | Ch. 8, G12 |
| Time and concurrency over producers (merge, buffer, groupedWithin, debounce) | Gap X10 | `Stream.merge(a, b)` | producers are sequential internal iteration with no operators; each such case must convert to `Stream`, which waits on G12 | Ch. 8, 24 |
| Stream to `AsyncIterable` (`Stream.toAsyncIterable`) | Unchanged | `for await (const x of Stream.toAsyncIterable(s))` | no `for await` in `.es`; use it from TypeScript | Ch. 10 |

### 15. Sinks

Docs pages: Sink Introduction, Creating Sinks, Sink Operations, Leftovers; v3 Sink Concurrency.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Sinks (`Sink.sum`, `count`, `take`, `head()`, `last()`, `collect()`, `drain`, `timed`, `reduce`, `mapInput`, `map`, `mapEnd`, `ignoreLeftover`) | Unchanged | `yield* Stream.run(stream, Sink.sum)` | `Stream.run(stream, Sink.sum)` | R1, R3 (derived) |
| Effectful folds (`Sink.fold`, `foldUntil`, `forEach`) | Unchanged | `Sink.fold(() => 0, (sum) => sum <= 10, (a, b) => Effect.succeed(a + b))` | `Sink.fold(() => 0, (sum) => sum <= 10, (a, b) => a + b)`: the step's expected type returns an Effect, so it receives the Effect form (R5); the `() => 0` initial value is a plain thunk (gap X3) | R5; gap X3 |
| Feed a producer into a sink | Gap G12 | n/a | waits on the producer adapter | Ch. 8, G12 |

### 16. Testing

Docs page: TestClock; `@effect/vitest` (package docs and `ai-docs/src/09_testing`).

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Effect tests (`it.effect`; v3 `it.scoped`) | Changed | `it.effect("welcome", () => Effect.gen(function* () { … }))` | `it.effect("welcome", () => { const name = Effect.provide(() => welcome("42"), wire(UsersTest, MailerTest)); assert.strictEqual(name, "Ada") })` | Ch. 4, 9 |
| `it.live`, `it.effect.each`, `it.effect.prop`, `it.flakyTest` (v3 `it.scopedLive`) | Unchanged | `it.live("reads the clock", () => program)` | `it.live("reads the clock", () => { … })` | Ch. 11 (test runners take programs) (derived) |
| Shared test layers (`layer(AppLive)("suite", (it) => …)`, `it.layer`) | Unchanged | `layer(AppLive)("users", (it) => { it.effect("finds", () => …) })` | same; the suite callback is plain JavaScript and each test body is a program | R5 (derived) |
| Fake services | Changed | `Layer.succeed(Users, Users.of({ find: () => Effect.succeed(ada) }))` | `Layer.succeed(Users, { find: () => ada })`, composed with `wire(UsersTest, MailerTest)` | Ch. 4 |
| Override for one region | Changed | `program.pipe(Effect.provideService(Mailer, quiet))` | `Effect.provideService(() => program(), Mailer, quiet)` | Ch. 4 |
| Scripted answers to requests | Changed | no equivalent | `handle(() => checkout("c-42"), Approval, { approve: (_r, k) => resume(k, true) })` | Ch. 9 |
| TestClock (`effect/testing`; v3 `effect/TestClock`) | Unchanged | `const f = yield* Effect.forkChild(p); yield* TestClock.adjust("1 minute"); yield* Fiber.join(f)` | `const f = Effect.forkChild(() => p()); TestClock.adjust("1 minute"); Fiber.join(f)` | R1, R2 (derived) |
| TestConsole (`TestConsole.layer`, `logLines`, `errorLines`), TestCrypto | Unchanged | `const lines = yield* TestConsole.logLines` | `const lines = TestConsole.logLines()`: `logLines` is an Effect value | R1 (derived) |
| Assert on an `Exit` | Gap X1 | `assert.deepStrictEqual(yield* Effect.exit(p), Exit.succeed(1))` | `Exit.succeed(1)` returns an Effect subtype, so Ch. 11 runs it and the comparison sees `1` | X1 |
| Promise-style tests (`test("x", async () => { await Effect.runPromise(p) })`) | Gap X4 | `Effect.run*` appears in 1,067 of Smithers' 2,084 test files | `.es` has no `await`, and runner calls inside a callback are unspecified; such tests stay in `.ts` or move to `it.effect` | X4 |
| Property tests (`it.effect.prop`, `Arbitrary.checkEffect`) | Unchanged | `Arbitrary.checkEffect(arb, (v) => v < 5)` | same | R1 (derived) |

### 17. Code style

Docs pages: Guidelines, Dual APIs, Branded Types, Pattern Matching, Simplifying Excessive Nesting, Control Flow Operators.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Run once, at the edge (`NodeRuntime.runMain`) | Changed | `NodeRuntime.runMain(program)` | `NodeRuntime.runMain(() => main())` at a module's top level; nothing else at top level may run | Ch. 1, 11 (ES1001) |
| Avoid tacit (point-free) calls | Unchanged | `Effect.map((x) => fn(x))`, not `Effect.map(fn)` | the advice carries over to the combinators that remain | none needed |
| Dual APIs (data-first and data-last) | Changed | `pipe(effect, Effect.retry(policy))` or `Effect.retry(effect, policy)` | data-first with a program: `Effect.retry(() => f(), policy)`; data-last only inside EffectScript's `pipe` | Ch. 5; **Proposed** O1 |
| Branded types (`Brand.nominal`, `Brand.make`, `Brand.all`; v3 `Brand.refined`) | Unchanged | `const Int = Brand.make<Int>((n) => Number.isInteger(n) \|\| "Expected an integer")` | same. A failed check throws `BrandError` from a plain call, so it is a defect (R3); for a typed error use `Int.result(n)` and `throw` | R3 (derived) |
| Pattern matching on values (`Match.value`, `type`, `when`, `not`, `tag`, `exhaustive`, `orElse`, `option`, `result`; v3 `Match.either`) | Unchanged | `Match.value(shape).pipe(Match.tag("Circle", (c) => c.r), Match.exhaustive)` | same, with pure handlers | R3 (derived) |
| Pattern matching with effectful branches | Gap X3 | `Match.value(event).pipe(Match.tag("Created", (e) => notify(e)), Match.exhaustive)` then `yield*` the result | unclear: ES4301 may reject `(e) => notify(e)` passed to `Match.tag`, or the call may return an Effect that R1 runs. `switch (event._tag)` with narrowing works today | Ch. 2, 10, 14 |
| Do notation (`Effect.Do`, `bind`, `let`, `bindTo`) | Changed | `Effect.Do.pipe(Effect.bind("start", () => now), Effect.let("elapsed", ({ start }) => …))` | `const start = now(); const elapsed = …` | Ch. 2 |
| Control flow operators (`Effect.when`, `whileLoop`, `zip`, `zipWith`, `forEach`, `all`). v3 `Effect.if`, `unless`, `loop`, `iterate` are absent in 4.0.5 | Changed | `Effect.whileLoop({ while: () => i < 3, body: () => step(), step: (a) => out.push(a) })` | `while (i < 3) out.push(step())` | Ch. 2 |

### 18. Data types

Docs pages: BigDecimal, Cause, Chunk, Data, DateTime, Duration, Result, Exit, HashSet, Option, Redacted; v3 Either.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| `Option` (constructors, `match`, `map`, `getOrElse`, `Option.gen`, …) | Unchanged | `Option.getOrElse(found, () => guest)` | same. In 4.0.5 `Option` is not an Effect, so its functions are plain calls | R3 (derived) |
| `Option` to a typed failure | Changed | docs: `yield* option`, which dies in 4.0.5 ("Not a valid effect"); working form `yield* Effect.fromOption(found)` | `const user = Effect.fromOption(found)` (fails with `NoSuchElementError`), or `if (Option.isNone(found)) throw new NotFound({ id })` | Ch. 3; R1 (derived) |
| `Result` (v3 `Either`): `succeed`, `fail`, `match`, `mapBoth`, `all`, `Result.gen` | Unchanged | `Result.match(r, { onFailure: f, onSuccess: s })` | same | R3 (derived) |
| Capture an outcome as a value (`Effect.result`; v3 `Effect.either`) | Changed | `const r = yield* Effect.result(task)` | `const r = Effect.result(() => task())` | R2 (derived) |
| `Result` to a typed failure (`Effect.fromResult`) | Unchanged | `yield* Effect.fromResult(r)` | `Effect.fromResult(r)` | R1 (derived) |
| Capture an `Exit` (`Effect.exit`) | Changed | `const exit = yield* Effect.exit(task)` | `const exit = Effect.exit(() => task())`; works because the outer call returns `Effect<Exit>` | R2 (derived) |
| Build or transform an `Exit` (`Exit.succeed`, `failCause`, `map`, `zip`) | Gap X1 | `assert.deepStrictEqual(exit, Exit.succeed(1))` | `Exit` extends `Effect` in 4.0.5, so R1 runs `Exit.succeed(1)` and gives `1` | Ch. 11 |
| Read an `Exit` (`Exit.match`, `isSuccess`, `exit.cause`) | Unchanged | `Exit.match(exit, { onFailure: Cause.pretty, onSuccess: String })` | same | R3 (derived) |
| `Cause` (flat `reasons` in v4; `Cause.pretty`, `hasFails`, `hasDies`, `squash`). v3 `sequential`/`parallel` trees are gone | Unchanged | `cause.reasons.filter(Cause.isFailReason)` | same; get a cause with `Effect.catchCause(() => f(), (cause) => …)` | R3 (derived) |
| `Data.Class`, `TaggedClass`, `taggedEnum` with `$is`/`$match`. v3 `Data.struct`, `tuple`, `case` are gone | Unchanged | `const { Loading, Success } = Data.taggedEnum<RemoteData>()` | same | R3 (derived) |
| Error classes (`Data.Error`, `Data.TaggedError`) | Changed | `return yield* new NotFound({ file })` | `throw new NotFound({ file })` | Ch. 3 |
| `new` of a class whose instances are Effects (every Effect error class) | Gap X1 | `new NotFound({ file })` builds a value | Ch. 11 says what a call does, not what `new` does; the examples assume `new` builds the value without running it | Ch. 3, 11 |
| `Chunk`, `HashSet`, `HashMap`, `MutableHashSet` | Unchanged | `HashSet.make(1, 2, 3).pipe(HashSet.add(4))` | same | R3 (derived) |
| `Duration` | Unchanged | `Duration.seconds(2)` | same | R3 (derived) |
| `DateTime` pure functions (`make`, `add`, `format*`, zones, parts) | Unchanged | `DateTime.add(now, { days: 1 })` | same | R3 (derived) |
| `DateTime.now`, `nowInCurrentZone`, `isFuture` (Effects) | Unchanged | `const t = yield* DateTime.now` | `const t = DateTime.now()` | R1 (an `Effect` value runs when called) |
| Time zone for a region (`DateTime.withCurrentZone*`) | Changed | `program.pipe(DateTime.withCurrentZoneNamed("Europe/London"))` | `pipe(() => program(), DateTime.withCurrentZoneNamed("Europe/London"))` | Ch. 5; R2 (derived) |
| `BigDecimal` | Unchanged | `BigDecimal.sum(a, b)` | same | R3 (derived) |
| `Redacted` | Unchanged | `Redacted.value(apiKey)` | same | R3 (derived) |

### 19. Traits and behaviours

Docs pages: Equal, Hash, Equivalence, Order.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| `Equal.equals`, `Equal.symbol`, `Hash.symbol`, `Equal.byReference`. 4.0.5 compares class instances structurally by default | Unchanged | `Equal.equals(a, b)` | same; `===` keeps JavaScript's meaning | R3 (derived) |
| `Equivalence` (`String`, `Number`, `mapInput`, `combine`). v3 lowercase names are gone | Unchanged | `Equivalence.mapInput(Equivalence.Number, (u: User) => u.id)` | same | R3 (derived) |
| `Order` (`String`, `Number`, `mapInput`, `combine`, `flip`, `clamp`, `isLessThan`) | Unchanged | `Array.sort(users, Order.mapInput(Order.String, (u) => u.name))` | same | R3 (derived) |

### 20. Schema

Docs pages: Introduction, Getting Started, Basic Usage, Filters, Advanced Usage, Projections, Transformations, Annotations, Canonical Codecs, Error Messages, Error Formatters, Class APIs, Default Constructors, Effect Data Types, Standard Schema, Arbitrary, JSON Schema, Equivalence, Formatter, Compilers.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Define schemas (`Struct`, primitives, `Literals`, `Union`, `Tuple`, `Record`, `TemplateLiteral`, `Enum`, `brand`, `suspend`) | Unchanged | `const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })` | same; a value, so allowed at module top level | Ch. 11 (derived) |
| Decode or encode as an Effect (`decodeUnknownEffect`, `decodeEffect`, `encodeEffect`). v3 `decodeUnknown` | Unchanged | `const person = yield* Schema.decodeUnknownEffect(Person)(input)` | `const person = Schema.decodeUnknownEffect(Person)(input)`; `SchemaError` joins E | R1 (derived) |
| Decode without Effect (`decodeUnknownSync`, `Result`, `Option`, `Promise`; `is`, `asserts`) | Unchanged | `Schema.decodeUnknownSync(Person)(input)` | same. A `SchemaError` thrown by `decodeUnknownSync` is a defect (R3) that a `.es` `catch` does not see (X2); use the Effect form for a typed error | R3; O11 |
| Decode to an `Exit` (`decodeUnknownExit`, `encodeExit`) | Gap X1 | `const exit = Schema.decodeUnknownExit(Person)(input)` | `Exit` is an Effect, so R1 runs it: the call gives a `Person` or fails, never an `Exit` value | Ch. 11 |
| Filters (`makeFilter`, `check`, `isMinLength`, `isBetween`, …). v3 `Schema.filter` | Unchanged | `Schema.String.check(Schema.isMinLength(2))` | same | R3 (derived) |
| Pure transformations (`decodeTo`, `SchemaTransformation.transform`, `SchemaGetter.transform`). v3 `Schema.transform` | Unchanged | `Schema.decodeTo(Schema.Boolean, SchemaTransformation.transform({ decode: (s) => s === "on", encode: (b) => (b ? "on" : "off") }))` | same | R3 (derived) |
| Effectful transformations and filters (`SchemaGetter.transformEffect`, `checkEffect`, `Schema.catchDecoding`, `declareConstructor`). v3 `transformOrFail` | Unchanged | `SchemaGetter.transformEffect((s) => lookupColor(s))` | same; the callback is an EffectScript function that may call services, which then appear in the schema's `DecodingServices` | R5 (derived) |
| Defaults given as Effects (`withConstructorDefault`, `withDecodingDefault*`) | Changed | `Schema.Finite.pipe(Schema.withConstructorDefault(Effect.sync(() => Date.now())))` | `Schema.Finite.pipe(Schema.withConstructorDefault(() => Date.now()))`; the expected type is `Effect`, so the thunk becomes a program (R2), legal at top level because nothing runs | Ch. 11 (derived) |
| Classes (`Schema.Class`, `TaggedClass`, `extend`) | Unchanged | `class Person extends Schema.Class<Person>("Person")({ name: Schema.String }) {}` | same | R3 (derived) |
| Schema errors (`Schema.TaggedError`, `Schema.Error`) | Changed | `return yield* new HttpError({ status: 500 })` | `throw new HttpError({ status: 500 })` | Ch. 3 |
| Constructors (`make`, `makeOption`, `makeEffect`) | Unchanged | `Person.makeEffect({ name: "a" })` | same. `make` throws (a defect, R3); `makeEffect` runs and fails with a `SchemaIssue.Issue` | R1, R3 (derived) |
| Annotations, error messages, formatters (`annotate`, `SchemaIssue.makeFormatterDefault`) | Unchanged | `Schema.String.annotate({ identifier: "Password" })` | same | R3 (derived) |
| Canonical codecs and derivations (`toCodecJson`, `toStandardSchemaV1`, `toJsonSchemaDocument`, `toEquivalence`, `toFormatter`, `Arbitrary.schema`) | Unchanged | `Schema.toJsonSchemaDocument(Person)` | same | R3 (derived) |
| Property checks (`Arbitrary.checkEffect`) | Unchanged | `Arbitrary.checkEffect(arb, (v) => v < 5)` | same | R1 (derived) |
| Schema-backed config (`Config.schema`) | Gap X6 | `Config.schema(Schema.Struct({ host: Schema.String, port: Schema.Finite }), "db")` | `Config` is an Effect, so R1 reads it at the call; composing it is the X6 problem | X6 |
| JIT and AOT compilers (`SchemaJITCompiler`, `SchemaAOTCompilerBuild.build`) | Unchanged | `SchemaJITCompiler.enable(User.ast)` | same; a build step, not language-visible | none needed |

### 21. Platform: FileSystem, Path, Terminal, Stdio, child processes, KeyValueStore, Socket, Worker

Docs pages: Introduction to Effect Platform, FileSystem, Path, PlatformLogger, Runtime, Terminal; v3 Command, KeyValueStore. Modules the v4 site omits come from `effect@4.0.5` (`effect/process`, `effect/persistence`, `effect/socket`, `effect/workers`).

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Platform layers (`NodeServices.layer`, `BunServices.layer`; v3 `NodeContext.layer`) | Changed | `Effect.provide(program, NodeServices.layer)` | `Effect.provide(() => main(), NodeServices.layer)` | Ch. 4 |
| FileSystem service (`readFileString`, `writeFileString`, `stat`, `readDirectory`, `stream`, `watch`, …) | Unchanged | `const fs = yield* FileSystem.FileSystem; const text = yield* fs.readFileString(p)` | `const text = FileSystem.FileSystem.readFileString(p)`: a TypeScript `Context.Service` is called like a `service` | Ch. 4, 10 |
| Open a file (`fs.open` returns a scoped `File`) | Changed | `const file = yield* fs.open(p)` inside `Effect.scoped` | `using file = FileSystem.FileSystem.open(p)`. Ch. 6's `openFile` example (`FileSystem.open(path)`, then `file.close()`) matches no Effect 4 API: `open` already registers the release, and `File` has no `close` | Ch. 6 |
| FileSystem test stub (`FileSystem.layerNoop`) | Changed | `FileSystem.layerNoop({ readFileString: () => Effect.succeed("x") })` | `FileSystem.layerNoop({ readFileString: () => "x" })` | Ch. 4 |
| Path service (`join`, `resolve`, `basename` return plain values) | Gap X13 | `const path = yield* Path.Path; path.join(a, b)` | `Path.Path().join(a, b)` works by R1 and R3; `Path.Path.join(a, b)` is unstated | X13 |
| Log to a file (`Logger.toFile`; v3 `PlatformLogger.toFile`) | Unchanged | `Logger.layer([Logger.formatLogFmt.pipe(Logger.toFile("/tmp/app.log"))])` | same | R3 (derived) |
| Terminal (`readLine`, `display`, `columns`, `readInput`) | Unchanged | `const terminal = yield* Terminal.Terminal; const line = yield* terminal.readLine` | `const line = Terminal.Terminal().readLine()`: `readLine` is an Effect value, run by calling it | R1 |
| Stdio (`args`, `stdin`, `stdout`; new in v4) | Unchanged | `const args = yield* (yield* Stdio.Stdio).args` | `const args = Stdio.Stdio().args()` | R1 (derived) |
| Child processes (`ChildProcess.make`, `ChildProcessSpawner`; v3 `Command.make`, `Command.string`) | Gap X1 | `const out = yield* spawner.string(ChildProcess.make("node", ["--version"]))` | `ChildProcess.make(...)` returns a command that is itself an Effect (running it spawns the process), so Ch. 11 would spawn at the call and `spawner.string` could never receive the command | X1 |
| KeyValueStore (`effect/persistence`; v3 returned `Option`, v4 returns `string \| undefined`) | Unchanged | `const kv = yield* KeyValueStore.KeyValueStore; yield* kv.set("k", "v")` | `KeyValueStore.KeyValueStore.set("k", "v")` | Ch. 4 |
| Socket (`effect/socket`; v4.0.5 pull-based `reader`) | Changed | `const { pull } = yield* socket.reader` inside `Effect.scoped` | `using reader = socket.reader()` then `reader.pull()` in a loop (derived, uncertain) | Ch. 6; R1 |
| Workers (`effect/workers`, usually through RPC) | Unchanged | `worker.run((message) => handle(message))` | same; the handler is an EffectScript function | R5 (derived) |

### 22. HTTP: HttpClient, HttpServer, HttpApi

Not on the v4 site. Sources: `effect/http`, `effect/http-api`, `ai-docs/src/50_http-client`, `51_http-server`, `REPO/packages/effect/HTTPAPI.md`.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| HttpClient requests (`HttpClient.HttpClient`, `get`, `post`, `execute`, `FetchHttpClient.layer`) | Unchanged | `client.get(url).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Todo)))` | `const todo = HttpClientResponse.schemaBodyJson(Todo)(HttpClient.HttpClient.get(url))` | Ch. 4, 11 (derived) |
| Response bodies (`response.json`, `response.text` are Effects) | Unchanged | `const body = yield* response.json` | `const body = response.json()` | R1 |
| Client middleware (`mapRequest`, `filterStatusOk`, `retryTransient`, `withRateLimiter`, `followRedirects`) | Unchanged | `client.pipe(HttpClient.filterStatusOk, HttpClient.retryTransient({ times: 3 }))` | same; `.pipe` over a client value | Ch. 5 (pipes over data stay plain) |
| Routes (`HttpRouter.add`, `use`, `addAll`; `HttpServerResponse`) | Gap X9 | `HttpRouter.add("GET", "/hello", HttpServerResponse.text("Hi"))` | a handler may be a response value, an Effect, or a function, picked by `Effect.isEffect` at run time; how an EffectScript handler is lowered for that union is unstated | X9 |
| Serve (`HttpRouter.serve`, `Layer.launch`, `NodeHttpServer.layer`) | Changed | `Layer.launch(HttpRouter.serve(routes)).pipe(NodeRuntime.runMain)` | `NodeRuntime.runMain(() => Layer.launch(HttpRouter.serve(routes)))` | Ch. 11 |
| HttpApi definitions (`HttpApi.make`, `HttpApiGroup.make`, `HttpApiEndpoint.get`, `HttpApiSchema`, errors with `httpApiStatus`) | Unchanged | `HttpApiEndpoint.get("getUser", "/users/:id", { success: User })` | same (values) | R3 |
| HttpApi handlers (`HttpApiBuilder.group(api, "users", (h) => h.handle(…))`) | Unchanged | `handlers.handle("getUser", ({ params }) => Users.find(params.id))` | same; handlers are EffectScript functions. The build callback's result is dispatched on `Effect.isEffect` (X9) | R5; X9 |
| Derived clients (`HttpApiClient.make`) | Unchanged | `const client = yield* HttpApiClient.make(Api, { baseUrl })` | `const client = HttpApiClient.make(Api, { baseUrl }); client.users.getUser({ params: { id } })` | R1 |
| Middleware and security (`HttpApiMiddleware`, `HttpApiSecurity.bearer`) | Unchanged | `HttpApiMiddleware.Service<Auth>()("Auth", { security: { bearer: HttpApiSecurity.bearer } })` | same | R3 |

### 23. SQL

Not on the v4 site. Sources: `effect/sql`, `ai-docs/src/40_sql`, `@effect/sql-*` drivers.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| The SQL client service (`SqlClient.SqlClient`) | Unchanged | `const sql = yield* SqlClient.SqlClient` | `const sql = SqlClient.SqlClient()` | Ch. 4 |
| Queries (`` sql`…` `` tagged templates) | Gap X1 | ``const rows = yield* sql`SELECT * FROM users` `` | ``const rows = sql`SELECT * FROM users` `` does run, because a `Statement` extends `Effect`; that is the X1 rule working by accident | X1 |
| Statement members (`.stream`, `.values`, `.raw`, `.unprepared`, `.withoutTransform`, `.compile()`) and statements nested as fragments | Gap X1 | ``sql`SELECT * FROM events`.stream`` | unreachable: Ch. 11 runs the statement before `.stream` is read | X1 |
| Fragments (`sql.in`, `sql.insert`, `sql.update`, `sql.and`, `sql.csv`) | Unchanged | ``sql`SELECT * FROM t WHERE ${sql.in("id", ids)}` `` | same | R3 |
| Transactions (`sql.withTransaction`) | Changed | `sql.withTransaction(insertAll)` | `sql.withTransaction(() => insertAll())` | R2 |
| Schemas, resolvers, repositories (`SqlSchema.findAll`, `SqlResolver`, `SqlModel.makeRepository`, `Model.Class`) | Unchanged | ``SqlSchema.findAll({ Request: Schema.Void, Result: Group, execute: () => sql`SELECT * FROM groups` })`` | same; `execute` is an EffectScript function | R5 |
| Migrations (`Migrator`, `SqliteMigrator.layer`) | Unchanged | `SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord({ "0001_init": init }) })` | same | R3 |
| Driver layers read from config (`PgClient.layerConfig`) | Gap X6 | `PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })` | the `Config.Redacted(...)` argument runs at the call, at a module's top level ES1001 | X6 |

### 24. CLI

Not on the v4 site. Sources: `effect/cli`, `ai-docs/src/70_cli`.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Commands (`Command.make`, `withSubcommands`, `withHandler`; v3 `@effect/cli`) | Gap X1 | `const tasks = Command.make("tasks", { workspace }, ({ workspace }) => listTasks(workspace))` | a `Command` extends `Effect` (yielding it reads the parsed flags), so Ch. 11 would run `Command.make(...)`; at a module's top level that is ES1001 | X1 |
| Flags and arguments (`Flag.String`, `withAlias`, `withDefault`, `Argument.String`; v3 `Options.text`, `Args.text`) | Unchanged | `Flag.String("workspace").pipe(Flag.withAlias("w"), Flag.withDefault("personal"))` | same (values, not Effects) | R3 |
| Prompts (`Prompt.String`, `Confirm`, `Select`) | Gap X1 | `const name = yield* Prompt.String({ message: "Name?" })` | one prompt runs at the call, which works; composing prompts (`Flag.withFallbackPrompt`) does not | X1 |
| Run a CLI (`Command.run({ version })` with `NodeServices.layer`) | Changed | `tasks.pipe(Command.run({ version: "1.0.0" }), Effect.provide(NodeServices.layer), NodeRuntime.runMain)` | `NodeRuntime.runMain(() => Effect.provide(() => Command.run({ version: "1.0.0" })(tasks), NodeServices.layer))`, once X1 lets `tasks` exist | Ch. 11; X1 |

### 25. AI

v3 pages: Introduction, Getting Started, Planning LLM Interactions, Tool Use. v4 source: `effect/ai`, `ai-docs/src/71_ai`.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| Model calls (`LanguageModel.generateText`, `generateObject`) | Unchanged | `const response = yield* LanguageModel.generateText({ prompt })` | `const response = LanguageModel.generateText({ prompt })` | R1 |
| Streaming text (`LanguageModel.streamText` returns a Stream) | Unchanged | `Stream.runForEach(LanguageModel.streamText({ prompt }), (part) => render(part))` | same | Ch. 8 |
| Tools (`Tool.make`) | Unchanged | `Tool.make("search", { parameters: { q: Schema.String }, success: Schema.String })` | same | R3 |
| Toolkits (`Toolkit.make`, `toolkit.toLayer`) | Gap X1 | `const toolkit = Toolkit.make(search)` | a `Toolkit` is an Effect (yielding it gives the handlers), so Ch. 11 would run `Toolkit.make(...)` | X1 |
| Tool handlers | Changed | `toolkit.toLayer(Effect.succeed({ search: ({ q }) => runSearch(q) }))` | `toolkit.toLayer(() => ({ search: ({ q }) => runSearch(q) }))` | R2, R5 |
| Chat sessions (`Chat.empty`, `Chat.fromPrompt`, `chat.generateText`) | Unchanged | `const chat = yield* Chat.empty` | `const chat = Chat.empty()` | R1 |
| Provider fallback (`ExecutionPlan.make`, `Effect.withExecutionPlan`) | Changed | `program.pipe(Effect.withExecutionPlan(plan))` | `Effect.withExecutionPlan(() => program(), plan)` | R2 |
| AI errors (`AiError` with a `reason` union) | Changed | `Effect.catchReason("AiError", "RateLimitError", (r) => wait(r))` | `catch (e) { if (e.reason._tag === "RateLimitError") return wait(e.reason); throw e }` | Ch. 3 |
| Provider layers (`OpenAiClient.layerConfig({ apiKey: Config.Redacted("OPENAI_API_KEY") })`) | Gap X6 | as left | the `Config` argument runs at the call | X6 |

### 26. Cluster, workflow, and RPC

Not on the v4 site. Sources: `effect/rpc`, `effect/cluster`, `effect/workflow`, `ai-docs/src/80_cluster`.

| Feature | Class | Effect 4 | EffectScript | Proposal |
| --- | --- | --- | --- | --- |
| RPC definitions (`Rpc.make`, `RpcGroup.make`) | Unchanged | `RpcGroup.make(Rpc.make("getUser", { payload: { id: Schema.String }, success: User }))` | same | R3 |
| RPC handlers (`group.toLayer(handlers)`) | Gap X9 | `UserRpcs.toLayer({ getUser: ({ id }) => Users.find(id) })` | `toLayer` accepts handlers or an Effect of handlers, chosen by `Effect.isEffect` at run time | X9 |
| RPC clients and servers (`RpcClient.make`, `RpcServer.layer`, protocols) | Changed | `const client = yield* RpcClient.make(UserRpcs)` inside `Effect.scoped` | `using client = RpcClient.make(UserRpcs)` | Ch. 6 |
| Entities (`Entity.make`, `entity.toLayer`, `entity.client`, `Rpc.fork`) | Unchanged | `const clientFor = yield* Counter.client; yield* clientFor("c-1").Increment({ amount: 1 })` | `const clientFor = Counter.client(); clientFor("c-1").Increment({ amount: 1 })` | R1 |
| Workflows (`Workflow.make`, `wf.toLayer`, `wf.execute`) | Unchanged | `IncrementWorkflow.toLayer(({ value }) => Effect.succeed(value + 1))` | `IncrementWorkflow.toLayer(({ value }) => value + 1)` | R5 |
| Activities (`Activity.make({ execute })`) | Gap X1 | `yield* Activity.make({ name: "SendEmail", error: SendEmailError, execute: sendEmail })` | `execute` takes a program (`execute: () => sendEmail()`); the activity is an Effect, and running it at the call is what the workflow wants, so this case works only if X1 keeps today's rule | X1 |
| Durable time and deferreds (`DurableClock.sleep`, `DurableDeferred.await`) | Unchanged | `yield* DurableClock.sleep({ name: "cool-off", duration: "1 day" })` | `DurableClock.sleep({ name: "cool-off", duration: "1 day" })` | R1 |
| Replay of workflow bodies | Gap X17 | a workflow body reruns on resume; only activities and durable state are journaled | how producers, handlers, and held continuations behave in a replayed body is unstated (uncertain) | X17 |

### 27. Effect 3 features that Effect 4 removed

Effect 4 has nothing to compile these to; EffectScript targets Effect 4 only (Ch. 10, P15), so each row records the Effect 4 replacement and the EffectScript form of that.

| Feature | Class | Effect 3 | EffectScript (via the Effect 4 replacement) | Proposal |
| --- | --- | --- | --- | --- |
| Micro | Unchanged | `Micro.gen(function* () { … })`, `Micro.runPromise(p)` | none: Effect 4 removed `Micro` ("the rewritten Effect runtime is itself lightweight"). Effect 3 Micro code is foreign code | Ch. 10 |
| Supervisors (`Supervisor.track`, `Effect.supervised`) | Unchanged | `Effect.supervised(program, supervisor)` | `FiberSet` and `fork` (see Concurrency) | Ch. 7 |
| STM (`STM.commit`, `TRef`, `TMap`) | Unchanged | `STM.commit(TRef.update(ref, f))` | `Effect.tx(() => TxRef.update(ref, f))` (derived) | R2 |
| FiberRef and `Effect.locally` | Changed | `Effect.locally(program, FiberRef.currentLogLevel, LogLevel.Debug)` | `Effect.provideService(() => program(), References.CurrentLogLevel, "Debug")` | Ch. 4, 20 |
| Either | Unchanged | `Either.right(1)`, `Effect.either(p)` | `Result.succeed(1)`, `Effect.result(() => p())` | R2, R3 |
| Mailbox | Unchanged | `Mailbox.make<number>()` | `Queue.make<number, Cause.Done>()` | R1 |
| `Runtime<R>` and `Effect.runtime<R>()` | Gap X4 | `Runtime.runPromise(runtime)(program)` | `Effect.context<R>()` plus `Effect.runPromiseWith(ctx)`, not named as runners | X4 |
| `Effect.Service` with `.Default`, `Effect.Tag` accessors | Changed | `Users.find(id)` through a generated accessor | `service Users { … }`, called as `Users.find(id)` | Ch. 4 |
| Ambient settings (`Effect.withConcurrency`, `withRequestBatching`, `withClock`, `withRandom`) | Unchanged | `Effect.withConcurrency(program, 4)` | per-call options and `References` with `Effect.provideService` | Ch. 4 |

## Gaps, ranked by how often an Effect user hits them

Rank comes from the usage census in [appendix A](#appendix-a-usage-census) (files that use the feature in Smithers and opencode, both on Effect 4) and from how early the docs teach the feature. "Proposal" names the proposal's own open item when one exists.

| Rank | Gap | What a user writes that hits it | Files in census (Smithers / opencode) | Proposal | After the decision log |
| --- | --- | --- | --- | --- | --- |
| 1 | [X3](#x3-callbacks-passed-to-typescript-functions) Callbacks passed to TypeScript functions | `Option.match(found, { onNone: () => guest, onSome: (id) => Users.find(id) })`; `Stream.runFold(s, () => 0, add)`; `stores.map(makeSync)` | `Option.*` 722 / 80; `Stream.*` 497 / 82; `Option.match` 31 / 4 | Fable review, finding 3 | Settled by D9 and D22: the plain-JavaScript variant when eligible, otherwise ES4301, so effectful `Option.match` and `Match` handlers are rejected |
| 2 | [X2](#x2-try-around-a-plain-call-that-throws) `try`/`catch` around a plain call that throws | `try { return JSON.parse(text) } catch { return null }` | JavaScript `try` in `Effect.gen` files 487 / 70; with `JSON.parse` 362 / 33 | none | Narrowed by D5, D22, D23: built-ins such as `JSON.parse` get trusted contracts whose exceptions are expected failures; other plain calls need a boundary (ES4401); Effect's own throwing sync APIs (`decodeUnknownSync`, `Option.getOrThrow`) stay defects a `catch` cannot see |
| 3 | [X4](#x4-runners-and-promise-boundaries) Runners and Promise boundaries | `test("x", async () => { await Effect.runPromise(p) })`; `ManagedRuntime` in a request handler | `Effect.run*` 1,148 / 73 (1,067 / 50 in tests); `async` functions 1,272 / 212; `ManagedRuntime` 45 / 8 | none | Narrowed: D21 sends programs with several entry points to `ManagedRuntime`; no runner list and no rule for runner calls inside `.es` functions |
| 4 | [G12](#g12-producers-and-streams) Producers and Streams | `for (const e of events)` over a `Stream`; a producer feeding `Stream.mapEffect` with concurrency | `Stream.*` 497 / 82; `Stream.run*` 284 / 39 | G12 | Design settled by D26: a producer is a `Stream` wherever one is expected, and `for...of` over a `Stream` pulls with `Stream.toPull`; the experiment remains |
| 5 | [X1](#x1-values-that-are-both-data-and-effects) Values that are both data and Effects | `` sql`SELECT …`.stream ``; `Exit.succeed(1)` in an assertion; a top-level `Command.make(...)` | Effect SQL templates 271 / 4; `Exit` constructors 114 / 4 (90 in tests); `Context.Reference` 41 / 5 | none | Settled by D24: a call runs only when its type is `Effect<A, E, R>` itself; a richer subtype is data until called; `new` never runs |
| 6 | [X5](#x5-layer-sharing-across-provide-calls) Layer sharing across `provide` calls | two `Effect.provide(() => …, AppLive)` calls in one program | `Effect.provide` 1,577 / 150 (8,124 call sites in Smithers) | Fable review, finding 6 | Settled by D21: each `provide` builds its layers once; provide at `main` |
| 7 | Partial contracts (former O7) | "this export never fails; infer the rest" | not measurable by search | D57 | Closed: `Effect<infer A, never, infer R>` |
| 8 | [X8](#x8-fork-outside-a-scope-region) `fork` outside a Scope region | `fork(() => poll())` in a function with no `using` | fork variants 429 / 97 | O5; Fable review, finding 9 | Settled by D19: `fork` is block-owned |
| 9 | [X12](#x12-service-declarations-and-effect-4-service-features) Service declarations and Effect 4 service features | `make`, `static layer`, `Context.Reference` defaults | `extends Context.Service` 140 / 145; `Context.Reference` 41 / 5 | O2 | Narrowed by D1: services are abstract classes that may carry `static layer`; `Context.Reference` defaults unaddressed |
| 10 | [X13](#x13-service-members-that-are-not-effect-returning-methods) Service members that are not Effect-returning methods | `Path.Path.join(a, b)`, `Terminal.Terminal.readLine` | `FileSystem`/`Path` 424 / 81 | none | Open: D1 allows `abstract readonly` value members; TypeScript services with plain methods are unaddressed |
| 11 | [X9](#x9-parameters-that-accept-a-function-or-an-effect) Parameters that accept a function or an Effect | `HttpRouter.add(…, handler)`, `RpcGroup.toLayer(…)`, `NodeSdk.layer(() => config)` | `HttpRouter`/`HttpApi`/`HttpServer` 30 / 136; RPC 42 / 1 | none | Open |
| 12 | [X6](#x6-configuration) Configuration | `Config.all({ port: Config.Port("PORT").pipe(Config.withDefault(8080)) })` | Effect `Config` constructors 8 / 7 (5 / 7 compose); taught in the Configuration guide | none | Settled by D24 and D6 |
| 13 | [X11](#x11-callback-adapters-and-interruptible-acquisition) Callback adapters and interruptible acquisition | `Effect.callback` in a `.es` file; `using socket = connect(url)` that a timeout must cancel | `Effect.callback` 2 / 0 | none | Narrowed by D25 (`using` adds no masking policy; `acquireRelease` decides); `Effect.callback` from `.es` unaddressed |
| 14 | [X15, X16](#x15-and-x16-devtools-and-installation) Devtools and installation | `@effect/tsgo` on `.es` files; build setup | not measured | none | Settled by D30 to D35: `esc`, `@effectscript/vite`, the fork's language server, Oxlint for lint |
| 15 | [X17](#x17-workflow-replay) Workflow replay | an EffectScript function as a workflow body | `Workflow`/`Activity` 7 / 0 | none | Open |

### X3. Callbacks passed to TypeScript functions

- **Question.** When an EffectScript function is passed where TypeScript expects a plain function type (`(a: A) => B`, `LazyArg<A>`), does the callee receive the `$direct` form (a function that returns `B`) or the Effect form (a function that returns `Effect<B>`)? And when such a callback can pause, is it rejected (ES4301) or allowed because the callee returns the Effect and R1 then runs it?
- **Why the rules do not answer it.** Ch. 10 and 14 reject pausing callbacks passed to "plain JavaScript" but define that only by example (`Array.prototype.map`). Every pure callback into `Option`, `Array`, `Stream`, `Match`, `Schema`, and `Order` depends on the answer: `Stream.runFold(s, () => 0, add)` breaks if `() => 0` arrives in its Effect form. Ch. 5's own `stores.map(makeSync)` passes an EffectScript function to `Array.prototype.map` (Fable review, finding 3). Effectful branches are a common Effect idiom, `Option.match(found, { onNone: () => Effect.succeed(guest), onSome: (id) => users.find(id) })`: 16 Smithers files put an Effect in an `Option.match` handler on the same line.
- **What decides it.** A rule in Ch. 11 or 14 keyed on the parameter's declared return type: an `Effect`-returning parameter gets the Effect form, any other gets `$direct`, and a pausing callback there is ES4301. Then a decision on effectful `Option.match` and `Match` branches: reject them (users write `switch` or `if`), or recognize them. Experiment: run `Stream.runFold(s, () => 0, add)`, `Option.match` with one effectful branch, `Match.tag` with an effectful branch, and `stores.map(makeSync)` through the content-mapper skeleton (G11).

### X2. `try` around a plain call that throws

- **Question.** In `.es`, `try { return JSON.parse(text) } catch { return null }` does not catch the `SyntaxError`: a plain call's exception is a defect (R3), and `catch` sees only E (R4, Ch. 15). Inside `Effect.gen` the same code catches it (verified on 4.0.5, appendix A), and in TypeScript it always has. Ch. 10 says the exception is a defect "exactly as when the same call sits inside an Effect.gen body today", which is true only when nothing catches it.
- **Why it matters.** The code compiles, reads like ordinary JavaScript, and fails differently at run time: a parse error now kills the fiber instead of returning `null`. 487 Smithers files and 70 opencode files mix JavaScript `try` with `Effect.gen`.
- **What decides it.** Pick one: (a) a `catch` also catches synchronous exceptions from plain calls inside its `try` block, typed `unknown`; (b) the compiler reports a `catch` that can never run because its `try` block has E = never but contains a plain call that can throw, and suggests `Effect.try`; (c) keep today's silent rule. Experiment: lower the `JSON.parse`-in-`try` patterns from the census under (a) and (b) and count dead `catch` blocks.

### X4. Runners and Promise boundaries

- **Question.** Ch. 11 names three runners: `Effect.runPromise`, `NodeRuntime.runMain`, and `it.effect`. It does not say whether `runFork`, `runSync`, `runCallback`, `run*With(context)`, `ManagedRuntime#run*`, `BunRuntime.runMain`, `it.live`, and `@effect/vitest`'s `layer(...)` are runners, or whether a runner may be called inside a function or a plain callback (a vitest `test` body, an Express handler, a React event handler), where it starts a new root and returns a Promise that `.es` cannot `await`.
- **What decides it.** A list of runner symbols in Ch. 11, and a rule for runner calls below the top level: allowed (a new root with an empty Context, as Ch. 21 says of `runSync`) or rejected. Experiment: port five Smithers tests that `await Effect.runPromise(…)` to `.es` both ways.

### G12. Producers and Streams

- **Question (the proposal's own).** The producer-to-`Stream` adapter and `for...of` over a `Stream` are proposed but unbuilt.
- **Addition (X10).** Producers have no operators for time and concurrency (`merge`, `mapEffect` with concurrency, `groupedWithin`, `debounce`, `buffer`), so every such pipeline crosses the adapter. Today's rules already allow external iteration through `Stream.toPull` (`using pull = Stream.toPull(s)`, then `pull()` until `Cause.Done`); Ch. 8 should state it as the interim answer.
- **What decides it.** G12's experiment, plus a typed rule for `for...of` over a `Stream` value.

### X1. Values that are both data and Effects

- **Question.** Ch. 11 runs every call whose result type is an `Effect`. In 4.0.5 many values meant to be composed first are Effects too:

| Value | Declared at (`effect@4.0.5/src`) | What Ch. 11 does to the call | What an Effect user expects |
| --- | --- | --- | --- |
| `Config.String("HOST")`, `Config.all`, `Config.withDefault` | `Config.ts:113` (`Config<T> extends Effect<T, ConfigError>`) | reads the value immediately | a description to compose, read once |
| `Exit.succeed(1)`, `Exit.failCause(c)`, `Schema.decodeUnknownExit(S)(u)` | `Exit.ts:89` (`Exit.Proto extends Effect`) | gives `1` or fails | an `Exit` value to compare or match |
| `Context.Reference(...)`, `Context.Service<S>("key")`, `References.*` | `Context.ts:68`, `:497` (`Key extends Effect`) | looks the service up; at a module's top level, ES1001 | a key to declare and provide |
| `` sql`SELECT …` `` | `sql/Statement.ts:76` | runs the query, so `.stream`, `.values`, `.raw`, `.unprepared`, `.compile()` are unreachable | a statement to run, modify, or nest |
| `Command.make(...)` (CLI), `Prompt.String(...)` | `cli/Prompt.ts:55`; `Command` (probe: `Effect.isEffect` true) | runs it; at top level, ES1001 | a command tree to run once |
| `ChildProcess.make("git", ["status"])` | `process/ChildProcess.ts:45` | spawns the process | a command to hand to a spawner |
| `Toolkit.make(...)`, `Activity.make(...)` | `ai/Toolkit`, `workflow/Activity.ts:38` | runs it | a toolkit to provide; an activity to run inside a workflow |
| `new NotFound({ id })` (every `Data.TaggedError`, `Schema.TaggedError`) | `Cause.ts:1312` (`YieldableError`) | Ch. 11 says nothing about `new`; a TypeScript helper that returns an error instance would fail at the call | a value to throw or return |

- **Why it matters.** `Config.withDefault(Config.Port("PORT"), 8080)` fails with `ConfigError` before the default applies (verified on 4.0.5), an `Exit` can never be built for an assertion, and a CLI or a Toolkit cannot be declared at a module's top level. Ch. 4 special-cases `Context.Service` classes; nothing covers the rest.
- **What decides it.** One rule, chosen from: (a) a call runs only when its declared return type is the `Effect` interface itself, and a value of a richer subtype is data until called with `()` (`Config.Port("PORT")()` reads it; `` sql`…`() `` queries); (b) a call is left unrun where the expected type is that subtype (contextual); (c) declaration metadata that marks "description" constructors. Experiment: compile `Config.all({ host: Config.String("HOST"), port: Config.withDefault(Config.Port("PORT"), 8080) })`, `assert.deepStrictEqual(Effect.exit(() => f()), Exit.succeed(1))`, `` sql`SELECT 1`.stream ``, a top-level `Command.make`, and `throw new NotFound({ id })` under each rule.

### X5. Layer sharing across `provide` calls

- **Question.** Ch. 4 says a layer is built once per `provide`. Ch. 22 measured that two sibling `Effect.provide(…, AppLive)` calls build `AppLive` twice in 4.0.5, while Effect's migration note says one MemoMap is shared across provides; Ch. 22 then defers to "Chapter 4", which has no rule. A program that provides `AppLive` in two places opens the database pool twice.
- **What decides it.** A Ch. 4 rule: provide the `wire`d layer once at `main`, or let runners install a shared MemoMap. Experiment: D05 extended to `NodeRuntime.runMain` with two sibling provides.

### X8. `fork` outside a Scope region

- **Question.** O5 attaches a forked fiber to the innermost Scope region, a block with `using`. A function with none is unspecified: an error, or `Scope` joins its R so the caller's block owns the fiber.
- **What decides it.** The rule in Ch. 7 and 24 with the inferred contract shown (Fable review, finding 9).

### X12. Service declarations and Effect 4 service features

- **Question.** Effect 4 services carry a constructor (`Context.Service<S>()(id, { make })`), conventional `static layer` fields, and defaults (`Context.Reference(id, { defaultValue })`). `service S { … }` has none of these. A hand-written class works (Ch. 4), but the function forms `Context.Service<S>("key")` and `Context.Reference(...)` hit X1.
- **What decides it.** Whether `service` gains `make` and default members, or the docs say to declare those in TypeScript.

### X13. Service members that are not Effect-returning methods

- **Question.** Ch. 11 lowers `Users.find(id)` to "get the service, then run its method". It does not say what `Path.Path.join(a, b)` (a method that returns a string) or `Terminal.Terminal.readLine` (a member that is an Effect value) lower to. `S().member(...)` works by R1 and R3.
- **Also.** A service method whose name matches a static member of the `Context.Service` class (`of`, `use`, `useSync`, `context`, `key`, `pipe`) makes `S.use(…)` ambiguous between the static and the method.
- **What decides it.** One sentence in Ch. 11, a check for colliding names, and a test over `Path`, `Terminal`, and `Clock`.

### X9. Parameters that accept a function or an Effect

- **Question.** R2 converts `() => f()` only where the expected type is `Effect`. Overloads and unions that accept both a function and an Effect are unstated: `NodeSdk.layer(LazyArg | Effect)`, `Effect.andThen(f | effect)`, `Effect.fromOption(option | LazyArg)`, `HttpRouter.add` (response, Effect, or function), `RpcGroup.toLayer` and `Entity.toLayer` (handlers or an Effect of handlers), `HttpApiBuilder.group`, `Effect.withErrorReporting`, and `forkChild` (an Effect or options). Several of these choose a branch at run time with `Effect.isEffect`, so the choice changes behavior.
- **What decides it.** A stated preference (the function overload, or the Effect overload), checked against these APIs.

### X6. Configuration

- **Question.** X1 applied to `Config`, the one docs guide it breaks entirely. Reading a single value works by accident (`const port = Config.Port("PORT")`); building `AppConfig` with `Config.all`, `withDefault`, `nested`, `option`, `orElse`, or `Config.schema` does not. The proposal never mentions Effect's `Config` and names a user service `Config` in Ch. 4.
- **What decides it.** The X1 rule. Until then, the answer is "define `Config` values in TypeScript and import them".

### X11. Callback adapters and interruptible acquisition

- **Question.** Ch. 6 puts callback adapters in TypeScript with the runtime's `suspend`. It does not say whether `Effect.callback` may be used from `.es`, where `resume(Effect.succeed(x))` would run its argument under R1 and must be spelled `resume(() => x)`; nor which acquisition policy `using` applies. Its example wraps `suspend` in a masked `acquireRelease`, so the `!waiter.resume(socket)` branch never runs (Fable review, finding 2).
- **What decides it.** Both answers stated in Ch. 6, and the example fixed with `{ interruptible: true }`.

### X15 and X16. Devtools and installation

- **Question.** Whether `@effect/tsgo` (diagnostics such as "floating Effect", refactors, Layer Magic) and the VS Code extension's fiber, span, and context panes work on `.es` files; and how a project installs the compiler and runtime and builds `.es` with Vite, Bun, or a test runner. Ch. 25 covers the compiler's architecture only.
- **What decides it.** The content-mapper skeleton (G11) shows what the editor sees; a setup page follows from it.

### X17. Workflow replay

- **Question.** A workflow body reruns on resume and only activities and durable state are journaled. How producers, handlers, and held continuations behave inside a replayed body is unstated (uncertain).
- **What decides it.** One replay test with a producer and a handler inside `Workflow.toLayer`.

## Answers that look wrong

These follow from the proposal's rules as written. Each is either a gap above or a document error to fix.

| # | What the rules say | Why it looks wrong | Where |
| --- | --- | --- | --- |
| 1 | A call to anything typed as an `Effect` runs | `Config`, `Exit`, SQL statements, CLI commands, child-process commands, toolkits, activities, and service keys are built by calls and composed as data; Ch. 11 runs them at construction (X1, X6) | Ch. 11 |
| 2 | A plain call's exception is a defect, and `catch` sees only E | `try { JSON.parse(s) } catch {}` silently stops catching, unlike TypeScript and unlike `Effect.gen` today (X2) | Ch. 10, 15 |
| 3 | `throw` in `.es` adds the thrown type to E, including `Error` | `throw new Error("unreachable")` becomes a typed, catchable failure; the same line inside `Effect.gen`, or in a TypeScript helper, is a defect. Porting `Effect.gen` code changes which errors `catch` sees | Ch. 3 |
| 4 | Ch. 5 passes `makeSync` to `Array.prototype.map` | the callback convention for that position is undefined (X3) | Ch. 5 |
| 5 | Ch. 6 `openFile` uses `FileSystem.open(path)` and `file.close()` | Effect 4's `FileSystem` has no module-level `open`; the service's `open` already returns a scoped `File`, which has no `close` | Ch. 6 |
| 6 | Ch. 4 and Ch. 20 name user services `Config` and `Logger` | they shadow Effect's own `Config` and `Logger` modules, which the proposal never shows; a reader cannot tell whether `Config()` is Effect's `Config` | Ch. 4, 20 |
| 7 | Ch. 6's adapter checks `waiter.resume(socket)` inside a masked `acquireRelease` | the lost-race branch it demonstrates cannot run (X11) | Ch. 6 |

After the decision log: D24 settles #1, D5 and D23 narrow #2, and D9 settles the convention behind #4; #3 stands; #5 to #7 are text in the proposal, not checked against the spec rewrite in `docs/design/src/`.

## FAQ for Effect users

Each answer states what the proposal's rules give today. **Not supported yet** marks an answer the proposal does not give; the snippet then shows the closest form its rules allow. As in the proposal, a snippet without an enclosing function sits inside one, and names such as `User`, `guest`, and `AppLive` are assumed to be declared nearby.

### How do I do async, await, and promises?

A call already waits, so `.es` files have no `async` and no `await`. Wait on a Promise with `Effect.tryPromise`, which types the rejection and passes an `AbortSignal` so interruption cancels the request, or with `Effect.promise` when a rejection is a bug. Both are calls, so they run and give you the resolved value. Promise-based callers (an Express handler, a React event, a test that uses `await`) run an exported EffectScript function from a `.ts` file with `Effect.runPromise(f())`; doing that inside `.es` is **not supported yet** (gap X4).

```ts es
function fetchJson(url: string) {
  const response = Effect.tryPromise({
    try: (signal) => fetch(url, { signal }),
    catch: (cause) => new HttpError({ url, cause })
  })
  return Effect.tryPromise({ try: () => response.json(), catch: (cause) => new HttpError({ url, cause }) })
}
// Effect<any, HttpError, never>
```

Relies on Ch. 10 (Promises; Using EffectScript code from TypeScript) and Ch. 11 (runners). After the decision log: `fetch` is a platform API that `.es` may not call, even inside `Effect.tryPromise` (D5, D23, ES4402); use `HttpClient` (D6).

### How do I run things concurrently?

Ordinary calls run one after another; running things at once is always an explicit Effect combinator whose branches are programs written `() => …`. `Effect.all`, `Effect.forEach`, `Effect.race`, and `Effect.timeout` keep Effect's semantics: when one branch fails, the others are interrupted and their cleanup finishes before the call fails. Background work that should stop when the enclosing block exits uses `fork` (**Proposed**, O5); `Effect.forkChild` and `Effect.forkDetach` remain available by name. A `control` operation cannot be performed inside a branch that runs on another fiber (ES4201).

```ts es
function dashboard(id: string) {
  const [profile, orders] = Effect.all([() => loadProfile(id), () => recentOrders(id)], { concurrency: 2 })
  const thumbnails = Effect.forEach(orders, (order) => thumbnail(order), { concurrency: 8 })
  return { profile, thumbnails }
}
```

Relies on Ch. 7 and Ch. 14.

### Where did `Effect.gen` and `yield*` go?

Every `.es` function body is what you used to write inside `Effect.gen` or `Effect.fn`: calling a function that returns an Effect runs it and gives its value, so `yield*` disappears. The compiler emits `Effect.fnUntraced(function* …)` and infers the function's `Effect<A, E, R>`. In `.es`, `function*` declares a producer, so `Effect.gen` cannot be written there (ES1002); existing generator code stays in `.ts` files and is called like any Effect function.

```ts es
function userName(id: string) {
  const name = Users.find(id).name.trim()   // was: const users = yield* Users; const user = yield* users.find(id)
  Effect.log(`found ${name}`)
  return name
}
// Effect<string, UserNotFound, Users>
```

Relies on Ch. 2, Ch. 10, Ch. 24, and O4.

### How do I handle errors from code that is not Effect?

A call to a plain function is an ordinary JavaScript call, and an exception it throws is a defect, not a typed error. Turn it into a typed error with `Effect.try` for synchronous code or `Effect.tryPromise` for Promises; both run and give you the value. Two traps: a `.es` `try`/`catch` written around the plain call does not catch its exception (**not supported yet**, gap X2), and in v0 a callback passed to plain JavaScript may not fail with a typed error (G15).

```ts es
function parseConfig(text: string) {
  return Effect.try({
    try: () => JSON.parse(text) as Config,
    catch: (cause) => new ConfigError({ cause })
  })
}
// Effect<Config, ConfigError, never>
```

Relies on Ch. 10 (Plain functions), Ch. 15, and O11. After the decision log: a bare call to plain TypeScript is an error (ES4401) unless the function carries a trusted contract (`/** @effectscript trusted */` with `@throws`), and JavaScript built-ins such as `JSON.parse` ship with one, so a `catch` sees their declared exceptions (D5, D23).

### What does `throw` mean now?

In `.es`, `throw` is always a typed failure: the thrown value's type joins the function's E, and a `catch` can handle it. That includes `throw new Error("unreachable")`, which inside `Effect.gen` would be a defect. Defects come only from plain calls that throw, `Effect.die`, and `Effect.orDie(() => …)`.

```ts es
function parseId(raw: string) {
  if (!/^\d+$/.test(raw)) throw new InvalidId({ raw })
  return Number(raw)
}
// Effect<number, InvalidId, never>
```

Relies on Ch. 3 and Ch. 15.

### How do I use Option and Either/Result?

Both are plain data in Effect 4 (`Either` became `Result`), so their functions are ordinary calls. To fail with a typed error when a value is missing, call `Effect.fromOption(o)` (it fails with `NoSuchElementError`) or narrow and `throw`; to capture a program's outcome as data, call `Effect.result(() => f())`. The docs' `yield* option` dies at run time in 4.0.5 and has no EffectScript form. The proposal does not mention either type; this answer applies Ch. 11's call rule, and effectful `Option.match` branches are **not supported yet** (gap X3).

```ts es
function lookup(id: string) {
  const cached = HashMap.get(cache, id)               // Option<User>
  if (Option.isSome(cached)) return cached.value
  const fetched = Effect.result(() => Users.find(id))  // Result<User, UserNotFound>
  return Result.isSuccess(fetched) ? fetched.success : guest
}
```

Relies on Ch. 3 and Ch. 11 (derived). After the decision log: effectful `Option.match` branches are rejected with ES4301 (D9, D22); branch with `if` or `switch`.

### How do I use Schema?

Schemas are values, so you build them at a module's top level as in Effect. `Schema.decodeUnknownEffect(S)(input)` is a call that runs and adds `SchemaError` to E; `decodeUnknownSync` throws, so its failure is a defect. Schema error classes are thrown with `throw`, and Effect-taking options such as `withConstructorDefault` take `() => …`. **Not supported yet**: `decodeUnknownExit` (gap X1) and schema-backed `Config` (gap X6).

```ts es
const Person = Schema.Struct({ name: Schema.String, age: Schema.Finite })

function readPerson(input: unknown) {
  return Schema.decodeUnknownEffect(Person)(input)
}
// Effect<{ readonly name: string; readonly age: number }, SchemaError, never>
```

Relies on Ch. 3 and Ch. 11 (derived).

### How do I use Streams?

EffectScript adds producers: a `function*` that may call services between `yield`s, consumed with `for...of`, which closes the producer's resources on `break`. Effect's `Stream` stays usable as is: a stream is a value, and `Stream.runForEach`, `runCollect`, and `run(sink)` are calls that run it, with EffectScript functions as callbacks. Converting a producer to a `Stream`, and `for...of` over a `Stream`, are **not supported yet** (G12); `using pull = Stream.toPull(s)` with `pull()` is the interim external iteration (derived).

```ts es
function* lines(path: string) {
  using file = Files.open(path)
  while (true) {
    const line = file.readLine()
    if (line === undefined) return
    yield line
  }
}

function audit(path: string, events: Stream.Stream<Event>) {
  for (const line of lines(path)) if (line.startsWith("ERROR")) Alerts.raise(line)
  Stream.runForEach(events, (event) => Audit.record(event))
}
```

Relies on Ch. 8, Ch. 24, O4, and G12. After the decision log: a producer is a `Stream` wherever one is expected, and `for...of` over a `Stream` pulls with `Stream.toPull` (D26).

### How do I test?

Test bodies are programs: `it.effect("name", () => { … })` with ordinary statements inside. Fake a service with `Layer.succeed(Users, { find: (id) => ada })` (plain functions are fine), compose fakes with `wire`, and override one service for a region with `Effect.provideService`. `TestClock.adjust` is a call; fork the program that sleeps first, as in Effect. **Not supported yet**: Promise-style tests with `await Effect.runPromise` in `.es` (gap X4) and assertions against `Exit.succeed(...)` (gap X1).

```ts es
const UsersTest = Layer.succeed(Users, {
  find: (id) => ({ id, name: "Ada", email: "ada@example.com" }),
  rename: () => {}
})

it.effect("welcome returns the user's name", () => {
  const name = Effect.provide(() => welcome("42"), wire(UsersTest, MailerTest))
  assert.strictEqual(name, "Ada")
})
```

Relies on Ch. 4 (Testing with fake services) and Ch. 9 (Testing with a handler).

### How do I log, trace, and measure?

`Effect.log`, `Effect.annotateCurrentSpan`, and `Metric.update` are calls that run. Log annotations, log spans, spans, and metric tracking wrap a program, so they take `() => …`. EffectScript functions are untraced by default, because a traced frame costs 10 to 20 times more; add a span where you want one with `Effect.withSpan`. Loggers, metric definitions, and the OpenTelemetry layer are values you provide as in Effect.

```ts es
const requests = Metric.counter("requests")

function handle(req: Request) {
  Metric.update(requests, 1)
  Effect.annotateCurrentSpan("path", req.path)
  return Effect.withSpan(() => route(req), "handle")
}
```

Relies on Ch. 2 (Tracing), Ch. 5, and Ch. 22. After the decision log: `"tracing": "exported"` or `"all"` in `tsconfig.json` compiles functions with `Effect.fn` spans (D34).

### How do I configure?

**Not supported yet** (gaps X6 and X1). `Config` is an Effect in 4.0.5, so `const port = Config.Port("PORT")` reads the value at the call, which works; composing configs with `Config.all`, `withDefault`, `nested`, or `Config.schema` does not, because each inner call runs before the combinator sees it. Until the call rule is settled, define composed `Config` values in a `.ts` file, import them, and read one by calling it; provide a `ConfigProvider` like any Layer.

```ts es
import { AppConfig } from "./config.ts"   // Config.all({ host: …, port: … }) written in TypeScript

function main() {
  const { host, port } = AppConfig()       // an Effect value runs when called
  return Http.listen(host, port)
}
```

Relies on Ch. 4 and Ch. 11. After the decision log: settled by D24, so `Config.all({ … })` can be written in `.es` as data and read by calling it, `AppConfig()`.

### How do I run a program?

Hand `main` to a runner at a module's top level: `NodeRuntime.runMain(() => main())`. Nothing else at the top level may run a program (ES1001), and a call never starts a fiber. From TypeScript, an EffectScript function is an ordinary `(…) => Effect`, so `NodeRuntime.runMain(main())`, `Effect.runPromise(main())`, and `ManagedRuntime` work there. **Not supported yet**: runners other than `runPromise`, `runMain`, and test runners, and runner calls inside `.es` functions (gap X4).

```ts es
// main.es
function main() {
  const name = Effect.provide(() => welcome("42"), AppLive)
  Effect.log(`welcomed ${name}`)
}

NodeRuntime.runMain(() => main())
```

Relies on Ch. 1 (Running it), Ch. 10, and Ch. 11 (Where programs start). After the decision log: provide the application layer once at `main`, and give a program with several entry points one `ManagedRuntime` (D21).

### Can I still use `pipe`?

Yes. Over data, Effect's `pipe` and the `.pipe` method on Layers, Streams, Schedules, and Schemas are unchanged. Over programs, EffectScript's own `pipe` takes a zero-argument function first, and the `pipe` call runs the result (**Proposed**, O1). Most pipes disappear: `map`, `flatMap`, `andThen`, and `tap` become statements, `catchTag` becomes `try`/`catch`, and `ensuring` becomes `finally`.

```ts es
const user = pipe(
  () => fetchUser(id),
  Effect.retry({ times: 3 }),
  Effect.timeout("2 seconds")
)
const rows = pipe(items, Array.filter(isActive), Array.map(toRow))
```

Relies on Ch. 5. The Fable review (finding 8) recommends dropping EffectScript's `pipe` for nested data-first calls.

### What about `Match` and pattern matching?

Matching on values is unchanged: `Match.value(x).pipe(Match.tag(…), Match.exhaustive)` with pure handlers is an ordinary call. For branches that call services or can fail, use TypeScript's narrowing with `switch` or `if`, which `.es` supports with effectful calls anywhere. Effectful handlers inside `Match` or `Option.match` are **not supported yet** (gap X3).

```ts es
function onEvent(event: AppEvent) {
  switch (event._tag) {
    case "Created": return Notify.created(event.id)
    case "Deleted": return Audit.record(`deleted ${event.id}`)
  }
}
```

Relies on Ch. 2 (Control flow is ordinary JavaScript) and Ch. 14. After the decision log: effectful handlers passed to `Match` are rejected with ES4301 (D9, D22), so `switch` is the answer.

### How do fibers, interruption, and cancellation work?

EffectScript keeps Effect's fiber model: a call never starts a fiber; runners, `fork`, and concurrent combinators do. Interruption is not an error: `catch` never sees it, `finally` and `using` always run, and `Effect.uninterruptible(() => …)` holds it off for a block. `fork(() => …)` ties a child to the enclosing block, which interrupts the child and waits for its cleanup before releasing anything acquired earlier; `Fiber.join` and `Fiber.interrupt` are calls. Interruption lands at Effect operations, so a plain JavaScript region is atomic, and Promises are cancelled through the `AbortSignal` that `Effect.tryPromise` passes.

```ts es
function serve(port: number) {
  using server = Http.listen(port)
  fork(() => heartbeat())                 // interrupted before the server closes
  try {
    return server.awaitShutdown()
  } finally {
    Effect.log("stopped")                 // runs on success, failure, or interruption
  }
}
```

Relies on Ch. 3, Ch. 7, Ch. 13, Ch. 15, and O5. After the decision log: `fork` is block-owned (D19).

### How do I write, provide, and replace a service?

Declare it with `service Users { find(id: string): Effect<User, UserNotFound, never> }`, call `Users.find(id)`, and implement it with `Layer.effect(Users, () => { … })`, whose body runs once when the layer is built. Compose providers with `wire(...)` or Effect's Layer functions, provide with `Effect.provide(() => program(), AppLive)`, and replace one service for a region with `Effect.provideService`. Effect 4's `make` option and `Context.Reference` defaults have no `service` form yet (gap X12).

```ts es
service Users {
  find(id: string): Effect<User, UserNotFound, never>
}

const UsersLive = Layer.effect(Users, () => {
  const db = Database()
  return {
    find(id) {
      const rows = Effect.orDie(() => db.query("select * from users where id = $1", [id]))
      if (rows.length === 0) throw new UserNotFound({ id })
      return toUser(rows[0])
    }
  }
})
```

Relies on Ch. 4 and O2. After the decision log: the `service` keyword is gone; a service is an abstract class whose members are all abstract, with an optional `static readonly layer` (D1).

### How do I manage resources?

`using x = acquire()` acquires a resource and releases it when the block exits, on success, failure, or interruption, in reverse order. Define the acquire and release steps with `Effect.acquireRelease(() => open(), (handle) => close(handle))`. A function that acquires without `using` leaves `Scope` in its requirements, and the caller's `using` owns the resource.

```ts es
function compareLogs(a: string, b: string) {
  using left = openLog(a)
  using right = openLog(b)
  return diffLines(left.readAll(), right.readAll())
}
```

Relies on Ch. 6 and Ch. 24.

### How do I retry, time out, repeat, or schedule?

Effect's combinators take the program as `() => f()`: `Effect.retry`, `Effect.timeout`, `Effect.repeat`, and `Effect.schedule` keep their Effect signatures. Schedules are values and are unchanged. Each retry reruns the function from the start with fresh local variables.

```ts es
const user = Effect.retry(() => fetchUser(id), Schedule.exponential("100 millis"))
const fresh = Effect.timeout(() => fetchUser(id), "1 second")      // E gains TimeoutError
Effect.repeat(() => syncInventory(store), Schedule.spaced("5 minutes"))
```

Relies on Ch. 5.

### How do I keep a program as a value instead of running it?

A call runs; a function value does not. Write `() => f(x)` to get a program, then store it, return it, or pass it, and call it to run it, from scratch each time. `Effect.cached(() => load())` returns a program you call later.

```ts es
function makeSync(store: Store) {
  return () => syncInventory(store)   // a program; nothing has run
}

const cachedConfig = Effect.cached(() => loadConfig())
const config = cachedConfig()          // loads once; later calls reuse the result
```

Relies on Ch. 5 and O1.

### How do I wrap a callback API?

Write the adapter in a `.ts` file with the EffectScript runtime's `suspend`, which, unlike `Effect.callback`, tells the producer when a value arrived too late, then call it from `.es`. Using `Effect.callback` directly in `.es` (where `resume(Effect.succeed(x))` would have to be written `resume(() => x)`) is **not supported yet** (gap X11).

```ts es
import { connect } from "./net-adapter.ts"   // suspend + Effect.acquireRelease, in TypeScript

function session(url: string) {
  using socket = connect(url)
  return handshake(socket)
}
```

Relies on Ch. 6 (Adapting a callback API) and Ch. 19.

### Can I mix `.ts` and `.es` files?

Yes. A TypeScript function that returns an Effect is called from `.es` like any EffectScript function, and its A, E, and R join the caller's contract; `Context.Service` classes written in TypeScript are called like `service` declarations. To TypeScript, every exported EffectScript function is `(…) => Effect<A, E, R>`, cold until run.

```ts es
import { findUser } from "./users-repo.ts"   // Effect.fn("findUser")(function* …)

export function title(id: string) {
  return findUser(id).name.toUpperCase()
}
// Effect<string, UserNotFound | DbError, Database>
```

Relies on Ch. 10.

### Is there anything from Effect I cannot use?

Effect 3 code (including Micro, which Effect 4 removed) runs only as foreign code behind an adapter, because EffectScript targets Effect 4. Generator-based APIs (`Effect.gen`) cannot be written in `.es` files but can be called from them. The other limits are the gaps in this file: composed `Config` values and other data that are also Effects (X1, X6), effectful callbacks to pure helpers (X3), runner calls inside `.es` (X4), and `Stream` interop (G12).

```ts es
const legacy = Effect.tryPromise({ try: () => Effect3.runPromise(oldProgram), catch: (e) => new LegacyError({ e }) })
```

Relies on Ch. 10 (Effect 3) and P15.

## Appendix A. Usage census

How often real Effect 4 code uses each feature, to rank the gaps. Measured 2026-10-15 with `rg -l` over the `.ts` and `.tsx` files that contain `from "effect` in Smithers (`~/smithers/packages`, `apps`, `flows`; `effect` 4.0.4; 3,604 files, 2,084 of them tests) and opencode (`~/opencode/packages`; `effect` 4.0.0-beta.83; 1,070 files, 377 tests), skipping `node_modules`, `dist`, and `vendor`. Counts are files that match a regular expression, not call sites, so a module name shared with another library (`Command`, `Prompt`, `Logger`) can inflate a count.

| Feature | Smithers | opencode |
| --- | --- | --- |
| `Effect.gen` | 2,080 | 616 |
| `pipe(` | 2,309 | 594 |
| `Effect.fn` (traced) / `Effect.fnUntraced` | 137 / 34 | 330 / 71 |
| `Schema.*` / Schema decode or encode | 1,669 / 645 | 408 / 130 |
| `Effect.provide` / `Layer.*` | 1,577 / 1,388 | 150 / 346 |
| `Effect.provide` call sites | 8,124 | 409 |
| `async` functions in Effect files | 1,272 | 212 |
| `Effect.run*` (in tests) | 1,148 (1,067) | 73 (50) |
| `test(` or `it(` with `Effect.runPromise` | 875 | 43 |
| `acquireRelease` / `scoped` / `addFinalizer` | 1,018 | 190 |
| JavaScript `try {` in Effect files (and in `Effect.gen` files) | 840 (487) | 103 (70) |
| `try {` files that also call `JSON.parse` | 362 | 33 |
| `throw new Error` in `Effect.gen` files | 329 | 108 |
| `Option.*` / `Option.match` | 722 / 31 | 80 / 4 |
| `Option.match` with an Effect in a handler on the same line | 16 | 0 |
| `Effect.fromOption`, `fromResult`, `fromNullishOr` | 31 | 2 |
| `Result.*` | 193 | 8 |
| `Effect.exit` / `Exit` constructors (in tests) | 517 / 114 (90) | 68 / 4 (0) |
| `Stream.*` / `Stream.run*` | 497 / 284 | 82 / 39 |
| `@effect/vitest` imports / `layer(` in those files | 757 / 407 | 0 / 0 |
| `it.effect`, `it.live`, `it.layer` | 664 | 196 |
| `TestClock.*` | 261 | 8 |
| Effect SQL tagged templates (file imports `effect/sql` or `@effect/sql`) | 271 | 4 |
| `extends Context.Service<` / function-form `Context.Service<…>("…")` / `Context.Reference` | 140 / 14 / 41 | 145 / 1 / 5 |
| Effect `Config` constructors (v4 names) / composing ones | 8 / 5 | 7 / 7 |
| `ConfigProvider.*` | 11 | 18 |
| fork variants / `Fiber.*` / `FiberSet`, `FiberMap`, `FiberHandle` | 429 / 417 / 6 | 97 / 52 / 5 |
| `Deferred` / `Queue` / `PubSub` / `Semaphore` or `Latch` | 295 / 28 / 18 / 97 | 56 / 17 / 1 / 20 |
| `Effect.timeout*` / `retry`, `repeat` / `Schedule.*` | 203 / 59 / 79 | 49 / 11 / 14 |
| catch family / `mapError`, `tapError`, `orElse*`, `orDie`, `ignore*` | 296 / 643 | 138 / 232 |
| `ManagedRuntime` / `runMain` | 45 / 7 | 8 / 2 |
| `FileSystem`, `Path` / `HttpClient` / `HttpApi`, `HttpRouter`, `HttpServer` | 424 / 106 / 30 | 81 / 88 / 136 |
| `Effect.callback` or `Effect.async` | 2 | 0 |
| `Match.*` / `Effect.Do`, `bind` | 0 / 0 | 1 / 0 |
| RPC / `Workflow`, `Activity`, `Entity` / AI modules / `Tx*` / `Micro` | 42 / 7 / 3 / 0 / 0 | 1 / 0 / 1 / 1 / 0 |

Behavior probes, run with Node against `experiments/node_modules/effect` (4.0.5):

| Probe | Result |
| --- | --- |
| `Effect.gen(function* () { try { return JSON.parse("{bad") } catch (e) { return "caught " + e.name } })` | `caught SyntaxError`: JavaScript `try` inside `Effect.gen` catches a plain call's exception |
| `Effect.sync(() => JSON.parse("{bad")).pipe(Effect.catch(…))` | not caught: the exception is a defect, and `Effect.catch` (what `.es` `catch` lowers to) skips it |
| `Effect.isEffect` on `Config.String("HOST")`, `Exit.succeed(1)`, `Context.Reference(…)`, `Option.some(1)` | `true`, `true`, `true`, `false` |
| `Config.withDefault(Config.Port("PORT"), 8080)` read with an empty provider | `8080` |
| `Config.Port("PORT")` read first, with an empty provider | fails with `ConfigError` |
| `Effect.fn("plain")((n) => Effect.succeed(n + 1))(1)` | `2`: `Effect.fn` accepts a non-generator body |

## Appendix B. Page index

Every page of the v4 docs (110 pages, from `llms.txt`) and the section of this file that covers it.

| Docs group (pages) | Pages | Covered in |
| --- | --- | --- |
| Start Here (2) | Welcome to Effect, Why Effect? | §1 |
| Learning Path (5) | The Effect Type, Installation, Creating Effects, Two Types of Errors, Basic Concurrency | §1, §2, §12 |
| Core Concepts (5) | Importing Effect, Running Effects, Using Generators, Building Pipelines, Devtools | §1, §7 |
| Guides (4) | Getting Started, Configuration, Introduction to Runtime, Batching | §1, §6, §7, §11 |
| Error Management (11) | Expected Errors, Unexpected Errors, Fallback, Matching, Retrying, Timing Out, Sandboxing, Error Accumulation, Error Channel Operations, Parallel and Sequential Errors, Yieldable Errors | §2 |
| Requirements Management (4) | Managing Services, Default Services, Managing Layers, Layer Memoization | §3 |
| Resource Management (2) | Introduction, Scope | §4 |
| Observability (4) | Logging, Metrics in Effect, Tracing in Effect, Tracking Fibers | §5 |
| Scheduling (4) | Using schedules, Choosing and combining schedules, Scheduling work with cron, Schedule cookbook | §8 |
| State Management (3) | Ref, SynchronizedRef, SubscriptionRef | §9 |
| Caching (2) | Caching Effects, Cache | §10 |
| Concurrency (6) | Fibers, Deferred, Queue, PubSub, Semaphore, Latch | §12 |
| Stream (6) | Introduction to Streams, Creating Streams, Consuming Streams, Error Handling in Streams, Operations, Resourceful Streams | §14 |
| Sink (4) | Introduction, Creating Sinks, Sink Operations, Leftovers | §15 |
| Testing (1) | TestClock | §16 |
| Code Style (6) | Guidelines, Dual APIs, Branded Types, Pattern Matching, Simplifying Excessive Nesting, Control Flow Operators | §17 |
| Data Types (11) | BigDecimal, Cause, Chunk, Data, DateTime, Duration, Result, Exit, HashSet, Option, Redacted | §18, §6 (Redacted) |
| Trait (2), Behaviour (2) | Equal, Hash, Equivalence, Order | §19 |
| Schema (20) | Introduction, Getting Started, Basic Usage, Filters, Advanced Usage, Projections, Transformations, Annotations, Canonical Codecs, Error Messages, Error Formatters, Class APIs, Default Constructors, Effect Data Types, Standard Schema, Arbitrary, JSON Schema, Equivalence, Formatter, Compilers | §20 |
| Platform (6) | Introduction to Effect Platform, FileSystem, Path, PlatformLogger, Runtime, Terminal | §21, §5, §7 |
| v3 only (22) | AI (4 pages), Micro (2), Supervisor, Command, KeyValueStore, Either, Sink Concurrency, Schema Pretty, five Scheduling pages, five Additional Resources pages (Coming from ZIO, Effect vs fp-ts, Effect vs neverthrow, Effect vs Promise, Myths) | §25, §27, §5, §21, §18, §15, §20, §8, FAQ |
| Package only (no docs page) | HTTP, HttpApi, SQL, CLI, Cluster, Workflow, RPC, Socket, Worker, ChildProcess, Stdio, Tx modules, FiberHandle, RcRef, Pool, ManagedRuntime, `@effect/vitest` | §21 to §26, §4, §5, §7, §9, §16 |

