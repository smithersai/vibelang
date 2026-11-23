# SynchronizedRef

A `SynchronizedRef<A>` pairs a mutable cell with an internal lock that serializes effectful updates. Use it when computing the next state depends on both the current value and an Effect that can suspend—such as refreshing an expiring token or loading the next revision from a service.

## Serializing effectful updates

```vibe
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

All three fibers invoke `updateEffect` concurrently, but the lock lets only one callback run at a time. Each callback sees the value committed by the previous update, so none of the three entries is lost. As with `Ref`, treat the stored value as immutable and return a new array or object rather than mutating `current`.

## Reading synchronized references

```vibe
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

`SynchronizedRef.get` is non-blocking: it returns the most recently committed value immediately without waiting for an in-progress `updateEffect`. Pure `set`, `update`, and `modify` operations work just like `Ref`. Even on a `SynchronizedRef`, a `get` followed by a separate `set` is two independent steps, not an atomic transition.

## Keeping dependent asynchronous updates atomic

```vibe
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

Because `updateAndGetEffect` holds the lock across `versions.loadAfter(current)`, the second concurrent `refresh()` waits until the first commits `1`, then passes `1` to `loadAfter` and receives `2`. When a callback fails or is interrupted, the reference keeps its prior value and releases the lock so subsequent callers can proceed.

Know the boundary of this guarantee: `SynchronizedRef` serializes transitions on *one* reference. It does not roll back external side effects performed before a failure, coordinate across multiple references, or permit re-entrant updates to the same reference (which deadlock).

## Coming from Effect

Pass an Effect-returning callback to `updateEffect` or `updateAndGetEffect`. A plain arrow suffices when forwarding an existing Effect (`(current) => versions.loadAfter(current)`); use an `effect (current) => { ... }` arrow when the transition runs multiple `try` steps. `try.all` executes the two refreshes concurrently and returns their ordered tuple.
