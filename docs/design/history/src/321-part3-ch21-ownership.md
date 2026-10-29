### 21. One-shot ownership and races

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

```ts es
approve(request, k) {
  const first = resume(k, true)
  return resume(k, false)        // defect ContinuationAlreadyConsumed, raised here (T2)
}
```

```ts ts
socket.once("connect", () => {
  if (!waiter.resume(socket)) socket.destroy()   // lost the race to cancellation: still ours to release
})
```

Both snippets consume a continuation a second time, or too late. One representation has three holders, and the law for a second consumption depends on the holder:

| Holder | What it holds | Law on a second consumption | Why it differs |
| --- | --- | --- | --- |
| A handler clause | A prompt continuation `k` | Defect at the caller | A clause that resumes twice is a programming error inside VibeLang |
| A foreign callback resuming a root wait (`suspend`) | The whole parked fiber | `resume` returns `false`; the caller keeps the value | Foreign producers race legitimately with cancellation and must learn they lost |
| A foreign producer under `handoff` | The whole parked fiber | `HandoffProtocolViolation` thrown into the producer | The producer promised one delivery and quiescence; breaking that promise is the producer's bug |

#### States

```text
                       resume(k, x) / resumeWith(k, program)
        suspended ─────────────────────────────────────────► resumed
          │   ▲
          │   └── transfer(k), standard library only: owner := the Scope region
          │       around the handler (a second transfer revokes the first)
          │
          │ abandon(k), or its owner exits: the clause returns, fails, or is
          │ interrupted; the owning Scope region closes; or the capturing fiber exits
          └─────────────────────────────────────────────────► abandoned

  resume on resumed or abandoned        → defect ContinuationAlreadyConsumed at the caller   [T2, O03, K13a]
  abandon on resumed or abandoned       → no effect                                          [Kernel]
  resume, abandon, or transfer from another fiber → defect ContinuationWrongFiber            [O04, T14, O06]
```

#### Owners

[Kernel] [Rule]

- **The clause.** By default, the clause invocation that received `k` owns it, through an `Owner(k)` frame under the clause. If the clause exits by any path while `k` is still suspended, `k` is abandoned before control leaves the clause (T3, T4). An `Owner` nested inside a captured segment abandons its own continuation when that segment is abandoned (O01, O02).
- **A Scope region, after `transfer`.** `transfer(k)` moves ownership to the Scope region around the handler, the Scope in the clause's Context, and returns a `Suspended` handle that `resume`, `resumeWith`, and `abandon` accept (T10). Closing that region abandons `k` if it is still suspended and still owned by that transfer (O03). A second transfer revokes the first (O08). Transfer into the Scope parked inside `k` itself, a direct ownership cycle, is a defect (O07). Transfer into a Scope with parallel finalizers is a defect, `TransferIntoParallelScope`, because Effect runs each parallel finalizer on a forked fiber, which could never abandon `k` (K13e).
- **The capturing fiber, always.** A transferred continuation never outlives the fiber that captured it. The first transfer on a fiber puts a `FiberExit` frame at the bottom of its stack, and when the fiber's computation ends by any path, that frame abandons every transferred continuation still suspended, newest first, before the fiber's exit is published; cleanup failures join that exit (K13a-K13d). Without it, a child that transferred into a Scope inherited from its parent and then exited left a segment no fiber could release.

`transfer` stays inside the standard library in v0 (D16). Producers' external iteration uses it on one fiber, where every rule above holds. One case is still a defect rather than a release: closing the owning Scope from another fiber while the capturing fiber is alive raises `ContinuationWrongFiber` at the closer, and the segment is released when the capturing fiber exits (K13c). Routing that close to the capturing fiber is G3.

Every consumption is fiber-affine, transfer and abandonment included. Effect frames are closures over the fiber that pushed them: `updateContext`'s restore frame calls `setContext` on that fiber (`internal/effect.ts:2200-2208`) [Effect]. An earlier kernel version abandoned on whichever fiber closed the Scope; T14b caught it rewriting the capturing fiber's live Context.

