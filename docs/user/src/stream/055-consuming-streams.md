# Consuming Streams

A Stream does nothing until a consumer runs it. Every consumer (`Stream.runCollect`, `Stream.runForEach`, `Stream.runFold`, `Stream.run`) returns an Effect—execute it with `try` inside an effect function or block. Always bound infinite streams (with `Stream.take`, `takeWhile`, or a stopping consumer) before running a consumer that waits for stream end.

| Consumer | Purpose | Stops early? |
| --- | --- | --- |
| `Stream.runCollect` | Gather all elements into an array | No |
| `Stream.runForEach` | Execute an Effect per element | Only on failure |
| `Stream.runForEachWhile` | Execute an Effect until callback returns `false` | Yes |
| `Stream.runFold` / `runFoldEffect` | Reduce elements into one accumulator | No |
| `Stream.run(source, sink)` | Delegate consumption policy to a `Sink` | Depends on sink |

## Collecting elements

```vibe
// run: { const jsonValue = try collectLabels(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function collectLabels() {
  return try Stream.runCollect(Stream.make("north", "south", "west"))
}
// Array<"north" | "south" | "west">!!
// Output: ["north","south","west"]
```

`try Stream.runCollect(source)` buffers every emitted element into an ordered array. Use it only when the stream is finite and fits in memory. If the stream fails mid-way, `runCollect` fails with that error rather than returning a partial array.

## Executing per-element effects

```vibe
// run: try announce()
effect function announce() {
  try Stream.runForEach(Stream.make("build", "test", "package"), effect (stage) => {
    try Console.log(`starting ${stage}`)
    try sleep("20 millis")
  })
}
// void!!
// Output: starting build
// Output: starting test
// Output: starting package
```

`runForEach` invokes its callback sequentially on each element and succeeds with `void`. Any typed failures or service requirements from the callback merge into the resulting Effect. To process elements concurrently before a final consumer, stage the work with `Stream.mapEffect(..., { concurrency })`.

## Stopping conditionally

```vibe
// run: try Console.log(try reachBudget())
effect function reachBudget() {
  let total = 0
  try Stream.runForEachWhile(Stream.make(3, 5, 8, 13), effect (amount) => {
    total += amount
    return total < 10
  })
  return total // 16
}
// Output: 16
```

`runForEachWhile` keeps pulling while the callback returns `true` and halts as soon as it returns `false`. Note that the element causing `false` (`8`) has already been consumed and its callback body executed (`total` reaches `16`). Stopping early immediately closes the stream and runs all upstream finalizers.

## Folding into an accumulator

```vibe
// run: try Console.log(try totalBytes()); try Console.log(try totalWithProgress())
effect function totalBytes() {
  return try Stream.runFold(Stream.make(256, 512, 128), () => 0, (total, n) => total + n)
}
// Returns 896.

effect function totalWithProgress() {
  return try Stream.runFoldEffect(Stream.make(256, 512, 128), () => 0, effect (total, n) => {
    const next = total + n
    try Console.log(`processed ${next} bytes`)
    return next
  })
}
// Output: 896
// Output: processed 256 bytes
// Output: processed 768 bytes
// Output: processed 896 bytes
// Output: 896
```

The initial-value thunk (`() => 0`) runs once per consumption, guaranteeing fresh state even for mutable accumulators. Use `runFold` for pure, non-failing reducers and `runFoldEffect` when folding needs Effects. Both consume to stream end; for early termination based on accumulator state, use `runForEachWhile` or `Sink.fold`.

## Running a sink

```vibe
// run: { const jsonValue = try readHeader(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function readHeader() {
  const source = Stream.make("version", "length", "body")
  return try Stream.run(source, Sink.take<string>(2))
}
// Returns ["version", "length"].
// Output: ["version","length"]
```

`Stream.run(source, sink)` pairs a stream with a reusable `Sink`, unifying both components' error channels and service requirements. When a sink stops before the source finishes, any unused elements from the current batch become leftovers—see [Leftovers](../sink/062-leftovers.md).
