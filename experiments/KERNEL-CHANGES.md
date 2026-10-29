# Kernel changes, 2026-10-16

This change fixes the five kernel defects found in the 2026-10-16 reviews. Each fix has regression tests in `tests/kernel-regressions.test.ts`. `bun test` now passes 148 of 148 tests: the original 128 plus 20 new ones.

| # | Defect | Law now guaranteed | Tests | Kernel change |
| --- | --- | --- | --- | --- |
| 1 | A tail `resume` from a generator clause leaks the clause's frames (Codex R10, Fable 1) | A clause that returns `tailResume(k, v)` iterates in constant stack | K11a-K11d | `TailResume`, `tailResume`, `tailResumeWith`; `ClauseFrame` |
| 2 | Explicit `abandon` drops a cleanup defect while an interruption is pending (Codex R2b) | Abandonment reports every cleanup reason plus every real pending interruption; only its own sentinel is removed | K12a-K12e | `AbandonCollector.finish` |
| 3 | `transfer` into an inherited Scope strands the continuation after the child exits (Codex R5) | A transferred continuation never outlives its capturing fiber; transfer into a parallel Scope is a defect | K13a-K13e | `FiberExitFrame`, `TransferIntoParallelScope` |
| 4 | `Effect.catch` recovers a cause that also holds a defect (Codex R1) | Source `catch` recovers only causes made entirely of expected failures | K14a-K14c | `catchExpected` |
| 5 | The Chapter 6 adapter cannot be cancelled under masked acquisition (Codex R3, Fable 2) | Interruptible acquisition cancels the wait and releases late values; masked acquisition waits | K15a-K15c | None; tests only |
| 6 | On Effect 4.1.0, the kernel's own cause handling keeps a typed failure beside a defect that Effect would make a defect (2026-10-25, D305) | Where the kernel combines or recovers causes, a `Fail` beside a `Die` becomes a `Die`, as in Effect | K14b, K16a-K16d | `electDefects`; `afterAbandon`; `catchExpected` |
| 7 | Source `catch` refuses a failure beside an interruption, which `Effect.catch` recovers (2026-10-25, D306) | Source `catch` follows `Effect.catch`; only an abandonment passes through | K14c, K14d | `catchExpected` |

Existing exports keep their signatures. The new exports are `TailResume`, `tailResume`, `tailResumeWith`, `catchExpected`, and `TransferIntoParallelScope`.

## 1. Tail resume from a compiled clause

**Defect.** `resume` dropped the clause's `Owner(k)` frame only when it was the top frame. In a generator clause, `return yield* resume(k, v)` runs with the clause's `Iterator` frame above `Owner(k)`. That frame stays until the resumed computation returns, so a producer grew the stack by two frames per element: 200,003 frames for 100,000 elements.

No kernel check can remove that `Iterator` frame. The generator is suspended inside `yield*`, and it returns only after the resumed computation finishes. The clause has to finish before the resume runs.

**Change.**

- `tailResume(k, v)` and `tailResumeWith(k, effect)` return a `TailResume` request: a plain value, not an Effect.
- `capture` pushes a `ClauseFrame(k)` directly above `Owner(k)`. When a clause returns a `TailResume`, the `ClauseFrame` performs the resume. By then the clause's frames are gone, generator frames included.
- `resumeWith` drops `Owner(k)` when it is on top (the `tailResume` path). It also drops `[Owner(k), ClauseFrame(k)]` when the clause returned the resume effect itself (the existing `flatMap` shape, T17).

**Law.** A clause that returns `tailResume(k, v)` keeps the stack constant however many elements a producer yields. At N = 100,000 the deepest stack measured 3 frames (K11a), and 5 with a per-element `using` and `finally` (K11b). Both tests assert under 20.

**Lowering the compiler must emit.** Inside a clause, write `return tailResume(k, v)` or `return tailResumeWith(k, program)`. Never write `yield* tailResume(...)`: the request is not an Effect, so yielding it is a defect (K11c).

```ts
// for (const line of lines(path)) {
//   if (line.startsWith("ERROR")) found.push(line)
//   if (found.length === 3) break
// }
yield* handle("for-of", [Yield], producer, {
  Yield: Effect.fnUntraced(function* (line: string, k: Continuation) {
    if (line.startsWith("ERROR")) found.push(line)
    if (found.length === 3) return             // break: Owner(k) abandons the producer
    return tailResume(k, undefined)            // RETURN the request; never yield* it
  })
})
```

