# W5-C Concurrency and Streams POC Report

## API surface

### Cancellation

- `Cancellation` and `Cancelled` reuse the constructors already owned by `join.ts`, preserving capability lookup, `instanceof`, mapper cancellation, and the stable `vibelang:Cancelled@1` wire identity.
- The shared `Cancellation` prototype now supplies `isCancelled()` and `onCancel(handler)`. `checkpoint()`, `check()`, `whenCancelled()`, parent/child linkage, and the AbortSignal view remain coherent with `join.ts`.
- `CancellationRegistration` is a frozen, WeakSet-branded, idempotent disposal handle with `dispose()`, `[Symbol.dispose]()`, and `active`.
- `CancellationSource` is the live manual source. It accepts an optional linked `AbortSignal`, exposes a callable-and-property-compatible signal bridge, cancels once, and can unlink its external signal.
- `alreadyCancelled(reason)` and `neverCancelled()` provide deterministic test tokens.
- `cancellationSignal`, `cancellationError`, `cancellationCheckpoint`, and `onCancellation` are TypeScript adapter utilities shared by the primitives.

### Semaphore

- `new Semaphore(size)` / `Semaphore.withPermits(size)` require a positive safe-integer bound.
- `acquire(cancellation?)` returns `Promise<SemaphorePermit>`, queues fairly, and rejects a cancelled waiter with the existing nominal `Cancelled`.
- `tryAcquire()` returns `Optional<SemaphorePermit>`.
- `withPermit(operation, cancellation?)` releases in `finally` after fulfillment, rejection, or cancellation.
- `SemaphorePermit` is frozen, WeakSet-branded, idempotently releasable, and supports `[Symbol.dispose]()`.
- `size`, `activeCount`, `availableCount`, and `pendingCount` expose accounting for diagnostics and tests.

### Queue

- `new Queue<T>(capacity)` / `Queue.bounded<T>(capacity)` create a bounded FIFO MPMC queue; capacity is mandatory and must be a positive safe integer.
- `offer(value, cancellation?)` returns `Promise<Result<void, QueueClosed | Cancelled>>` and suspends while full.
- `take(cancellation?)` returns `Promise<Result<T, QueueClosed | Cancelled>>` and suspends while empty.
- `tryOffer` and `tryTake` return `Optional<Result<...>>`: `None` is temporary backpressure/absence, while `Some(Error(QueueClosed))` preserves permanent shutdown as a typed failure.
- `shutdown(reason)` is idempotent, settles every pending producer and consumer, rejects future operations, and permits already-accepted buffered values to drain.
- `QueueClosed` is nominal and registered as `vibelang:QueueClosed@1` with a strict wire codec.
- `capacity`, `size`, `pendingTakers`, `pendingOfferers`, and `isShutdown` expose queue state.

### Channel

- `new Channel<T>(capacity = 1)` / `Channel.buffered<T>(capacity)` provide a closeable small-buffer channel over `Queue`.
- `send`, `receive`, `trySend`, and `tryReceive` preserve Queue Result/Optional and cancellation semantics.
- `close(reason)` propagates `QueueClosed` to pending senders and receivers.
- Async iteration drains accepted values and treats `QueueClosed` as clean end-of-stream.

### Stream

- `Stream.fromIterable`, `Stream.fromAsyncIterable`, and `Stream.of` create frozen, WeakSet-branded, reusable lazy streams.
- Lazy combinators: `map`, `filter`, `take`, `drop`, and `scan`.
- `mapConcurrent(project, limit | Governor | options)` delegates to `mapUnordered`, yields completion order, honors shared governors, and inherits its child cancellation/join discipline.
- `buffer(queueCapacity)` uses a bounded `Queue`, retains source order, contains late pull rejection, and joins producer/source cleanup on early exit.
- `interrupt(Cancellation | AbortSignal)` and cancellation options on terminal runners provide typed interruption.
- `runCollect`, `runForEach`, and `runFold` return `Promise<Result<...>>`. Local producer errors remain expected failures, non-Error foreign throws become `UnhandledException`, and Panics are not swallowed.

