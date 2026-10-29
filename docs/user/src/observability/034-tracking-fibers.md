# Tracking Fibers

`FiberSet` and `FiberMap` track groups of running fibers and clean them up with an owning scope. Use a set for an unkeyed group and a map when each operation has an identity, such as a client ID.

## Managing groups of running fibers

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14, VIP-17
// run: try Console.log(try stringify(try runGroup()))
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

effect function stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}

```

```output
tracked workers 2
[1,2]
```

`FiberSet.run` forks an Effect value and registers its fiber; `FiberSet.add` registers an existing fiber; `try FiberSet.size(workers)` counts the fibers tracked now. Join individual handles to collect results; tracking produces no ordered result list.

## Tracking fibers by key

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17
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

Running a fiber under an existing key interrupts that key's previous fiber: latest-request behavior, with no obsolete handle kept elsewhere. `FiberMap.has` and `get` inspect tracked keys, `remove` interrupts and removes a keyed fiber, and `run` with `onlyIfMissing: true` keeps existing work instead of replacing it.

## Removing completed work

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
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

Sets and maps remove completed fibers automatically, so a long-lived owner doesn't accumulate finished handles; a map also keeps an older completion from deleting a newer fiber under the same key. `awaitEmpty` waits for the current group to drain. `FiberSet.join` instead waits on the set's failure signal and propagates a tracked failure; it is not a successful drain.

## Interrupting tracked work on scope closure

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
// run: try serveBriefly()
effect function serveBriefly() {
  try scoped(effect {
    const workers = try FiberSet.make<void>()
    try FiberSet.run(workers, ensuring(
      sleep("1 minute"),
      Console.log("tracked worker cleaned up")
    ))
    try sleep("20 millis")
  })
  try Console.log("worker scope has closed")
}
```

```output
tracked worker cleaned up
worker scope has closed
```

`make` acquires a scope-owned collection. Here `scoped(effect { ... })` ties that scope to the block, whose exit interrupts remaining work and waits for cleanup. Without `scoped`, the collection belongs to the caller's runtime scope and `Scope` stays in the function's requirements; use that form when a service layer owns the group.
