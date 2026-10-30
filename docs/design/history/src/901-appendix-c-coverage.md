### C. Every Effect feature in VibeLang

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

> **Retired handler design.** The first release has no handlers or continuation kernel. `control`, `handle`, `resume`, `abandon` are not supported. [VIP-35](../../vips/0035-handlers-open.md) remains an open proposal; any handler examples and machine descriptions below record the old prototype.

```ts es
const Port = Config.withDefault(Config.Port("PORT"), 3000)      // unchanged by design: Effect's API, as is

function loadUser(id: string) {
  return retry(() => Users.find(id), { times: 3 })  // changed: the program is a function
}
```

Every section of Effect 4's documentation, the Effect 3 pages version 4 dropped, and the `effect@4.0.6` modules the site omits (HTTP, SQL, CLI, AI, cluster, workflow, RPC), mapped to VibeLang. **Changed**: VibeLang has its own form. **Unchanged**: by design, you use Effect's API as you do today; the call rule (Chapter 13) makes it work directly, and a second way would be ceremony. The map comes from the feature-coverage audit (`docs/research/effect-feature-coverage.md`, 309 features), updated to the decisions in Chapter 29. D57 completes partial annotations with explicit `infer` slots.

#### C1. Getting started: the Effect type, creating, running, generators, pipelines

| Feature | In VibeLang | Form |
| --- | --- | --- |
| The `Effect<A, E, R>` type | Changed | Inferred for every function; written as a return annotation to have it checked (Chapter 2) |
| Type helpers (`Effect.Success`, `Error`, `Services`) | Unchanged | Apply them to the TypeScript type of a VibeLang function |
| Annotate one channel, infer the rest | Changed (D57) | In a return annotation with a body, write `Effect<A, infer E, infer R>`; a slot left out of `Effect<…>` is `never` (D308), and `A!E` infers R (D309) |
| Installation | Changed | `effect@4.0.6`, `vibelang-runtime`, and `vibelang` (Chapter 28) |
| Importing Effect | Changed | `effect`'s root modules and its subpath packages' modules need no import (D146, D310); import platform packages such as `@effect/platform-node` |
| `Effect.succeed` | Changed | `return 42` |
| `Effect.fail`, `failSync` | Changed | `throw new HttpError()` |
| `Effect.sync` around a side effect | Changed | Call the code; platform side effects go through Effect modules (Chapter 11), or the `sync` hatch (D148) |
| `Effect.try`, `tryPromise`, `promise` | Changed | The hatches `try(…)` and `sync(async () => …)`, whose first arguments are self-contained TypeScript that takes values as inputs (D148, D229) |
| `Effect.suspend` | Changed | A function with no required parameters, `() => …`, where a program is expected (D7, D322) |
| `Effect.callback` | Changed | The hatch `callback((resume, signal) => …)`: `resume(value)`, `resume.fail(error)`; inputs come before `resume` (D43, D148, D230) |
| `Effect.void`, `never`, `yieldNow`, `interrupt` | Changed | Bare functions: `yieldNow()`, `interrupt()` (D179) |
| Runners (`runPromise`, `runSync`, `runFork`, `runCallback`) | Changed | In the prelude; `runPromise(main())` from TypeScript, a top-level call, or a hatch's body, where no fiber runs the code (EK1005, D38, D148) |
| `Effect.gen` and `yield*` | Changed | An ordinary function body, and calls (Chapter 2); `Effect.gen` in a `.vibe` file is EK1002, since every `function*` there is a producer (D370) |
| `Effect.gen({ self: this }, …)` | Changed | An ordinary method; `this` keeps its JavaScript meaning |
| `Effect.fn`, `fnUntraced` | Changed | `function f() { … }`, untraced unless `tracing` asks for spans (Chapter 28) |
| `map`, `flatMap`, `andThen`, `tap`, `as` | Changed | Statements |
| `pipe` and `.pipe` over programs | Changed | Nested programs, `timeout(() => retry(() => f(), …), …)`: `pipe` passes a function as the value it is, so data-last combinators, which take an `Effect`, do not take it (D383) |
| `pipe` over data | Unchanged | `pipe(items, Array.filter(isActive))` |
| `Effect.all`, `zip`, `zipWith` | Changed | Programs as functions: `Effect.all([() => a(), () => b()])` |
| `Effect.fromOption`, `fromResult`, `fromNullishOr` | Unchanged | `const n = Effect.fromOption(parse(x))` |
| Control flow inside `Effect.gen` | Changed | `if`, `for`, `while`, and early `return` in an ordinary function |
| Devtools | Changed | The fork's language server for `.vibe`; `@effect/tsgo` stays on `.ts`; Effect's `DevTools` for fibers and spans (Chapter 28) |

