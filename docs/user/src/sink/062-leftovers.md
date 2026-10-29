# Leftovers

Leftovers are elements of a batch that a sink received but had not consumed when it completed. Keep them when another sink should continue from that batch, or move them into the result to inspect them. They are not every element left in the source.

## Collecting leftover elements

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try inspectRemainder(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function inspectRemainder() {
  const source = Stream.fromArray([21, 34, 55, 89])
  const sink = Sink.mapEnd(Sink.take<number>(2), ([selected, leftover]) => [
    { selected, leftover: leftover ?? [] }
  ] as const)
  return try Stream.run(source, sink)
}
// { selected: [21, 34], leftover: [55, 89] }
// Output: {"selected":[21,34],"leftover":[55,89]}
```

`Sink.mapEnd` receives `[result, optionalLeftoverBatch]` and returns another such tuple. A one-element tuple moves the leftovers into the success result, leaving no separate leftover batch; `try Stream.run(source, sink)` returns that result.

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: const remainder = try inspectSmallBatches(); { const jsonValue = { first: Option.getOrElse(remainder.first, () => 0), leftover: remainder.leftover }; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function inspectSmallBatches() {
  const source = Stream.rechunk(Stream.fromArray([21, 34, 55, 89]), 2)
  const sink = Sink.mapEnd(Sink.head<number>(), ([first, leftover]) => [
    { first, leftover: leftover ?? [] }
  ] as const)
  return try Stream.run(source, sink)
}
// { first: Option.some(21), leftover: [34] }
// Output: {"first":21,"leftover":[34]}
```

Here `55` and `89` are in a batch the sink never requests, so the leftovers you can inspect depend on internal batch boundaries. `Stream.peel` gives both the sink result and a live remainder stream, including input not yet requested; consume that remainder inside its Scope.

## Explicitly discarding leftovers

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try discardRemainder(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function discardRemainder() {
  const sink = Sink.take<number>(2).pipe(
    Sink.ignoreLeftover,
    Sink.mapEnd(([selected, leftover]) => [
      { selected, leftover: leftover ?? [] }
    ] as const)
  )
  return try Stream.run(Stream.fromArray([21, 34, 55, 89]), sink)
}
// { selected: [21, 34], leftover: [] }
// Output: {"selected":[21,34],"leftover":[]}
```

`ignoreLeftover` changes the sink's leftover type to `never` and drops its unused batch suffix; it does not drain the rest of the upstream source. In sink composition or repeated consumption, dropping leftovers can lose already-pulled elements, so use it only when you intend that loss.
