# SubscriptionRef

A `SubscriptionRef<A>` combines a `SynchronizedRef` with a live change stream. Each subscriber receives the current value immediately upon subscribing, followed by every subsequent committed update.

![Atomic Ref vs. reactive SubscriptionRef](/diagrams/ref-and-subscriptionref.svg)

## Combining state with subscriptions

```vibe
// run: const progress = try makeProgress(); try advance(progress); { const jsonValue = try SubscriptionRef.get(progress); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function makeProgress() {
  return try SubscriptionRef.make({ completed: 0, total: 12 })
}

effect function advance(progress: SubscriptionRef.SubscriptionRef<{
  completed: number
  total: number
}>) {
  try SubscriptionRef.update(progress, (state) => ({
    ...state,
    completed: state.completed + 1
  }))
}
// Output: {"completed":1,"total":12}
```

`SubscriptionRef.make(initial)` allocates the cell and its broadcast hub. Every update commits the new state and publishes it to active subscribers. Store immutable values so past snapshots emitted to subscribers are never mutated under them.

## Reading and updating observable state

```vibe
// run: { const jsonValue = try renameStatus(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function renameStatus() {
  const status = try SubscriptionRef.make("starting")
  const before = try SubscriptionRef.get(status)
  try SubscriptionRef.set(status, "running")
  const after = try SubscriptionRef.updateAndGet(status, (s) => s.toUpperCase())
  return { before, after }
}
// Returns { before: "starting", after: "RUNNING" }.
// Output: {"before":"starting","after":"RUNNING"}
```

`SubscriptionRef.get` reads the current state without creating a subscription. `set`, `update`, `modify`, and their `*Effect` counterparts behave identically to `SynchronizedRef`, holding the update lock across effectful transitions. A standalone `get` is only a snapshot and does not reserve the value for a later write.

## Consuming current and future values

```vibe
// run: { const jsonValue = try currentSnapshot(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function currentSnapshot() {
  const count = try SubscriptionRef.make(7)
  const changes = SubscriptionRef.changes(count)
  return try Stream.runCollect(Stream.take(changes, 1)) // [7]
}
// Output: [7]
```

`SubscriptionRef.changes(ref)` returns a cold `Stream`—no subscription is registered until the stream is consumed. Each consumption first emits the value current at subscription time, then every later update. Consume it with Stream operators (`Stream.take`, `Stream.runForEach`) or a `for try (const value of changes) { ... }` loop; exiting the loop closes the stream and unsubscribes automatically.

## Coordinating concurrent subscribers

```vibe
// run: try observeTwoClients()
effect function observeTwoClients() {
  const count = try SubscriptionRef.make(0)
  const firstReady = try Deferred.make<void>()
  const secondReady = try Deferred.make<void>()

  effect function client(ready: Deferred.Deferred<void>) {
    for try (const value of Stream.take(SubscriptionRef.changes(count), 2)) {
      try Console.log("observed", value)
      try Deferred.succeed(ready, undefined)
    }
  }

  const first = fork client(firstReady)
  const second = fork client(secondReady)
  try Deferred.await(firstReady)
  try Deferred.await(secondReady)
  try SubscriptionRef.set(count, 1)
  join first
  join second
}
// Output: observed 0
// Output: observed 0
// Output: observed 1
// Output: observed 1
```

Because `changes` subscribes lazily when consumption begins, forking a subscriber does not guarantee it is subscribed before the next `set`. Here each client completes a `Deferred` upon receiving its initial snapshot (`0`), proving both subscriptions are live before `SubscriptionRef.set(count, 1)` runs. Never rely on `sleep` or a yield to synchronize subscriber startup—signal readiness explicitly.