#### C2. Error management

On a cause mixing an expected failure and a defect, neither Effect's typed recovery operators nor VibeLang's `catch` recovers (D305). Chapter 17 lists each operator's behavior.

| Feature | In VibeLang | Form |
| --- | --- | --- |
| Expected errors and defects | Changed | `throw` is expected; an exception no contract lists, `Effect.die`, and `Effect.orDie` are defects (Chapter 3) |
| A JavaScript `throw` | Changed | A typed failure everywhere outside a hatch; a plain-annotated function never fails, so one that can throw needs an Effect contract, and a constructor, an accessor or a static block never fails either (D282); `Effect.die(new Error(…))` for a bug in Effect code |
| A JavaScript `catch` around a throwing call | Changed | Every catch handles expected failures only, in plain functions too (D282); EK2004 marks a catch whose try block has E = `never`; the `try` hatch catches a JavaScript exception |
| `Data.TaggedError`, `Data.Error`, `Schema.TaggedError` | Changed | `error E { ... }` declares a `TaggedError` class; `Schema.TaggedError` is unchanged |
| Error tracking in E | Changed | Inferred: what a function throws, plus its callees' E, minus what it catches |
| `Effect.catch`, `catchTag`, `catchTags`, `catchIf` | Changed | `try`/`catch` with narrowing; the combinators still work with a program |
| `catchReason`, `catchReasons`, `unwrapReason` | Changed | Narrow `e._tag` and `e.reason._tag` inside `catch` |
| `Effect.die`, `orDie`, `catchDefect`, `catchCause`, `tapDefect` | Changed | The same functions with a program: `Effect.orDie(() => f())` |
| `Effect.result`, `option`, `exit` | Changed | `Effect.result(() => task())` |
| `orElseSucceed`, `firstSuccessOf` | Changed | `try`/`catch`, or `Effect.firstSuccessOf([() => a(), () => b()])` |
| `Effect.match`, `matchEffect`, `matchCause` | Changed | `try` with statements; `Effect.exit(() => f())`, then `Exit.match` |
| `Effect.ignore`, `ignoreCause` | Changed | `Effect.ignore(() => task())` |
| `Effect.retry`, `retryOrElse` | Changed | `Effect.retry(() => request(), { times: 5 })`, with fresh locals per attempt |
| `Effect.timeout`, `timeoutOption`, `timeoutOrElse` | Changed | `Effect.timeout(() => task(), "1 second")`; E gains `Cause.TimeoutError` |
| `Effect.sandbox` | Changed | `Effect.sandbox(() => task())` inside `try`; `catch (cause)` gets the cause |
| `Effect.validate`, `partition` | Unchanged | The same calls, with VibeLang callbacks |
| `Effect.all` with `mode: "result"` | Changed | Programs as functions, the same options |
| `mapError`, `mapBoth`, `tapError`, `flip`, `filterOrFail` | Changed | `catch (e) { throw new Other({ e }) }`; `if (…) throw new E()` |
| Parallel and sequential errors (`Cause.reasons`) | Unchanged | `catch` gets the first expected failure (D28); `Effect.catchCause` sees all |
| Yieldable errors | Changed | `throw new E()`; `new` never runs anything (D24) |
| A contract with E = `never` | Changed | Checked by the compiler (EK2001) |

