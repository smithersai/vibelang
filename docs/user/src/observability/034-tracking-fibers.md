# Tracking Fibers

`FiberSet` and `FiberMap` track dynamically spawned fibers inside a `Scope`, automatically pruning finished fibers and interrupting every still-running fiber when that Scope closes.

| Collection | Keyed? | On duplicate key | Use when |
| --- | --- | --- | --- |
| `FiberSet` | No | N/A | Dynamic pool of background tasks |
| `FiberMap` | Yes (`K`) | Interrupts prior fiber (or skips with `onlyIfMissing: true`) | Per-entity work (client session, editor preview, job ID) |

## Managing groups of running fibers

```vibe
// run: { const jsonValue = try runGroup(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function runGroup() {
  return try scoped(effect {
    const workers = try FiberSet.make<number>()
    const first = try FiberSet.run(workers, effect {
      try sleep("30 millis")
      return 1
    })
    const second = try FiberSet.run(workers, effect {
      try sleep("50 millis")
      return 2
    })
    try Console.log("tracked workers", try FiberSet.size(workers))
    return [join first, join second]
  })
}

```

```output
tracked workers 2
[1,2]
```

`FiberSet.run` forks an Effect and registers its handle in one step; `FiberSet.add` registers an already-forked fiber; `try FiberSet.size(workers)` reports the current live count. A `FiberSet` tracks lifecycle, not result ordering—join individual fiber handles when you need their return values.

## Tracking fibers by key

```vibe
// run: try Console.log(try replacePreview())
effect function replacePreview() {
  return try scoped(effect {
    const previews = try FiberMap.make<string, string>()
    try FiberMap.run(previews, "editor-1", effect {
      try sleep("1 second")
      return "old preview"
    })
    const current = try FiberMap.run(previews, "editor-1", effect {
      try sleep("20 millis")
      return "new preview"
    })
    return join current
  })
}
```

```output
new preview
```

Calling `FiberMap.run` with a key already in the map interrupts the previous fiber before replacing it—giving latest-wins cancellation with zero manual handle bookkeeping. Pass `{ onlyIfMissing: true }` to keep an existing in-flight task instead of replacing it. Use `FiberMap.has`, `get`, and `remove` (which interrupts and deletes) to inspect or cancel specific keys.

## Removing completed work

```vibe
// run: try Console.log(try waitForAllTracked())
effect function waitForAllTracked() {
  return try scoped(effect {
    const workers = try FiberSet.make<void>()
    try FiberSet.run(workers, sleep("10 millis"))
    try FiberSet.run(workers, sleep("20 millis"))
    try FiberSet.awaitEmpty(workers)
    return try FiberSet.size(workers) // 0
  })
}
```

```output
0
```

Both `FiberSet` and `FiberMap` remove fibers automatically upon completion, preventing memory leaks in long-lived services; `FiberMap` also guards against a stale fiber's completion removing a newer fiber stored under the same key.

Note the distinction between two waiting primitives:
- `FiberSet.awaitEmpty` suspends until every currently tracked fiber completes.
- `FiberSet.join` waits on the set's failure signal and fails as soon as any tracked fiber fails—it does *not* complete on normal drain.

## Interrupting tracked work on scope closure

```vibe
// run: try serveBriefly()
effect function serveBriefly() {
  try scoped(effect {
    const workers = try FiberSet.make<void>()
    const started = try Deferred.make<void>()
    try FiberSet.run(workers, ensuring(
      effect {
        try Deferred.succeed(started, undefined)
        try sleep("1 minute")
      },
      Console.log("tracked worker cleaned up")
    ))
    try Deferred.await(started)
  })
  try Console.log("worker scope has closed")
}
```

```output
tracked worker cleaned up
worker scope has closed
```

Completing `started` from inside `ensuring` proves the worker has started and installed its finalizer before the outer scope closes—something a `sleep` cannot guarantee.

`FiberSet.make` and `FiberMap.make` attach cleanup to the active `Scope`. Wrapping the block in `scoped(effect { ... })` interrupts all remaining fibers and awaits their finalizers before exiting the block. Omit `scoped` when a service `Layer` owns the collection so the `Scope` requirement propagates to the layer's lifetime.
