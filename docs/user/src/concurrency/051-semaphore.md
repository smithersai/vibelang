# Semaphore

A `Semaphore` bounds concurrent entry to a shared resource with a fixed pool of permits. One permit enforces mutual exclusion; larger pools cap in-flight operations across independent callers while suspending waiters without blocking the thread.

![Fiber coordination with Deferred and Semaphore](/diagrams/deferred-and-semaphore.svg)

| Mechanism | Scope | Permit count | Release guarantee |
| --- | --- | --- | --- |
| `Semaphore.withPermit` | Shared across all callers holding the semaphore | 1 | Automatic on success, failure, or interruption |
| `Semaphore.withPermits(sem, n, eff)` | Shared across all callers holding the semaphore | `n` (atomic) | Automatic on success, failure, or interruption |
| `forEach(..., { concurrency })` | Single traversal only | Fixed per traversal | Managed by `forEach` |

## Creating a permit pool

```vibe
// run: const limit = try makeUploadLimit(); try Console.log(try Semaphore.withPermits(limit, 3, effect { return "three permits acquired" }))
effect function makeUploadLimit() {
  return try Semaphore.make(3)
}
// Semaphore.Semaphore!!
// Output: three permits acquired
```

Allocate one semaphore and share it across every caller subject to the same limit; constructing a new pool per call isolates permits and removes the shared cap. Permits represent concurrency slots, not resource objects like connections.

## Limiting concurrent access

```vibe
// run: { const jsonValue = try uploadAll(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function uploadAll() {
  const uploads = try Semaphore.make(2)
  return try forEach(["a.csv", "b.csv", "c.csv", "d.csv"], (file) =>
    Semaphore.withPermits(uploads, 1, effect {
      try Console.log("upload started", file)
      try sleep("30 millis")
      return file
    }), { concurrency: "unbounded" })
}
// Output: upload started a.csv
// Output: upload started b.csv
// Output: upload started c.csv
// Output: upload started d.csv
// Output: ["a.csv","b.csv","c.csv","d.csv"]
```

All four fibers start immediately, but at most two enter the permit-guarded body simultaneously. Reach for a semaphore when separate subsystems share one downstream cap; `forEach`'s `concurrency` option bounds only a single traversal.

## Acquiring several permits around work

```vibe
// run: { const jsonValue = try weightedJobs(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function weightedJobs() {
  const memoryBudget = try Semaphore.make(4)
  return try forEach([1, 2, 3], (weight) =>
    Semaphore.withPermits(memoryBudget, weight, effect {
      try sleep("20 millis")
      return `job using ${weight} units`
    }), { concurrency: 3 })
}
// Output: ["job using 1 units","job using 2 units","job using 3 units"]
```

`Semaphore.withPermits` acquires all `n` permits atomically, letting callers model weighted costs such as memory units or rate-limit tokens. Requesting more permits than the pool's total capacity suspends forever, so validate weights against the configured pool size.

## Releasing permits safely

```vibe
// run: try Console.log(try releaseOnFailure())
error Rejected

effect function releaseOnFailure() {
  const mutex = try Semaphore.make(1)
  const rejected = Semaphore.withPermits(mutex, 1, effect {
    throw new Rejected()
  }) catch (error) => match (error) {
    when Rejected: error._tag;
  }
  try Console.log("first job rejected", rejected)
  return try Semaphore.withPermits(mutex, 1, effect {
    return "next job can enter"
  })
}
// Output: first job rejected Rejected
// Output: next job can enter
```

`Semaphore.withPermits` and `Semaphore.withPermit` always restore permits on success, failure, and interruption. Prefer them over pairing `Semaphore.take` and `release` manually, where interruption between acquisition and cleanup registration can leak permits.
