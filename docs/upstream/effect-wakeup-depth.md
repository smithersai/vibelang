# Bound synchronous fiber wake-up depth

**Status:** drafted, not filed. **Target:** Effect runtime.

**Title:** Synchronous fiber wake-ups have no depth guard: a chain of ~1,000 `Deferred` wake-ups overflows and silently strands the rest (4.0.5)

**Version:** effect 4.0.5. Node 26.10.0 and Bun 1.4.1, macOS arm64.

**What happens.** When fiber A completes a `Deferred` that fiber B awaits, B runs synchronously on A's JavaScript stack (`Effect.callback` resume calls `fiber.evaluate` inline, `internal/effect.ts:1155-1164`). If B then completes a `Deferred` that C awaits, C runs nested inside B, and so on. `evaluate`/`runLoop` keep no depth counter (`internal/effect.ts:583-679`; `currentOpCount` resets on each entry). At about 815 to 1,400 hops on Node, or 3,000 to 4,700 on Bun, one fiber dies with `RangeError: Maximum call stack size exceeded`. Every later fiber in the chain waits forever, and nothing reports the problem unless someone observes the dead fiber. One run on Bun at 5,000 hops spun at 98% CPU instead.

The same nesting applies to `PubSub.publish`, fiber exit observed through `Fiber.join`/`Fiber.await`, rendezvous queues, `Queue.shutdown`, and late `Effect.callback` resumes. Buffered `Queue.offer`, `Latch.open`, and `Semaphore.release` schedule through the dispatcher. Capacity-zero queue offers can resume takers inline, so the queue distinction depends on capacity and operation.

**Minimal repro** (bun test or node):

```ts
import { Deferred, Effect, Fiber } from "effect"

const N = 5_000
await Effect.runPromise(Effect.gen(function*() {
  const gates = yield* Effect.forEach(Array.from({ length: N + 1 }), () => Deferred.make<number>())
  const fibers: Array<Fiber.Fiber<unknown>> = []
  for (let i = 0; i < N; i++) {
    fibers.push(yield* Effect.forkChild(
      Effect.flatMap(Deferred.await(gates[i]!), (n) => Deferred.succeed(gates[i + 1]!, n + 1))
    ))
  }
  yield* Effect.yieldNow
  yield* Deferred.succeed(gates[0]!, 0)
  yield* Effect.sleep("50 millis")
  console.log("finished:", yield* Deferred.isDone(gates[N]!))   // false
  console.log("dead:", fibers.filter((f) => f.pollUnsafe()?._tag === "Failure").length)   // 1, RangeError
}))
```

**Expected.** The chain completes. This is a regression from Effect 3: the same chain on effect 3.22.3 completes for N = 1,000, 5,000, and 100,000 on both Node 26.10.0 and Bun 1.4.1 (`experiments/scripts/v3-wakeup-chain.mjs`).

**Suggestion.** Bound inline resumption: track nesting depth in `evaluate` and, past a small budget, schedule the resumption on the woken fiber's dispatcher instead of running it inline. A budget of 64 nested wake-ups completes a 100,000-fiber chain in our tests while keeping the inline fast path for shallow wake-ups.

**VibeLang impact.** The kernel bounds its own `suspend` wake-ups, but
`Deferred`, `PubSub`, and TypeScript-authored Effects still use Effect's native
wake-ups. One stranded dependency can leave an application waiting forever.
Observe failed fibers in the reproduction instead of relying only on a timeout.

**Evidence:** [wakeup-chain.test.ts](../../experiments/tests/wakeup-chain.test.ts).
Run `cd experiments && bun test tests/wakeup-chain.test.ts`: `F10a` passes by
asserting exhaustion of a tracer's logical stack budget of `64` evaluations,
with one `RangeError` and the rest of the chain stranded. This leaves native
stack space for error recovery: exhausting the actual host stack can livelock
Effect's error handler and made the documentation suite intermittent.
`K10a` still completes a `100,000`-fiber chain using the kernel's depth budget.
Host-dependent native thresholds are measured separately by
`node scripts/wakeup-chain-depth.ts`.
The Effect 3 comparison is
[v3-wakeup-chain.mjs](../../experiments/scripts/v3-wakeup-chain.mjs); it requires
the extracted Effect 3 package described in that script.
