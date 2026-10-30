# Clarify sharing across sibling Layer provides

**Status:** drafted, not filed. **Target:** Effect migration documentation.
**Version:** `effect@4.0.5`.

## Behavior and reproduction

```ts
import { Context, Effect, Layer } from "effect"

class Id extends Context.Service<Id, number>()("draft/Id") {}
let builds = 0
const live = Layer.effect(Id, Effect.sync(() => ++builds))
const result = await Effect.runPromise(Effect.all([
  Effect.provide(Id, live),
  Effect.provide(Id, live)
], { concurrency: 2 }))
console.log(result, builds) // [1, 2], 2
```

The same Layer object builds twice under sibling provides, even when the calls
overlap. Run
`cd experiments && bun scripts/runtime-facts/q6-siblings.ts` for the
[resource-owning reproduction](../../experiments/scripts/runtime-facts/q6-siblings.ts).
The [historical D05 reproduction](https://github.com/smithersai/vibelang/blob/e130b5d26d024100797feafde55c5a0cd6b31eec/experiments/tests/conformance/source-claims.test.ts)
built the Layer into one MemoMap, supplied it through `Layer.CurrentMemoMap`,
and asserted one acquisition and one release. Its conformance suite was
retired with the continuation kernel; the source remains historical evidence.

The [dated research](../research/effect4-runtime.md), section 6, records a
migration note stating that memoization is shared between `Effect.provide`
calls. In 4.0.5, a provide creates a child map or a new root map. Entries built
in one sibling's child are not visible in the other sibling's child.

## Expected behavior

Documentation should distinguish reuse within one provide, reuse of an
already-built ancestor entry, and independent sibling provides. It should not
promise that siblings build a Layer once just because their Layer objects are
identical or their lifetimes overlap.

## Why it matters to VibeLang

Applications expect one database pool or one background resource per
application. VibeLang preserves Effect's memoization boundaries (D21);
`wire` composes providers but does not install a global cache.

## Suggested fix

Correct the migration note and add sibling, nested, and ManagedRuntime
examples with acquisition and release counters. Recommend providing the
application Layer once around the program, using a `ManagedRuntime` for
multiple entry points, or explicitly supplying a prebuilt MemoMap when shared
ownership is deliberate. State the owning Scope and disposal boundary for
each example. No runtime semantic change is requested.
