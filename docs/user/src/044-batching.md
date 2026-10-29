# Batching

Use requests and resolvers when independent lookups can share a backend call. A request describes one answer; a resolver collects compatible pending requests and completes each with its own success or failure.

## Model requests and domain errors

```vibe
// pending: VIP-5, VIP-13, VIP-14
// run: const first = FindPart({ code: "ink-blue" }); const same = FindPart({ code: "ink-blue" }); try Console.log(Equal.equals(first, same), Hash.hash(first) === Hash.hash(same)); try Console.log(Equal.equals(first, FindPart({ code: "ink-black" })))
type Part = { code: string; label: string }

error PartMissing {
  code: string
}

error CatalogUnavailable

interface FindPart extends Request.Request<Part, PartMissing | CatalogUnavailable> {
  _tag: "FindPart"
  code: string
}

const FindPart = Request.tagged<FindPart>("FindPart")
// Output: true true
// Output: false
```

`Request` is Effect's module in `.vibe`; it is in scope without an import. The request carries the input, success type, and expected errors. `Request.tagged` supplies structural equality and hashing, so equal requests compare equal for cache reuse. A real request model includes every input that affects the answer, such as a tenant or locale.

A direct service call per item repeats backend work. Batching helps only when the data source can answer several inputs together; it doesn't create a bulk endpoint.

## Define request resolvers

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try request(FindPart({ code: "ink-blue" }), PartResolver)))
const DemoCatalog = new Map<string, Part>([
  ["ink-black", { code: "ink-black", label: "Black ink" }],
  ["ink-blue", { code: "ink-blue", label: "Blue ink" }]
])

const PartResolver = RequestResolver.make<FindPart>(effect (entries) => {
  try Console.log(`catalog batch size=${entries.length}`)
  for (const entry of entries) {
    try Request.completeEffect(entry, effect {
      const part = DemoCatalog.get(entry.request.code)
      if (part === undefined) throw new PartMissing({ code: entry.request.code })
      return part
    })
  }
})
// Output: catalog batch size=1
// Output: {"code":"ink-blue","label":"Blue ink"}
```

This fixture resolves a batch from a map; a backend resolver replaces the lookup with one bulk operation, then matches the returned rows to entries. `Request.completeEffect` runs its program and completes the entry with the result, expected failures included.

Complete every entry, including requests for absent rows. Use `Request.succeed` and `Request.fail` when you already have a value or error. When each entry needs its own operation rather than a bulk call, `RequestResolver.fromEffect` is simpler.

## Build queries from requests

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-14
// run: try Console.log(try partLabel("ink-black")); const missing = try result(findPart("missing")); if (Result.isFailure(missing)) try Console.log(missing.failure._tag)
effect function findPart(code: string) {
  return try request(FindPart({ code }), PartResolver)
}
// Part!PartMissing | CatalogUnavailable!

effect function partLabel(code: string) {
  return (try findPart(code)).label
}
// Output: catalog batch size=1
// Output: Black ink
// Output: catalog batch size=1
// Output: PartMissing
```

`try request(...)` submits the request to its resolver and waits for that entry's answer. The resolver's pending work, not the query function's syntax, decides which calls share a backend operation.

## Combine compatible requests into batches

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try labels(["ink-black", "ink-blue"])))
effect function labels(codes: ReadonlyArray<string>) {
  return try forEach(codes, (code) => partLabel(code), {
    concurrency: "unbounded"
  })
}
// Output: catalog batch size=2
// Output: ["Black ink","Blue ink"]
```

Requests with the same resolver and batch key can join one pending batch. The default resolver delay yields before running the collected work, so requests started together accumulate. Dependencies add later waves: a query that needs an earlier answer starts after it arrives.

`Effect.forEach` and `Effect.all` are sequential by default; enable concurrency to collect independent requests. A bounded limit caps outstanding requests, and so also batch size. Batching alone doesn't guarantee repeated equal requests are cached; add a resolver cache for shared results.

## Control batch execution

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-23
// run: const parts = try forEach(Array.from({ length: 65 }, () => "ink-blue"), (code) => tunedLookup(code), { concurrency: "unbounded" }); try Console.log(parts.length, parts.every((part) => part.label === "Blue ink"))
const TunedResolver = PartResolver
  |> RequestResolver.setDelay(%, "8 millis")
  |> RequestResolver.batchN(%, 64)

effect function tunedLookup(code: string) {
  return try request(FindPart({ code }), TunedResolver)
}
// Output: catalog batch size=64
// Output: catalog batch size=1
// Output: 65 true
```

`setDelay` trades latency for a larger collection window; `batchN` caps each backend batch; `setDelayEffect` takes a program for a custom delay; `grouped` partitions requests by a key. Callers that should share pending batches reuse one configured resolver.

For full control, `RequestResolver.makeWith` accepts `batchKey`, `delay`, `collectWhile`, and `runAll`. Group by backend compatibility, such as destination or tenant. A batch size log like the one above verifies that concurrent callers share work.

