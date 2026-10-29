### 20. The machine

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

```ts es
function checkout(cartId: string) {
  using hold = Inventory.reserve(cartId)
  try {
    return Payments.charge(cartId)
  } catch (e) {
    return refund(cartId, e)
  }
}
```

```text
fiber._stack while Payments.charge runs, bottom to top:

  … main │ Ret(checkout) │ Final(close scope: release hold) │ Catch(PaymentError → refund) │ Ret(charge)
           a call          `using`                            `try`/`catch`                  a call
```

Every construct in the function is a frame on the fiber's stack. The machine defines what every VibeLang program means; syntax, types, and the compiler exist to produce and check its states. It is not a model of Effect's runtime that we hope matches: it is Effect's runtime plus a few frame kinds and four operations, and the kernel prototype runs it.

In the machine's terms, Effect supplies two things: the representation (frames on `_stack` and the Context) and the **root handler**, the scheduler at the bottom of every fiber, which handles the runtime operations (wait, yield, fork, interrupt) by parking and resuming whole fiber stacks. Every other handler is a prompt above the root. In this precise sense the language is the effect system: every feature is a rule over frames, prompts, and one-shot continuations, and Effect's run loop is one handler in that semantics, not a library the language calls.

#### Objects

| Term | Definition | Representation on Effect 4 |
| --- | --- | --- |
| Computation | One run of code. It returns a value, fails with an expected error, dies with a defect, is interrupted, or performs an operation. Every function body is a computation. | Primitives evaluated by a fiber |
| Program | A cold, reusable description of a computation. Constructing it runs nothing. Each run creates a new execution with fresh frames. | An `Effect` value; in source, `() =>` or another form that delays (Chapter 13) |
| Fiber | One execution: a frame stack, a Context, an interruptibility flag, a pending interruption, and child fibers. | `FiberImpl`, `internal/effect.ts:487-743` [Effect] |
| Frame | A piece of the rest of the computation: an activation waiting for a callee, or a boundary that acts when control leaves it. | An object on `fiber._stack` with success, failure, and ensure hooks, `internal/core.ts:31-61` [Effect] |
| Operation | A request a computation makes of its environment: a service method, a control operation, or a runtime request such as "wait for this callback". | A Context key |
| Tail-resumptive operation | One whose handler always resumes exactly once, as its last step. Every service method is one. | Runs in place; nothing is captured (Chapter 4) |
| Evidence | What the Context holds for an operation: an in-place implementation, or a reference to a handler's prompt. | A Context entry [Kernel] |
| Prompt | A frame that delimits capture for one handler and records the Context and interruptibility to restore when control leaves it. | Kernel `PromptFrame` [Kernel] |
| Delimited continuation | The frames between a perform site and the matching prompt, plus the Context and interruptibility at the perform site. It is live, one-shot, and owned. | Kernel `Continuation`: a spliced `_stack` segment [Kernel] |
| `Suspended` | A continuation whose ownership was transferred to a Scope region: resumable once, abandoned when its region closes or its capturing fiber exits. Internal to the standard library in v0. | Kernel `Suspended` [Kernel] |
| Execution boundary | A frame or fiber edge that limits capture, restores state, or changes ownership (Chapter 23). | |

#### State and frames

```text
Fiber = ⟨ K, Γ, ι, π, C ⟩                                    Effect 4 field
  K  frames, bottom → top                                   fiber._stack
  Γ  Context: services, references, current Scope,          fiber.context
     tracing span, operation evidence
  ι  interruptible                                          fiber.interruptible
  π  pending interruption cause                             fiber._interruptedCause
  C  child fibers                                           fiber._children

Frame                                                        Effect 4 frame
  Ret(f, pc, locals)  activation of f, waiting at pc          Iterator (generator) or OnSuccess
  Restore(Γ′)         on exit: Γ := Γ′                        OnExit pushed by updateContext
  Mask(ι′)            on exit: ι := ι′                        setInterruptible
  Final(fin)          on exit: run fin(exit) with ι = false   OnExit; Scope close
  Catch(h)            on a cause with a Fail, no Die, no abort: catchCause frame (runtime catchExpected)
                      run h(first failure)
  Prompt(H, Γₒ, ιₒ)   delimiter for handler H;                kernel PromptFrame
                      on exit: Γ, ι := Γₒ, ιₒ
  Owner(k)            on exit: abandon k if it is still       kernel OwnerFrame
                      suspended and still owned here
  Clause(k)           on a returned tail-resume request:      kernel ClauseFrame
                      resume k
  Collector(k)        bottom of an abandoned segment:         kernel AbandonCollector
                      restores the abandoner's state
  FiberExit           bottom of a fiber that transferred:     kernel FiberExitFrame
                      abandons its still-suspended transfers
```

