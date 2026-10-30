# Schema Annotations

Annotations work exactly as in Effect: they attach metadata or interpreter hooks without changing the value's static type. Use them for documentation, error messages, representation choices, and custom tooling. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Attaching built-in metadata

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { for (const input of [{}, { destination: 1 }, { destination: "" }]) { try Effect.catch(Schema.decodeUnknownEffect(Request)(input), (error) => Console.log(error.message)) } })
const Destination = Schema.String.annotate({
  message: "Destination must be text"
}).check(Schema.isNonEmpty({ message: "Choose a destination" })).annotate({
  identifier: "Destination",
  title: "Shipping destination",
  description: "The destination printed on the manifest",
  documentation: "Keep destination names consistent across depots.",
  examples: ["North depot"],
  default: "Central depot";
})

const Request = Schema.Struct({
  destination: Destination.annotateKey({ messageMissingKey: "Destination is required" })
})
```

```output
Destination is required
  at ["destination"]
Destination must be text
  at ["destination"]
Choose a destination
  at ["destination"]
```

`identifier` gives interpreters a stable name; `title`, `description`, and `documentation` explain the value. `examples` and `default` only document: they check no examples and apply no defaults. To change runtime behavior, use the explicit constructor or decoding default combinators.

`message` targets a schema node or check; annotating after a check targets the last check. `annotateKey` applies to a struct field or tuple position, `annotateEncoded` to a codec's external representation. `messageUnexpectedKey` customizes excess-key errors.

Representation hooks include `toCodec`, `toCodecJson`, `toCodecStringTree`, `toCodecIso`, and `toCodecArbitrary`. `toFormatter` and `toEquivalence` define behavior for opaque declarations; checks explain their constraints to interpreters with `toJsonSchema` and `arbitraryConstraint`. To change execution, pass parse options to a parser instead of relying on arbitrary annotation keys.

## Controlling decoding concurrency

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(try reviewLabels(["north", "south"]))); try Effect.catch(reviewLabels([""]), (error) => Console.log(error.message)) })
const ReviewedLabel = Schema.String.pipe(Schema.decode({
  decode: SchemaGetter.checkEffect(effect (label) => {
    try sleep("10 millis")
    return label.length > 0 || "Empty label"
  }),
  encode: SchemaGetter.passthrough()
}))
const Labels = Schema.Array(ReviewedLabel)

effect function reviewLabels(input: unknown) {
  return try Schema.decodeUnknownEffect(Labels)(input, { concurrency: 3 })
}
```

```output
["north","south"]
Empty label
  at [0]
```

Product schemas such as arrays, structs, and tuples can run effectful child parsers concurrently. The default is sequential; pass a positive concurrency limit or `"unbounded"` when creating or applying the parser. Concurrency changes the completion order of side effects, so a check must not depend on which sibling finishes first.

## Recovering decoding failures with fallback values

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try readLabel("crate")); try Console.log(try readLabel(42)); try Effect.catch(Schema.encodeUnknownEffect(OptionalLabel)(42), (error) => Console.log(error._tag)) })
const OptionalLabel = Schema.String.pipe(
  Schema.catchDecoding(effect (issue) => {
    try Console.log(`label fallback: ${issue._tag}`)
    return Option.some("unlabeled")
  })
)

effect function readLabel(input: unknown) {
  return try Schema.decodeUnknownEffect(OptionalLabel)(input)
}
```

```output
crate
label fallback: InvalidType
unlabeled
SchemaError
```

`catchDecoding` receives the decoding issue and returns an Effect producing an `Option` of the decoded value. `Some` is a fallback value; `None` means absence, which succeeds only where the surrounding schema permits it. Throw the issue to propagate it. A fallback changes decoding only: it does not repair encoding or capture defects.

Log the issue tag or stage when diagnostics help; don't record a rejected payload that contains secrets or customer data.

## Defining custom schema annotations

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(isInternal(DepotCode), isInternal(Schema.String)) })
const InternalOnly = Symbol.for("warehouse/schema/internal-only")

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      [InternalOnly]?: boolean
    }
  }
}

const DepotCode = Schema.String.annotate({ [InternalOnly]: true })

function isInternal(schema: Schema.Top) {
  return Schema.resolveAnnotations(schema)?.[InternalOnly] ?? false
}
```

```output
true false
```

A namespaced symbol avoids collisions with other tools, and module augmentation makes the annotation's value type checkable. `resolveAnnotations` retrieves metadata from the appropriate schema node; custom metadata has no effect until application tooling interprets it.

[Upstream page](https://effect.website/docs/v4/schema/annotations)
