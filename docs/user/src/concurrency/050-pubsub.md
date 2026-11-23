# PubSub

A `PubSub` broadcasts every published value to all active subscribers independently. Use it for live notifications and event fan-out; choose a `Queue` when workers should split items among themselves instead of each receiving a copy.

![Queue vs. PubSub message delivery](/diagrams/queue-vs-pubsub.svg)

| Constructor | Behavior when buffer is full | Tradeoff |
| --- | --- | --- |
| `PubSub.bounded(n)` | Suspends `publish` until all subscribers advance | Slowest subscriber backpressures publishers |
| `PubSub.dropping(n)` | Rejects new items (`publish` returns `false`) | Publishers never stall; new events may drop |
| `PubSub.sliding(n)` | Evicts oldest retained items | Publishers never stall; slow subscribers miss older events |
| `PubSub.unbounded()` | Always accepts immediately | Memory grows if subscribers lag |

## Broadcasting to independent subscribers

```vibe
// run: { const jsonValue = try broadcast(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function broadcast() {
  const hub = try PubSub.bounded<string>(4)
  return try ensuring(scoped(effect {
    const display = try PubSub.subscribe(hub)
    const audit = try PubSub.subscribe(hub)
    try PubSub.publish(hub, "deployment complete")
    return [try PubSub.take(display), try PubSub.take(audit)]
  }), PubSub.shutdown(hub))
}
// Returns ["deployment complete", "deployment complete"].

effect function stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}
// Output: ["deployment complete","deployment complete"]
```

Subscribe before publishing any message a listener must see: without replay configuration, late subscribers only receive subsequent publications. Each subscription tracks its own cursor, so taking from one leaves every other subscriber's copy intact.

## Selecting capacity and overflow behavior

```vibe
// run: const hubs = try makeHubs(); try Console.log(PubSub.capacity(hubs.reliable), PubSub.capacity(hubs.bestEffort), PubSub.capacity(hubs.latest), PubSub.capacity(hubs.unlimited)); for (const hub of Object.values(hubs)) { try PubSub.shutdown(hub) }
effect function makeHubs() {
  return {
    reliable: try PubSub.bounded<string>(64),
    bestEffort: try PubSub.dropping<string>(64),
    latest: try PubSub.sliding<string>(64),
    unlimited: try PubSub.unbounded<string>()
  }
}
// Output: 64 64 64 9007199254740991
```

Pick `bounded` when every subscriber must observe every event, `dropping` or `sliding` when publishers must stay responsive despite slow consumers, and `unbounded` only when publication rate is externally constrained.

## Managing scoped subscriptions

```vibe
// run: const hub = try PubSub.bounded<string>(2); const listener = try forkChild(listen(hub), { startImmediately: true }); try PubSub.publish(hub, "ready"); try Fiber.join(listener); try PubSub.shutdown(hub)
effect function listen(hub: PubSub.PubSub<string>) {
  try scoped(effect {
    const subscription = try PubSub.subscribe(hub)
    const message = try PubSub.take(subscription)
    try Console.log("notification", message)
  })
}
// Output: notification ready
```

`PubSub.subscribe` returns a scoped `PubSub.Subscription` that releases automatically when its `Scope` closes on success, failure, or interruption, freeing any backpressure that subscriber held. Omitting `scoped` leaves `Scope` in `R` so the caller owns the subscription's lifetime. In Effect 4, read from subscriptions using `PubSub.take` and its companion `PubSub` consumers.

## Publishing batches

```vibe
// run: { const jsonValue = try batch(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function batch() {
  const hub = try PubSub.bounded<string>(3)
  return try ensuring(scoped(effect {
    const subscription = try PubSub.subscribe(hub)
    const accepted = try PubSub.publishAll(hub, ["queued", "started", "finished"])
    const messages = try PubSub.takeAll(subscription)
    return { accepted, messages }
  }), PubSub.shutdown(hub))
}
// Output: {"accepted":true,"messages":["queued","started","finished"]}
```

`PubSub.publishAll` publishes a collection under the hub's overflow policy and returns whether every element succeeded. Because a bounded batch suspends once capacity fills, run producers and consumers on separate fibers whenever a batch can exceed capacity.

## Inspecting size and capacity

```vibe
// run: { const jsonValue = try inspect(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function inspect() {
  const hub = try PubSub.bounded<number>(5)
  return try ensuring(scoped(effect {
    const subscriber = try PubSub.subscribe(hub)
    try PubSub.publish(hub, 1)
    return {
      capacity: PubSub.capacity(hub),
      size: try PubSub.size(hub),
      empty: try PubSub.isEmpty(hub),
      full: try PubSub.isFull(hub)
    }
  }), PubSub.shutdown(hub))
}
// Output: {"capacity":5,"size":1,"empty":false,"full":false}
```

`PubSub.capacity` returns a plain number, while `size`, `isEmpty`, and `isFull` return Effects. `size` counts retained messages in the hub rather than copies across subscribers, and all counts are point-in-time snapshots rather than reservations.

## Ending subscriptions and shutting down

```vibe
// run: try Console.log(try ownHub())
effect function ownHub() {
  const hub = try PubSub.bounded<string>(8)
  try ensuring(scoped(effect {
    const subscriber = try PubSub.subscribe(hub)
    try PubSub.publish(hub, "last update")
    try Console.log(try PubSub.take(subscriber))
  }), PubSub.shutdown(hub))
  // The subscription's scope has closed and the hub has shut down.
  try PubSub.awaitShutdown(hub)
  return try PubSub.isShutdown(hub)
}
// Output: last update
// Output: true
```

Closing a single subscription affects neither the hub nor other subscribers. `PubSub.shutdown` terminates every subscription and releases blocked calls, while `awaitShutdown` and `isShutdown` observe that terminal state; always place `PubSub.shutdown` in the owner's cleanup path.
