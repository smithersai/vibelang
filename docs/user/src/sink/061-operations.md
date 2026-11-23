# Sink Operations

Instead of writing a custom reducer from scratch, adapt an existing `Sink` at its input or output boundary. Pure adapters (`mapInput`, `map`) transform synchronously; `*Effect` adapters defer effectful work to consumption. To omit unwanted elements before a sink counts or sums them, filter the feeding `Stream`.

| Operator | Adapts | When it runs |
| --- | --- | --- |
| `Sink.mapInput` / `mapInputEffect` | Incoming elements (`In`) | On every element before the inner sink |
| `Sink.map` / `mapEffect` | Final result (`A`) | Once after the inner sink succeeds |
| `Stream.filter` + `Stream.transduce` | Upstream selection + repeated sink execution | Per element before reaching the sink |

## Adapting consumer input

```vibe
// run: try Console.log(try countItems())
const quantities = Sink.mapInput(Sink.sum, (entry: { quantity: number }) => entry.quantity)

effect function countItems() {
  return try Stream.run(Stream.make({ quantity: 7 }, { quantity: 11 }), quantities)
}
// Returns 18.
// Output: 18
```

`Sink.mapInput` projects each incoming record into the type the inner sink expects (`number` for `Sink.sum`). Keep its callback pure and synchronous; use `Sink.mapInputEffect` when parsing or validation can fail or requires services.

```vibe
// run: try Console.log(try Stream.run(Stream.make("7", "11"), parsedTotal)); const outcome = try result(Stream.run(Stream.make("bad"), parsedTotal)); if (Result.isFailure(outcome)) match (outcome.failure) { when InvalidQuantity: try Console.log(outcome.failure._tag, outcome.failure.raw); }
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

`parsedTotal` accepts `string` inputs and adds `InvalidQuantity` to the sink's error channel. A failure in `mapInputEffect` fails stream consumption rather than silently dropping bad input.

## Mapping consumer output

```vibe
// run: { const jsonValue = try totalReport(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const report = Sink.map(Sink.sum, (total) => ({ total, unit: "items" }))

effect function totalReport() {
  return try Stream.run(Stream.make(7, 11), report)
}
// Returns { total: 18, unit: "items" }.
// Output: {"total":18,"unit":"items"}
```

`Sink.map` transforms the sink's final result `A` once upon completion without altering input or leftover types. Use `Sink.mapEffect` when post-processing needs an Effect (such as persisting a summary).

## Composing input and output transformations

```vibe
// run: try Console.log(try byteReport())
const report = Sink.sum.pipe(
  Sink.mapInput((entry: { bytes: number }) => entry.bytes),
  Sink.map((bytes) => `${bytes} bytes`)
)

effect function byteReport() {
  return try Stream.run(Stream.make({ bytes: 128 }, { bytes: 256 }), report)
}
// Returns "384 bytes".
// Output: 384 bytes
```

Chaining `mapInput` and `map` wraps one reusable core (`Sink.sum`) with both domain extraction and output formatting. The pipe builds an inert `Sink` value; `try Stream.run(source, report)` executes all three stages.

## Filtering before consumption

```vibe
// run: { const jsonValue = try positiveBatches(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function positiveBatches() {
  const positive = Stream.filter(Stream.make(-3, 4, 0, 8, -1, 12, 16), (n) => n > 0)
  const batches = Stream.transduce(positive, Sink.take<number>(3))
  return try Stream.runCollect(batches) // [[4, 8, 12], [16]]
}
// Output: [[4,8,12],[16]]
```

Filtering on the `Stream` excludes non-positive numbers before `Sink.take(3)` ever sees them, so dropped elements never count against the batch size. `Stream.transduce` runs the sink repeatedly across the stream, forwarding each cycle's leftovers to the next. If upstream ends right on a sink boundary, a trailing empty result may be emitted—filter empty arrays downstream when you want strictly non-empty groups.
