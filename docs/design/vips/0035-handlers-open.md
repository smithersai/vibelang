# VIP-35: effect handlers (`control`, `handle`, `resume`, `abandon`) (open)

**Status:** open, 2026-10-29. Listed for a future decision and not part of the first release. Will: "yea list as an open VIP".

## What it is

Old VibeLang's own feature, built on one-shot delimited continuations. Effect has no equivalent.

```ts
control Approval { approve(request: string): boolean!ReviewBusy }

effect function reviewedCheckout(cartId) {
  try { return try checkout(cartId) }               // checkout calls Approval.approve(…) inside
  handle Approval.approve(request) {
    const decision = try Reviewers.decide(request)
    return try resume(decision)                     // checkout continues from its call
  }
}
```

## Its use cases, and how Effect already covers them

| Use case | With services and Effect, no handlers |
| --- | --- |
| Pause a checkout until a person approves | An `Approval` service whose implementation calls `Reviewers.decide`; the fiber waits |
| Stop a search at the first result | `try.any` or a race; interruption cleans up |
| Script a test's answers in sequence | Provide a test implementation of the service (a `Ref` of answers) |
| Run a producer one value at a time | VIP-21 (`Stream.callback`) |

## What reopening it must resolve

- Its `try { … } handle …` form is a try statement, which VIP-5 removed from effect functions. `Approval.approve(…)` is the service shorthand VIP-10 denied. It needs new syntax.
- It is the largest runtime piece: continuations, answer types (D351, D410), tail resume (D557). VIP-31 currently promises no runtime semantics beyond Effect's.
- **Note 2026-10-29: the first release ships without handlers.** No accepted VIP adds `control`, `handle`, `resume` or `abandon`, so they and the continuation runtime are removed from the compiler. This VIP stays open. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.

## History

About 6 findings across 10 rounds.
