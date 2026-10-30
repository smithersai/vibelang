### 23. Boundaries and finalization

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

> **Retired handler design.** The first release has no handlers or continuation kernel. `control`, `handle`, `resume`, `abandon` are not supported. [VIP-35](../../vips/0035-handlers-open.md) remains an open proposal; any handler examples and machine descriptions below record the old prototype.

```ts es
const approved = handle(() => {
  const viaMap = ids.map((id) => Approval.approve(id))                    // EK4301: a JavaScript frame
  const viaFork = forEach(ids, (id) => Approval.approve(id), {
    concurrency: 4                                                        // EK4201: other fibers
  })
  return forEach(ids, (id) => Approval.approve(id))                // fine: same fiber, Effect frames
}, Approval, { approve: (_request, k) => resume(k, true) })
```

Three calls look alike and meet three different boundaries. A capture moves frames between a perform site and its prompt, so whatever sits between them decides whether the capture can happen. The compiler rejects the first two; the runtime would otherwise fail them with `UnhandledOperation` and `HandlerNotOnThisFiber`.

#### Execution boundaries

| Boundary | Created by | Capture through it | State it restores | Owner of what it delimits |
| --- | --- | --- | --- | --- |
| Runner (program entry) | `Effect.runPromise`, `NodeRuntime.runMain`, a test runner such as `it.effect` | Creates a fiber root for a program value. VibeLang code never creates roots by calling; only runners and `fork` do (Chapter 13) | | The runner |
| Fiber root | Runners, `fork` | Stops every capture. Runtime operations (wait, sleep, yield) park the whole stack here. | None | The scheduler |
| Prompt | `handle`, the loop of a `for...of` over a producer (Chapter 26) | Stops capture for its operations. Other operations pass through; this prompt then moves with the captured segment. | Γₒ, ιₒ | The clause invocation, or a Scope after `transfer` |
| Scope region | A block that declares `using`, or a region that owns a `fork`: a function body, an arrow's expression body included, a loop iteration, a `try`, `catch`, or `finally` block, or a `provide` or mask block (D353, D408) | Transparent: its `Final` frame moves with a captured segment and closes the Scope when the segment unwinds | | The block: its `using` acquisitions and forked fibers, nothing else |
| Catch, Final, Restore, Mask | `try/catch`, `finally`, `provide`, masks | Transparent: the frames move with a captured segment and act when it unwinds | Their own | |
| Owner, Clause | Capture | Transparent to outer captures | None | Its continuation |
| Foreign JavaScript frame | A call into untransformed JavaScript: an `Array.prototype.map` callback, `Effect.runSync` | Opaque. An operation performed below it cannot reach a handler above it. `runSync` starts a new root with an empty Context, so the operation is unhandled there (foreign-frame test). | | |
| TypeScript Effect code | A TypeScript function returning `Effect` | Transparent on the same fiber (T7a), but its body can fork where the checker cannot see, so a TypeScript function whose R holds a control operation is EK4202 | | |
| Plain JavaScript region | A plain function, which plain code calls (D445, D500), and the plain variant the compiler may give an Effect function (Chapter 15) | Must contain no capture or pause point, and must end with the Exit the frames would (Chapter 17) | | |
| Program run | Calling a program | Each run allocates fresh frames and continuations. Nothing crosses runs; a continuation from one attempt cannot be resumed in another (T11). | | |
| Workflow execution | Effect's `effect/workflow`: `Workflow.execute`, `toLayer` | The body runs on a forked child (`workflow/Workflow.ts:695-780`), so a handler outside it cannot be reached. Durable suspension interrupts that fiber (`Workflow.ts:1031-1036`): held continuations are abandoned through their owners. Every execution, first or replay, is a fresh program run, and only activities and durable state are journaled (D42) | | The workflow engine |
| Fork | `fork`, concurrent combinators | A new root. Context crosses as a snapshot (F7); prompts do not (T8; probes in Chapter 16). | | The region around the `fork` (D408), a Scope, the parent fiber, or nothing |

#### Regions and ownership

