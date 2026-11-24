# Deferred

A `Deferred.Deferred<A, E>` is a write-once synchronization cell completed by one fiber and awaited by any number of others. Use it to signal readiness, hand off a single value, or broadcast a one-time failure while suspending waiters without blocking the thread.

![Fiber coordination with Deferred and Semaphore](/diagrams/deferred-and-semaphore.svg)

| Operation | Behavior |
| --- | --- |
| `Deferred.succeed` / `Deferred.fail` | Completes once with a value or typed error; returns `false` if already completed |
| `Deferred.done` / `failCause` / `interrupt` | Completes with an `Exit`, a full `Cause`, or interruption |
| `Deferred.complete(d, eff)` | Runs `eff` once and stores its outcome for all waiters |
| `Deferred.completeWith(d, eff)` | Stores `eff` itself so each waiter evaluates it independently |
| `Deferred.isDone` / `Deferred.poll` | Non-blocking completion check and `Option` of the stored Effect |

## Creating a one-time result

```vibe
// run: const signal = try makeStartupSignal(); try Console.log(try Deferred.isDone(signal)); try Console.log(Option.isNone(try Deferred.poll(signal)))
error StartupFailed {
  stage: string
}

effect function makeStartupSignal() {
  return try Deferred.make<string, StartupFailed>()
}
// Deferred.Deferred<string, StartupFailed>!!
// Output: false
// Output: true
```

A freshly created deferred is empty. Allocation is an Effect operation, so call `try Deferred.make<A, E>()` inside an effect context and share that handle across the producer and every waiter.

## Waiting for completion

```vibe
// run: try Console.log(try waitForAddress())
effect function waitForAddress() {
  const address = try Deferred.make<string>()
  const listener = fork Deferred.await(address)
  try Deferred.succeed(address, "127.0.0.1:8080")
  return join listener
}
// Output: 127.0.0.1:8080
```

`try Deferred.await(address)` suspends until completion and returns immediately afterward. Any number of fibers may await the same deferred and observe the same result; interrupting one waiter leaves the deferred open for the rest.

In an `async` function, `await deferred` preserves JavaScript's behavior and reports `EK4610` (only values implementing the full `Deferred` interface trigger it, not wrappers or marker-only objects); write `await runPromise(Deferred.await(deferred))` with fresh imports to wait while evaluating `deferred` once. In effect code, `await` always reports `EK0102`, offering `try Deferred.await(value)` guidance only when the value implements the full `Deferred` interface.

## Completing with success or failure

```vibe
// run: { const jsonValue = try completeOnce(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(try shareFailure())
effect function completeOnce() {
  const result = try Deferred.make<number, string>()
  const accepted = try Deferred.succeed(result, 25)
  const ignored = try Deferred.fail(result, "too late")
  return { accepted, ignored, value: try Deferred.await(result) }
}
// Returns { accepted: true, ignored: false, value: 25 }.

effect function shareFailure() {
  const result = try Deferred.make<number, string>()
  try Deferred.fail(result, "configuration missing")
  const outcome = Deferred.await(result) catch (error) => ({ error })
  if (typeof outcome === "number") return outcome
  try Console.log(outcome.error)
  return 0
}
// Output: {"accepted":true,"ignored":false,"value":25}
// Output: configuration missing
// Output: 0
```

The first completion wins and returns `true`; every later completion returns `false` and is ignored. Use `Deferred.complete` to execute an Effect once and share its outcome, and reserve `Deferred.completeWith` for cases where each waiter should run the stored Effect itself.

## Polling completion state

```vibe
// run: { const jsonValue = try inspectWithoutWaiting(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function inspectWithoutWaiting() {
  const result = try Deferred.make<number>()
  const before = try Deferred.isDone(result) // false
  try Deferred.succeed(result, 9)
  const observed = try Deferred.poll(result)
  if (Option.isSome(observed)) {
    const stored = observed.value
    return { before, value: try stored }
  }
  return { before, value: undefined }
}
// Output: {"before":false,"value":9}
```

`Deferred.isDone` returns a boolean without suspending. `Deferred.poll` returns `None` while empty or `Some(storedEffect)` once completed; running `try stored` yields the value or propagates the stored failure.

## Coordinating work across fibers

```vibe
// run: try Console.log(try coordinate())
effect function coordinate() {
  const prepared = try Deferred.make<ReadonlyArray<string>>()
  const producer = fork effect {
    try sleep("20 millis")
    try Deferred.succeed(prepared, ["part-a", "part-b"])
  }
  const consumer = fork effect {
    const parts = try Deferred.await(prepared)
    return parts.join("+")
  }
  const result = join consumer
  join producer
  return result
}
// Output: part-a+part-b
```

The consumer blocks until the producer completes `prepared`, regardless of start order. If a producer can fail before completing the deferred, complete the deferred with that failure (or supervise both fibers together) so waiters do not hang indefinitely. A deferred is single-use: reach for a `Queue` for streams of messages or a `Latch` for a reusable gate.