Every frame kind down to `Catch` already exists in Effect 4 [Effect]; `Catch` is Effect's `catchCause` frame with the handler the runtime's `catchExpected` gives it. `using` adds no frame kind and no state: it is Effect's `acquireRelease` with `{ interruptible: true }` (Chapter 6, D490), whose acquire runs under a `Mask` frame restored to the interruptibility around it, and whose release becomes a `Final` in the Scope in the step that pops that `Mask`. The kernel adds the last five kinds and four operations: capture, resume, abandon, and transfer [Kernel].

#### Transitions

These rules are the specification. Within one rule, changes to K, Γ, ι, π, and continuation state happen atomically with respect to scheduling and interruption.

| Rule | When | Then |
| --- | --- | --- |
| call | `f(v)` that may suspend | Push `Ret(caller, pc)`; run the body of `f`. |
| return | `return v` meets `Ret(g, pc)` | Pop it; continue `g` at `pc` with `v`. |
| | meets `Restore(Γ′)` or `Mask(ι′)` | Pop it; restore Γ or ι; keep returning `v`. |
| | meets `Final(fin)` | Pop it; run `fin(Success v)` with ι = false; keep returning `v`, or fail with `fin`'s failure. A jump out of a region (`return`, `break`, `continue`) is a return of its completion record, so it meets `Final` the same way. |
| | meets `Prompt(H, Γₒ, ιₒ)` | Pop it; Γ, ι := Γₒ, ιₒ; continue with `H.onReturn(v)`. |
| | meets `Clause(k)` with `v` a tail-resume request for `k` | Pop it; perform `resume(k, x)` or `resumeWith(k, p)` as the request says. Any other `v` passes through. |
| | meets `Owner(k)` | Pop it; if `k` is suspended and owned here, abandon `k` first; keep returning `v`. |
| perform, in place | `op(v)` and Γ[op] is an in-place implementation `impl` | Call `impl(v)` here, under the current Γ. Nothing is captured. |
| perform, capture | `op(v)`, Γ[op] refers to H, and K = K₀ · Prompt(H, Γₒ, ιₒ) · K₁ | k := ⟨K₁, Γ, ι, H, suspended⟩. An abandonment abort in π that belongs to K₁ moves into `k`. K := K₀ · Owner(k) · Clause(k); Γ, ι := Γₒ, ιₒ; run the clause `H.op(v, k)`. |
| perform, unhandled | Γ[op] absent; H's prompt is on another fiber; or H's prompt has exited | Defect `UnhandledOperation`, `HandlerNotOnThisFiber`, or `HandlerPromptExited`. The checker rejects these programs first. |
| resume | `resume(k, x)`, k suspended, same fiber | k := resumed. If `Owner(k)` is on top, or `Clause(k)` over `Owner(k)`, pop them (a resume in tail position). Push `Prompt(H, Γ, ι)` then K₁; Γ, ι := k.Γ, k.ι; reinstate k's moved abort in π; deliver `x` at the perform site. `resume` returns when the handled computation reaches the reinstalled prompt. |
| resumeWith | `resumeWith(k, p)` | As `resume`, but run the program `p` at the perform site. `p` may fail only with the operation's declared E, and its R is `never` (Chapter 9). |
| abandon | `abandon(k)` or `abandonNow(k)`, k suspended, same fiber | k := abandoned; push `Collector(k)`, then K₁; Γ, ι := k.Γ, k.ι; add a fresh abort to π (never replacing a real pending interruption); unwind K₁. The abort re-raises whenever K₁ re-enters an interruptible region. `Final` frames run; `Catch` frames do not. The collector removes only its own abort from π. `abandonNow` returns the unwinding's Exit; `abandon` fails with every cleanup reason plus every real pending interruption, and never reports its own abort (K12a-K12e). |
| transfer | `transfer(k)` in the clause; standard library only (D16) | Owner of k := a fresh token registered with the Scope in Γ (the region around the handler); the capturing fiber's `FiberExit` frame also holds k. Returns `Suspended(k)`. Closing that Scope abandons k only if the same token still owns it; the fiber's exit abandons it if it is still suspended then (K13a-K13d). A Scope with parallel finalizers is rejected (K13e). |
| throw | `throw e` | Fail with `Fail(e)`. |
| fail | failure meets `Ret` | Discard the frame. |
| | meets `Catch(h)`, the cause has a `Fail`, no `Die` and no abandonment, not interrupting | Continue with `h(e)`, where `e` is the first failure; the other reasons are dropped, as `Effect.catch` drops them (D306). A cause with a `Die` passes through with each `Fail` made a `Die` (D305, K16d); one without a `Fail`, or carrying an abandonment, passes through intact (K14a-K14d). |
| | meets `Final(fin)` | Run `fin(Failure c)` with ι = false; keep failing with `c ⊕ f`, where `f` is `fin`'s failure: `c`'s reasons, then `f`'s, each `Fail` made a `Die` when a `Die` is among them (D305, Chapter 17). |
| | meets `Restore`, `Mask`, `Prompt`, `Clause` | Restore state; keep failing. |
| | meets `Owner(k)` | Abandon `k` first if it is owned here and suspended; keep failing with `c` plus any cleanup failure, combined as at `Final` (D305, K16a). |
| interrupt | request `r` from another fiber | π := π ⊕ r. If ι and parked: fail with π now. If ι and running: fail with π at the next step. If not ι: fail when a `Mask` frame restores ι = true. While π ≠ ∅ and ι, unwinding skips `Catch` frames. |
| wait (root) | `suspend(register)` | Park the fiber with K intact. `register` receives a one-shot resumer. |
| wake | `resumer.resume(v)` | Run the fiber with `v`: synchronously while the wake depth is under budget, otherwise on the scheduler (Chapter 24). |
| fork | `fork(p)` | New fiber ⟨[], Γ, true, ∅, ∅⟩ runs `p`. Its owner is the innermost region the source names around the `fork`: a function body, an arrow function's expression body included, one loop iteration, a `try`, `catch`, or `finally` block, a block that declares `using`, or a `provide` or mask block (D353, D408); or the caller's Scope (`Effect.forkScoped`), the parent fiber (`Effect.forkChild`), or nothing (`Effect.forkDetach`). No prompt crosses. |