## Supply resolver dependencies

```vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-4, VIP-5, VIP-6, VIP-9, VIP-12, VIP-14
// run: provide Layer.provide(Parts.layer, Layer.succeed(CatalogApi, { fetchMany: effect (codes) => new Map<string, Part>(codes.filter((code) => code !== "missing").map((code) => [code, { code, label: code.toUpperCase() }])) })) { const parts = try Parts; const results = try forEach(["ink", "missing"], (code) => result(parts.find(code)), { concurrency: "unbounded" }); try Console.log(JSON.stringify(results.map((r) => Result.isSuccess(r) ? r.success.label : r.failure._tag))) }; provide Layer.provide(Parts.layer, Layer.succeed(CatalogApi, { fetchMany: effect () => { throw new CatalogUnavailable() } })) { const parts = try Parts; const results = try forEach(["ink", "blue"], (code) => result(parts.find(code)), { concurrency: "unbounded" }); try Console.log(JSON.stringify(results.map((r) => Result.isFailure(r) ? r.failure._tag : "unexpected success"))) }
service CatalogApi {
  fetchMany(codes: ReadonlyArray<string>): ReadonlyMap<string, Part>!CatalogUnavailable
}

service Parts {
  find(code: string): Part!PartMissing | CatalogUnavailable

  static readonly layer = Layer.effect(Parts, effect {
    const api = try CatalogApi
    const resolver = RequestResolver.make<FindPart>(effect (entries) => {
      effect {
        const codes = entries.map((entry) => entry.request.code)
        const rows = try api.fetchMany(codes)
        for (const entry of entries) {
          try Request.completeEffect(entry, effect {
            const part = rows.get(entry.request.code)
            if (part === undefined) throw new PartMissing({ code: entry.request.code })
            return part
          })
        }
      } catch effect (error) => {
        for (const entry of entries) try Request.fail(entry, error)
      }
    })
    return {
      find: (code) => Effect.request(FindPart({ code }), resolver)
    }
  })
}
// Parts.layer: Layer<Parts, never, CatalogApi>
// Output: ["INK","PartMissing"]
// Output: ["CatalogUnavailable","CatalogUnavailable"]
```

Read `try CatalogApi` while building the layer and close over its implementation: building `Parts.layer` requires `CatalogApi`, and resolver execution requires no services. Every call to the provided `Parts` implementation shares the resolver built for that layer.

Match results by identifier; don't assume the backend preserves request order. A backend failure completes every affected entry with `CatalogUnavailable`; a missing row completes only its entry with `PartMissing`. When wiring the application, supply a `CatalogApi` layer alongside this one.

## Share and tune request caches

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try cachedExample())); const queries = try cachedQueries(); for (let i = 0; i < 2; i++) { const outcome = try result(queries.find("missing")); if (Result.isFailure(outcome)) try Console.log(outcome.failure._tag) }
effect function cachedQueries() {
  const resolver = try RequestResolver.withCache(PartResolver, {
    capacity: 128,
    strategy: "lru"
  })
  return {
    find: (code: string) => Effect.request(FindPart({ code }), resolver)
  }
}

effect function cachedExample() {
  const parts = try cachedQueries()
  const first = try parts.find("ink-blue")
  const again = try parts.find("ink-blue")
  return [first, again]
}
// Output: catalog batch size=1
// Output: [{"code":"ink-blue","label":"Blue ink"},{"code":"ink-blue","label":"Blue ink"}]
// Output: catalog batch size=1
// Output: PartMissing
// Output: PartMissing
```

`try RequestResolver.withCache(...)` allocates a cache and returns a wrapped resolver. Build it once in a service layer or another shared owner and reuse it for every query that should share answers; allocating it per lookup creates a fresh cache each time.

The cache is bounded by `capacity`, with `"lru"` eviction by default or `"fifo"` for insertion order. Completed expected failures are cached; interrupted results are not. Entries have no time-based expiry, and hits depend on request equality.

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(JSON.stringify(try expiringLookup()))
effect function expiringLookup() {
  const cache = try RequestResolver.asCache(PartResolver, {
    capacity: 128,
    timeToLive: () => "20 seconds"
  })
  const request = FindPart({ code: "ink-black" })
  const first = try Cache.get(cache, request)
  try Cache.invalidate(cache, request)
  return first
}
// Output: catalog batch size=1
// Output: {"code":"ink-black","label":"Black ink"}
```

Use `asCache` for a first-class cache with expiry, refresh, and invalidation. Its `timeToLive` function receives the request's `Exit` and the request, so success and failure can have different lifetimes. Cache reads whose answers are reusable; keep commands that must run every time out of the cache.

## Coming from Effect

Requests and resolvers keep Effect 4's APIs. Resolver callbacks that run Effects are effect functions, completion Effects use `effect { … }`, and cache allocation runs with `try RequestResolver.withCache(...)` or `try RequestResolver.asCache(...)`.

[Upstream Effect page](https://effect.website/docs/v4/batching)
