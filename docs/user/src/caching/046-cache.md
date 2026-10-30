# Cache

A `Cache` stores lookup outcomes by key and shares in-progress lookups across callers. Use it when many requests need the same data; capacity and expiration control how long the sharing lasts.

## Building a lookup cache

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-9, VIP-13, VIP-14
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

The default cache captures lookup services when created. `try Cache.get(cache, sku)` then reads an entry or runs the captured lookup. A cache created per request shares nothing across requests; when the cache belongs to the application, allocate it in a service layer.

## Sharing concurrent requests

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-18
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

Requests for the same missing key wait on one computation without blocking the JavaScript thread. A failed lookup shares and caches its failure. An interrupted lookup is removed, so a later call can try again.

## Setting capacity and expiration

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
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

Capacity bounds entries, not bytes; eviction keeps recently used entries over older ones. With a finite TTL, an expired outcome isn't reused and the next lookup reloads it. An infinite TTL disables time expiration; capacity eviction stays active.

## Inspecting cache state

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
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

`has`, `size`, `keys`, and `entries` return Effects that inspect state without loading missing keys; run each with `try`. `entries` includes resolved successes only, not failures or unfinished lookups. Concurrent access can change these observations at once, so don't use `has` followed by `get` as a synchronization protocol.

## Invalidating and refreshing entries

```vibe
// pending: VIP-1, VIP-5, VIP-14
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

`refresh` forces a new lookup and returns the refreshed value; readers still get an existing valid value while its replacement loads. `invalidate` removes one entry and `invalidateAll` removes every entry; the next `get` loads again. Refresh when the caller needs recomputation now; invalidate when a later reader should trigger it.
