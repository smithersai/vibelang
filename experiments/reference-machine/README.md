# Reference machine (strategy B)

**PROPOSED:** This is an explicit-frame reference runtime for the language contract in [independent-design.md](../../docs/research/independent-design.md). It uses public Effect APIs and keeps handler clauses and resumed computations in one Effect fiber.

**VERIFIED:** Effect is pinned to exactly 4.1.0. Installation and tests run with Bun:

```sh
# VERIFIED: run from experiments/reference-machine/
bun install
bun test
```

**VERIFIED:** [kernel.ts](./kernel.ts) implements cold IR nodes, dynamic deep handlers, one-shot resume/discontinue/abandonment, Context restoration, scopes, masks, fork/join and a resource handoff adapter. [kernel.test.ts](./kernel.test.ts) contains the seven requested scenarios and additional semantic probes. Recorded results are in [test-results.txt](./test-results.txt).

**VERIFIED:** The runtime erases static E/R types, cannot capture inside an opaque lifted Effect, and copies frame arrays on capture/resume. The deep test suspends all 100001 activations at depth 100000; it also exercises quadratic frame copying. This is an executable semantics prototype rather than a performance-oriented implementation or a compiler.

**PROPOSED:** `handoff` requires a one-delivery producer and a cancel-and-join action that guarantees quiescence. Resource acquisition should wrap it in Effect.acquireRelease with interruptible acquisition, so a successful delivery is registered for release before interruption can be accepted. The race tests exercise both delivery and cancellation winners while a handler owns a live continuation.

**UNTESTED:** General foreign-mask equivalence, cross-thread races, generators/streams, static contract/lifetime checking and native Effect prompt frames need additional implementations and experiments.
