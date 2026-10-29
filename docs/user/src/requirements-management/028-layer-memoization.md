# Layer Memoization

Effect shares repeated uses of one layer value within a build graph, and VibeLang keeps this: reuse a layer value when consumers should share its initialization and resources.

[Upstream page](https://effect.website/docs/v4/requirements-management/layer-memoization)

## Sharing acquisition across a graph

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-9, VIP-12, VIP-14
// run: try Console.log(try stringify(try documentLabels()))
service Prefix {
  value: string
}
service Heading {
  value: string
}
service Footer {
  value: string
}

const PrefixLive = Layer.effect(Prefix, effect {
  try Console.log("Prefix initialized")
  return {
    value: "Monthly"
  }
})
const HeadingLive = Layer.effect(Heading, effect {
  const prefix = try Prefix
  return {
    value: `${prefix.value} report`
  }
})
const FooterLive = Layer.effect(Footer, effect {
  const prefix = try Prefix
  return {
    value: `${prefix.value} archive`
  }
})

const Shared = Layer.merge(
  Layer.provide(HeadingLive, PrefixLive),
  Layer.provide(FooterLive, PrefixLive)
)

effect documentLabels() {
  provide Shared {
    return [(try Heading).value, (try Footer).value]
  }
}

effect stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}
// Output: Prefix initialized
// Output: ["Monthly report","Monthly archive"]
```

Both branches reference `PrefixLive`, so its initialization logs once per run of `documentLabels()`. Memoization uses layer object identity, not the output service type or structural equivalence; when sharing matters, call a layer-building factory once and reuse its value.

Sharing lasts for the graph's managed lifetime, not process-wide. Scoped acquisitions stay open while the graph uses them and release when the owning lifetime ends.

## Requesting fresh acquisition

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-12, VIP-14
// run: try Console.log(try stringify(try isolatedLabels()))
const Separate = Layer.merge(
  Layer.provide(HeadingLive, Layer.fresh(PrefixLive)),
  Layer.provide(FooterLive, Layer.fresh(PrefixLive))
)

effect isolatedLabels() {
  provide Separate {
    return [(try Heading).value, (try Footer).value]
  }
}
// Output: Prefix initialized
// Output: Prefix initialized
// Output: ["Monthly report","Monthly archive"]
```

`Layer.fresh` isolates acquisition from the surrounding graph's memoization: each fresh branch acquires its own prefix implementation. Use it when separate state or resource ownership is intended.

## Local provision boundaries

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-12, VIP-14
// run: try Console.log(try stringify(try twoLocalReads())); try Console.log(try stringify(try oneSharedReadBoundary()))
effect readPrefix() {
  return (try Prefix).value
}

effect twoLocalReads() {
  const first = try Effect.provide(readPrefix(), PrefixLive)
  const second = try Effect.provide(readPrefix(), PrefixLive)
  return [first, second]
}

effect oneSharedReadBoundary() {
  provide PrefixLive {
    const first = try readPrefix()
    const second = try readPrefix()
    return [first, second]
  }
}
// Output: Prefix initialized
// Output: Prefix initialized
// Output: ["Monthly","Monthly"]
// Output: Prefix initialized
// Output: ["Monthly","Monthly"]
```

Each `Effect.provide` starts its own build boundary, so `twoLocalReads` builds twice; `oneSharedReadBoundary` builds once and shares within it. Provide the application layer around the entry point; use `ManagedRuntime` when several entry points need a common runtime lifetime.

## Controlling memoization explicitly

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
// run: try Console.log(try stringify(try manualSharing()))
effect manualSharing() {
  return try scoped(effect {
    const memoMap = try Layer.makeMemoMap
    const owner = try scope
    const first = try Layer.buildWithMemoMap(PrefixLive, memoMap, owner)
    const second = try Layer.buildWithMemoMap(PrefixLive, memoMap, owner)
    return [
      try Effect.provide(readPrefix(), first),
      try Effect.provide(readPrefix(), second)
    ]
  })
}
// Output: Prefix initialized
// Output: ["Monthly","Monthly"]
```

`Layer.makeMemoMap` is an Effect value; run `try Layer.makeMemoMap` to get the map. Building one layer twice with the same map reuses its acquisition, and providing the resulting contexts doesn't rebuild it. The explicit scope owns resource release; both contexts are consumed before it closes.

A memo map controls sharing; a scope controls lifetime. Align both with the intended application or test boundary, and don't retain resource-owning implementations after their scopes close.
