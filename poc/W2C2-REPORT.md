# W2-C2 Concurrency POC Report

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## API surface

- `allKeyed(record)` returns a Promise of a null-prototype record whose values are awaited.
- `allSettledKeyed(record)` returns a Promise of a null-prototype record of keyed `PromiseSettledResult` values.
- `Governor.withLimit(limit)` creates a fixed-capacity FIFO governor.
- `governor.acquire()` returns a permit with an idempotent `release()` method.
- `governor.run(operation)` acquires, runs, and releases in `finally` while preserving the operation's value or rejection.
- `ConcurrencyBound` is `number | Governor`.
- `mapUnordered(inputs, mapper, boundOrOptions)` retains the compatibility overload `(inputs, bound, mapper, cancellation?)`; either overload accepts a number or shared Governor.
- `filterUnordered(inputs, predicate, boundOrOptions)` has matching modern and compatibility overloads.
- `bufferedUnordered(inputs, boundOrOptions)` performs bounded concurrent source pulls and yields their values in completion order.
- `MapUnorderedOptions`, `FilterUnorderedOptions`, and `BufferedUnorderedOptions` accept a concurrency bound and optional TypeScript cancellation adapter.

All new modules are exported through `src/concurrency/index.ts`.

## Semantics decisions

- Keyed Promise combinators snapshot own keys in ECMAScript property order, visit only enumerable properties, preserve string and symbol keys, and define writable/enumerable/configurable result data properties on a null-prototype object. Each visited input gets fulfillment and rejection handlers immediately, so a later throwing getter cannot leave earlier input rejection unobserved.
- `allKeyed` rejects with the first Promise-style rejection; `allSettledKeyed` records every input settlement but still rejects for dictionary-access failures, matching the Promise `all`/`allSettled` distinction.
- Fallible work composes as `Result.all(Object.values(await allKeyed(recordOfResultPromises)))`. This is documented beside `allKeyed`, tested with a typed Error value, and demonstrated with typed-worker Results.
- Governor admission is FIFO. Slots are reserved before a queued Promise is resolved, permit release is idempotent, synchronous reentrant enqueueing cannot recursively enter bookkeeping, and `run` releases on synchronous throw, async rejection, or cancellation. Rejection identity is unchanged. The Governor does not cancel, join, or otherwise own admitted work.
- Mapper and predicate work is completion-ordered and governed. A shared Governor coordinates the aggregate fan-out of independent helper instances.
- `bufferedUnordered` keeps at most the bound number of source pulls admitted and replenishes the buffer before yielding, so consumer work overlaps source production.
- On early exit, helpers cancel only their own child `Cancellation`, start source `return()` cleanup, and join admitted mapper/predicate/pull work before iterator closure completes. The parent remains live.
- The first failure is remembered at task-settlement time, including while a consumer is paused at `yield`. In-flight work is cancelled and joined before that exact failure is propagated; later sibling or cleanup failures cannot replace it.
- `join.ts` now constructs Result values exclusively through `RuntimeValues.success` and `RuntimeValues.failure`; compiler construction hooks are no longer used there.

## Verification

- `bun run check --pretty false`: pass.
- `bun test src/concurrency/`: 38 pass, 0 fail, 126 expectations across 5 files.
- Existing coverage preserved: 7 join/cancellation/unordered-map tests and 11 typed-worker tests (18 pre-existing tests total).
- Added coverage: 6 keyed Promise tests, 7 Governor tests, and 7 unordered async-iterator tests (20 new tests).
- `bun examples/concurrency/demo.ts`: pass; exercises keyed joins/settlements, a shared Governor, unordered map/filter/buffering, typed workers, and `Result.all` composition.

SOURCE SETTLED
