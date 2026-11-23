# Caching Effects

Caching reuses a computation's outcome across callers instead of repeating the work. Allocation is itself an Effect: create the cache once at the scope where callers share it—such as a service layer—never inside a per-request function.

| Primitive | Keyed? | Expiration | Explicit invalidation |
| --- | --- | --- | --- |
| `Cache.make` | Yes | Optional TTL + capacity | `Cache.invalidate` / `refresh` |
| `cached` | No (single Effect) | None | No |
| `cachedWithTTL` | No (single Effect) | Fixed TTL | No |
| `cachedInvalidateWithTTL` | No (single Effect) | Fixed TTL | Returns `[effect, invalidate]` |

## Memoizing parameterized computations

```vibe
// run: { const jsonValue = try memoizeLengths(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function memoizeLengths() {
  let lookups = 0
  const cache = try Cache.make({
    capacity: 64,
    lookup: effect (word: string) => {
      lookups++
      try sleep("10 millis")
      return word.length
    }
  })
  const length = (word: string) => Cache.get(cache, word)
  const first = try length("violet")
  const again = try length("violet")
  const other = try length("blue")
  return { first, again, other, lookups }
}
// Returns { first: 6, again: 6, other: 4, lookups: 2 }.
// Output: {"first":6,"again":6,"other":4,"lookups":2}
```

A keyed `Cache` memoizes one outcome per key and coalesces concurrent requests for the same missing key onto a single lookup. `capacity` bounds stored entries; without `timeToLive`, entries never expire by time.

## Reusing one computed result

```vibe
// run: { const jsonValue = try cachedSettings(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function cachedSettings() {
  let loads = 0
  const settings = try cached(effect {
    loads++
    try sleep("20 millis")
    return { theme: "dark", revision: loads }
  })
  // The settings loader has not run yet.
  const first = try settings
  const again = try settings
  return { first, again, loads }
}
// Output: {"first":{"theme":"dark","revision":1},"again":{"theme":"dark","revision":1},"loads":1}
```

`try cached(program)` allocates storage and returns a reusable Effect value without running `program`. The first `try settings` executes `program`; later callers reuse its success or expected failure, and concurrent callers wait on the same in-flight fiber. An interrupted computation is not cached, and shared in-flight work is interrupted only when *every* waiting caller is interrupted. Each `try cached(...)` allocates independent storage.

## Expiring results after a duration

```vibe
// run: { const jsonValue = try expiringSnapshot(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function expiringSnapshot() {
  let revision = 0
  const snapshot = try cachedWithTTL(effect { return ++revision }, "100 millis")
  const first = try snapshot
  const same = try snapshot
  try sleep("150 millis")
  const fresh = try snapshot
  return { first, same, fresh } // { first: 1, same: 1, fresh: 2 }
}
// Output: {"first":1,"same":1,"fresh":2}
```

`cachedWithTTL` bounds how long a stored result stays valid. Expiry triggers no background refresh—the next `try snapshot` recomputes lazily. Expiration uses Effect's `Clock`, so tests can drive it deterministically with `TestClock`.

## Invalidating explicitly

```vibe
// run: { const jsonValue = try reloadableSnapshot(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function reloadableSnapshot() {
  let revision = 0
  const [snapshot, invalidate] = try cachedInvalidateWithTTL(
    effect { return ++revision },
    "10 minutes"
  )
  const first = try snapshot
  try invalidate
  const fresh = try snapshot
  return { first, fresh } // { first: 1, fresh: 2 }
}
// Output: {"first":1,"fresh":2}
```

`cachedInvalidateWithTTL` returns `[cachedEffect, invalidateEffect]`. Running `try invalidate` clears the stored entry without triggering a reload; the next `try snapshot` computes a fresh value. Invalidate immediately after a successful mutation when readers must not observe stale data until the TTL elapses.

## Coming from Effect

Caching constructors return cold Effect values (`snapshot`, `invalidate`); hold them as values and execute them with `try`. Passing a cold `load()` call to a caching constructor defers execution until the first cache miss.