All APIs are exported through `src/concurrency/index.ts`, and `examples/concurrency/demo.ts` now exercises Queue, Semaphore, Channel, Stream, buffering, and governed concurrent mapping.

## Semantics decisions

- Mutable services keep all state in module-private WeakMaps and authenticate instances with WeakSets. Value-like Stream instances, permits, and cancellation registrations are frozen and non-forgeable.
- Queue and Channel reject `null` and `undefined` elements because `tryTake`/`tryReceive` use `Optional`, whose present variant cannot carry either value.
- Semaphore, Queue producer, and Queue consumer waiters are FIFO. Cancellation removes the waiter immediately before settling it, so it cannot consume a future permit, queue slot, or item.
- Queue shutdown preserves already-accepted buffered values. Suspended offers were not accepted and fail immediately; suspended/future takes fail once no buffered value remains.
- Cancellation listener exceptions are contained. Listeners are observation callbacks, not detached child tasks; fallible work belongs in an awaited operation.
- Stream `take` and all early consumer exits invoke iterator cleanup. `mapConcurrent` joins admitted mapper work through `mapUnordered`; `buffer` cancels its private producer, closes the source, and awaits cleanup before iterator return completes.
- `mapConcurrent` is deliberately unordered, matching the existing helper it delegates to. Sequential `map` preserves order.
- Every internally started Promise has fulfillment/rejection containment. The tests install a process-level `unhandledRejection` observer and assert that it remains empty.

## Tests and verification

- Added 37 tests in five files: 7 cancellation, 6 semaphore, 7 queue, 6 channel, and 11 stream tests.
- `bun test src/concurrency/`: **75 pass, 0 fail, 267 expectations across 10 files**. This preserves the 38-test baseline and adds all 37 W5-C tests.
- Coverage includes FIFO proofs, full/empty suspension and wakeup, shutdown with pending waiters, cancellation removal/accounting, AbortSignal linkage, disposal handlers, wire round-trips, structural forgery rejection, stream laws, concurrent-bound proof, early-break joining, buffering, expected producer failure, and unhandled-rejection hygiene.
- Scoped TypeScript verification over every W5-C source/test plus the concurrency demo: pass.
- `bun examples/concurrency/demo.ts`: pass.
- Full `bun run check --pretty false`: no W5-C diagnostics, but the shared worktree currently fails in concurrent edits under `src/durable/bundle-worker.test.ts` and `src/targets/portable-backend*`.

## Limitations

- `join.ts` already defines a concrete `Cancellation extends Context` whose bridge is a `signal` getter. Because W5-C was explicitly forbidden from changing that file, defining a second abstract `Cancellation` or `Cancelled` would break capability keys, `instanceof`, and wire identity. W5-C therefore reuses and augments that class. `CancellationSource.signal` is callable as `signal()` and remains AbortSignal-property-compatible, but the base `Cancellation` TypeScript declaration remains the pre-existing getter. Making the base declaration literally abstract with a `signal()` method requires a coordinated `join.ts` change.
- Channel implements the permitted small-buffer design, not a zero-capacity rendezvous channel. Its default buffer is one; Queue itself never has an unbounded or implicit capacity.
- JavaScript has no universal way to abort a hostile `AsyncIterator.next()` that ignores both cancellation and `return()`. Stream cleanup races the logical pull, attaches handlers to contain any late rejection, calls and awaits `return()`, and joins all work it can own—the same boundary documented by the existing async-iterator helpers.
- Streams preserve local Error identity at runtime, but TypeScript cannot infer a callback's thrown Error type. Callers that need a narrower compile-time failure channel must supply the stream failure generic at a typed boundary.

SOURCE SETTLED
