# Sink Operations

Transform a Sink when its consumption rule fits but its input or result type does not. Pure mappings build a new sink; effectful ones defer their work to consumption. To let only selected elements reach a sink, filter the feeding Stream.

## Adapting consumer input

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try countItems())
const quantities = Sink.mapInput(Sink.sum, (entry: { quantity: number }) => entry.quantity)

effect countItems() {
  return try Stream.run(Stream.make({ quantity: 7 }, { quantity: 11 }), quantities)
}
// Returns 18.
// Output: 18
```

`mapInput` converts each incoming value before the original sink sees it. Its callback is synchronous and cannot do Effect work; use `mapInputEffect` for validation, service calls, or other work with failures and requirements.

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-7, VIP-13, VIP-14
// run: try Console.log(try Stream.run(Stream.make("7", "11"), parsedTotal)); const outcome = try result(Stream.run(Stream.make("bad"), parsedTotal)); if (Result.isFailure(outcome)) match (outcome.failure) { when InvalidQuantity: try Console.log(outcome.failure._tag, outcome.failure.raw) }
error InvalidQuantity {
  raw: string
}

const parsedTotal = Sink.mapInputEffect(Sink.sum, effect (raw: string) => {
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new InvalidQuantity({ raw })
  return value
})
// Output: 18
// Output: InvalidQuantity bad
```

The new sink accepts strings and can fail with `InvalidQuantity`. A failed input transformation fails consumption; it does not silently discard the input.

## Mapping consumer output

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try totalReport(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const report = Sink.map(Sink.sum, (total) => ({ total, unit: "items" }))

effect totalReport() {
  return try Stream.run(Stream.make(7, 11), report)
}
// Returns { total: 18, unit: "items" }.
// Output: {"total":18,"unit":"items"}
```

`map` runs once on the sink's successful final result and leaves the input and leftover types unchanged. `mapEffect` allows Effect work there, such as saving a summary.

## Composing input and output transformations

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try byteReport())
const report = Sink.sum.pipe(
  Sink.mapInput((entry: { bytes: number }) => entry.bytes),
  Sink.map((bytes) => `${bytes} bytes`)
)

effect byteReport() {
  return try Stream.run(Stream.make({ bytes: 128 }, { bytes: 256 }), report)
}
// Returns "384 bytes".
// Output: 384 bytes
```

The input stage adapts each element, the original sink accumulates, and the output stage formats once. The pipeline builds a Sink value; `try Stream.run(source, sink)` executes it.

## Filtering before consumption

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try positiveBatches(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect positiveBatches() {
  const positive = Stream.filter(Stream.make(-3, 4, 0, 8, -1, 12, 16), (n) => n > 0)
  const batches = Stream.transduce(positive, Sink.take<number>(3))
  return try Stream.runCollect(batches) // [[4, 8, 12], [16]]
}
// Output: [[4,8,12],[16]]
```

Elements filtered out upstream don't count toward the sink's limit. `Stream.transduce` runs the sink repeatedly, passing batch leftovers to the next run. If input ends exactly at a completed sink boundary, a final empty result can appear; remove empty arrays downstream if you need only non-empty groups.
