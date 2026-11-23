# Introduction to Streams

A `Stream.Stream<A, E, R>` is a pull-based, lazy sequence of zero or more values of type `A` that may fail with `E` and require services `R`. Use a `Stream` for paginated APIs, log tails, large files, and event feeds that need backpressure, cancellation, and automatic resource cleanup.

![Pull-based Streams: effect function* producers yield values on demand through operators into for try or a Sink](/diagrams/stream-producer-flow.svg)

## Element, error, and service channels

Like an `Effect`, constructing a `Stream` runs nothing. Work starts only when a consumer pulls from it:

```vibe
// run: provide Feed = { next: effect () => "message" } { { const jsonValue = try preview(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } }
error FeedUnavailable

service Feed {
  next(): string!FeedUnavailable
}

const messages = Stream.fromEffectRepeat(effect {
  const feed = try Feed
  return try feed.next()
})
// Stream.Stream<string, FeedUnavailable, Feed>

effect function preview() {
  return try Stream.runCollect(Stream.take(messages, 4))
}
// Inferred: Array<string>!FeedUnavailable!Feed
// Output: ["message","message","message","message"]
```

## Infinite sources and bounded demand

Because Streams are pull-based, an infinite stream costs nothing beyond the elements you take:

```vibe
// run: { const jsonValue = try firstFiveTickets(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function firstFiveTickets() {
  const tickets = Stream.iterate(100, (n) => n + 1)
  return try Stream.runCollect(Stream.take(tickets, 5))
}
// Output: [100,101,102,103,104]
```

## Effect vs. Stream

An `Effect` succeeds with **one** value (even if that value happens to be an array). A `Stream` emits **zero, one, or many** values over time:

```vibe
// run: { const jsonValue = [try oneResult(), try Stream.runCollect(noReadings), try Stream.runCollect(oneReading), ...(try compare())]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function oneResult() {
  return [12, 24, 36]
}
// Array<number>!!

const noReadings = Stream.empty
const oneReading = Stream.succeed(12)
const readings = Stream.fromArray([12, 24, 36])
const oneBatch = Stream.succeed([12, 24, 36])

effect function compare() {
  return [
    try Stream.runCollect(readings), // [12, 24, 36]
    try Stream.runCollect(oneBatch)  // [[12, 24, 36]]
  ]
}
// Output: [[12,24,36],[],[12],[12,24,36],[[12,24,36]]]
```

## Backpressure and producers

Consumers drive demand — a slow consumer naturally throttles upstream production:

```vibe
// run: try printReadings()
effect function printReadings() {
  const source = Stream.mapEffect(Stream.range(20, 25), effect (n) => {
    try Console.log(`prepare ${n}`)
    return n
  })
  try Stream.runForEach(source, effect (n) => {
    try sleep("50 millis")
    try Console.log(`received ${n}`)
  })
}
// Output: prepare 20
// Output: received 20
// Output: prepare 21
// Output: received 21
// Output: prepare 22
// Output: received 22
// Output: prepare 23
// Output: received 23
// Output: prepare 24
// Output: received 24
// Output: prepare 25
// Output: received 25
```

In VibeLang, you can also write any Stream source as an `effect function*` producer and consume any Stream with `for try`:

```vibe
// run: try Effect.provide(printFirstReading(), Logger.layer([Logger.withConsoleLog(Logger.make(({ message }) => (message as unknown[])[0]))]))
effect function* readings() {
  for (let n = 1; n <= 3; n++) {
    try sleep("50 millis")
    yield n
  }
}

effect function printFirstReading() {
  const source = Stream.map(readings(), (n) => n * 10)
  for try (const n of source) {
    try log(n)
    break
  }
}
// Output: 10
```

A producer runs on its own fiber with a one-element buffer, so it may run up to two elements ahead of its consumer: one buffered and one waiting to be offered. This bound is for one sequential emitter; in a `for concurrent` body, each active item can compute its value before waiting, so the buffer does not bound all pending offers. Breaking out of `for try` immediately closes the Stream, interrupts the producer fiber, and runs its cleanup finalizers. See [Producers](../vibelang-features/112-producers.md) for the full guide.

## Coming from Effect

- Keep `Stream` constructors and operators as-is; pass cold Effect values (`work()`) to `Stream.fromEffect` / `Stream.mapEffect`.
- Run terminal consumers with `try` (`try Stream.runCollect(source)`) or iterate directly with `for try (const x of source)`.

[Upstream Effect page](https://effect.website/docs/v4/stream/introduction)
