### 17. Failures, defects, interruption, and cleanup

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

```ts es
function exportReport(id: string) {
  using tmp = TempFiles.create()
  try {
    writeRows(tmp, Reports.rows(id))
    return Storage.upload(tmp)
  } catch (e) {                    // e: UploadError
    return Storage.queueRetry(id)
  } finally {
    Metrics.increment("exports")
  }
}

function exportWithDeadline(id: string) {
  return timeout(() => exportReport(id), "30 seconds")
}
```

If the 30 seconds run out during the upload, the upload is interrupted, the `catch` block does not run, the `finally` block runs, the temporary file is removed, and the `Effect.timeout` call fails with `Cause.TimeoutError`.

This chapter is the normative definition of how a computation stops and what runs on the way out. Chapter 20's machine is its reference: each rule below follows one of the machine's transitions, and every way the compiler lowers a construct, the plain JavaScript path included, produces the Exit the machine produces (the Exit rule, below). Chapter 3 introduces the same rules by example.

#### Exits and causes

An **Exit** is `Success(value)` or `Failure(cause)`. A **cause** is an ordered list of reasons, as in Effect 4's `Cause`:

| Reason | Made by | In E |
| --- | --- | --- |
| `Fail(e)` | `throw e` in VibeLang; a callee's E; an exception that a trusted contract lists | Yes |
| `Die(d)` | Any other JavaScript exception, such as `(undefined as any).x`; `Effect.die`; a `Fail` beside a `Die` (D305) | No |
| `Interrupt(id)` | Another fiber, a timeout, or an enclosing scope closing | No |

**Abandonment** is how a handler that does not continue its program (Chapter 9) unwinds that program. It travels as an internal interrupt that no `catch` recovers and no Exit reports (Chapter 20).

**Combining causes.** When cleanup fails with cause `f` while its region is failing with cause `c`, the region fails with `c ⊕ f`: the reasons of `c`, then the reasons of `f`, with a reason equal (`Equal.equals`) to one already present listed once; then, if any reason is a `Die`, every `Fail` becomes a `Die` of the same error, in place (D305). This is `Cause.combine` followed by Effect 4.0.6's defect election, the operation `Effect.onExit` and `Effect.ensuring` apply when a finalizer fails after a failure [Effect]:

```text
Effect.onExit(Effect.fail("A"), () => Effect.fail("B"))     Fail:A | Fail:B
Effect.onExit(Effect.fail("A"), () => Effect.die("D"))      Die:A  | Die:D
Effect.ensuring(Effect.fail("A"), Effect.die("D"))          Die:A  | Die:D
Effect.onExit(Effect.succeed(1), () => Effect.fail("B"))    Fail:B
Effect.onExit(Effect.interrupt, () => Effect.fail("B"))     Interrupt | Fail:B
```

Each kind of exit has one rule:

| Exit | In E | Runs `catch` | Runs `finally` and `using` |
| --- | --- | --- | --- |
| Expected failure | Yes | Yes, narrowed by type | Yes |
| Defect | No | No; observe it with `Effect.catchDefect` at a boundary | Yes |
| Interruption | No | No | Yes |
| Abandonment | No | No | Yes |
| Expected failures plus a defect, such as a `finally` that crashed while the block was failing | No: each expected failure becomes a defect of the same error, first, as in Effect 4.0.6 (D305) | No: the whole exit propagates with every reason, the failures as defects | Yes |
| Expected failures plus an interruption, such as a joined fiber that was interrupted while its `finally` threw | Yes | Yes; `e` is the first, and the interruption is dropped, as `Effect.catch` drops it (D306) | Yes |
| Several expected failures, such as a `finally` that threw while the block was failing, or `Effect.race` with both branches failed | Yes | Yes; `e` is the first, and the `catch` handles the exit as a whole | Yes |

#### The throw rule

**Applies to** `throw e` in VibeLang code outside a hatch, as a statement or an expression (D186).