When the loop body has `using`, `try`, or `finally`, its regions return completion records. The clause dispatches on the record and resumes after every region has closed (K11b):

```ts
Yield: Effect.fnUntraced(function* (n: number, k: Continuation) {
  const completion = yield* Effect.scoped(Effect.fnUntraced(function* () {  // body block with `using`
    const lease = yield* Leases.acquire(n)
    return yield* Effect.ensuring(                                           // try/finally region
      Effect.fnUntraced(function* () {
        if (n === limit) return { kind: "break" } as const
        sum += n
        return { kind: "normal" } as const
      })(),
      finallyRegion
    )
  })())
  if (completion.kind === "break") return
  return tailResume(k, undefined)
})
```

**Tail position (v0 rule).** A `return resume(k, v)` or `return resumeWith(k, p)` is in tail position only when no region of the clause encloses that `return`. A region is a `try` block, a `catch` block, a `finally` block, or a block that declares `using`. Inside a region, emit `yield* resume(...)`. The region's cleanup must run after the resumed computation, and the stack then grows by design (K11d shows the order: bodies 0, 1, 2, then finallies 2, 1, 0). The kernel cannot detect a misplaced request.

**Cost.** Every clause invocation now holds one more frame. A non-tail resume holds three frames per pending element instead of two (R10: 302 frames at N = 100, 3,002 at N = 1,000). `bun bench/perform.ts` measured capture plus resume at 257 ns/op with 0 frames, against 247 ns recorded in the design document. The machine was loaded at the time: the plain-service control was 32% slower than its recorded figure.

## 2. Abandonment keeps cleanup failures beside real interruptions

**Defect.** In `AbandonCollector.finish`, an abandoner that was interruptible with a real interruption pending failed with the pending interruption alone. Any defect from the segment's cleanup was discarded. Only explicit `abandon`/`abandonNow` from an interruptible region reached that branch. Owner frames mask before they abandon, and `Scope.close` masks its finalizers (`internal/effect.ts:3940-3944`).

**Change.** That branch now fails with the unwinding's cause, minus this abandonment's sentinel, plus every pending interrupt it does not already carry. Effect's skip loop has usually copied them in already, as the same reason objects.

**Law.** An abandonment reports every reason its cleanup produced and every real pending interruption. It removes only its own sentinel abort, and no negative fiber id reaches a caller. Covered paths:

| Path | Test | Failed before the fix |
| --- | --- | --- |
| Explicit `abandon` from an interruptible clause | K12a | Yes |
| Explicit `abandonNow` from an interruptible clause (the call fails at once; the clause does not continue) | K12b | Yes |
| Owner exit: the clause returns without resuming | K12c | No; regression guard |
| Scope exit: `Effect.scoped` closes over a transferred continuation | K12d | No; regression guard |
| Scope exit: `Scope.close` from an interruptible region | K12e | No; regression guard |
| Fiber exit (section 3) | K13d | New path |

## 3. A transferred continuation never outlives its capturing fiber

**Defect.** A child fiber transferred `k` into a Scope inherited from its parent, then exited. When the parent closed that Scope, it got `ContinuationWrongFiber`, `k` stayed suspended, and the finalizer never ran. Every consumption is fiber-affine, so once the capturing fiber exits, nothing can resume or abandon `k`.

**Change.**

- The first `transfer` on a fiber inserts a `FiberExitFrame` at the bottom of that fiber's stack. It holds the fiber's transferred continuations; `resume` and `abandon` remove them.
- When the fiber's computation ends by success, failure, or interruption, the frame masks interruption as `Owner` does. It then abandons every continuation still suspended, newest first, before the fiber's Exit is published. Cleanup failures join that Exit.
- `transfer` into a Scope whose finalizer strategy is `"parallel"` is a defect, `TransferIntoParallelScope`. Effect runs each parallel finalizer on a forked fiber (`scopeCloseFinalizers`), so that Scope could never abandon `k`.

