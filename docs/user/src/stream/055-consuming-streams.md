# Consuming Streams

A consumer such as `Stream.runCollect` returns an Effect that consumes a Stream; in an effect function or block, run it with `try` to get its result. Bound an unbounded source before a consumer that waits for its end.

## Collecting elements

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try collectLabels(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect collectLabels() {
  return try Stream.runCollect(Stream.make("north", "south", "west"))
}
// Array<"north" | "south" | "west">!!
// Output: ["north","south","west"]
```

`try Stream.runCollect(source)` returns an array in emission order. It keeps every element, so use it for finite results that fit in memory. If the source fails, it fails, never returning a partial array.

## Executing per-element effects

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try announce()
effect announce() {
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

`runForEach` runs the callback for each element in sequence and discards its result; the callback's errors and service requirements join the source's. For concurrent preparation, use `Stream.mapEffect` with a concurrency limit before consuming.

## Stopping conditionally

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try reachBudget())
effect reachBudget() {
  let total = 0
  try Stream.runForEachWhile(Stream.make(3, 5, 8, 13), effect (amount) => {
    total += amount
    return total < 10
  })
  return total // 16
}
// Output: 16
```

The callback's Effect succeeds with `true` to continue or `false` to stop; the element whose callback succeeds with `false` is already consumed and its callback has run. Stopping closes the source and runs its finalizers. State declared in the function is fresh per call.

## Folding into an accumulator

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try totalBytes()); try Console.log(try totalWithProgress())
effect totalBytes() {
  return try Stream.runFold(Stream.make(256, 512, 128), () => 0, (total, n) => total + n)
}
// Returns 896.

effect totalWithProgress() {
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

The initial-state callback runs per consumption, so a mutable accumulator starts fresh. `runFold` needs a synchronous, non-failing reducer; `runFoldEffect` takes a callback that returns an Effect. Both wait for the source to end; to stop early based on the accumulator, use `runForEachWhile`.

## Running a sink

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try readHeader(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect readHeader() {
  const source = Stream.make("version", "length", "body")
  return try Stream.run(source, Sink.take<string>(2))
}
// Returns ["version", "length"].
// Output: ["version","length"]
```

A Sink packages a reusable consumption policy. `Stream.run` combines the source's and sink's failures and requirements in an Effect; run it with `try` to get the sink's result. A sink can finish before the source ends; see [Leftovers](../sink/062-leftovers.md) for elements it pulled but did not use.