**Checked.** The declared type of `e` joins the function's E. A `throw` whose operand's type is a Cause type, resolved by symbol to Effect's `Cause.Cause<E>`, or a union with such a member, is EK2140 (D406): `throw` fails with the value it is given, so it would fail with the `Cause` object itself as an expected failure, which no reader means. Write `Effect.failCause(cause)`, a call that runs and fails with every reason the cause holds, as in Effect code. `unknown` and `any` are not Cause types, and a `throw` of one fails with the value, whatever it is at run time. Under a plain contract, a throw that can escape is EK2003, since a plain function never fails (D282).

**At run time.** `throw e` fails with `Fail(e)`, as `Effect.fail` does, whatever `e` is, on every path the compiler emits. This is the machine's `throw` transition (Chapter 20), the one meaning `throw` has.

```ts es
error Unavailable

function fetchSnapshot(): string!Unavailable! {
  sleep("1 millis")
  return "snapshot"
}

function snapshotOrRethrow() {
  const outcome = exit(() => fetchSnapshot())
  if (outcome is Exit.Success(let value)) return value
  if (outcome.cause.hasInterrupts()) return Effect.failCause(outcome.cause)   // fails with every reason
  throw new Unavailable()                                                   // Fail(Unavailable)
}
// string!Unavailable!
```

#### The defect rule

**Applies to** every JavaScript exception that the throw rule and the trusted contracts of Chapter 10 do not classify: an exception from TypeScript code with no contract that lists it, a `TypeError` from the engine, an exception a hatch's code throws and its mapper does not map, and a release or disposal method that throws or rejects.

**At run time.** Where such an exception reaches an Effect frame, the computation fails with `Die(exception)`. In a function that compiles to plain JavaScript it propagates as the same JavaScript exception and becomes a `Die` where it reaches an Effect caller (D282). `Effect.die(d)` and `Cause.die(d)` make a `Die` directly. A `Fail` that meets a `Die` in one cause becomes a `Die` of the same error (D305), so no typed recovery runs on a cause that holds a defect.

#### The catch rule

**Applies to** `try { B } catch (p) { H }`, `x catch fallback`, and `x catch (e) => h` (D236). A catch expression is `try { x } catch (e) { … }` as an expression: its left side runs inside the catch.

**Checked.** The catch binding's type is exactly the expected failures `B` can raise, the E of `B` (D13, D218). A binding pattern in the catch clause, such as `catch ({ code = fallbackCode() })`, is code that runs after `B` and before `H`: what its defaults and computed keys can fail with and need joins the function's E and R, not `B`'s, so this catch never handles it (EK2001, EK2002 as for any code). A `match` on the binding must cover what `B` can raise or carry a `default` (Chapter 3). `catch (e: T)` is retired (EK2112). A catch whose block has E = `never` draws warning EK2004.

**At run time.** The catch handles the first `Fail` of a cause that holds no `Die` and no abandonment, and drops any `Interrupt` and further `Fail` reasons beside it, as `Effect.catch` does (D306). It then evaluates the binding pattern once, then runs `H`. A cause with a `Die` passes through with its failures as defects (D305, K16d). A cause of interruptions only passes through. A failure raised while a handler abandons a continuation passes every catch inside that continuation, so cleanup cannot resume abandoned code (K14d). While the fiber itself has a pending interruption and is interruptible, unwinding skips every catch (Chapter 20). Source `catch` and catch expressions compile to the runtime's `catchExpected`, so both recover exactly what this rule says (K14a-K14d, Chapter 26).

```ts es
error Missing { id?: string }
error NoDefault

function lookup(id?: string): string!Missing! {
  throw new Missing({ id })
}

function defaultId(): string!NoDefault! {
  throw new NoDefault()
}

function describe(id?: string) {
  try {
    return lookup(id)
  } catch ({ id: missing = defaultId() }) {   // runs after this catch recovers Missing
    return `no ${missing}`
  }
}
// string!NoDefault!: the default's failure escapes; this catch does not handle it
```

