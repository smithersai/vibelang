# Caching Effects

Caching shares a computation's outcome across callers instead of repeating the work. Use a keyed `Cache` for parameterized lookups, or `cached` and its TTL variants for one reusable Effect. Create the cache once, at the lifetime where callers share it.

## Memoizing parameterized computations

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try memoizeLengths()))
effect memoizeLengths() {
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

Each key stores its own outcome: repeated calls for the key reuse it, and concurrent requests for it share one lookup. Capacity bounds the number of entries; without `timeToLive`, entries don't expire by time.

## Reusing one computed result

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try cachedSettings()))
effect cachedSettings() {
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

`try cached(program)` allocates a reusable Effect value; `try settings` runs that value. The first caller starts the work; later callers reuse its success or expected failure, and concurrent callers wait for the same result. An interrupted computation isn't cached; shared pending work is interrupted only once every waiting caller is. Each `try cached(program)` allocates independent storage, so for requests to share it, allocate it outside the per-request function.

## Expiring results after a duration

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try expiringSnapshot()))
effect expiringSnapshot() {
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

The TTL bounds how long an outcome is reused. Expiration starts no background refresh; the next evaluation recomputes it. Use Effect's clock and sleep operations so tests can advance time without real waiting.

## Invalidating explicitly

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try reloadableSnapshot()))
effect reloadableSnapshot() {
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

The returned pair is a cached Effect and an invalidation Effect. `try invalidate` clears the stored outcome without loading a replacement; the next `try snapshot` loads it. Invalidate after a successful write when callers must stop seeing the previous result before the TTL expires.

## Coming from Effect

Keep returned Effect values such as `snapshot` and `invalidate`, and run them with `try`. Passing `load()` to a caching constructor leaves the Effect unrun until the cache needs it.
