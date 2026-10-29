# Introduction

A Sink describes how to consume a Stream into one result. Use one to make a consumption rule reusable: take a header, count records, accumulate totals, or run work for every element. Building a Sink consumes nothing.

## Consumers and result types

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try Stream.run(Stream.make("one", "two", "three"), header); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const header: Sink.Sink<Array<string>, string, string, never, never> = Sink.take<string>(2)
// Output: ["one","two"]
```

`Sink.Sink<A, In, L, E, R>` returns `A`, accepts input elements `In`, can leave unconsumed elements `L`, can fail with `E`, and requires services `R`. A sink can consume nothing, stop early, or read the whole source.

Sink constructors and operators that return Sinks build values; wrap any call that may throw with `Effect.try` and run it with `try`. An `effect function*` producer can be the source of `Stream.run`, since it returns a Stream.

## Running a consumer against a source

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try parseHeader(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function parseHeader() {
  const source = Stream.make("format-v2", "length-64", "payload")
  const header = Sink.take<string>(2)
  return try Stream.run(source, header)
}
// Array<string>!!
// Returns ["format-v2", "length-64"].
// Output: ["format-v2","length-64"]
```

`try Stream.run(source, sink)` runs consumption and returns the sink's result. The source's and sink's failures and services join the consuming function's contract; provide those services around consumption or with the source's and sink's own provision operators.

## Unconsumed elements

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try headerWithLeftovers(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function headerWithLeftovers() {
  const sink = Sink.mapEnd(Sink.take<string>(1), ([header, rest]) => [
    { header, rest: rest ?? [] }
  ] as const)
  return try Stream.run(Stream.fromArray(["header", "first", "second"]), sink)
}
// Returns { header: ["header"], rest: ["first", "second"] }.
// Output: {"header":["header"],"rest":["first","second"]}
```

Streams deliver batches internally. When the sink stops within a batch, the batch's unused suffix becomes leftovers; they are not the source's whole unread tail, which can include batches never requested. `try Stream.run(source, sink)` returns only `A`; use `Sink.mapEnd` to move leftovers into `A` when they matter.

## Coming from Effect

Sink's five type parameters and its operators keep their Effect meanings. Constructing a Sink builds a value; `try Stream.run(source, sink)` runs an Effect and returns the sink's success value directly.
