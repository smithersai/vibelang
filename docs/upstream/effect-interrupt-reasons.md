# Explain repeated Interrupt reasons introduced by tracing

> **Withdrawn 2026-11-23.** Effect 4.1.1 reports one interrupt reason for each tested case: `Effect.gen`, a single `Effect.fn`, nested `Effect.fn` calls, and `withSpan`. The old counts below describe 4.0.5.

**Status:** withdrawn, never filed. **Target:** Effect runtime and diagnostics docs.
**Version:** `effect@4.0.5`. **Kind:** diagnostic representation proposal.

## Behavior and reproduction

```ts
import { Cause, Effect, Exit, Fiber } from "effect"

const exit = await Effect.runPromise(Effect.gen(function* () {
  const child = yield* Effect.forkChild(
    Effect.fn("draft/wait")(function* () { yield* Effect.never })()
  )
  yield* Effect.sleep("1 millis")
  yield* Fiber.interrupt(child)
  return yield* Fiber.await(child)
}))
if (Exit.isFailure(exit)) {
  console.log(exit.cause.reasons.filter(r => r._tag === "Interrupt").length)
  console.log(Cause.interruptors(exit.cause).size)
}
// Effect 4.1.1: one reason, then one interruptor.
```

Run the [existing comparison](../../experiments/scripts/runtime-facts/q3-fn-interrupt-reasons.ts):
`cd experiments && bun scripts/runtime-facts/q3-fn-interrupt-reasons.ts`.
The research observed one Interrupt reason for `Effect.gen`, three for one
`Effect.fn`, six for nested `Effect.fn` calls, and two for `withSpan`, all with
the same interruptor id. Cause annotations differ by reference as stack
information is attached during unwinding.

## Expected behavior

Diagnostics should distinguish interruptor identities from annotated stack
observations. Adding tracing should not make a
single interruption appear to be several unrelated cancellation events.
Retain useful stack annotations even when grouping reasons by interruptor.

## Historical VibeLang rationale

Tracing is opt-in, and enabling it changes the number of reasons developers
see. Abandonment must retain every real pending interruption and cleanup
failure while removing only its own sentinel. Miscounting reasons makes these
guarantees harder to verify and can inflate cancellation metrics.

## Suggested fix

Document `Cause.interruptors` as the way to count distinct interruptor ids.
Consider grouping repeated annotated Interrupt reasons in pretty printing, or
merging their annotations while preserving all sites. Add traced and untraced
regression cases. Do not simply discard annotations or deduplicate all reasons
by fiber id, since distinct sites carry useful diagnostic information.
