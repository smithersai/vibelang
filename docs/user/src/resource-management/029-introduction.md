# Introduction to Resource Management

Files, database connections, locks, and temporary directories must be released whether work succeeds, fails with an expected error, dies with a defect, or is interrupted mid-flight.

VibeLang uses Effect's resource primitives: `ensuring` for unconditional cleanup, `onExit` / `onError` for outcome-aware cleanup, and `scoped` + `acquireRelease` for composable LIFO resource ownership.

![Resources acquired inside scoped() are always released in reverse order (LIFO), even on failure or interruption](/diagrams/scope-lifecycle.svg)

> **Why not JavaScript `using`?**
> TypeScript's `using` keeps JavaScript's synchronous disposal rules — an Effect failure or fiber interruption can bypass it, so `using` in effect code draws warning `EK0801` (and `await using` is `EK0102`). Use `scoped` + `acquireRelease` for Effect resources, and `acquireDisposable` for JavaScript `Disposable` / `AsyncDisposable` objects.

## Unconditional cleanup (`ensuring`)

```vibe
// run: try Console.log(try exportRows(true)); try Effect.catch(exportRows(false), (error) => Console.log(error._tag))
error ExportRejected

effect function exportRows(accepted: boolean) {
  return try ensuring(effect {
    try Console.log("Export started")
    if (!accepted) throw new ExportRejected()
    return "Export complete"
  }, Console.log("Export finished"))
}
// Inferred: string!ExportRejected
// Output: Export started
// Output: Export finished
// Output: Export complete
// Output: Export started
// Output: Export finished
// Output: ExportRejected
```

`ensuring(work, cleanup)` runs `cleanup` uninterruptibly after every exit — success, typed failure, defect, or cancellation. Its cleanup Effect must have `E = never` (catch or `orDie` any cleanup failure).

## Outcome-aware cleanup (`onExit` and `onError`)

`onExit` receives the full `Exit<A, E>`, letting cleanup branch on success vs. failure vs. interruption:

```vibe
// run: try Console.log(try observedExport(true)); try Effect.catch(observedExport(false), (error) => Console.log(error._tag))
effect function observedExport(accepted: boolean) {
  return try onExit(exportRows(accepted), effect (outcome) => {
    if (Exit.isSuccess(outcome)) {
      try Console.log("Export succeeded")
    } else {
      try Console.log("Export stopped", try Effect.try(() => JSON.stringify(outcome.cause.reasons.map((reason) => reason._tag))))
    }
  })
}
// Output: Export started
// Output: Export finished
// Output: Export succeeded
// Output: Export complete
// Output: Export started
// Output: Export finished
// Output: Export stopped ["Fail"]
// Output: ExportRejected
```

`onError` runs only on unsuccessful outcomes (expected errors, defects, and cancellation), without recovering the error:

```vibe
// run: try Console.log(try reportFailedExport(true)); try Effect.catch(reportFailedExport(false), (error) => Console.log(error._tag))
effect function reportFailedExport(accepted: boolean) {
  return try onError(exportRows(accepted), effect (cause) => {
    if (Cause.hasInterrupts(cause)) {
      try Console.log("Export cancelled; cleanup complete")
    } else {
      try Console.log("Export failed; cleanup complete")
    }
  })
}
// Output: Export started
// Output: Export finished
// Output: Export complete
// Output: Export started
// Output: Export finished
// Output: Export failed; cleanup complete
// Output: ExportRejected
```

## Single-resource bracket (`acquireUseRelease`)

When one resource is acquired, used, and released in a single place:

```vibe
// run: provide LeaseStore = { acquire: () => succeed({ id: "test-lease" }), release: (lease) => Console.log(`Released ${lease.id}`) } { try Console.log(try withLease()) }
interface Lease {
  id: string
}

service LeaseStore {
  acquire(): Lease!!
  release(lease: Lease): void!!
}

effect function withLease() {
  const store = try LeaseStore
  return try acquireUseRelease(
    store.acquire(),
    effect (lease) => {
      try Console.log(`Working with lease ${lease.id}`)
      return lease.id
    },
    effect (lease, outcome) => {
      try Console.log(`Releasing after ${outcome._tag}`)
      try store.release(lease)
    }
  )
}
// Inferred: string!!LeaseStore
// Output: Working with lease test-lease
// Output: Releasing after Success
// Output: Released test-lease
// Output: test-lease
```

Acquisition and release run uninterruptibly; the use phase stays interruptible. Release runs if and only if acquisition succeeded.

## Composable ownership (`acquireRelease` + `scoped`)

When multiple resources must compose without nested callback pyramids, register each release on the enclosing `Scope` with `acquireRelease` and close them all at once with `scoped`:

```vibe
// run: try Console.log(try example()); provide LeaseStore = { acquire: () => succeed({ id: "owned" }), release: (lease) => Console.log(`Released ${lease.id}`) } { try Console.log(try leaseId()) }
effect function acquireLease() {
  const store = try LeaseStore
  return try acquireRelease(
    store.acquire(),
    (lease) => store.release(lease)
  )
}
// Inferred: Lease!!(LeaseStore | Scope.Scope)

effect function leaseId() {
  return try scoped(effect {
    const lease = try acquireLease()
    return lease.id
  })
}
// Inferred: string!!LeaseStore

const LeaseStoreTest = Layer.succeed(LeaseStore, {
  acquire: () => succeed({ id: "test-lease" }),
  release: (_lease) => succeed(undefined)
})

effect function example() {
  provide LeaseStoreTest { return try leaseId() }
}
// Output: test-lease
// Output: Released owned
// Output: owned
```

Look at the types:
- `acquireLease()` carries `Scope.Scope` in `R` — the compiler **prevents** you from forgetting to close it.
- `scoped(effect { ... })` provides a fresh `Scope`, closes every acquired resource in reverse (LIFO) order when the block ends, and removes `Scope.Scope` from `R`.

See [Scope](030-scope.md) for manual scope management, `addFinalizer`, and `acquireDisposable`.

## Coming from Effect

`Scope` is globally in scope (`Scope.Scope`). Pass `effect { ... }` blocks and `effect (x) => ...` arrows straight to `ensuring`, `onExit`, `onError`, `acquireUseRelease`, `acquireRelease`, and `scoped`.

[Upstream Effect page](https://effect.website/docs/v4/resource-management/introduction)
