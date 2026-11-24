# Prototype segmented storage for captured continuations

> **Withdrawn 2026-11-23 after VIP-35 denied control handlers.** The performance proposal and measurements below document historical continuation work.

**Status:** withdrawn, never filed. **Target:** Effect runtime.
**Version examined:** `effect@4.0.5`. **Kind:** performance proposal (G17),
dependent on the [supported-prompt proposal](effect-prompt-primitive.md).

## Current behavior and reproduction

The fiber stores continuation frames in one array. The VibeLang kernel
copies the segment above a prompt during capture and reinstallation. Capturing
once at every level of a depth-N recursive call therefore copies a quadratic
total number of frames. This is a cost of the current integration, not a
violation of an Effect stack-safety guarantee.

Minimal workload using the existing kernel, placed under `experiments/`:

```ts
import { Effect } from "effect"
import { handle, operation, resume } from "../packages/runtime/src/kernel/kernel.ts"

const Tick = operation<void, void>("draft/Tick")
const descend: (n: number) => Effect.Effect<number> = Effect.fnUntraced(function* (n: number) {
  yield* Tick()
  return n === 0 ? 0 : 1 + (yield* descend(n - 1))
})
let copied = 0
await Effect.runPromise(handle("bench", [Tick], descend(1_000), {
  "draft/Tick": (_, k) => {
    copied += k.frameCount
    return resume(k, undefined)
  }
}))
console.log(copied) // 501501
```

Run the existing [deep-capture benchmark](../../experiments/bench/deep-capture.ts):
`cd experiments && bun bench/deep-capture.ts`. At depths 1,000, 2,000, 4,000,
and 8,000, the recorded frame-copy counts are 501,501, 2,003,001, 8,006,001,
and 32,012,001. Timings vary with host load; copy counts expose the growth.

## Expected capability

Capturing a segment should detach or share opaque chunks without copying all
its frames. The normal Effect run loop and finalizer unwinding must stay fast,
and resume and abandon must retain one-shot, same-fiber ownership.

## Historical VibeLang rationale

Deep nested producers and recursive handlers in the prototype paid for copies at each perform.
The kernel cannot substitute a segmented `_stack` itself while Effect's
runtime expects an array. Ordinary service calls use in-place evidence and do
not need this optimization.

## Suggested fix

Prototype chunked frame storage behind an opaque segment API. Compare push/pop,
shallow capture, deep capture, resume, and abandonment costs against the array.
Run the kernel law suite and Effect's own finalization and scheduler tests on
both representations. Keep this an experiment until real workloads show that
the lower copy cost outweighs overhead in ordinary Effect programs.