The interruption rows describe Effect 4 as it is (`internal/effect.ts:558-579`, `internal/core.ts:600-631`) [Effect]. The prompt, owner, clause, collector, fiber-exit, capture, resume, abandon, and transfer rows are the kernel (`packages/runtime/src/kernel/kernel.ts`) [Kernel].

**Every lowering answers to these rules.** The rules define the Exit of every program. The frame lowering of Chapter 26 follows them step by step. Any other lowering, such as a function compiled to plain JavaScript (Chapter 15), runs as one step of the machine, since nothing in it can park or capture, and must end with the Exit these rules give: the same value, or the same reasons in the same order (Chapter 17's Exit rule). Where JavaScript's own `finally` or `IteratorClose` would replace or drop a failure, the lowering uses the runtime's combining forms instead.

**Tail position is structural.** A resume is in tail position when `Owner(k)` (with `Clause(k)` above it) is on top of the stack when it runs. In a generator clause, `return yield* resume(k, v)` runs with the clause's own frame above them, so it is not a tail resume, and a producer looping that way keeps every element's clause frames until the loop ends (`tests/generator-tail-resume.test.ts`: 3,002 frames at 1,000 elements). The compiler therefore emits `return tailResume(k, v)`: the clause's generator finishes first, and `Clause(k)` performs the resume (K11a). Inside a `try`, `catch`, `finally`, or `using` region of the clause, the compiler emits `yield* resume(…)` instead, because the region's cleanup must run after the resumed computation (K11d).

#### Choices the machine makes

| Choice | Alternatives | Decision and reason |
| --- | --- | --- |
| Deep or shallow handlers | Shallow: resume without reinstalling the prompt | **Deep** [Rule]. A loop that performs an operation many times (T9, T17) needs the handler every time. A tail resume drops its inert owner, so iterating a producer 100,000 times keeps the stack at 3 frames (K11a). Shallow handling is a different operation and can be added later. |
| Handler selection | Dynamic: nearest prompt on this fiber. Lexical: handlers passed as capabilities (Effekt) | **Dynamic** [Rule]. Effect's Context is already dynamically scoped, and DI must stay Effect-compatible. Lexical capabilities would need a second, value-passing DI system. |
| Where a clause runs | Inside or outside its prompt | **Outside**, in Γₒ [Kernel]. A clause that performs its own operation reaches the next handler out instead of recursing. |
| Context across resume | Snapshot, or delimited dynamic binding | **Snapshot** [Rule], Chapter 22. |
| Where a continuation can be consumed | Any fiber, or only the capturing fiber | **Capturing fiber only**, for resume, transfer, and abandon [Rule]. Effect frames are bound to the fiber that pushed them (T14b), and children, identity, and interruption authority stay coherent (O04, O06). The capturing fiber's exit releases what it transferred (K13a). |
| Double resume | Ignore, or defect | **Defect at the caller** for handler continuations [Rule]. Root waits keep Effect's first-wins behavior but report the loss: `resume` returns `false` (Chapter 21). |
| Which causes `catch` recovers | First failure of any cause (`Effect.catch`), or only causes made of expected failures | **`Effect.catch`'s rule** [Rule] (D306): the first expected failure of a cause with no defect. On Effect 4.0.5, a recovered mixed cause dropped a defect (the runtime boundary regression); since Effect 4.0.6, a failure beside a defect is a defect before any `catch` sees it (D305). An abandonment passes through (K14d). |
