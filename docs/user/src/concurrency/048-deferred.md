# Deferred

A `Deferred.Deferred<A, E>` is a result another fiber can complete once. Use it to signal readiness, hand a value to waiting work, or share a one-time failure. Waiting suspends the fiber; other work keeps running.

## Creating a one-time result

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: const signal = try makeStartupSignal(); try Console.log(try Deferred.isDone(signal)); try Console.log(Option.isNone(try Deferred.poll(signal)))
error StartupFailed {
  stage: string
}

effect makeStartupSignal() {
  return try Deferred.make<string, StartupFailed>()
}
// Deferred.Deferred<string, StartupFailed>!!

effect stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}
// Output: false
// Output: true
```

A new deferred is empty, holding neither a success nor a failure. Creating it is an Effect operation, so run `Deferred.make` with `try` inside an effect function or block. Pass the same handle to the producer and every waiter that shares its result.

## Waiting for completion

```vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-17
// run: try Console.log(try waitForAddress())
effect waitForAddress() {
  const address = try Deferred.make<string>()
  const listener = fork Deferred.await(address)
  try Deferred.succeed(address, "127.0.0.1:8080")
  return join listener
}
// Output: 127.0.0.1:8080
```

`try Deferred.await(address)` waits while the handle is empty and returns at once after completion. Several fibers can await one deferred and receive the same result. Cancelling one waiter doesn't require completing the deferred for the others.

## Completing with success or failure

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try stringify(try completeOnce())); try Console.log(try shareFailure())
effect completeOnce() {
  const result = try Deferred.make<number, string>()
  const accepted = try Deferred.succeed(result, 25)
  const ignored = try Deferred.fail(result, "too late")
  return { accepted, ignored, value: try Deferred.await(result) }
}
// Returns { accepted: true, ignored: false, value: 25 }.

effect shareFailure() {
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

The first completion wins; later completions return `false`. `Deferred.done` takes an `Exit`, `Deferred.failCause` a cause, and `Deferred.interrupt` completes waiters with interruption. `Deferred.complete(deferred, program)` evaluates an Effect and shares its outcome; `completeWith` stores the Effect for each waiter to evaluate, so it doesn't promise one execution.

## Polling completion state

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try stringify(try inspectWithoutWaiting()))
effect inspectWithoutWaiting() {
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

`Deferred.isDone` reports whether completion happened. `Deferred.poll` returns `None` while empty, else `Some` of the completed Effect, which runs with `try stored`. A completed failure is still done; running its stored Effect propagates the failure.

## Coordinating work across fibers

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17
// run: try Console.log(try coordinate())
effect coordinate() {
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

The consumer can't proceed before the producer supplies its input, whichever fiber starts first. A producer that fails before completing the signal leaves waiters waiting, so real startup code also completes it with the failure, or supervises producer failure alongside the wait. A deferred is single use; use a Queue for repeated messages or a Latch for a reusable gate.