#### The finalization rule

**Applies to** every cleanup VibeLang runs: a `finally` block, a `finally (exit)` block, a `using` release, the close of a Scope region (a region that declares `using` or owns a `fork`, D408), a clause owner abandoning a continuation (Chapter 21), a fiber's exit releasing its transferred continuations, and the iterator close of the iterator rule below.

**Checked.** A `return`, `break`, or `continue` that leaves a `finally` block is EK2006: in JavaScript it discards the failure in flight. A cleanup's own failures and requirements join the enclosing function's E and R. A control operation inside cleanup must be handled inside that cleanup (Chapter 9), so no handler outside can cut it short.

**At run time.** Cleanup runs once per exit of its region, with interruption held off until it ends. The cleanups of one region run in reverse order of registration, and a Scope region interrupts its forked fibers and waits for them in that same order (Chapter 7). When a region exits with `X` and its cleanup ends:

| Cleanup | `X` | The region exits with |
| --- | --- | --- |
| Succeeds | Any | `X` |
| Fails with `f` | `Success`, or a jump: `return`, `break`, `continue` | `Failure(f)` |
| Fails with `f` | `Failure(c)` | `Failure(c ⊕ f)` |

This is the machine's `Final` transition (Chapter 20), and it is what `Effect.onExit` and `Effect.ensuring` do. The first two rows are JavaScript's `finally`; the third is not: JavaScript replaces the pending exception with the cleanup's, and VibeLang keeps both, as Java's suppressed exceptions and Effect's causes do. A failure during cleanup that VibeLang runs is never dropped, on every path: a block's exit, a clause that abandons, an explicit `abandon` while an interruption is pending, a scope that closes, and a fiber that exits (D15, K12a-K12e, K13d). An Effect operator that discards an Exit by design, as `timeout` and `race` discard a loser's, is the one boundary of this guarantee (below, D256).

```ts es
error First
error Cleanup

function report() {
  try {
    try {
      throw new First()
    } finally {
      throw new Cleanup()           // added to the cause; it does not replace First
    }
  } catch (e) {                     // e: First | Cleanup; here the cause is [Fail(First), Fail(Cleanup)]
    return e._tag                   // "First"
  }
}
```

`finally (exit)` binds the try statement's `Exit<void, E>`, where E is what the try statement can fail with, and runs on every exit with interruption held off, as `Effect.onExit`'s finalizer does. A success carries no value, because the try block's statements have none; a `return` inside the try block still returns its value (D178).

#### The iterator rule

**Applies to** every construct that opens a JavaScript iterator: `for...of` over an iterable that is not a producer or a `Stream`, and array destructuring, in a binding, an assignment, a parameter, or a `for...of` head.

**At run time.** An iterator the construct opens is closed, by looking its `return` method up and calling it once, when it closes and never earlier, as ECMAScript's `IteratorClose` does (D424), on every exit before the iterator is done: a jump, an expected failure, a defect, an interruption, or an abandonment, wherever the exit starts, in the loop head, a binding pattern's default, or the body (D356). The iterable's static type exempts nothing: an array whose `Symbol.iterator` was replaced is closed like any iterator. Closing is cleanup under the finalization rule, so a `return()` that throws while a failure is pending is added to the cause, where ECMAScript's `IteratorClose` would drop it. A producer and a `Stream` close by abandonment and scope close instead (Chapter 8).

```ts es
error Empty

function fallback(): number!Empty! {
  throw new Empty()
}

function firstOrFallback(pairs: Iterable<[number | undefined]>) {
  for (const [n = fallback()] of pairs) return n   // if fallback() fails, pairs is closed first
  return 0
}
```

#### The interruption rule

**Applies to** an interruption request from another fiber, a timeout, a closing scope or `interrupt()`, and to the blocks `uninterruptible { … }`, `restore { … }`, and `interruptible { … }`.

