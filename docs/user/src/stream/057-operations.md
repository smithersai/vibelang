# Operations

Operators build a new description of how to process a source. Keep pure transformations synchronous; use the effectful variants when callbacks call services, fail, or wait. Consumption decides when callbacks run.

## Observing and taking elements

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-12, VIP-14
// run: try Effect.provide(effect { { const jsonValue = try readFirst(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; provide Logger.layer([]) { { const jsonValue = [try Stream.runCollect(below), try Stream.runCollect(through), try Stream.runCollect(last)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } } }, Logger.layer([Logger.withConsoleLog(Logger.make(({ message }) => (message as unknown[])[0]))]))
const observed = Stream.tap(Stream.range(10, 18), (n) => log(`reading ${n}`))
const first = Stream.take(observed, 3)
const below = Stream.takeWhile(observed, (n) => n < 13)
const through = Stream.takeUntil(observed, (n) => n === 13)
const last = Stream.takeRight(observed, 2)

effect function readFirst() {
  return try Stream.runCollect(first) // [10, 11, 12]
}
// Output: reading 10
// Output: reading 11
// Output: reading 12
// Output: [10,11,12]
// Output: [[10,11,12],[10,11,12,13],[17,18]]
```

`tap` observes elements without replacing them. `takeWhile` excludes the first element that fails its predicate; `takeUntil` includes the first that satisfies it. `takeRight` emits only after the source ends, so it does not suit infinite sources.

`takeWhileEffect` and `takeUntilEffect` accept effectful predicates. A failing tap or predicate fails the resulting stream.

## Async iteration and manual pulls

```ts
// TypeScript (.ts)
// exporter.ts
// run: return Effect.runPromise(countRows({ async *[Symbol.asyncIterator]() { yield "a"; yield "b" } })).then((count) => console.log(count))
import { Effect } from "effect"

