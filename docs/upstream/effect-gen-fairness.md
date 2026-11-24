# Count completed generator yields toward cooperative scheduling

**Status:** drafted, not filed. **Target:** Effect runtime.
**Version:** `effect@4.1.1`.

## Behavior and reproduction

```ts
import { Effect, Fiber } from "effect"

let count = 0
let observed = -1
await Effect.runPromise(Effect.gen(function* () {
  const spinner = yield* Effect.forkChild(Effect.gen(function* () {
    for (let i = 0; i < 200_000; i++) {
      count++
      yield* Effect.void
    }
  }))
  const observer = yield* Effect.forkChild(Effect.sync(() => { observed = count }))
  yield* Fiber.join(spinner)
  yield* Fiber.join(observer)
}))
console.log(observed) // 200000: every completed yield ran before the observer
```

Run the existing comparison:
`cd experiments && bun scripts/runtime-facts/q2-gen-exit-starvation.ts`.
[The script](../../experiments/scripts/runtime-facts/q2-gen-exit-starvation.ts)
also yields `Effect.sync(bump)` in the loop as a control; that observer runs
before the loop finishes. `fromIteratorUnsafe` consumes successful Exit values
inside its own `while` loop without returning to `runLoop`'s yield check.

## Expected behavior

Long generator loops that yield Effects should periodically give the scheduler
a chance to run other fibers. Completed Effects should have a bounded inline
fast path, rather than making a loop atomic for an unbounded number of yields.
Ordinary JavaScript loops without yielded Effects remain atomic.

## Why it matters to VibeLang

The compiler avoids emitting known-completed Effect yields in loops because
they do not provide fairness or interruption delivery. TypeScript-authored
generators that VibeLang calls can still encounter the same starvation.

## Suggested fix

Count inline Exit steps toward a budget and periodically return control to the
fiber run loop with the iterator frame retained. Respect explicit scheduler
yield prevention and preserve the fast path for short generators. Add a test
with a competing fiber and a separate pending-interruption test; benchmark the
completed-Effect path before choosing the budget.