#### C3. Requirements management: services, layers, memoization

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Context.Service` class | Changed | `service Users { find(id: string): User!UserNotFound }` (D1, D128) |
| Service keys | Changed | Derived from package, path, and class name; duplicates are EK3001 |
| `yield* Users`, then a method | Changed | `Users.find(id)`; `Users()` gives the implementation |
| `Users.use`, `useSync` | Changed | Call the member: `Users.find(id)` |
| A member that returns a plain value (`Path.join`) | Changed | `Path.join(a, b)`; the service joins R (D41) |
| A member that is an `Effect` value | Unchanged | Call it: `Terminal.readLine()` |
| The `make` option and `static layer` | Changed | `static make()` and `static readonly layer` on the service class (D40) |
| `Context.Reference` with a default | Unchanged | `Context.Reference(key, { defaultValue })` as is, or `static readonly default` on a service class (D40) |
| `Effect.serviceOption` | Unchanged | `Effect.serviceOption(Mailer)` |
| Default services (`Clock`, `Console`, `Random`, `Tracer`, `ConfigProvider`) | Unchanged | `Clock.currentTimeMillis()`; R stays empty |
| `Effect.provideService` | Changed | `Effect.provideService(() => program(), Mailer, quiet)` |
| `Context.make`, `Context.add` | Unchanged | Values, provided with `Effect.provide(() => program(), context)` |
| `Layer.succeed`, `effect`, `sync` | Changed | `Layer.effect(Users, () => { const db = Database(); return { … } })` |
| Layers that hold resources | Changed | Acquire without `using`; the layer's Scope owns the resource |
| Requirements that leak into methods | Changed | EK3101 |
| `Layer.merge`, `mergeAll`, `provide`, `provideMerge` | Unchanged | The same functions; `wire(…)` orders them and reports graph errors (D27) |
| Missing, duplicate, and cyclic providers | Changed | EK3201, EK3202, EK3203 |
| `Effect.provide` | Changed | `Effect.provide(() => program(), AppLive)`; each `provide` builds its layers once (D21) |
| Layer memoization, `Layer.fresh`, MemoMaps | Unchanged | As in Effect; provide at `main`, or run entry points through one `ManagedRuntime` (D21) |
| `Layer.launch`, `build`, `unwrap`, `mock`, `tap`, `catch` | Unchanged | Values and calls as in Effect |
| Fake services | Changed | `Layer.succeed(Users, { find: (id) => ada, rename: () => {} })` |

#### C4. Resource management

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Effect.scoped` | Changed | A block that declares `using` |
| `acquireRelease`, `acquireUseRelease` | Changed | `using lock = Effect.acquireRelease(() => acquire(), (l) => release(l))` |
| Interruptible acquisition | Unchanged | `acquireRelease(…, { interruptible: true })`; `using` adds no mask, so it keeps the acquisition's choice, as `yield*` does (D25, D490) |
| A resource the caller owns | Changed | Acquire without `using`; `Scope` stays in R (D14) |
| `ensuring`, `onExit`, `onError`, `addFinalizer` | Changed | `finally`; `Effect.onExit(() => f(), (exit) => …)` when the exit matters |
| `Scope.make`, `close`, `provide` | Unchanged | The same calls |
| `Disposable` resources | Changed | `using x = disposable` registers its one disposal, read once, `[Symbol.asyncDispose]` first (D342, D343) |
| `RcRef`, `RcMap`, `Pool`, `ScopedRef`, `ScopedCache`, `LayerMap` | Changed | `using pool = Pool.make({ acquire: () => connect(), size: 10 })` |
| Cleanup when a handler abandons a program | Changed | No Effect equivalent; `using` and `finally` run before `handle` returns |