/** @throws {never} */
export function countRows(rows: AsyncIterable<string>): Effect.Effect<number, Error> {
  return Effect.tryPromise({
    try: async () => {
      let count = 0
      for await (const row of rows) count++
      return count
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
  })
}
// Output: 2
```

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-9, VIP-12, VIP-14
// run: provide Exporter = { write: (rows) => countRows(rows) } { try Console.log(try exportRows(Stream.make("a", "b"))) }
import { countRows } from "./exporter.js"

service Exporter {
  write(rows: AsyncIterable<string>): number!Error
}

effect function exportRows(source: Stream.Stream<string>) {
  const rows = try Stream.toAsyncIterableEffect(source)
  const exporter = try Exporter
  return try exporter.write(rows)
}
// Output: 2
```

`try Stream.toAsyncIterableEffect(source)` captures the current services and returns an async iterable for a TypeScript consumer; `toAsyncIterable` is the direct variant for a source with no service requirements. Conversion consumes nothing. Iteration failures cross as JavaScript errors, so the foreign consumer must map them back into its declared failure channel.

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14
// run: try printBatches()
effect function printBatches() {
  try scoped(effect {
    const pull = try Stream.toPull(Stream.rechunk(Stream.range(30, 34), 2))
    while (true) {
      const batch = try Pull.catchDone(pull, () => succeed(undefined))
      if (batch === undefined) break
      { const jsonValue = batch; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
    }
  })
}
// Output: [30,31]
// Output: [32,33]
// Output: [34]
```

`try Stream.toPull(source)` returns a pull Effect that yields a non-empty array per `try pull`. Normal completion is `Cause.Done`, handled here with `Pull.catchDone`; other failures propagate. Keep the pull within its Scope. For ordinary processing, use Stream's consumers or `for try (const element of source) { … }`, which pulls the Stream and closes it when the loop exits; `for try` also consumes Streams returned by `effect function*` producers. Async iterables need Stream adaptation or an async consumer using `for await`.

## Mapping, flattening, and state

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = [try Stream.runCollect(labels), try Stream.runCollect(upper), try Stream.runCollect(signals), try Stream.runCollect(words), try Stream.runCollect(totals)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function loadLabel(id: number) {
  try sleep("10 millis")
  return `item-${id}`
}

const labels = Stream.mapEffect(Stream.make(4, 7, 9), (id) => loadLabel(id), { concurrency: 2 })
const upper = Stream.map(labels, (label) => label.toUpperCase())
const signals = Stream.map(labels, () => null)
const words = Stream.make("red green", "blue").pipe(
  Stream.map((line) => line.split(" ")),
  Stream.flattenIterable
)
const totals = Stream.mapAccum(Stream.make(4, 7, 9), () => 0, (total, n) => {
  const next = total + n
  return [next, [next]] as const
})
// Output: [["item-4","item-7","item-9"],["ITEM-4","ITEM-7","ITEM-9"],[null,null,null],["red","green","blue"],[4,11,20]]
```

`map` is synchronous; `mapEffect` takes a callback that returns an Effect. With concurrency above one, `mapEffect` runs callbacks concurrently yet keeps input order unless `{ unordered: true }` allows completion order. `flattenIterable` emits each member of each iterable.

`mapAccum` starts fresh state per run and returns `[nextState, emittedValues]` per input, emitting zero or more values. `mapAccumEffect` allows Effect work in the transition; `Stream.drain(source)` runs the work and suppresses emitted values.

## Filtering, scanning, and changes

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try inspect(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const readings = Stream.make(2, 2, 5, 5, 2)
const large = Stream.filter(readings, (n) => n >= 5)
const changes = Stream.changes(readings)
const running = Stream.scan(readings, () => 0, (total, n) => total + n)

effect function inspect() {
  return {
    large: try Stream.runCollect(large),     // [5, 5]
    changes: try Stream.runCollect(changes), // [2, 5, 2]
    running: try Stream.runCollect(running)  // [0, 2, 4, 9, 14, 16]
  }
}
// Output: {"large":[5,5],"changes":[2,5,2],"running":[0,2,4,9,14,16]}
```

`filter` removes elements without changing the survivors. `scan` emits the initial state and each update; `runFold` returns only the final one. `changes` drops consecutive equal elements; it does not remember every distinct value. `filterEffect`, `scanEffect`, and `changesWithEffect` allow Effect work; `changesWith` takes a custom synchronous equality test.

## Zipping and indexing

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = [try readPairs(), try Stream.runCollect(descriptions), try Stream.runCollect(indexed), (try Stream.runCollect(neighbors)).map(([previous, value, next]) => [Option.getOrNull(previous), value, Option.getOrNull(next)])]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const sizes = Stream.make(5, 8, 13)
const names = Stream.make("small", "large")
const pairs = Stream.zip(sizes, names)
const descriptions = Stream.zipWith(sizes, names, (size, name) => `${name}: ${size}`)
const indexed = Stream.zipWithIndex(names)
const neighbors = Stream.zipWithPreviousAndNext(sizes)

effect function readPairs() {
  return try Stream.runCollect(pairs) // [[5, "small"], [8, "large"]]
}
// Output: [[[5,"small"],[8,"large"]],["small: 5","large: 8"],[["small",0],["large",1]],[[null,5,8],[5,8,13],[8,13,null]]]
```

`zip` pairs by position and ends when either side runs out; `zipWith` combines each pair; `zipWithIndex` adds a zero-based index. `zipWithPrevious`, `zipWithNext`, and `zipWithPreviousAndNext` mark missing neighbors with `Option.none()`.

For sources with different rates, `zipLatest` waits until both sides produce, then pairs each arrival with the other side's latest value; `zipLatestWith` combines with a callback. Timing determines the pairs, so real-time examples can't rely on an exact interleaving.

## Cartesian products

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = [try Stream.runCollect(variants), try Stream.runCollect(names)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const variants = Stream.cross(Stream.make("linen", "wool"), Stream.make("blue", "gray"))
const names = Stream.crossWith(
  Stream.make("linen", "wool"),
  Stream.make("blue", "gray"),
  (fabric, color) => `${color} ${fabric}`
)
// Output: [[["linen","blue"],["linen","gray"],["wool","blue"],["wool","gray"]],["blue linen","gray linen","blue wool","gray wool"]]
```

`cross` emits every left/right combination; `crossWith` transforms each. The right source reruns, effects included, for each left element, so an infinite right source blocks the next left element.

## Partitioning and grouping

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14, VIP-18
// run: { const jsonValue = try partitionReadings(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function partitionReadings() {
  return try scoped(effect {
    const [even, odd] = try Stream.partition(
      Stream.range(10, 19),
      Filter.fromPredicate((n: number) => n % 2 === 0),
      { capacity: 2 }
    )
    return try.all [Stream.runCollect(even), Stream.runCollect(odd)]
  })
}
// Output: [[10,12,14,16,18],[11,13,15,17,19]]
```

`try Stream.partition(source, filter, options)` runs one source and returns the passing and failing streams, in that order. It is an Effect that requires Scope: keep both consumers within `scoped(effect { … })` and run them concurrently, since a full, unconsumed branch can backpressure the other. `partitionEffect` takes a `Filter.FilterEffect`; its Result's successes go to the passing branch, failures to the other.

```vibe
// pending: VIP-2, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = [(try Stream.runCollect(summaries)).sort((a, b) => a.region.localeCompare(b.region)), try Stream.runCollect(batches), try Stream.runCollect(timedBatches)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const requests = Stream.make(
  { region: "west", bytes: 10 },
  { region: "east", bytes: 20 },
  { region: "west", bytes: 15 }
)
const groups = Stream.groupByKey(requests, (request) => request.region)
const summaries = Stream.flatMap(groups, ([region, group]) =>
  Stream.fromEffect(effect {
    const bytes = try Stream.runFold(group, () => 0, (total, request) => total + request.bytes)
    return { region, bytes }
  }), { concurrency: "unbounded" })
const batches = Stream.grouped(requests, 2)
const timedBatches = Stream.groupedWithin(requests, 20, "1 second")
// Output: [[{"region":"east","bytes":20},{"region":"west","bytes":25}],[[{"region":"west","bytes":10},{"region":"east","bytes":20}],[{"region":"west","bytes":15}]],[[{"region":"west","bytes":10},{"region":"east","bytes":20},{"region":"west","bytes":15}]]]
```

`groupByKey` produces `[key, groupStream]` pairs. Consume groups concurrently so an idle group consumer doesn't stall distribution; merged results have no fixed order. `groupBy` takes an effectful callback returning `[key, value]`. `grouped` emits arrays up to a fixed size, `groupedWithin` also flushes on elapsed time, and both emit a final partial batch.

## Concatenating, merging, and interleaving

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = [try Stream.runCollect(sequential), try Stream.runCollect(flattened), try Stream.runCollect(expanded), (try Stream.runCollect(merged)).sort(), try Stream.runCollect(alternating), try Stream.runCollect(selected)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const primary = Stream.make("a1", "a2")
const secondary = Stream.make("b1", "b2", "b3")
const sequential = Stream.concat(primary, secondary)
const flattened = Stream.flatten(Stream.make(primary, secondary))
const expanded = Stream.flatMap(primary, (label) => Stream.make(label, label.toUpperCase()))
const merged = Stream.merge(primary, secondary, { haltStrategy: "both" })
const alternating = Stream.interleave(primary, secondary)
const selected = Stream.interleaveWith(primary, secondary, Stream.make(true, false, false, true, false))
// Output: [["a1","a2","b1","b2","b3"],["a1","a2","b1","b2","b3"],["a1","A1","a2","A2"],["a1","a2","b1","b2","b3"],["a1","b1","a2","b2","b3"],["a1","b1","b2","a2","b3"]]
```

`concat` consumes the left source, then the right; `flatten` does so for a stream of streams. `flatMap` builds an inner stream per element, sequentially unless its `concurrency` option runs them together. `switchMap` interrupts the previous inner stream when a new element arrives, for searches where only the newest request matters.

`merge` emits whichever side is ready, keeping each side's order. Its `haltStrategy` is `"both"` (default), `"left"`, `"right"`, or `"either"`; a source failure still fails the merge. `map` each side first to give them a common representation.

`interleave` alternates elements, then drains the survivor after the other ends. `interleaveWith` takes a boolean stream: `true` pulls left, `false` right. It ends when the selector ends or both data streams are exhausted.

## Separators and affixes

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try Stream.mkString(separated)); try Console.log(try formatFields())
const fields = Stream.make("name", "email", "role")
const separated = Stream.intersperse(fields, ",")
const bracketed = Stream.intersperseAffixes(fields, { start: "[", middle: ",", end: "]" })

effect function formatFields() {
  return try Stream.mkString(bracketed) // "[name,email,role]"
}
// Output: name,email,role
// Output: [name,email,role]
```

`intersperse` inserts a separator between adjacent elements; `intersperseAffixes` also emits a prefix and suffix. They are stream elements, so downstream transformations see them.

## Broadcasting and buffering

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14, VIP-18
// run: { const jsonValue = try shareReadings(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = try Stream.runCollect(buffered); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function shareReadings() {
  return try scoped(effect {
    const [totals, audit] = try Stream.broadcastN(Stream.range(1, 12), { n: 2, capacity: 3 })
    return try.all [
      Stream.runSum(totals),
      Stream.runForEach(audit, effect (n) => {
        try sleep("10 millis")
        try Console.log(`audit ${n}`)
      })
    ]
  })
}

const buffered = Stream.buffer(Stream.range(1, 12), { capacity: 3 })
// Output: audit 1
// Output: audit 2
// Output: audit 3
// Output: audit 4
// Output: audit 5
// Output: audit 6
// Output: audit 7
// Output: audit 8
// Output: audit 9
// Output: audit 10
// Output: audit 11
// Output: audit 12
// Output: [78,null]
// Output: [1,2,3,4,5,6,7,8,9,10,11,12]
```

`try Stream.broadcastN(source, options)` runs one source and gives each subscriber the same elements; with bounded suspending buffers, the slowest subscriber limits progress. Keep the subscribers inside the acquired Scope and run their consumers concurrently.

`buffer` lets upstream run ahead of one consumer. `{ capacity: n }` backpressures when full; `"unbounded"` removes the limit. With a numeric capacity, `strategy: "sliding"` drops old queued values and `strategy: "dropping"` rejects new ones, trading completeness for throughput.

## Debouncing and throttling

```vibe
// pending: VIP-2, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = [try Stream.runCollect(settled), try Stream.runCollect(paced)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const bursts = Stream.concat(Stream.make("c", "ca", "cat"), Stream.fromEffect(effect {
  try sleep("300 millis")
  return "cats"
}))
const settled = Stream.debounce(bursts, "100 millis")
const paced = Stream.range(1, 10).pipe(
  Stream.rechunk(1),
  Stream.throttle({
    cost: (batch) => batch.length,
    units: 2,
    duration: "1 second",
    strategy: "shape",
    burst: 1
  })
)
// Output: [["cat","cats"],[1,2,3,4,5,6,7,8,9,10]]
```

`debounce` emits a burst's latest element after the quiet interval. `throttle` is a token bucket: `units` replenish per `duration`, `cost` charges each internal batch, and `burst` adds capacity. The default `"shape"` strategy waits for tokens; `"enforce"` drops over-budget batches. Rechunk to size one to charge per element.

## Scheduling delivery

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try announce()
const announcements = Stream.schedule(
  Stream.make("prepare", "deploy", "verify"),
  Schedule.spaced("500 millis")
)

effect function announce() {
  try Stream.runForEach(announcements, (message) => Console.log(message))
}
// Output: prepare
// Output: deploy
// Output: verify
```

`schedule` delivers elements, unchanged, on a Schedule's timing, and can end when the schedule ends. Use `Stream.tick` for periodic signals and `Stream.fromEffectSchedule` to repeat an operation on a schedule.