**Law.** The capturing fiber's exit is an unconditional second owner. The Scope consumes `k` if it closes on the capturing fiber first; otherwise `k` is abandoned on the capturing fiber before that fiber's Exit is visible.

| Case | Test |
| --- | --- |
| A child transfers into its inherited parent Scope and exits. The release runs on the child before `Fiber.join` returns, the parent's Scope close is clean, and a late `resume` is `ContinuationAlreadyConsumed`. | K13a |
| The capturing fiber exits while a Scope it transferred into stays open (`Scope.make` never closed) | K13b |
| The capturer is interrupted after a cross-fiber close of its Scope failed: the release still runs, on the capturer | K13c |
| A cleanup defect during exit-time abandonment fails the capturing fiber | K13d |
| Transfer into `Scope.make("parallel")` is rejected; the clause's owner abandons `k` | K13e |

**Still open (G3).** Closing the owning Scope from another fiber while the capturer is alive remains `ContinuationWrongFiber` at the closer. The segment is then released at the latest when the capturer exits (K13c). A sequential Scope forked from a parallel parent is not detected at transfer time; the exit rule covers it.

## 4. Source `catch` recovers expected failures only

**Defect.** `Effect.catch` takes the first `Fail` reason through `findError` and replaces the whole cause (`internal/effect.ts:158-165, 2646-2685`). Lowering source `catch` to it recovered a cause that held both `Fail` and `Die`, and dropped the defect (R1).

**Change.** `catchExpected(self, handler)` uses `Effect.catchCause`. It calls `handler` with the first failure only when every reason in the cause is a `Fail`. Otherwise it re-fails with the whole cause, untouched.

**Law.** A cause that contains a defect passes through source `catch` with its `Fail` reasons made `Die` (section 6). A cause of several expected failures, or of expected failures beside an interruption, is recovered with the first, as `Effect.catch` would recover it (K14a, K14c; section 7). A cause that carries an abandonment passes through untouched (K14d). Mixed causes are K14b (`Fail` + `Die`) and K14c (`Fail` + `Interrupt`, `Die` alone, interruption alone).

**Lowering the compiler must emit.** Use `catchExpected` wherever the design emits `Effect.catch` for source `catch`:

```ts
// try { return Users.find(String(id)) }
// catch (e) { return guest }
// finally { Metrics.increment("profile") }
return yield* Effect.ensuring(                      // Final: finally
  catchExpected(                                    // Catch: expected failures only
    Effect.fnUntraced(function* () {                // try region
      const users = yield* Users
      return yield* users.find(String(id))
    })(),
    (_e) => Effect.succeed(guest)                   // catch region
  ),
  Effect.fnUntraced(function* () {                  // finally region
    const metrics = yield* Metrics
    yield* metrics.increment("profile")
  })()
)
```

**Typing.** `catchExpected` removes `E` from the error channel, as `Effect.catch` does. A re-raised cause with a defect holds its failures as `Die` reasons (section 6). EffectScript catches never recover such a cause. A TypeScript caller that applies `Effect.catch` downstream can, which is Effect's behavior in R1. The checker should define `E` as the type of causes made only of expected failures.

## 5. `suspend` inside `Effect.acquireRelease`

**Confirmed.** effect 4.1.0 takes `options?: { readonly interruptible?: boolean }` as the third argument (`src/Effect.ts:13600-13604`). With it, the acquire runs under `restore` (`internal/effect.ts:4194`). The release is still registered under the mask, after acquisition succeeds, so no leak window opens.

**Behavior (tests only; no kernel change).**

| Policy | What interruption does | Test |
| --- | --- | --- |
| Default (masked) | The request is only recorded while the fiber waits. The value is delivered, its release is registered, the mask ends, and the release runs. `suspend`'s cancellation hook never runs. | K15a |
| `{ interruptible: true }` | Cancellation wins at once: the registration cleanup runs and the fiber exits. A later `waiter.resume` returns `false`, so the producer releases the value. | K15b |
| `{ interruptible: true }`, deferred wake-up | A value the gate accepted but has not delivered is released once by `suspend`'s `release` option. | K15c |

The Chapter 6 adapter needs interruptible acquisition and the `release` option:

