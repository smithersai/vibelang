### 22. What resume restores

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

```ts es
handle(() => Effect.provideService(() => checkout("c-42"), AuditLog, RequestAuditLog), Approval, {
  approve(request, k) {
    AuditLog.info("in the handler")   // AppAuditLog: the clause runs outside the provide
    return resume(k, true)            // checkout continues with RequestAuditLog, its open Scope, its span
  }
})
```

A resumed computation gets back exactly the state it had when it was captured, and the handler never sees the inside of the region it handles. The full rule, state by state:

| State | At capture | While the clause runs | At resume | When the computation leaves the reinstalled prompt |
| --- | --- | --- | --- | --- |
| Frames between perform site and prompt | Moved into `k` | Parked in `k`; nothing runs; scopes stay open | Moved back above a new `Prompt` | Pop normally |
| The selected handler | Its prompt is removed | Absent. The clause runs outside its own handler, so performing the same operation reaches the next handler out [Kernel] | Reinstalled at the resume site (deep handler) | Popped |
| Context Γ: services, operation evidence, current Scope, tracing span | `k.Γ` := Γ, a pointer to an immutable snapshot | Γ := Γₒ, the Context outside the prompt (T1: the clause logs with `AppAuditLog`) | Γ := `k.Γ` (T1: `RequestAuditLog` and the open Scope are back) | Γ := the Context at the resume site (T13) |
| Interruptibility ι | `k.ι` := ι | ι := ιₒ | ι := `k.ι`; a pending interruption is delivered at once if `k.ι` (T12) | ι := the value at the resume site |
| Pending interruption π | Real requests stay with the fiber; an abandonment abort unwinding inside the segment moves into `k` | May receive new requests | Real requests are never rolled back; `k`'s moved abort is reinstated (I11) | |
| Fiber identity | Unchanged | Same fiber | Same fiber, enforced | |
| Children | Stay attached to the fiber or their Scope; keep running | | Unchanged | |
| Tracing span | Part of Γ: the clause sees the outer span | | The body sees its own span again; each span ends exactly once, when its frame exits (G6a, T01) | |
| Node `AsyncLocalStorage` | Not split. It follows the JavaScript async context, which a same-fiber capture never changes. Effect captures it only when a fiber parks and when a fork is scheduled (`internal/effect.ts:586-598, 5545`) | A store set inside the handled region is visible in the clause (G6b) | Unchanged | |

#### Snapshot Context, not delimited dynamic binding

[Rule] Prior art has two rules, and they disagree:

| Rule | What a resumed computation sees for a binding made outside the delimiter | Who uses it |
| --- | --- | --- |
| Delimited dynamic binding (DDB) | The resumer's binding | Kiselyov, Shan, and Sabry (ICFP 2006); Racket continuation marks; Koka evidence vectors; handler lookup in OCaml 5 and WasmFX |
| Snapshot at suspension | The binding it had when it suspended | TC39 AsyncContext; Effect 4 (PR #8629: "a fiber resumes in the async context it had when it suspended"); Kotlin `CoroutineContext`; Swift task-locals; tokio task-locals |

TC39's AsyncContext (Stage 2) is the closest analogue in JavaScript itself. Its specification text snapshots the context at each `await`, so code after the `await` resumes in the context it had at the `await`, and it runs a generator body in the context captured when the generator object was created, never in the context of whoever calls `.next()` (`docs/research/tc39-syntax.md` §8).

VibeLang takes the snapshot rule for three reasons:

1. **Effect's frames can only carry a snapshot.** `updateContext` pushes a frame that restores an absolute previous Context, captured in a closure (`internal/effect.ts:2186-2211`). Under DDB, a segment spliced under a different resumer would still restore the capture-time outer Context when its inner `provide` exits. That is wrong under DDB, and closures cannot be rebased. DDB would need Effect to store Context deltas instead.
2. **Dependency injection stays stable.** A resumed computation keeps the providers it selected. Under DDB, where and when a continuation is resumed would change which `Database` a half-finished service method talks to.
3. **Leaking a resumer's Context is a security bug class.** Request-scoped services (current user, tenant, credentials) must not flow into another request's computation. Effect 3 shipped exactly that leak through `AsyncLocalStorage` (GHSA-38f7-945m-qr2g, CVE-2026-32887).

The cost is real, and it applies to handler lookup: a continuation transferred out of its outer handlers' region, then resumed where a different handler for the same operation is installed, does not rebind to that handler but fails loudly with `HandlerPromptExited` (T15) [Kernel]. The independent semantics proposal reached the same choice for the same DI reason. A program that needs the rest of a computation under different providers runs a fresh program under them; it does not rebind a live continuation.

#### `AsyncLocalStorage` is fiber-wide, not delimited

[Kernel] [Rule] Node offers no public way to switch the async context in the middle of a run loop; `AsyncResource.runInAsyncScope` only scopes a callback. G6b shows the consequence: a store entered inside a handled region leaks into the clause. Request-scoped values in VibeLang therefore live in Context, which the kernel does delimit. `AsyncLocalStorage` remains a bridge for foreign libraries at fiber granularity, and VibeLang code does not write to it.

#### Why the reinstalled prompt records the resume site's Context

After `resume(k, x)` returns, the clause continues; it must see its own Context, not the body's. T13 resumes from inside a clause-local `provide` and checks three things: the body after resumption sees its own provider; the next clause invocation sees the resume site's provider; and so does the clause after `resume` returns.

The reference machine (strategy B, Chapter 25) does not implement this rule yet. The runtime boundary regression resumes under a clause-local provider and performs again: the kernel's next clause sees the resume site's provider, as specified, while strategy B reuses its old prompt and sees the `handle` site's. The rule stands; aligning strategy B with it is the first law of G16.
