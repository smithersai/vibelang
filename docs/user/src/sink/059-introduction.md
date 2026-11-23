# Introduction to Sinks

A `Sink` is a reusable stream consumer: it specifies how to pull elements from a `Stream`, decide when to stop, and produce a single result. Constructing a `Sink` is pure and consumes nothing; `try Stream.run(source, sink)` drives it.

![Pull-based Stream pipeline into a Sink](/diagrams/stream-and-sink-pipeline.svg)

## Consumers and result types

```vibe
// run: { const jsonValue = try Stream.run(Stream.make("one", "two", "three"), header); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const header: Sink.Sink<Array<string>, string, string, never, never> = Sink.take<string>(2)
// Output: ["one","two"]
```

A sink carries five type parameters: `Sink.Sink<A, In, L, E, R>`:

| Parameter | Meaning |
| --- | --- |
| `A` | Final result produced on completion |
| `In` | Element type accepted from the stream |
| `L` | Leftover element type returned if the sink stops mid-batch (`never` if none) |
| `E` | Typed failures the sink can produce |
| `R` | Services required while consuming |

A sink may finish immediately without pulling, stop after a prefix, or drain the entire source. Sink constructors build values; wrap any throwing helper with `Effect.try` and run it with `try`. Because `effect function*` producers return Streams, they plug directly into `Stream.run`.

## Running a consumer against a source

```vibe
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

`try Stream.run(source, sink)` executes the stream into the sink and returns `A`. The combined Effect unions both the stream's and sink's failures (`E`) and service requirements (`R`). Satisfy those requirements with `provide` around `Stream.run` or via the stream's and sink's own provision operators.

## Unconsumed elements

```vibe
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

Streams pull elements in internal chunks (batches). If a sink completes mid-batch, the unused suffix of *that batch* becomes leftovers `L`—not the entire unread tail of the source, since later batches are never requested. `Stream.run` returns only `A`; use `Sink.mapEnd` to fold leftovers into `A` when callers need them.

## Coming from Effect

All five `Sink` type parameters and combinators keep their Effect semantics. Construct sinks as plain values and run them with `try Stream.run(source, sink)` to obtain `A` directly.
