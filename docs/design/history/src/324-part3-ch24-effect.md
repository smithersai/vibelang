### 24. What Effect provides and what the kernel adds

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

The kernel is a TypeScript library over `effect@4.0.6`. This is kernel test T3, written directly against it: a handler that returns without resuming, and the cleanup that follows.

```ts ts
const Ask = operation<void, number>("Ask")

const body = Effect.scoped(Effect.gen(function* () {
  yield* Effect.acquireRelease(note("acquire"), () => note("release"))
  yield* Effect.addFinalizer((exit) => note(`finalizer sees interrupt=${Exit.hasInterrupts(exit)}`))
  const n = yield* Ask(undefined)                  // captures up to the handle below
  yield* note(`never reached ${n}`)
  return n
}))

const result = yield* handle("h", [Ask], body, {
  Ask: () => Effect.as(note("clause returns without resuming"), -100)
})
```

```text
acquire
clause returns without resuming
finalizer sees interrupt=true
release
handle returned -100
```

Everything in that test except `operation`, `handle`, and the capture is ordinary Effect: `Effect.scoped`, `acquireRelease`, `addFinalizer`, the fiber, and the finalizers that run during abandonment.

#### Provided by Effect 4, unchanged

| Machine requirement | Effect 4.0.5 mechanism | Evidence |
| --- | --- | --- |
| A reified, heap-allocated continuation | `fiber._stack: Array<Primitive>`; `runLoop` is a trampoline | `internal/effect.ts:516, 625-679` [Effect]; 100,001 frames captured and resumed (T6a) |
| One-shot capture at the root | `Effect.callback`: the first resume wins, later ones are ignored | `internal/effect.ts:1141-1190`; F5 [Effect] |
| Resumption | `fiber.evaluate(effect)` runs the fiber synchronously on the resumer's JS stack | `internal/effect.ts:1155-1164, 583-599`; F6 [Effect] |
| Finalization | `OnExit` frames run masked; Scopes close finalizers in reverse order, sequentially by default | `internal/effect.ts:4173-4214, 3982-4003` [Effect] |
| Cause-aware recovery | `Effect.catchCause` sees every reason of a cause | `internal/effect.ts:2646-2685` [Effect]; the runtime's `catchExpected` is built on it (K14) |
| Dynamic binding | `fiber.context` plus restore frames; services keyed by string | `internal/effect.ts:2186-2211`; `Context.ts:609` [Effect] |
| Interruption | Masks, delivery points, recovery handlers skipped while interrupting | `internal/effect.ts:558-579, 4557-4653`; `internal/core.ts:600-631` [Effect] |
| Interruptible acquisition | `acquireRelease(acquire, release, { interruptible: true })` runs the acquire under `restore` and still registers the release under the mask; inside an enclosing mask, `uninterruptibleMask`'s `restore` is the identity, so the acquire stays masked | `Effect.ts:13366-13370`; `internal/effect.ts:4143-4159`, `internal/effect.ts:4670-4682`; K15a-K15c [Effect] |
| Structured concurrency | `forkChild` children are interrupted and awaited before the parent's exit is published; `forkIn` and `forkScoped` tie a fiber to a Scope | `internal/effect.ts:600-606, 5491-5673`; F8 [Effect] |
| Fork snapshots Context | A child starts with the parent's Context object; nothing merges back | `internal/effect.ts:5536`; F7 [Effect] |
| Fairness | `shouldYield` after `MaxOpsBeforeYield` = 2048 ops; per-fiber dispatchers batch into one `setImmediate` | `Scheduler.ts:198-200, 294-297, 231-257` [Effect] |
| Layer sharing and ownership | `MemoMap` keyed by Layer object identity; each `Effect.provide` owns one Scope | `Layer.ts:418-466`; `internal/layer.ts:8-22` [Effect] |
| `AsyncLocalStorage` across root waits | Fiber re-enters through a captured `AsyncResource` (effect#8629) | `internal/effect.ts:586-598` [Effect] |

#### Missing, supplied by the kernel

| Requirement | Why Effect cannot express it today | Kernel mechanism | Evidence |
| --- | --- | --- | --- |
| A delimiter inside a fiber | The only delimiter is the root; nothing captures part of `_stack` (`internal/effect.ts:516, 680-701`) | `PromptFrame` pushed from `Effect.withFiber` | T1, T9 |
| Partial capture and resume | No API splices `_stack` | `capture` splices the segment above the prompt; `resume` reinstalls a prompt plus the segment and restores Γ, ι | T1, T13, T6a |
| Tail resume from a compiled clause | A generator clause's frame sits above the owner until the resumed computation returns | `ClauseFrame` performs a `tailResume` request the clause returns, after the clause's frames are gone | K11a-K11d |
| Abandonment with finalization | A dropped segment skips its `OnExit` frames | `abandon` re-pushes the segment over a collector and unwinds it with a sticky interruption that joins, never replaces, real pending interruptions, travels with any capture made during the unwinding, and reports every cleanup reason | T3, T4, kernel-edges, A01-A04, I03, I10, I11, K12a-K12e |
| Ownership | Nothing owns a detached segment | `OwnerFrame` under each clause; `transfer` to the Scope region around the handler, with an owner token; `FiberExitFrame` releases transfers when the capturing fiber exits | T3, T10, T14, O01-O08, K13a-K13e |
| Recovery that respects abandonment | `Effect.catch` would recover a failure raised while a control operation abandons a continuation | `catchExpected` applies `Effect.catch`'s rule (D306) but passes an abandonment through untouched, and re-fails a cause with a `Die` with its failures as defects (D305) | K14a-K14d, K16d |
| Double-resume detection | `Effect.callback` silently ignores later resumes | `ContinuationAlreadyConsumed` defect at the caller | T2 |
| Reporting a lost race to the producer | The late resume returns nothing | `suspend`'s resumer returns `false`; `handoff` releases late values after producer quiescence | T5a, T5b, H1-H4 |
| Bounded wake-up depth | No depth guard on synchronous wake-ups | `suspend` delivers inline under a budget of 64 nested wake-ups, then schedules | F10a, K10a, K10b |

#### Effect 4.0.5 hazards the language designs around

| Hazard | Evidence | Consequence for VibeLang |
| --- | --- | --- |
| `Effect.gen`, `Effect.fn`, `fnUntraced`, and `fnUntracedEager` never call the generator's `throw()` or `return()`. JavaScript `catch`, `finally`, and `using` inside the body do not run on failure or interruption. | F1-F4 [Effect]; research §8. Effect's language service exempts `try/finally` in `Effect.gen` as "valid cleanup" (language-service#442), which the runtime contradicts. | Source `catch`, `finally`, and `using` compile to Effect frames, never to JavaScript `try`, in any function that can pause (Chapter 26). Native loops and array destructuring that can suspend use an Effect-owned generator finalizer to preserve IteratorClose (Chapter 26). |
| `Effect.catch` recovered a cause that held both a `Fail` and a `Die`, and dropped the `Die`. Effect 4.0.6 fixed it: such a cause holds only defects, and typed recovery skips it (Effect-TS/effect#9433, #9516). | Runtime boundary regression; F11a, F11b | Source `catch` compiles to `catchExpected` (D13, K14), which follows 4.0.6's rule on defects (D305). |
| `Effect.acquireRelease` masks its acquire by default, so a wait inside it cannot be cancelled, unless the acquire's own code enters `Effect.interruptible` or `Effect.interruptibleMask`, which set the fiber interruptible under any mask. | The runtime boundary regression, K15a [Effect] | Resources that wait on the outside world pass `{ interruptible: true }`; `using` adds no mask, so it keeps each acquisition's choice and lets cancellation reach any other pause in its initializer, as `yield*` does (D25, D490). |
| Synchronous wake-ups have no depth guard. A chain of `Deferred`, `PubSub`, fiber-exit, or `Effect.callback` wake-ups overflows: one fiber dies with `RangeError`, and every fiber after it waits forever with no error surfaced. | `F10a` [Effect] now exhausts a tracer budget of `64` evaluations, with native headroom for recovery. `scripts/wakeup-chain-depth.ts` breaks on Node 26.10 after about 940 to 1,260 hops, and on Bun 1.4.1 after about 4,100; the research run saw 815 on Node and a Bun livelock at 98% CPU. A regression: effect 3.22.3 completes the same chain at 100,000 hops on both hosts (F10b). | The kernel bounds its own wake-ups (K10a). Effect's own `Deferred` and `PubSub` need an upstream fix (G5). |
| A generator that yields completed Exits bypasses the op budget. | Research §2: 200,000 yields of `Effect.void` before another fiber ran. | The compiler never emits a yield of a known-completed effect inside a loop. |
| Hidden forks: `timeout`, `race`, `raceFirst`, concurrent `all`/`forEach`, `zip` with `concurrent: true`, parallel Scope finalizers, and `Layer.merge` run their arguments on other fibers. | T7b and the fiber-behavior probes [Kernel]; research §4. | Control operations cannot cross these combinators (EK4201), and TypeScript functions with a control operation in R are rejected (EK4202). |
| A service's runtime identity is its key string; two services with the same string alias silently. | `Context.ts:609`; research §5. | The compiler generates key strings from package and module path and rejects duplicates program-wide (Chapter 4). |
| `Effect.ensuring` requires a cleanup whose E is `never`; `Effect.onExit` lets the cleanup fail. | `Effect.ts` (`ensuring`, `onExit` signatures) | `finally` lowers to `Effect.onExit` (D46), so a failing cleanup is reported, never rejected by the types. |
| JavaScript's `finally` replaces a pending exception with the finalizer's, and ECMAScript's `IteratorClose` drops an exception from `return()` while another is pending; `Effect.onExit` combines the two causes instead. | ECMA-262 `TryStatement` and `IteratorClose`; `effect@4.0.6` `internal/effect.ts:4012-4019` (`combineFinalizerCause`) [Effect] | Plain lowerings of `finally` and iterator close combine failures as frames do (D340, D356, Chapter 17). |
| Interrupting fibers one at a time, waiting for each one's cleanup before the next, deadlocks when one sibling's cleanup waits for another's. `Fiber.interruptAll` signals every fiber first. | `effect@4.0.6` `internal/effect.ts:964-975` [Effect]; the concurrency audit's race probes | `join`, the `await` operations, and `for concurrent` signal every fiber they stop, then wait (D354); a block's exit keeps Effect's Scope order. |
| `Effect.acquireRelease` of a `Disposable`, bound with a `using` that also disposes its value, releases it twice. | The `using` disposal probes; ECMAScript and Effect each release once | One owner per `using`: an acquisition records the value whose release it registered, and `using` disposes only a value nothing recorded (D342, D401). A `Scope` requirement proves no registration: `Effect.scoped(Effect.succeed(disposable))` registers nothing. |
| Effect's `Context.Service` class form makes the class's instance type the service identifier. | `prototype/esc/scratch/probe2.ts` | Services compile to Effect's own class, whose instance type, the identifier, carries the key as a literal type, so no structural type or other service stands for one; `implements S` in a `.vibe` file checks the shape, `S.Shape` (D501). |
| Structurally identical abstract classes are one TypeScript type. | `experiments/tests/service-identity/probe.ts`: providing one of two same-shaped classes leaves R empty, and the program dies with `Service not found` | Service classes are nominal (Chapter 4). |
| Frames are closures over the fiber that pushed them. | `internal/effect.ts:2200-2208`; T14b [Kernel]. | Every continuation consumption is fiber-affine (Chapter 21). |
| `fnUntracedEager` runs the body when the function is called. | Research §8. | Never emitted: it breaks the rule that constructing a program runs nothing. |
| `Effect.fn` costs 1.1 µs (Bun) to 2.0 µs (Node) per call; `fnUntraced` costs about 0.1 µs. | Research §12. | Compiled functions use untraced frames; spans are opt-in (`tracing`, Chapter 28). |
| Sibling `Effect.provide` calls do not share Layer builds unless something gives them a common `MemoMap`: an enclosing provide, a `ManagedRuntime`, or an explicitly supplied `Layer.CurrentMemoMap`. The rc.118 migration note says sharing is the default. | Research §6; conformance test D05. | Each `Effect.provide` builds its layers once; provide the application layer once at `main`, or run entry points through a `ManagedRuntime` (D21, Chapter 4). |
| Two providers for one service in a `Layer.merge`: the later one wins, with no warning. | A3 probe [Effect]. | Ambiguity is a compile-time error in `wire` (EK3202, Chapter 4). |
| A Layer cycle through `Layer.suspend` hangs on its own in-progress build. | Research §6. | `wire` detects provider cycles statically (EK3203, Chapter 4). |
| Effect 3 values die in the Effect 4 runtime and vice versa. | Research §10. | Target Effect 4 only. Effect 3 code is foreign code behind a boundary (Chapter 10). |

The [upstream draft index](../../upstream/README.md) collects reproductions and proposed fixes for wake-up depth, generator cleanup and tooling, mixed-cause recovery, fairness, Layer memoization documentation, and interruption diagnostics, plus supported-prompt and segmented-stack proposals. Every entry is drafted, not filed (D59). Kernel review defects are tracked separately in `experiments/KERNEL-CHANGES.md`.

#### Scheduling, stack safety, and cancellation

**Scheduling** [Effect] [Rule]. A fiber runs until it parks, completes, or reaches 2048 run-loop steps, then yields through its dispatcher. Woken fibers run on the waker's JS stack (`Deferred`, `PubSub`, fiber exit, `Effect.callback`) or through a dispatcher task (`Queue.offer`, `Latch.open`, `Semaphore.release`). VibeLang does not promise whether a woken fiber runs before or after the waker's next step; programs that need an order must synchronize explicitly. Fairness is promised only at run-loop steps. A plain JavaScript region is atomic, exactly as an `Effect.sync` body is.

Kotlin's coroutine design forbids a suspending function to resume its continuation in its own stack frame, since that may overflow the stack (KEEP-0164), but `kotlinx.coroutines`' unconfined dispatcher does resume a woken coroutine inline on the waker's thread, through an event loop that queues nested resumptions so the stack stays bounded, while its other dispatchers schedule the resumption (`kotlinx.coroutines` 1.10.2, `Unconfined.kt` and `DispatchedContinuation.kt`). Swift enqueues a task resumed after a real suspension, and it deferred an API that would resume inline, since that takes over "the current thread from the caller for a potentially unbounded amount of time" (SE-0300; `continuation-prior-art.md` rule 12). The kernel keeps Effect's synchronous fast path and bounds its depth (K10a), as Kotlin's unconfined event loop does. Both choices satisfy the rule above, and VibeLang keeps the bounded fast path: always scheduling would add one dispatcher hop to every wake-up, and Effect's own wake-ups already run inline. A measurement showing that waker-blocking time matters in real programs would change this default, not the rule.

**Stack safety** [Effect] [Kernel] [Rule]. Heap frames make recursion depth a heap question: T6a nests 100,001 compiled calls and captures all of them in one operation. Direct JavaScript recursion is bounded by the host: about 10,150 frames on Node 26.10 and about 39,900 on Bun 1.4.1 for a one-line recursive function (F9). A plain function on a cycle of plain calls starts eagerly on a bounded JavaScript stack and continues on heap frames, as its `Effect.gen` equivalent does. So does one with a plain return annotation, which recurses as the unannotated one does (D412). Recursion through a synchronous foreign callback, such as one `Array.prototype.forEach` calls, keeps the host stack limit, annotated or not, and a very large native frame can still overflow (Chapter 15). Capture and resume copy the frames between the perform site and the prompt; the cost is linear in that distance (Chapter 25). Cross-fiber wake-ups are stack-safe only when bounded (K10a); Effect's own are not (F10a).

**Cancellation** [Effect] [Kernel]. Interruption is Effect's: a request is recorded, delivered at once to a parked fiber and at the next step to a running one, deferred by masks, and unwinds with recovery handlers skipped. The kernel adds three things. A held continuation is abandoned through its owner as part of the same unwinding (T4). Abandonment re-raises if a masked handler swallows it (kernel-edges). And a pending interruption is reported beside every cleanup failure, never instead of one (K12a).

#### Division of labor

| Concern | Effect 4, unchanged | Kernel (runtime extension) | Compiler |
| --- | --- | --- | --- |
| Frames, trampolining, fairness | Run loop, `_stack`, op budget | | Emits frames that satisfy the frame invariant (Chapter 26); never yields known Exits in loops |
| Root suspension | `Effect.callback` | `suspend`: reports lost races, bounds wake-up depth, releases deferred values | Lowers adapters (Chapter 10) |
| Partial capture | | `Prompt`, `Owner`, `Clause`, capture, `resume`, `tailResume`, `resumeWith`, `abandon`, `transfer` | Lowers `handle`, operation calls, and tail resumes; checks second-class continuations (Chapter 9) |
| Finalization | `OnExit`, Scopes | Abandonment by sticky interruption; fiber-exit release of transfers | Lowers `finally` and `using` to frames (Chapter 26), or on the plain path to the runtime's combining forms (Chapter 17) |
| Context and DI | `updateContext`, Context keys, Layers, `MemoMap` | Prompt evidence entries | Service keys and accessors, contract checks (EK3101), `wire` graphs (EK3201-EK3204) |
| Interruption | Masks, delivery, skip loop | Owner abandonment during unwinding | Nothing beyond masks in source |
| Fork | `forkChild`, `forkIn`, Context snapshot | Prompts do not cross (`HandlerNotOnThisFiber`) | Block regions for `fork`; fiber-behavior table; EK4201, EK4202 |
| Typed failures | `Fail` causes, `catchCause` | `catchExpected` | `throw` → fail; `catch` → `catchExpected`; contracts (EK2001, EK2002) |
| Plain JavaScript calls | | | Control classes; `$direct` variants (Chapter 15) |
| Producers | | `Yield` as a control operation; `transfer`; the `Stream` adapter | `function*` and `for...of` lowering (Chapter 26) |