Garbage collection is never the cleanup mechanism. A suspended continuation with no owner cannot exist: capture assigns an owner atomically. No production runtime cleans up abandoned continuations from the collector; OCaml's attempt stalled over deadlocks (`continuation-prior-art.md` rule 4). Development builds may register suspended continuations with a `FinalizationRegistry` to report one collected while still suspended, as Swift's checked continuations log "leaked its continuation". That report is a diagnostic, never cleanup [Rule].

#### Double resumption

A second consumption is a defect raised at the second caller (T2). Nothing in the continuation runs twice. This differs from `Effect.callback`, which silently ignores every resume after the first (F5). Silent dropping suits racing external callbacks, which is why root waits report instead; it is wrong for a handler that resumes twice by mistake.

#### Cancellation versus resumption

JavaScript runs one fiber step at a time, so a race between a resume and an interruption is decided by which one reaches the fiber first.

| Case | Outcome |
| --- | --- |
| Handler continuation `k`; the fiber is interrupted while the clause holds `k` | The clause unwinds, then `Owner(k)` abandons `k`, then outer frames unwind. Order verified: clause finalizer, continuation finalizer, outer finalizer (T4). |
| Handler continuation; interruption arrives while the clause is masked | Recorded in π. Delivered at the perform site the moment `resume` restores an interruptible state; the body's finalizer runs and its next statement does not (T12). |
| A real interruption is pending, or arrives, during an abandonment | Kept in π alongside the abandonment's own abort, then delivered with every cleanup failure; the internal abort never appears in the final cause (I03, I10, K12a, K12b). |
| Root wait (`suspend`); resume wins | The value is delivered once; a second resume returns `false` (T5c). A later interruption unwinds normally. |
| Root wait; interruption wins | Registration cleanup runs; the late `resume` returns `false`, so the producer still owns the value and can release it (T5b). Plain `Effect.callback` drops the late value silently and returns nothing to the producer (T5a). |
| Root wait; resume accepted but deferred by the wake budget; interruption arrives before delivery | The kernel releases the value with the waiter's `release` function (K10b, W04). |
| Root wait; `register` accepts a value, then throws | The value is released, and the fiber dies with the registration's defect (W05). |
| Root wait inside a masked `acquireRelease` (the default) | The interruption is only recorded while the fiber waits. The value is delivered, its release is registered, the mask ends, and the release runs. The registration's cancellation hook never runs (K15a). |
| Root wait inside `acquireRelease(…, { interruptible: true })`, or in a `using` initializer outside any mask (D490) | Cancellation wins at once; the registration's cleanup runs. A later `resume` returns `false`, and a value accepted but not yet delivered is released by `suspend`'s `release` (K15b, K15c). |
| Producer cannot check a return value (foreign event source with asynchronous shutdown) | `handoff`: cancellation seals the gate, waits for the producer to acknowledge quiescence, and releases any late delivery before cancellation completes (H2). A deferred delivery that loses is released too (H3). A delivery after quiescence is a protocol violation raised to the producer (H4). Adapted from the independent semantics proposal. |

**A delivered value is an ownership transfer** [Rule]. A value that needs release (a socket, a lease) is owned by exactly one party at every instant: the producer until the gate accepts it, the kernel while a delivery is in flight, and the receiving computation's Scope after delivery. The receiving side registers release before any interruption can be accepted: `Effect.acquireRelease` registers it under its mask after acquisition succeeds, in both policies (`internal/effect.ts:4143-4159`). Which policy an acquisition uses is its own choice, inside `using` as outside it (D25, D401). `using` is Effect's `acquireRelease`, which registers a value's release in the step that ends its acquire, so no interruption separates the value from its release (Chapter 6, D342, D401, D490).
