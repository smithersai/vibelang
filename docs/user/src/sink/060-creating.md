# Creating Sinks

Choose a Sink for the result you need and run it with `try Stream.run(source, sink)`. Sinks are reusable: initializer state is fresh on each run, so runs share no mutable state. This page uses [Sink builders](059-introduction.md) and writes effectful callbacks as `effect` functions.

## Basic consumers and endpoint values

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = [Option.getOrElse((try endpoints()).first, () => ""), Option.getOrElse((try endpoints()).last, () => ""), (try endpoints()).prefix]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect endpoints() {
  const source = Stream.make("opening", "middle", "closing")
  return {
    first: try Stream.run(source, Sink.head<string>()),
    last: try Stream.run(source, Sink.last<string>()),
    prefix: try Stream.run(source, Sink.take<string>(2))
  }
}
// first: Some("opening"), last: Some("closing")
// prefix: ["opening", "middle"]
// Output: ["opening","closing",["opening","middle"]]
```

`head` stops after the first element; `last` reads to the end; both return `Option.none()` on empty input. `take(n)` returns up to `n` elements, completing early at the limit and keeping any unused suffix of its current input batch as leftovers.

## Counting, summing, draining, and timing

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: const summary = try summarize(); { const jsonValue = [summary.count, summary.sum, Duration.isDuration(summary.duration)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try drainObserved()
effect summarize() {
  const source = Stream.make(6, 10, 14)
  return {
    count: try Stream.run(source, Sink.count), // 3
    sum: try Stream.run(source, Sink.sum),     // 30
    duration: try Stream.run(source, Sink.timed)
  }
}

effect drainObserved() {
  const source = Stream.tap(Stream.make("ready", "done"), (s) => Console.log(s))
  try Stream.run(source, Sink.drain)
}
// Output: [3,30,true]
// Output: ready
// Output: done
```

These sinks consume the whole source. `drain` discards elements but still runs source effects; `timed` also drains and returns a `Duration.Duration`. `Sink.withDuration(otherSink)` returns `[result, duration]`: the other sink's result and the elapsed time. Each field in `summarize` is a separate consumption.

## Per-element work

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try writeRecords()
const print = Sink.forEach(effect (line: string) => {
  try Console.log(`record: ${line}`)
  try sleep("10 millis")
})

effect writeRecords() {
  try Stream.run(Stream.make("created", "approved"), print)
}
// Output: record: created
// Output: record: approved
```

`forEach` builds a sink that runs work in sequence and succeeds with `void`; its callback's expected failures and services become the sink's `E` and `R`. `forEachWhile` stops when its callback's Effect succeeds with `false`; `forEachArray` works on internal batches.

## Successful and failed sinks

```vibe
// pending: VIP-1, VIP-5, VIP-7, VIP-13, VIP-14
// run: try Console.log(try immediateResult()); const tag = rejectInput() catch (error) => match (error) { when Rejected: error._tag }; try Console.log(tag)
error Rejected

effect immediateResult() {
  return try Stream.run(Stream.make(40, 50), Sink.succeed("already complete"))
}

effect rejectInput() {
  return try Stream.run(Stream.make(40, 50), Sink.fail(new Rejected()))
}
// never!Rejected!
// Output: already complete
// Output: Rejected
```

`succeed` and `fail` finish without requesting source elements. They succeed or fail when the sink runs, not at construction. `Sink.fromEffect(work())` makes the same kind of immediate sink from an Effect value.

## Collecting by size or condition

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try collectSamples(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect collectSamples() {
  const source = Stream.make(8, 5, -1, 13)
  return {
    all: try Stream.run(source, Sink.collect<number>()),
    firstTwo: try Stream.run(source, Sink.take<number>(2)),
    positivePrefix: try Stream.run(source, Sink.takeWhile((n: number) => n > 0))
  }
}
// all: [8, 5, -1, 13], firstTwo: [8, 5], positivePrefix: [8, 5]
// Output: {"all":[8,5,-1,13],"firstTwo":[8,5],"positivePrefix":[8,5]}
```

`collect` gathers every input into an array. `takeWhile` stops at the first rejected element and leaves it in the batch remainder; it does not skip it and keep searching. `takeUntil` includes the matching element, then stops. `takeWhileEffect` and `takeUntilEffect` accept effectful predicates.

