# Define generator cleanup on Effect failure and interruption

**Status:** drafted, not filed. **Target:** Effect runtime.

**Title:** `Effect.gen` / `Effect.fn` never run JavaScript `finally`, `catch`, or `using` cleanup on failure or interruption (4.1.1); the language service calls `try/finally` valid cleanup

**Version:** effect 4.1.1.

**What happens.** The generator frame created by `Effect.gen`, `Effect.fn`, `Effect.fnUntraced`, and `Effect.fnUntracedEager` (`fromIteratorUnsafe`, `internal/effect.ts:1473`) defines only a success continuation. When a yielded effect fails, or the fiber is interrupted while suspended inside the generator, the frame is popped and the generator object is dropped. Nothing calls `iterator.throw()` or `iterator.return()`. JavaScript `catch`, `finally`, and `using` disposal inside the body therefore never run on those paths.

```ts
import { Effect, Fiber } from "effect"

const log: Array<string> = []
await Effect.runPromiseExit(Effect.gen(function*() {
  try { yield* Effect.fail("boom") } finally { log.push("finally") }
}))
console.log(log)   // []

await Effect.runPromise(Effect.gen(function*() {
  const fiber = yield* Effect.forkChild(Effect.gen(function*() {
    try { yield* Effect.never } finally { log.push("finally on interrupt") }
  }))
  yield* Effect.sleep("1 millis")
  yield* Fiber.interrupt(fiber)
}))
console.log(log)   // []
```

**Why it matters.** The Effect language service warns on `try/catch` inside `Effect.gen` (language-service#271) but exempts `try/finally` as a valid cleanup pattern (language-service#442). At runtime that cleanup does not run on failure or interruption, so users following the exemption leak resources.

**Expected behavior.** Either generator cleanup runs on failure and interruption,
or the API documentation explicitly states that JavaScript cleanup is unsupported
and tooling reports it. Driving effects yielded from `finally` requires a defined
masking and cause-combination policy; calling `return()` once is insufficient.

**VibeLang impact.** Every pausing function lowers source `catch`, `finally`,
and `using` into Effect recovery and finalizer frames. A generator frame must not
own source cleanup. This is the frame invariant in the spec, not a request to
make JavaScript `catch` recover Effect failures automatically.

**Options.** (a) Call `iterator.return()` when unwinding past a generator frame, and drive any effects yielded from `finally` uninterruptibly. (b) Document that generator `finally` is not a finalizer, and change the language-service rule to warn on `try/finally` and `using` inside generators, pointing to `Effect.ensuring` / `acquireRelease`.

**Evidence:** [F1-F3](../../experiments/tests/effect-facts.test.ts), with the
generator variants and disposal in
[q8-generators.ts](../../experiments/scripts/runtime-facts/q8-generators.ts).
Run `cd experiments && bun test tests/effect-facts.test.ts`, or
`bun scripts/runtime-facts/q8-generators.ts`. The failed-yield and interrupted
cases record no JavaScript cleanup; the JavaScript-throw control does run it.

The [language-service draft](language-service-generator-cleanup.md) addresses
the tooling exemption separately. The references to language-service issues
above come from the dated local research, not a fresh upstream status check.
