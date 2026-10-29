# Schema to Formatter

Value formatters work exactly as in Effect. A schema-derived formatter renders decoded values as readable strings for diagnostics or display. It neither validates input nor serializes for transport; use a codec for serialization and an issue formatter for failures. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Deriving value formatters from schemas

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try displayDispatch({ depot: "east", counts: [2, 4] })) })
const Dispatch = Schema.Struct({
  depot: Schema.String,
  counts: Schema.Array(Schema.Int)
})

effect function displayDispatch(input: unknown) {
  const dispatch = try Schema.decodeUnknownEffect(Dispatch)(input)
  return Schema.toFormatter(Dispatch)(dispatch)
}
// For { depot: "east", counts: [2, 4] }, produces a readable object representation.
```

```output
{ "depot": "east", "counts": [2, 4] }
```

`toFormatter` walks structs, arrays, unions, and supported declarations. It takes the schema's decoded type, even when the codec accepts a different wire representation, so the example decodes first to give it valid data. Exceptions from formatting callbacks are defects.

## Customizing formatting at selected syntax-tree nodes

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-15, VIP-26
// run: await runPromise(effect { try Console.log(try displayManifest({ label: "crate", weight: 2 })) })
const Weight = Schema.Finite.pipe(Schema.overrideToFormatter(
  () => (value) => `${value} kg`
))
schema Manifest { label: string; weight: Weight }

effect function displayManifest(input: unknown) {
  const manifest = try Schema.decodeUnknownEffect(Manifest)(input)
  return Schema.toFormatter(Manifest, {
    onBefore: (ast) => ast._tag === "String"
      ? (value: string) => `[${value}]`
      : undefined
  })(manifest)
}
```

```output
{ "label": [crate], "weight": 2 kg }
```

`overrideToFormatter` replaces formatting at one schema node, here the weight. A `toFormatter` annotation takes priority; `onBefore` then intercepts selected AST nodes before built-in derivation, and returning undefined keeps the default.

An opaque declaration can supply `toFormatter` when declared; a parameterized one receives the formatter for each parameter. Keep hooks and generated formatter functions synchronous and pure; compute service-dependent display data before formatting. Check custom output for exposed secrets before logging it.

[Upstream page](https://effect.website/docs/v4/schema/formatter)