#### C5. Observability

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Effect.log` and its levels | Unchanged | `Effect.logWarning("disk low")` |
| A minimum log level for a region | Changed | `Effect.provideService(() => program(), References.MinimumLogLevel, "Debug")` |
| `annotateLogs`, `withLogSpan` | Changed | With a program: `Effect.withLogSpan(() => handle(req), "handler")` |
| `annotateLogsScoped` | Unchanged | The same call; a `using` block or the caller supplies the Scope |
| `Logger.make`, `Logger.layer`, formats, `Logger.toFile` | Unchanged | Values, provided as layers |
| `Console` | Unchanged | `Console.log("hi")`; `console.log` is EK4402 |
| Metrics (`counter`, `gauge`, `histogram`, `summary`, `frequency`, `timer`) | Unchanged | Defined at the top level; `Metric.update(requests, 1)` |
| `trackSuccesses`, `trackDuration` | Changed | `Effect.trackDuration(() => task(), latency)` |
| `Metric.CurrentMetricAttributes` | Changed | Provided around a program with `Effect.provideService` |
| Spans per function (`Effect.fn("name")`) | Changed | `"tracing"` in `tsconfig.json`, or `Effect.withSpan` where you want one (Chapter 28) |
| `Effect.withSpan` | Changed | `Effect.withSpan(() => loadUser(id), "load-user")` |
| `annotateCurrentSpan`, `currentSpan`, `linkSpans` | Unchanged | The same calls |
| Logs as span events | Unchanged | Spans stay correct across handler capture (G6a) |
| Exporting traces, logs, and metrics (`OtlpTracer`, `OtlpLogger`, `OtlpMetrics` from `effect/observability`) | Unchanged | Layers, provided as in Effect: `OtlpTracer.layer({ url, resource: { serviceName } })` |
| `FiberSet`, `FiberMap`, `FiberHandle` | Changed | `using set = FiberSet.make()`, then `FiberSet.run(set, () => task())` |
| Supervisors (Effect 3) | Unchanged | Effect 4 has none; `FiberSet` and `fork` |

#### C6. Configuration

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Config.String`, `Port`, `Int`, `Boolean`, `Duration`, `URL`, `Redacted` | Unchanged | Data until called: `const Port = Config.Port("PORT")`, then `Port()` (D24) |
| `Config.all`, `withDefault`, `nested`, `option`, `orElse`, `schema` | Unchanged | Composed as data, read once by calling |
| `ConfigProvider` (`fromEnv`, `fromUnknown`, `layer`) | Unchanged | Provided as a layer |
| `ConfigProvider.fromDotEnv()`, `fromDir()` | Unchanged | Calls that run, inside a function |
| `config.parse(provider)` in tests | Unchanged | `AppConfig.parse(provider)` returns an Effect, so the call runs it |
| A Layer chosen by config (`Layer.unwrap`) | Changed | `Layer.unwrap(() => …)`, with a program |
| `Redacted` | Unchanged | `Redacted.value(DatabaseUrl())` |

#### C7. Runtime

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `NodeRuntime.runMain`, `BunRuntime.runMain` | Changed | `export function main()` in a file that names its platform, `import "vibelang/platform/node"`; the entry statement runs it (D312) |
| `runMain` options | Changed | The same options, with a program |
| One-shot runners and `run*With(context)` | Changed | Programs as functions, only where no fiber runs the code (D38) |
| `ManagedRuntime` | Unchanged | `ManagedRuntime.make(AppLive)`; `runtime.runPromise(() => handle(req))` in a framework callback, or from TypeScript |
| Top-level `await` | Changed | No `await`; the top level builds values, calls plain functions (D445), and calls runners; a call that runs a program there is EK1001 |
| Scheduling and fairness | Unchanged | 2048 operations per slice; a plain JavaScript region is atomic |
| `ErrorReporter`, `Effect.withErrorReporting` | Changed | `Effect.withErrorReporting(() => program())()`: the arrow stays a function, and the declared return type is a conditional with a function branch, so the call returns the wrapped function, and `()` runs it (D321, D324) |

#### C8. Scheduling

| Feature | In VibeLang | Form |
| --- | --- | --- |
| Schedule constructors (`spaced`, `fixed`, `exponential`, `recurs`, `cron`) | Unchanged | `Schedule.exponential("250 millis")` |
| Schedule combinators | Unchanged | `.pipe` over a schedule value |
| Effectful schedule callbacks (`tap`, `modifyDelay`) | Unchanged | VibeLang callbacks |
| `Effect.repeat` | Changed | `Effect.repeat(() => poll(), { schedule, until: (s) => s === "done" })` |
| `Effect.retry` with a schedule | Changed | `Effect.retry(() => f(), Schedule.exponential("100 millis"))` |
| `Effect.schedule`, `repeatOrElse` | Changed | Programs as functions |
| `Cron.parse`, `Schedule.cron` | Unchanged | `Effect.fromResult(Cron.parse("0 3 * * *", "UTC"))` |
| A cron job's lifetime | Changed | `fork Effect.schedule(() => report(), Schedule.cron(cron))` inside `main` |

