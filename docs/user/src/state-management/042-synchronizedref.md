# SynchronizedRef

A `SynchronizedRef` serializes updates that run Effects. Use it when the next value depends on both the current value and work that can pause, such as refreshing a credential or loading a revision.

## Serializing effectful updates

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-19
// run: { const jsonValue = (try recordRevisions()).toSorted((a, b) => a - b); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function recordRevisions() {
  const revisions = try SynchronizedRef.make<ReadonlyArray<number>>([])
  for concurrent(3) (const id of [1, 2, 3]) {
    try SynchronizedRef.updateEffect(revisions, effect (current) => {
      try sleep("10 millis")
      return [...current, id]
    })
  }
  return try SynchronizedRef.get(revisions)
}
// Output: [1,2,3]
```

Three fibers call the callbacks concurrently, but they acquire the reference's update lock one at a time. Each sees the value the previous update committed, so all three revisions stay in the final array. Return a replacement immutable value instead of changing the stored array in place.

## Reading synchronized references

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: { const jsonValue = try inspect(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function inspect() {
  const state = try SynchronizedRef.make({ version: 0, ready: false })
  const before = try SynchronizedRef.get(state)
  try SynchronizedRef.set(state, { version: 1, ready: true })
  const after = try SynchronizedRef.get(state)
  return { before, after }
}
// Output: {"before":{"version":0,"ready":false},"after":{"version":1,"ready":true}}
```

`get` reads the latest committed value without waiting for an in-progress update to compute its replacement. `set`, `update`, and `modify` make synchronous changes. A read and a later write stay two operations, not one atomic one, even on a synchronized reference.

## Keeping dependent asynchronous updates atomic

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-9, VIP-12, VIP-13, VIP-14, VIP-18
// run: provide Versions = { loadAfter: effect (version) => { try sleep("10 millis"); return version + 1 } } { { const jsonValue = try refreshTwice(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } }; const state = try SynchronizedRef.make(0); try Effect.catch(SynchronizedRef.updateEffect(state, effect () => { throw new RefreshFailed() }), (error) => Console.log(error._tag)); try Console.log(try SynchronizedRef.updateAndGetEffect(state, (n) => succeed(n + 1)))
error RefreshFailed

service Versions {
  loadAfter(version: number): number!RefreshFailed
}

effect function refreshTwice() {
  const version = try SynchronizedRef.make(0)
  const versions = try Versions
  effect function refresh() {
    return try SynchronizedRef.updateAndGetEffect(version, (current) =>
      versions.loadAfter(current))
  }
  return try.all [refresh(), refresh()]
}
// [number, number]!RefreshFailed!Versions
// Output: [1,2]
// Output: RefreshFailed
// Output: 1
```

The second update reads the first update's committed version before calling `loadAfter`. A failing callback commits no replacement and releases the lock. This protects the reference's update sequence; it doesn't roll back remote side effects, coordinate several references, or make recursive updates to the same reference safe.

## Coming from Effect

Pass a callback returning an Effect to `updateEffect`. A plain arrow can return an existing Effect, such as `versions.loadAfter(current)`. An effect arrow can run several operations with `try` before returning the next value. `try.all` runs the two refresh Effects concurrently and keeps their results.