## Uniqueness and key limits

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = Array.from(try collectUnique()); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const unique = Sink.reduce(() => new Set<string>(), (set, value: string) => set.add(value))
const threeUnique = Sink.reduceWhile(
  () => new Set<string>(),
  (set) => set.size < 3,
  (set, value: string) => set.add(value)
)

effect collectUnique() {
  return try Stream.run(Stream.make("oak", "oak", "ash", "elm", "pine"), threeUnique)
}
// Set containing "oak", "ash", "elm".
// Output: ["oak","ash","elm"]
```

Use a native Set when JavaScript value equality fits. A size limit counts unique values, so duplicates take no extra slot.

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = Array.from(try summarizeStations()); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
type Reading = { station: string; count: number }

function addReading(totals: Map<string, number>, reading: Reading): Map<string, number> {
  totals.set(reading.station, (totals.get(reading.station) ?? 0) + reading.count)
  return totals
}

const allStations = Sink.reduce(() => new Map<string, number>(), (map, reading: Reading) => addReading(map, reading))
const twoStations = Sink.reduceWhile(
  () => new Map<string, number>(),
  (map) => map.size < 2,
  (map, reading: Reading) => addReading(map, reading)
)

effect summarizeStations() {
  return try Stream.run(Stream.make(
    { station: "hill", count: 4 },
    { station: "hill", count: 3 },
    { station: "lake", count: 8 },
    { station: "hill", count: 9 }
  ), twoStations)
}
// Map with "hill" -> 7 and "lake" -> 8.
// Output: [["hill",7],["lake",8]]
```

The reducer defines both the grouping key and the merge rule. The limited sink stops at two keys and leaves later input unread, even updates for existing keys: it limits the consumed prefix rather than scanning all input while rejecting new keys.

## Folding with termination and count limits

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try Effect.provide(foldSamples(), Logger.layer([Logger.withConsoleLog(Logger.make(({ message }) => (message as unknown[])[0]))])); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const total = Sink.reduce(() => 0, (sum, n: number) => sum + n)
const budget = Sink.fold(
  () => 0,
  (sum) => sum < 20,
  effect (sum, n: number) => {
    try log(`adding ${n}`)
    return sum + n
  }
)
const firstThree = Sink.foldUntil(() => 0, 3, effect (sum, n: number) => sum + n)

effect foldSamples() {
  const source = Stream.make(7, 9, 12, 15)
  return {
    all: try Stream.run(source, total),       // 43
    budget: try Stream.run(source, budget),   // 28
    first: try Stream.run(source, firstThree) // 28
  }
}
// Output: adding 7
// Output: adding 9
// Output: adding 12
// Output: {"all":43,"budget":28,"first":28}
```

`reduce` takes a pure reducer and consumes to the end; `reduceEffect` supports Effect work. `fold` takes an effectful step and checks its continuation predicate after each consumed element, so the element that reaches or crosses the limit is included. `foldUntil` stops after a maximum number of inputs or at source completion.

## Folding by weight

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try firstBatch(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
type Packet = { bytes: number }
type Batch = { packets: ReadonlyArray<Packet>; bytes: number }

const weighted = Sink.fold<Batch, Packet>(
  () => ({ packets: [], bytes: 0 }),
  (batch) => batch.bytes < 100,
  effect (batch, packet) => ({
    packets: [...batch.packets, packet],
    bytes: batch.bytes + packet.bytes
  })
)
const packets = Sink.map(weighted, (batch) => batch.packets)

effect firstBatch() {
  return try Stream.run(Stream.make({ bytes: 60 }, { bytes: 55 }, { bytes: 10 }), packets)
}
// Returns the 60-byte and 55-byte packets.
// Output: [{"bytes":60},{"bytes":55}]
```

The state tracks total cost, not element count. It stops after reaching the threshold, so the final element can exceed the target: this is not strict maximum-size packing. `Stream.transduce(source, packets)` repeats the sink to emit successive batches, feeding each run's leftovers into the next. At end of input, a sink that consumes nothing can produce an empty final result; batch consumers must handle it.