```ts
export const connect = (url: string) =>
  Effect.acquireRelease(
    suspend<net.Socket>((waiter) => {
      const socket = net.connect(url)
      socket.once("connect", () => {
        if (!waiter.resume(socket)) socket.destroy()   // lost to cancellation: still ours
      })
      return () => socket.destroy()                    // cancelled before connect
    }, { release: (socket) => socket.destroy() }),     // accepted, not yet delivered
    (socket) => Effect.sync(() => socket.destroy()),
    { interruptible: true }                            // cancellation reaches the wait
  )
```

In the deferred race, both the registration cleanup and `release` can destroy the same socket. `destroy` is idempotent.

Which policy `using` applies to an EffectScript `acquireRelease` remains a design decision.

## 6. Defect precedence on Effect 4.1.0 (2026-10-25)

**Change upstream.** Effect 4.1.0 gives defects precedence where its runtime combines a failure with a finalizer's or a concurrent sibling's cause: `ensuring`, `onExit`, `acquireRelease`, scope close, `callback` cleanup, concurrent `forEach` and `all`, and `raceAll` when every racer fails (Effect-TS/effect#9433). Every typed recovery operator skips a cause that holds a defect and re-fails with its failures made defects (#9516). `Fail(e) + Die(d)` becomes `Die(e) + Die(d)`, in order, and no handler runs. F11a-F11e pin this.

**Defect.** The kernel combines causes itself in one place. `afterAbandon` joins a clause's or a fiber's exit with the cleanup failures of the continuation it abandons, using `Cause.combine`, so a producer whose cleanup dies after the loop body failed, or a handler clause that fails while abandoning, kept `Fail(e) + Die(d)`. Source `catch` re-raised a hand-built `Fail(e) + Die(d)` untouched, where `Effect.catch` now re-raises `Die(e) + Die(d)`.

**Change.** `electDefects(cause)` mirrors Effect's internal `causeElectDefects` with public APIs: when a cause holds a `Die`, each `Fail` (except a Stream's `Done`) becomes a `Die` of the same error with the same annotations. `afterAbandon` applies it to the cause it builds. `catchExpected` applies it to a cause it re-raises. The runtime's `$failureOf`, which the retired typed clauses before a Cause clause test, returns `$noFailure` for a cause with a defect.

**Law.** Where the kernel combines or re-raises a cause, a `Fail` beside a `Die` is a `Die` (K16a: owner exit; K16b: fiber exit; K16d: `catchExpected`). A cleanup failure that is itself expected stays expected (K16c).

## 7. Source `catch` recovers a failure beside an interruption (2026-10-25)

**Change.** D13 kept a cause holding a `Fail` and an `Interrupt` from source `catch`. `Effect.catch` recovers it with the first failure and drops the interruption, on Effect 4.0.5 and 4.1.0 alike (F11c), and after the 4.1.0 bump so does `retry`. `catchExpected` now applies `Effect.catch`'s rule (D306), with one guard of the kernel's own: a cause that carries an abandonment's sentinel interrupt passes through untouched. Abandonment unwinds a segment with the continuation's own interruptibility. Interruptibly, Effect's skip loop passes every catch frame. In a masked region, a failure that a `finally` raises during the unwinding reaches the region's catch frame. Recovering it there would resume abandoned code and lose the cleanup failure, so the guard keeps it moving (K14d; without the guard the handler runs and the exit is the clause's success).

**Law.** A cause with expected failures and interruptions but no defect is recovered with its first failure (K14c). A cause that carries an abandonment is never recovered (K14d).

## Verification

- `bun test`: 148 pass, 0 fail.
- `bun test ./tests/runtime-boundaries.test.ts`: 11 pass. R2b and R5 now assert the fixed behavior. R1 and R10 also assert the replacement (`catchExpected`, `tailResume`). R3 is annotated as unchanged Effect behavior.
- `bun test ./tests/acquisition-cancellation.test.ts ./tests/generator-tail-resume.test.ts`: 7 pass. The masked probe's expected order was corrected to match the order its review recorded: the release runs before `waiter.resume` returns. Two probes were added that show a clause returning `tailResume` holds 3 frames at N = 100,000.
- Falsification: the new tests were also run against a copy of the kernel with the four kernel fixes reverted. K11a-c, K12a-b, K13a-e and K14b-c fail there (12 tests). The 8 that pass on both guard behavior the fixes must preserve.