A block opens a Scope region when it directly declares `using`, and a region the source names, a function body, a loop iteration, a `try`, `catch`, or `finally` block, or a `provide` or mask block, opens one when a `fork` belongs to it; a block that is only braces opens none (D408). The region closes when it exits, by any path. Only its `using` acquisitions and forked fibers belong to it. Any other acquisition in the block keeps `Scope` in the function's requirements, so the caller owns it (D14, D19). The runtime boundary regression shows why the alternative, whole-block ownership, was rejected: it closes a connection the function returns to its caller. An owned fiber is interrupted when its region closes, so the checker rejects one that flows anywhere outside it (EK4838, Chapter 7, D409).

#### Finalization

| Exit | What runs | Evidence |
| --- | --- | --- |
| Return | `Final` frames in LIFO order with `Success` | Effect `OnExit`, `internal/effect.ts:4173-4214` [Effect] |
| Expected failure | Unwind to the nearest `Catch`, which recovers the first expected failure of a cause with no defect and no abandonment (D306); `Final` frames on the way run first with `Failure(c)` | [Effect]; K14a |
| Expected failure plus a defect | Unwind past every `Catch` as defects: each failure becomes a defect of the same error (D305); `Final` frames run | K14b, K16a-K16d; F11a, F11b [Effect] |
| Expected failure plus an interruption | Unwind to the nearest `Catch`, which drops the interruption, as `Effect.catch` does (D306); `Final` frames on the way run first | K14c; F11c [Effect] |
| Defect | Unwind past every `Catch`; `Final` frames run | [Effect] |
| A finalizer fails | After a return or a jump, the region fails with the finalizer's cause `f`; after a failure `c`, with `c ⊕ f`, never with `f` alone (D340) | `Effect.onExit` [Effect]; K12a-K12e |
| An iterator a `for...of` or a destructuring opened | Closed by a `Final` frame on every exit before its end, wherever the exit starts (D356) | Chapter 17 |
| Interruption | Like a defect. While the fiber has a pending interruption π and is interruptible, even cause-level `catchCause` frames are skipped (`internal/core.ts:611-627`). A self-raised interrupt cause with no π, such as `Effect.interrupt`, can still be caught by `catchCause` (conformance test D04), but not by source `catch`. `Final` frames run masked | [Effect] |
| Abandonment | The segment unwinds as if interrupted. Finalizers see an interruption Exit, `catchCause` inside the segment does not run, and the abandoner continues only after the unwinding finishes. | T3 [Kernel] |
| Abandonment inside a mask | A recovery handler inside the mask may observe the abort, but the abort re-raises when the mask ends. A segment entirely inside a mask that swallows the abort and returns normally is a defect, `AbandonedContinuationContinued`, at every owner: clause invocation, `abandon`, and Scope (kernel-edges; A04). | [Kernel] |
| Interruption while a continuation is held | Clause finalizers, then the held continuation's finalizers, then outer finalizers | T4 [Kernel] |
| Finalizer failure during abandonment | A release that dies fails the boundary that abandoned: the `handle` (kernel-edges), the caller of `abandon` (A02), the closing Scope region (A01), or the exiting fiber (K13d). The abort itself is not reported; a real pending interruption is reported beside the failure (K12a-K12e) | [Kernel] |
| The capturing fiber exits while it still holds transferred continuations | Each is abandoned on that fiber, newest first, before the fiber's exit is published | K13a-K13d [Kernel] |
| A finalizer that performs a control operation handled outside it | Works when the outer handler resumes, even mid-abandonment: the abort moves with the capture and returns at resume (I11). If the outer handler abandons instead, the finalizer is cut short. VibeLang therefore requires a finalizer's control operations to be handled inside the finalizer [Rule; checker] | I11, I06 [Kernel] |

JavaScript `finally` inside an `Effect.gen` body is not a finalizer: Effect never calls the generator's `return()` or `throw()` (F1, F2, F3). VibeLang `finally` and `using` therefore compile to `Final` frames, never to JavaScript `finally`, in every function that compiles to frames (Chapter 26). A function that compiles to plain JavaScript keeps JavaScript's `try` only as Chapter 17's Exit rule allows.
