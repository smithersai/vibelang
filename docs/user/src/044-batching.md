# Batching

Suppose an endpoint renders 50 items and calls `findPart(code)` for each one. Without batching, that triggers 50 separate database or HTTP round trips—even though the backend accepts a list of codes in one call.

Effect solves this by splitting a lookup into two parts: a **Request** (a data value describing one question) and a **RequestResolver** (a batch executor that collects concurrent pending requests, sends one bulk call, and hands each caller its own answer or error). Callers keep writing clean single-item lookups; batching happens automatically whenever calls run concurrently.

![Request batching and TTL Cache](/diagrams/batching-and-caching.svg)

## Step 1: Model requests and domain errors

First, turn "look up one part" into a typed value that carries its inputs, success type, and expected errors.

```vibe
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

`Request` is in scope in `.vibe` without an import. `Request.tagged` generates a constructor with structural equality and hashing—crucial when caching or deduplicating requests, because two `FindPart({ code: "ink-blue" })` objects compare equal by value, not by reference.

> Include every input that can change the answer (such as tenant ID or locale) as a field on the request. Missing fields cause silent cache collisions.

Batching cannot invent a bulk backend where none exists: it pays off when your data source can satisfy multiple keys in one round trip.

## Step 2: Define a request resolver

Next, tell Effect how to answer a whole batch of `FindPart` requests at once.

```vibe
// run: { const jsonValue = try request(FindPart({ code: "ink-blue" }), PartResolver); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
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

In production, swap `DemoCatalog.get` for one bulk query (`SELECT ... WHERE code IN (...)` or a batch HTTP endpoint), then match each returned row back to its entry. `Request.completeEffect` runs an Effect and settles that entry with either its value or its typed failure.

**Golden rule for resolvers:** complete *every* entry in the batch, including missing keys. Use `Request.succeed` or `Request.fail` when you already hold a plain value or error. If a data source truly has no bulk API, `RequestResolver.fromEffect` resolves one entry at a time with less boilerplate.

## Step 3: Wrap requests in ordinary query functions

Callers should never have to construct `FindPart` or reference `PartResolver` directly. Hide both behind small effect functions:

```vibe
// run: try Console.log(try partLabel("ink-black")); const missing = try result(findPart("missing")); if (Result.isFailure(missing)) try Console.log(missing.failure._tag)
effect function findPart(code: string) {
  return try request(FindPart({ code }), PartResolver)
}
// Part!(PartMissing | CatalogUnavailable)

effect function partLabel(code: string) {
  return (try findPart(code)).label
}
// Output: catalog batch size=1
// Output: Black ink
// Output: catalog batch size=1
// Output: PartMissing
```

`try request(req, resolver)` submits one request and suspends the fiber until the resolver completes that entry. Notice that `partLabel` looks completely sequential—yet it participates in batching automatically whenever multiple `partLabel` calls run concurrently.

## Step 4: Run queries concurrently to trigger batching

Here is the payoff: run independent lookups concurrently, and watch the batch size jump from `1` to `2`.

```vibe
// run: { const jsonValue = try labels(["ink-black", "ink-blue"]); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function labels(codes: ReadonlyArray<string>) {
  return try forEach(codes, (code) => partLabel(code), {
    concurrency: "unbounded"
  })
}
// Output: catalog batch size=2
// Output: ["Black ink","Blue ink"]
```

Why did both calls merge into one batch? By default, a resolver yields briefly before dispatching, letting sibling fibers submit their pending requests into the same wave. Dependent queries form later waves once the answers they depend on arrive.

**Watch out for two common surprises:**
- `Effect.forEach` and `Effect.all` run *sequentially* unless you enable concurrency. Sequential calls always produce batch size `1`. A numeric `concurrency` limit also caps the maximum batch size.
- Batching alone does not cache repeated equal requests across waves—add a cache (below) if you want shared results.

## Tune batch windows, sizes, and grouping

Backends have limits: a SQL `IN` clause or batch API may cap each call at 64 keys, or benefit from waiting a few milliseconds to gather more callers.

