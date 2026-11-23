# Schema to Formatter

`Schema.toFormatter` derives a string formatter for decoded values, useful for diagnostics and display. It does not validate inputs or produce transport serialization—use a codec for wire formats and [Error Formatters](095-error-formatters.md) for failures. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Deriving a value formatter

```vibe
// run: try Console.log(try displayDispatch({ depot: "east", counts: [2, 4] }))
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

`toFormatter` traverses structs, arrays, unions, and supported declarations on the decoded type, so decode untrusted values first. Exceptions thrown by formatting hooks are defects.

## Customizing formatting per node

```vibe
// run: try Console.log(try displayManifest({ label: "crate", weight: 2 }))
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

Precedence:
1. A `toFormatter` annotation (via `overrideToFormatter` or on a declaration) wins first.
2. `onBefore(ast)` intercepts AST nodes before default derivation; returning `undefined` keeps the built-in formatter.
3. Parameterized declarations receive each type parameter's formatter.

Keep formatter callbacks synchronous and pure, and ensure custom output does not leak secrets into logs.

[Upstream page](https://effect.website/docs/v4/schema/formatter)
