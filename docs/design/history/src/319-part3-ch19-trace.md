### 19. The checkout trace, step by step

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

This chapter follows one program through the machine before Chapter 20 defines it: the checkout from Chapter 9, simplified, plus a request-scoped audit log so the trace shows which Context each piece of code sees. Kernel test T1 runs exactly this program, lowered by hand.

```ts es
service AuditLog { info(message: string): void!! }
service Inventory { reserve(cartId: string): Hold!!Scope }
service Reviewers { decide(request: string): boolean!! }

control Approval {
  approve(request: string): boolean!!
}

function checkout(cartId: string) {
  using hold = Inventory.reserve(cartId)        // released when checkout's body exits
  const ok = requestApproval(cartId)
  if (!ok) throw new Declined({ cartId })
  return `charged ${cartId} holding ${hold}`
}

function requestApproval(cartId: string) {
  AuditLog.info(`approval needed for ${cartId}`)
  const ok = Approval.approve(`checkout ${cartId}`)   // the capture happens here
  AuditLog.info(`approval ${ok ? "granted" : "denied"}`)
  return ok
}

const receipt = handle(
  () => Effect.provideService(() => checkout("c-42"), AuditLog, RequestAuditLog),
  Approval,
  {
    approve(request, k) {
      AuditLog.info(`clause handling "${request}"`)   // runs outside the provide: AppAuditLog
      const decision = Reviewers.decide(request)      // the whole fiber waits on a timer
      AuditLog.info(`clause resuming with ${decision}`)
      return resume(k, decision)
    }
  }
)
```

The generated TypeScript for the `handle` (the runtime package's API is shown as the compiler will emit it; the kernel prototype also takes a label):

```ts gen
const receipt = yield* handle(Approval,
  Effect.provideService(Effect.suspend(() => checkout("c-42")), AuditLog, RequestAuditLog),
  {
    approve: Effect.fnUntraced(function* (request: string, k: Continuation<boolean, never, string>) {
      const auditLog = yield* AuditLog
      yield* auditLog.info(`clause handling "${request}"`)
      const reviewers = yield* Reviewers
      const decision = yield* reviewers.decide(request)
      yield* auditLog.info(`clause resuming with ${decision}`)
      return tailResume(k, decision)              // a tail resume: returned, never yielded
    })
  })
```

#### The machine, step by step

Notation: K is the fiber's frame stack, listed bottom to top; Γ is its Context. `Prompt` marks where `handle` was installed, `Restore` undoes a `provideService`, `Final(S₁)` closes `checkout`'s Scope, `Owner(k)` holds the captured continuation while the clause runs, and `Clause(k)` performs a tail resume the clause returns. `checkout`'s `using` makes its body a Scope region, so `checkout` has two frames: the function frame and the region frame `checkout/scope` (Chapter 26).

```text
① just before the perform (fiber 1)
   K = … main │ Prompt(Approval, Γ₀) │ Restore(Γ₀′) │ checkout │ Final(S₁) │ checkout/scope │ requestApproval
   Γ = { AuditLog: RequestAuditLog, Approval → prompt, Scope: S₁ open }

② Approval.approve(…) captures 5 frames
   k.K₁ = [ Restore(Γ₀′) │ checkout │ Final(S₁) │ checkout/scope │ requestApproval ]
   k.Γ  = { AuditLog: RequestAuditLog, Approval → prompt, Scope: S₁ open }
   K    = … main │ Owner(k) │ Clause(k) │ clause
   Γ    = Γ₀ = { AuditLog: AppAuditLog, … }                   the clause runs at the prompt

③ Reviewers.decide → Effect.sleep → fiber 1 parks at its root
   K is intact: … main │ Owner(k) │ Clause(k) │ clause │ (sleep's frames)
   another fiber runs; S₁ is still open; the hold is still held

④ timer fires → fiber 1 wakes at the root → the clause returns tailResume(k, true)
   → Clause(k) resumes k; Owner(k) is inert and is dropped
   K = … main │ Prompt(Approval, Γ₀) │ Restore(Γ₀′) │ checkout │ Final(S₁) │ checkout/scope │ requestApproval
   Γ = k.Γ                                                RequestAuditLog and S₁ are back

⑤ requestApproval returns true → checkout returns → Final(S₁) releases the hold
   → Restore → Prompt restores Γ₀ → handle returns the receipt
```

The kernel's own trace from `bun test tests/trace.test.ts` (frame labels: `OnExit` is Effect's restore or finalizer frame, `fn x` a compiled function frame, `Iterator` an `Effect.gen` frame). T1 names the service `Logger`, with two implementations `AppLogger` and `RequestLogger`, and writes its clause by hand as a generator ending in `return yield* resume(k, decision)`. That is not a tail resume, so the reinstated stack keeps the clause's frames (`Owner`, `Clause`, and the clause's `Iterator`) under the new prompt. Step ④ shows the compiled shape, which drops them (K11a):

```text
capture Approve on fiber 1: 5 frames
  segment (bottom->top): OnExit | fn checkout | OnExit | fn checkout/scope | fn requestApproval
  saved context: Logger=RequestLogger, Approve->Prompt, Scope(Open)
resume Approve on fiber 1
  reinstated top: OnExit | OnExit | OnExit | Iterator | Owner | Clause | Iterator | Prompt | OnExit | fn checkout | OnExit | fn checkout/scope | fn requestApproval
  restored context: Logger=RequestLogger, Approve->Prompt, Scope(Open)

events:
  reserve c-42
  [RequestLogger] approval needed for c-42
  [AppLogger] clause handling "checkout c-42"
  other fiber ran while the main fiber was suspended
  reviewer approved "checkout c-42"
  [AppLogger] clause resuming with true
  [RequestLogger] approval granted
  release hold-1
```

#### What the trace shows

- **Two continuations exist at step ③, of different kinds.** `k` is a handler continuation: five frames owned by the clause. The fiber's own stack, parked by `Effect.sleep`, is a root continuation owned by the scheduler. Both are one-shot; the first is the kernel's, the second is Effect's.
- **The handler runs outside its own `provide`.** The clause logs through `AppAuditLog`; the resumed body logs through `RequestAuditLog` again (Chapter 22).
- **Resources stay open while a continuation waits.** The hold is released once, at step ⑤, when `checkout` returns.
- **Ownership is explicit.** `Owner(k)` stays under the clause until the clause finishes. A clause that ends with a tail resume finishes first, so its owner is dropped as `k` resumes; a clause that does work after `resume` keeps it until that work ends (Chapter 20).