```vibe
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

| Combinator | What it controls |
| --- | --- |
| `RequestResolver.setDelay` / `setDelayEffect` | How long to wait to accumulate pending requests before firing |
| `RequestResolver.batchN` | Maximum entries per backend call (splits larger waves cleanly) |
| `RequestResolver.grouped` | Partitions one wave into sub-batches by a key (e.g., tenant or shard) |
| `RequestResolver.makeWith` | Full custom control over `batchKey`, `delay`, `collectWhile`, and `runAll` |

Reuse a single configured resolver instance across callers that should share batches—and keep a batch-size log or metric during development so you can *see* batching working.

## Wire resolver dependencies in a layer

Real resolvers talk to services like `CatalogApi`. Acquire those services once when building a `Layer` and close over them inside the resolver:

```vibe
// run: provide Layer.provide(PartsLive, Layer.succeed(CatalogApi, { fetchMany: effect (codes) => new Map<string, Part>(codes.filter((code) => code !== "missing").map((code) => [code, { code, label: code.toUpperCase() }])) })) { const parts = try Parts; const results = try forEach(["ink", "missing"], (code) => result(parts.find(code)), { concurrency: "unbounded" }); try Console.log(try Effect.try(() => JSON.stringify(results.map((r) => Result.isSuccess(r) ? r.success.label : r.failure._tag)))) }; provide Layer.provide(PartsLive, Layer.succeed(CatalogApi, { fetchMany: effect () => { throw new CatalogUnavailable() } })) { const parts = try Parts; const results = try forEach(["ink", "blue"], (code) => result(parts.find(code)), { concurrency: "unbounded" }); try Console.log(try Effect.try(() => JSON.stringify(results.map((r) => Result.isFailure(r) ? r.failure._tag : "unexpected success")))) }
service CatalogApi {
  fetchMany(codes: ReadonlyArray<string>): ReadonlyMap<string, Part>!CatalogUnavailable
}

service Parts {
  find(code: string): Part!(PartMissing | CatalogUnavailable)
}

export const PartsLive = Layer.effect(Parts, effect {
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
// PartsLive: Layer<Parts, never, CatalogApi>
// Output: ["INK","PartMissing"]
// Output: ["CatalogUnavailable","CatalogUnavailable"]
```

Reading `try CatalogApi` during layer construction gives `PartsLive` the requirement `CatalogApi` while keeping every `Parts.find` call free of extra service dependencies. Every caller using that layer shares the same resolver instance.

Notice two deliberate details in the resolver body:
1. **Match rows by key (`rows.get(...)`), never by array index**—backends are not guaranteed to preserve request order or return missing rows.
2. **Isolate row errors from backend errors**—a missing key fails only its own entry with `PartMissing`, whereas a failed `fetchMany` fails every entry in the batch with `CatalogUnavailable`.

## Add caching to a resolver

Batching collapses *concurrent* work; caching eliminates *repeated* work across time. Effect offers two levels of request caching:

| API | Eviction / TTL | Best for |
| --- | --- | --- |
| `RequestResolver.withCache` | Bounded `capacity` (`"lru"` or `"fifo"`), no TTL | Short-lived request scopes or static reference data |
| `RequestResolver.asCache` | Full `Cache` with per-exit `timeToLive`, refresh, and invalidation | Long-lived services needing expiry or explicit invalidation |

```vibe
// run: { const jsonValue = try cachedExample(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; const queries = try cachedQueries(); for (let i = 0; i < 2; i++) { const outcome = try result(queries.find("missing")); if (Result.isFailure(outcome)) try Console.log(outcome.failure._tag) }
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

`try RequestResolver.withCache(...)` allocates a fresh cache and returns a wrapped resolver—allocate it once in a shared layer or owner, never inside a per-lookup helper. Both successes and completed expected failures (`PartMissing`) are cached; interrupted lookups are not.

When entries need time-based expiration or manual invalidation after a write, wrap the resolver with `RequestResolver.asCache`:

```vibe
// run: { const jsonValue = try expiringLookup(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
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

`timeToLive` receives the request's `Exit` and the request itself, so you can give successes a long TTL and transient failures a short (or zero) TTL. Cache idempotent reads only; keep side-effecting commands outside any cache.

## Coming from Effect

Requests and resolvers use Effect 4's API directly. Resolver callbacks that execute Effects are `effect` functions, per-entry computations use `effect { ... }`, and cache creation runs with `try RequestResolver.withCache(...)` or `try RequestResolver.asCache(...)`.

[Upstream Effect page](https://effect.website/docs/v4/batching)