**Checked.** A `restore` block outside an `uninterruptible` block of the same function is EK2111. The blocks at a module's top level are EK1001.

**At run time.** Interruption is Effect's (Chapter 20's interrupt transition). A request is recorded on the fiber. It is delivered at once to a parked interruptible fiber, at the next step of a running one, and when the mask ends for a masked one. Delivery fails the fiber with `Interrupt`: no `catch` runs, and cleanup runs with interruption held off, as Effect runs a finalizer, except inside an `interruptible` block, `Effect.interruptible`, or `Effect.interruptibleMask` that the cleanup's own code enters, which set the fiber interruptible under any mask, as Effect's do; a `restore` gives back only what its own mask replaced (D490). A function or region that compiles to plain JavaScript is one step, as an `Effect.sync` body is, so interruption never lands inside it. An `uninterruptible` block runs as `Effect.uninterruptibleMask`, a `restore` block inside it as the mask's `restore`, and an `interruptible` block as `Effect.interruptible`; their statements stay code of the enclosing function, and each block calls the prelude function of its name, Effect's own, which also takes a program (D180). A resource's acquisition is masked or interruptible as its `acquireRelease` says, and a `using` adds no mask: its initializer runs with the interruptibility in force where it stands (Chapter 6, D490). When `join`, an `await` operation, or `for concurrent` interrupts several fibers, it requests interruption of all of them before it waits for any; a region's exit closes its Scope one owned thing at a time, newest first (Chapter 7, D354, D408).

```ts es
function commit(rows: ReadonlyArray<string>) {
  uninterruptible {
    logInfo(`writing ${rows.length} rows`)
    restore {
      sleep("10 millis")            // an interruption may land here
    }
    logInfo("written")              // not here
  }
}
```

#### The abandonment rule

**Applies to** a handler clause that ends without resuming, `abandon(k)`, a closing Scope region that owns a transferred continuation, and a fiber exit that releases one (Chapter 21).

**At run time.** The abandoned segment unwinds as if interrupted: cleanup sees an interrupted exit, no `catch` inside the segment runs, and the abandoner continues only after the unwinding ends. A cleanup failure during abandonment fails the boundary that abandoned: the `handle`, the caller of `abandon`, the closing Scope region, or the exiting fiber; the internal interrupt is never reported, and a real pending interruption is reported beside the failure (K12a-K12e).

#### The Exit rule

**Applies to** every lowering of a construct other than the frame lowering of Chapter 26: plain JavaScript functions and regions (Chapter 15), single-result bodies (D274), tail resumes (K11a), JavaScript's own `for...of` (D404), trusted-call wrappers, and any later optimization.

**Checked.** The compiler applies such a lowering only where it produces the frame lowering's Exit: the same success value, or the same reasons in the same order. Chapter 26's observation model adds the other observations every lowering keeps, such as the order and count of side effects and the lifetimes of resources and fibers. Experiment G10 compiles a corpus both ways and compares.

**At run time.** Where JavaScript's own statement behaves differently, the lowering uses the runtime's combining form or is not applied. A `finally` in a plain function combines failures as the finalization rule says (D340). A plain function never fails, so only defects leave it as JavaScript exceptions. When cleanup adds a defect to a pending one, the exception that leaves is a `SuppressedError` whose `error` is the cleanup's exception and whose `suppressed` is the pending one, as ECMA-262's `DisposeResources` reports two failures; the runtime turns a `SuppressedError` it made back into the combined cause where it reaches an Effect frame. A TypeScript caller of a plain-annotated function sees that `SuppressedError`. The runtime supplies `SuppressedError` where the host lacks it.

#### The E guarantee

**Statement.** In a program the compiler accepts, every `Fail` reason in a cause that leaves a function holds a value whose type is in that function's E. E bounds expected failures only: `Die` and `Interrupt` reasons are outside it, so a contract with E = `never` promises that no expected failure leaves the function, not that nothing crashes.

