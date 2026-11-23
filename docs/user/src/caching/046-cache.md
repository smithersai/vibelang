# Cache

`Cache` is a bounded, concurrent key-value store backed by a lookup function. Callers ask for keys via `Cache.get`; on a miss, the cache runs the lookup once, shares that in-flight fiber across concurrent callers for the same key, and stores the settled outcome subject to capacity and TTL limits.

![Request batching and TTL Cache](/diagrams/batching-and-caching.svg)

## Building a lookup cache

```vibe
// run: const prices = try Effect.provide(makePrices(), Layer.succeed(Products, { price: (sku) => succeed(42) })); try Console.log(try Cache.get(prices, "ink"))
error MissingProduct {
  sku: string
}

service Products {
  price(sku: string): number!MissingProduct
}

effect function makePrices() {
  const products = try Products
  return try Cache.make({
    capacity: 200,
    timeToLive: "2 minutes",
    lookup: (sku: string) => products.price(sku)
  })
}
// Cache.Cache<string, number, MissingProduct>!!Products
// Output: 42
```

Acquire lookup dependencies when constructing the cache and close over them: `Cache.get(prices, sku)` then needs no extra services. Allocate an application-wide cache once inside a `Layer`; allocating inside a request handler creates a private cache that shares nothing across requests.

## Sharing concurrent requests

```vibe
// run: { const jsonValue = try concurrentLookup(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function concurrentLookup() {
  let calls = 0
  const cache = try Cache.make({
    capacity: 10,
    lookup: effect (key: string) => {
      calls++
      try sleep("30 millis")
      return key.toUpperCase()
    }
  })
  const values = try.all [
    Cache.get(cache, "north"),
    Cache.get(cache, "north"),
    Cache.get(cache, "north")
  ]
  return { values, calls }
}
// Returns { values: ["NORTH", "NORTH", "NORTH"], calls: 1 }.
// Output: {"values":["NORTH","NORTH","NORTH"],"calls":1}
```

Three concurrent callers for `"north"` trigger `lookup` exactly once without blocking the thread. Expected failures are also shared and cached for the entry's lifetime; interrupted lookups are discarded so the next caller retries cleanly.

## Setting capacity and expiration

```vibe
// run: const names = try makePermanentNames(); try Console.log(try Cache.get(names, "ink")); try Console.log(try Cache.get(names, "blue"))
effect function makePermanentNames() {
  return try Cache.make({
    capacity: 50,
    timeToLive: Duration.infinity,
    lookup: (id: string) => succeed(`item-${id}`)
  })
}
// Output: item-ink
// Output: item-blue
```

`capacity` limits entry count, not byte size, evicting least-recently-used entries first. A finite `timeToLive` causes expired entries to reload lazily on the next `get`. `Duration.infinity` disables time expiration while keeping capacity eviction active.

## Inspecting cache state

```vibe
// run: { const jsonValue = try inspect(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function inspect() {
  const cache = try Cache.make({ capacity: 5, lookup: (key: string) => succeed(key.length) })
  try Cache.get(cache, "paper")
  return {
    present: try Cache.has(cache, "paper"),
    size: try Cache.size(cache),
    keys: Array.from(try Cache.keys(cache)),
    entries: Array.from(try Cache.entries(cache))
  }
}
// Output: {"present":true,"size":1,"keys":["paper"],"entries":[["paper",5]]}
```

`has`, `size`, `keys`, and `entries` inspect current state without triggering lookups; run each with `try`. `entries` yields only resolved successes, omitting failures and in-flight lookups. Because other fibers may update the cache between operations, treat inspection as a point-in-time snapshot—never branch on `has` before calling `get`.

## Invalidating and refreshing entries

```vibe
// run: { const jsonValue = try refreshExample(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function refreshExample() {
  let version = 0
  const cache = try Cache.make({
    capacity: 5,
    timeToLive: "1 minute",
    lookup: effect (key: string) => `${key}:${++version}`
  })
  const first = try Cache.get(cache, "profile")
  const refreshed = try Cache.refresh(cache, "profile")
  try Cache.invalidate(cache, "profile")
  const reloaded = try Cache.get(cache, "profile")
  try Cache.invalidateAll(cache)
  return { first, refreshed, reloaded }
}
// Output: {"first":"profile:1","refreshed":"profile:2","reloaded":"profile:3"}
```

| Operation | Effect on cache | Behavior for concurrent readers |
| --- | --- | --- |
| `Cache.refresh(cache, key)` | Runs lookup immediately and replaces the entry | Readers keep seeing the current valid entry until the refresh completes |
| `Cache.invalidate(cache, key)` | Deletes one entry | Next `Cache.get` triggers a fresh lookup |
| `Cache.invalidateAll(cache)` | Deletes every entry | Subsequent `Cache.get` calls reload on demand |

Use `refresh` when you need the fresh value right now without stalling concurrent readers; use `invalidate` when reloading can wait until the next reader asks.