#### C9. State management

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Ref` | Unchanged | `const ref = Ref.make(0); Ref.update(ref, (n) => n + 1)` |
| Programs stored as object fields | Changed | `inc = () => Ref.update(this.value, (n) => n + 1)` |
| `SynchronizedRef.updateEffect` | Unchanged | `SynchronizedRef.updateEffect(ref, (xs) => [...xs, load()])` |
| `SubscriptionRef.changes` | Unchanged | A `Stream`: iterate it with `for...of` |
| Transactions (`TxRef`, `Effect.tx`) | Changed | `Effect.tx(() => TxRef.update(ref, (n) => n + 1))` |

#### C10. Caching

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Effect.cached` | Changed | `const get = Effect.cached(() => load())`, then `get()` |
| `cachedWithTTL`, `cachedInvalidateWithTTL` | Changed | Programs as functions; `get()` and `invalidate()` |
| `Cache` | Unchanged | `Cache.make({ capacity: 100, lookup: (id) => fetchUser(id) })` |

#### C11. Batching

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Request.Class`, `TaggedClass` | Unchanged | The same classes |
| `RequestResolver.make`, `fromEffect`, `makeGrouped`, `batchN` | Unchanged | Callbacks are VibeLang functions |
| `Effect.request` | Unchanged | `Effect.request(new GetUser({ id }), resolver)` |
| Batches form under concurrency | Unchanged | Sequential calls never batch, as in Effect |
| `RequestResolver.withCache` | Unchanged | Inside a function or a Layer |
| A resolver that needs a service | Changed | `Layer.effect(Todos, () => { const http = Http(); … })` |

#### C12. Concurrency

| Feature | In VibeLang | Form |
| --- | --- | --- |
| The `concurrency` option | Changed | Programs as functions, the same options |
| Struct and record forms of `Effect.all` | Changed | An object literal's fields convert to programs; a record built elsewhere is spread, `all({ ...jobs })` (D423) |
| A computed array of programs | Changed | `Effect.all([...stores.map(makeSync)])`: a spread in a literal, whose elements convert (D9, D423) |
| `Effect.forEach` with concurrency | Unchanged | The same call |
| `Effect.zip` with `concurrent: true` | Changed | Programs as functions |
| `race`, `raceFirst`, `raceAll` | Changed | Programs as functions; each has its own exit rule (Chapter 7) |
| `forkChild`, `forkDetach`, `forkScoped`, `forkIn` | Changed | Programs as functions |
| Background work owned by a block | Changed | `fork heartbeat()`, owned by the function body, loop iteration, or region around it (D19, D166, D408) |
| `Fiber.join`, `joinAll` | Changed | `join fiber` and `join [a, b]` (D225) |
| `Fiber.await`, `interrupt`, `interruptAll` | Unchanged | The same calls, or `fiber.await()` and `fiber.interrupt()` |
| Interruption isn't an error | Changed | `catch` never sees it; `finally` and `using` always run |
| `uninterruptible`, `uninterruptibleMask`, `interruptibleMask` | Changed | `uninterruptible { … restore { … } }` and `interruptible { … }` blocks, or the prelude functions with a program, Effect's own (D180, D481) |
| `onInterrupt` | Changed | `Effect.onInterrupt(() => task(), () => Console.log("stopped"))` |
| `Effect.forever` | Changed | `while (true) tick()` |
| `Deferred` | Unchanged | `Deferred.make<number>()`, `d.await()` (D227) |
| `Deferred.complete` with a program | Changed | `Deferred.complete(d, () => task())` |
| `Queue` | Unchanged | `Queue.offer(queue, 1)` |
| `PubSub.subscribe` | Changed | `using subscription = PubSub.subscribe(pubsub)` |
| `PubSub.publish` | Unchanged | The same call |
| `Semaphore` | Unchanged | `Semaphore.make(1)`; `mutex.withPermits(1)(() => task())` |
| `Latch` | Unchanged | `latch.open()`: an `Effect` member runs when called |
| What a forked fiber sees | Unchanged | A snapshot of the parent's Context |
| Control operations across fibers | Changed | EK4201 (Chapter 9) |

#### C13. Async interop

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `async` and `await` | Changed | In the TypeScript escapes, a hatch's function, a `module` declaration's body, and a `.ts` file, `async` and `await` keep JavaScript's meaning, a module body's top-level `await` included; in VibeLang code outside them, a call waits, `join` waits for a fiber, `async` is EK1003, and `await` appears only in the await operations (D148, D226, D283) |
| `Effect.promise`, `Effect.tryPromise` | Changed | `sync(async (signal) => …)` and `try(async (signal) => …)`; the `AbortSignal`, after any inputs, cancels on interruption (D148, D230) |
| `Effect.callback` | Changed | The `callback` hatch; `resume(value)`; `suspend` for resources (D43, D148) |
| `Effect.runPromise` from Promise code | Changed | `runPromise`, from TypeScript, a top-level callback, or a hatch's body (D38, D148) |
| Async iterables and event emitters | Unchanged | `Stream.fromAsyncIterable`, `Stream.fromEventListener` |
| Synchronous code that throws | Changed | An exception from TypeScript code is a defect; use `try(…)` for a typed Effect failure (D282) |
| Effect 3 libraries | Changed | Foreign code: `try(async (p, signal) => Effect3.runPromise(p, { signal }), (error) => …, p)` (D439) |

#### C14. Streams

| Feature | In VibeLang | Form |
| --- | --- | --- |
| A sequence produced by code that waits between values | Changed | A `function*` producer and `for...of` (Chapter 8) |
| Streams from data (`make`, `range`, `fromIterable`, `tick`) | Unchanged | `Stream.range(1, 10)` |
| `fromEffect`, `fromEffectRepeat` | Changed | Programs as functions |
| `unfold`, `paginate` | Unchanged | VibeLang callbacks |
| `Stream.callback`, `fromQueue`, `fromPubSub`, `fromEventListener` | Unchanged | The same calls; inner JavaScript callbacks can't pause (EK4301) |
| Operators (`map`, `filter`, `mapEffect`, `merge`, `buffer`, `debounce`, `groupedWithin`) | Unchanged | The same calls; a producer is a `Stream` (D402) |
| `runCollect`, `runForEach`, `runFold`, `runDrain`, `run` | Unchanged | Calls that run the stream |
| `Stream.toPull` | Changed | `for...of` over a `Stream` (D26) |
| `Stream.catch`, `retry`, `timeout` | Unchanged | The same calls; `try`/`catch` applies to the call that runs a stream |
| `Stream.scoped` | Unchanged | `Stream.scoped(stream)`: it takes a Stream |
| `Stream.ensuring` | Changed | `Stream.ensuring(stream, () => cleanup())`: the finalizer is a program |
| `Stream.partition`, `broadcastN` | Changed | `using`, because they need a Scope |
| Producers and streams together | Changed | A producer is a `Stream` value: `for...of` runs it on the loop's fiber, and any other consumer through the adapter (D402) |
| `Stream.toAsyncIterable` | Unchanged | From TypeScript, with `for await` |

#### C15. Sinks

| Feature | In VibeLang | Form |
| --- | --- | --- |
| Sinks (`sum`, `count`, `collect`, `head`, `drain`) | Unchanged | `Stream.run(stream, Sink.sum)` |
| `Sink.fold`, `foldUntil`, `forEach` | Unchanged | VibeLang callbacks; a literal at a plain parameter is a plain function (D500) |
| A producer into a sink | Changed | The producer is a `Stream`: `Stream.run(lines(path), sink)` (D402) |

#### C16. Testing

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `it.effect` | Changed | `it.effect("name") { … }`, a block passed as the last argument (D376) |
| `it.live`, `.each`, `.prop`, `it.flakyTest` | Unchanged | The same calls |
| `layer(AppLive)("suite", (it) => …)` | Unchanged | The same call |
| Fake services | Changed | Object literals in `Layer.succeed` |
| An override for one region | Changed | `Effect.provideService(() => program(), Mailer, quiet)` |
| Scripted answers to requests | Changed | `handle` (Chapter 9) |
| `TestClock` | Unchanged | `TestClock.adjust("1 minute")` |
| `TestConsole`, `TestCrypto` | Unchanged | `TestConsole.logLines()` |
| Asserting on an `Exit` | Unchanged | `Exit.succeed(1)` is data (D24) |
| Promise-style tests | Changed | Stay in `.ts`, or move to `it.effect` (D38) |
| Property tests | Unchanged | `it.effect.prop`, `Arbitrary.checkEffect` |

#### C17. Code style

| Feature | In VibeLang | Form |
| --- | --- | --- |
| Run once, at the edge | Changed | An exported `main` in the file that names its platform (D312) |
| Avoid tacit calls | Unchanged | The same advice |
| Dual APIs | Changed | Data-first with a program written `() =>`; a block after a dual is a type error whose note gives that form (D376) |
| Branded types | Unchanged | A failed check throws a defect; `Int.result(n)` for a typed error |
| Pattern matching with pure handlers (`Match`) | Unchanged | The same module |
| Pattern matching with effectful branches | Changed | `match`, whose arms can call Effect functions (Chapter 3), `switch`, or `if`; effectful `Match` handlers are EK4301 (D9) |
| Do notation (`Effect.Do`, `bind`, `let`) | Changed | Statements |
| Control flow operators (`Effect.when`, `whileLoop`) | Changed | `if` and `while` |

#### C18. Data types

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Option` | Unchanged | Plain data; `Option.gen` stays in `.ts` |
| An `Option` to a typed failure | Changed | `Effect.fromOption(found)`, or `throw` |
| `Result` (Effect 3's `Either`) | Unchanged | Plain data |
| `Effect.result`, `Effect.exit` | Changed | Programs as functions |
| `Effect.fromResult` | Unchanged | The same call |
| `Exit` constructors and readers | Unchanged | Data (D24); `Exit.match` |
| `Cause` | Unchanged | `Effect.catchCause(() => f(), (cause) => …)` |
| `Data.Class`, `TaggedClass`, `taggedEnum` | Unchanged | The same functions |
| Error classes | Changed | `error E { ... }` declarations; `throw` |
| `new` of a class whose instances are Effects | Changed | `new` constructs and never runs (D24) |
| `Chunk`, `HashSet`, `HashMap`, `Duration`, `BigDecimal`, `Redacted` | Unchanged | The same modules |
| `DateTime` | Unchanged | `DateTime.now()`; `new Date()` is EK4403 |
| A time zone for a region | Changed | Programs as functions |

#### C19. Traits and behaviours

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Equal`, `Hash` | Unchanged | The same functions; `===` keeps its JavaScript meaning. A class implements `[Equal.symbol]` and `[Hash.symbol]` with plain methods (D55, Chapter 15) |
| `Equivalence`, `Order` | Unchanged | The same modules |

#### C20. Schema

| Feature | In VibeLang | Form |
| --- | --- | --- |
| Defining schemas | Unchanged | Values, built at the top level |
| `decodeUnknownEffect`, `decodeEffect`, `encodeEffect` | Unchanged | Calls that run; `SchemaError` joins E |
| `decodeUnknownSync`, `is`, `asserts` | Unchanged | Trusted; their exceptions are defects (D37) |
| `decodeUnknownExit` | Unchanged | An `Exit` value (D24) |
| Filters and transformations | Unchanged | The same functions |
| `transformEffect`, `checkEffect` | Unchanged | VibeLang callbacks |
| Defaults given as Effects (`withConstructorDefault`) | Changed | A program: `Schema.withConstructorDefault(() => Clock.currentTimeMillis())` |
| `Schema.Class`, `TaggedClass` | Unchanged | The same classes |
| `Schema.TaggedError` | Changed | `throw new HttpError({ status: 500 })` |
| `make`, `makeEffect` | Unchanged | `make` throws defects; `makeEffect` runs |
| Annotations, formatters, JSON Schema, Arbitrary, compilers | Unchanged | The same functions |
| `Config.schema` | Unchanged | Data (D24) |

#### C21. Platform

| Feature | In VibeLang | Form |
| --- | --- | --- |
| Node.js and browser APIs | Changed | Not callable from `.vibe` (EK4402); Chapter 11 names each replacement |
| Platform layers (`NodeServices.layer`) | Changed | The platform import provides its bundle to `main` (D312); elsewhere `Effect.provide(() => program(), NodeServices.layer)` |
| `FileSystem` | Unchanged | `FileSystem.readFileString(path)`, from `effect/FileSystem` |
| `FileSystem.open` (a scoped `File`) | Changed | `using file = FileSystem.open(path)` |
| `FileSystem.layerNoop` | Changed | Its methods return values, not Effects |
| `Path` | Unchanged | `Path.join(a, b)`; `Path` joins R (D41) |
| `Terminal`, `Stdio` | Unchanged | `Terminal.readLine()` |
| Child processes | Unchanged | `ChildProcessSpawner.string(ChildProcess.make("git", ["status"]))`; the command is data (D24) |
| `KeyValueStore` | Unchanged | From `effect/persistence` |
| Sockets | Changed | `using` for a scoped reader |
| Workers | Unchanged | VibeLang handlers |

#### C22. HTTP

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `HttpClient` | Unchanged | `HttpClient.get(url)` runs |
| Response bodies | Unchanged | `response.json()` |
| Client middleware | Unchanged | `.pipe` over a client value |
| `HttpRouter.add` handlers | Unchanged | A handler function, never converted to a program (D324) |
| Serving | Changed | `export function main() { Layer.launch(HttpRouter.serve(routes)) }` in the file that names its platform (D312) |
| `HttpApi` definitions, middleware, security | Unchanged | Values |
| `HttpApi` handlers | Unchanged | VibeLang functions |
| `HttpApiClient` | Unchanged | Calls that run |

#### C23. SQL

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `SqlClient` | Unchanged | `const sql = SqlClient.SqlClient()` |
| `` sql`…` `` statements | Unchanged | Data until called (D24): `` sql`SELECT * FROM users`() `` runs it, and `.stream` stays reachable |
| Fragments (`sql.in`, `sql.insert`, `sql.and`) | Unchanged | The same calls |
| `sql.withTransaction` | Changed | `sql.withTransaction(() => insertAll())` |
| `SqlSchema`, `SqlResolver`, `SqlModel`, migrations | Unchanged | The same modules |
| Driver layers read from config | Unchanged | `Config` arguments are data (D24) |

#### C24. CLI

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Command.make`, `withSubcommands`, `withHandler` | Unchanged | Data (D24), declared at the top level |
| Flags and arguments | Unchanged | Values |
| Prompts | Unchanged | Data until called |
| Running a command | Changed | Inside `main`, handed to a runner |

#### C25. AI

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `LanguageModel.generateText`, `generateObject` | Unchanged | Calls that run |
| `LanguageModel.streamText` | Unchanged | A `Stream` |
| `Tool.make`, `Toolkit.make` | Unchanged | Data (D24) |
| Tool handlers | Changed | `toolkit.toLayer(() => ({ search: ({ q }) => runSearch(q) }))` |
| `Chat` | Unchanged | `Chat.empty()` |
| `Effect.withExecutionPlan` | Changed | `Effect.withExecutionPlan(() => program(), plan)` |
| `AiError` reasons | Changed | Narrow `e.reason._tag` in `catch` |
| Provider layers read from config | Unchanged | `Config` arguments are data (D24) |

#### C26. Cluster, workflow, and RPC

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Rpc.make`, `RpcGroup.make` | Unchanged | Values |
| `group.toLayer(handlers)` | Unchanged | An object of VibeLang handlers (D324) |
| RPC clients and servers | Changed | `using client = RpcClient.make(UserRpcs)` |
| Entities | Unchanged | `Counter.client()` |
| Workflows | Unchanged | Bodies are VibeLang functions (D42) |
| Activities | Unchanged | Data until called (D24) |
| `DurableClock.sleep`, `DurableDeferred.await` | Unchanged | Calls that run |
| Replay | Unchanged | Each execution is a fresh program run; held continuations end with it (D42) |

#### C27. Effect 3 features that Effect 4 removed

| Feature | In VibeLang | Form |
| --- | --- | --- |
| `Micro` | Unchanged | Effect 4 has none; Effect 3 code is foreign code (Chapter 10) |
| `Supervisor` | Unchanged | `FiberSet` and `fork` |
| STM | Unchanged | `Effect.tx` with `TxRef` |
| `FiberRef`, `Effect.locally` | Changed | `Effect.provideService(() => program(), References.CurrentLogLevel, "Debug")` |
| `Either` | Unchanged | `Result` |
| `Mailbox` | Unchanged | `Queue` |
| `Runtime<R>` | Changed | `ManagedRuntime`, or `run*With` under D38 |
| `Effect.Service`, `Effect.Tag` accessors | Changed | Abstract service classes, called as `Users.find(id)` |
| `withConcurrency`, `withClock`, `withRandom` | Unchanged | Per-call options and `References` |