**Assumptions.** The guarantee holds when TypeScript's own typing holds and foreign code keeps its contracts: no cast, `any`, or non-null assertion puts a value outside its type; TypeScript declarations of Effect functions, `@throws` tags, `trusted(…)` values, and `trustedPackages` say what the code does; and each hatch's mapper returns what its type says. Chapter 26 lists every such assumption once, as the trusted base (D373). Where an assumption fails at a class pattern, the match fails with a defect, the proposal's `TypeError`, rather than taking a wrong arm (Chapter 3).

#### The Effect-operator boundary

**Applies to** Effect's own operators, called from VibeLang.

**At run time.** They keep Effect's semantics (D22, D256). The guarantees above cover the cleanup VibeLang runs itself. An operator that discards an Exit by design still discards it: `timeout`, `race`, `raceFirst`, and `await.race` interrupt the losers and drop their exits, cleanup failures included (D256, F11e). A program that must observe a child's cleanup failure forks the child and joins it: `join` adopts the child's whole Exit (Chapter 7).

Effect's typed operators act on a mixed cause as follows. A cause that Effect or the kernel builds from an expected failure and a defect holds only defects (D305), and the typed operators treat a hand-built one the same way:

| Operators | Given an expected failure plus a defect |
| --- | --- |
| `Effect.catch`, `catchTag`, `catchIf`, `result`, `option`, `match`, `ignore`, `orElseSucceed`, `firstSuccessOf`, `flip`, `validate`, `partition`, `retry` | Run no handler; the cause propagates with every failure as a defect |
| `Effect.mapError` | Maps every expected failure in place and keeps the other reasons |
| `Effect.catchDefect` | Acts on the first defect, the original error once it is a defect, and drops the rest |
| `Effect.exit`, `Effect.catchCause`, `Effect.sandbox` | Keep every reason |

Given an expected failure plus an interruption and no defect, the typed operators act on the first failure and drop the interruption, `retry` retries, and `mapError` keeps the interruption. These were checked against `effect@4.0.6` (F11a-F11e). Use such an operator where dropping a reason is what the program means; a VibeLang `catch` drops only what `Effect.catch` drops.

#### Frames, not JavaScript `try`

In any function that compiles to frames, `try`, `catch`, `finally`, and `using` compile to Effect's own failure and cleanup frames, never to JavaScript `try`: Effect does not run JavaScript `finally` blocks inside generators when a fiber fails or is interrupted (F1-F3), so a JavaScript `try` would skip cleanup. Chapter 26 shows the generated code. A function that compiles to plain JavaScript may use JavaScript's statements only as the Exit rule allows.

#### Causes, exits, and interruption blocks

```ts es
function snapshotOrFallback() {
  try {
    const outcome = exit(() => fetchSnapshot())
    if (outcome is Exit.Success(let snapshot)) return snapshot
    const cause = outcome.cause
    if (cause.hasInterrupts()) return Effect.failCause(cause)
    return cause.hasFails() ? "cached" : "degraded"
  } finally (exit) {
    logDebug(`snapshot ${exit._tag}`)
  }
}

function moveFunds(from: Account, to: Account, amount: number) {
  uninterruptible {
    Ledger.debit(from, amount)
    Ledger.credit(to, amount)     // an interruption waits until both have run
  }
}
```

- `exit(program)` holds every reason a failure holds, defects and interrupts included, as `Effect.exit` does; test it with `is` or `match` on `Exit.Success` and `Exit.Failure` to recover from the whole cause (D217). The earlier form, a catch clause typed `Cause` (D176), still compiles, as `Effect.catchCause` with a control operation's abandonment passed through untouched, but is retired: it draws warning EK2113, whose quick fix writes the `match`.
- `Effect.failCause(cause)` fails with every reason a cause holds; a `throw` of a Cause is EK2140 (the throw rule, D406).
- `exit(program)`, `interrupt()`, and `yieldNow()` are bare functions (D179).
