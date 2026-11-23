# Introduction to Effect Schema

`Schema` works in VibeLang exactly as in Effect — plus VibeLang adds `schema` declarations that generate both the runtime codec and the TypeScript type in one place. Use schemas at every system boundary (HTTP JSON, environment variables, database rows, RPC) so untrusted `unknown` input becomes validated domain data.

![One schema declaration generates both the runtime decode/encode codec and the TypeScript type](/diagrams/schema-codec-flow.svg)

## Configuring compiler prerequisites

Enable `strict` and `exactOptionalPropertyTypes` in `tsconfig.json` so TypeScript distinguishes a missing optional key (`{}`) from an explicit `undefined` (`{ hint: undefined }`):

```vibe
// settings.vibe
// run: { const jsonValue = try readSettings({ label: "depot" }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(Settings)({ label: "depot", hint: undefined }))
const Settings = Schema.Struct({
  label: Schema.String,
  hint: Schema.optionalKey(Schema.String)
})

effect function readSettings(input: unknown) {
  return try Schema.decodeUnknownEffect(Settings)(input)
}
// Inferred: typeof Settings.Type!Schema.SchemaError
```

```output
{"label":"depot"}
false
```

`Schema` is globally in scope without an import. Schema constructors and `Schema.is` guards are pure calls; Effect-returning decoders (`decodeUnknownEffect`, `encodeEffect`) run with `try` and report validation failures on channel `E` as `Schema.SchemaError`.

## Schemas vs. Codecs (`Type` vs. `Encoded`)

Every schema describes two types — the **decoded** domain type (`Type`) and the **encoded** wire representation (`Encoded`) — plus optional services for each direction:

- `Schema.Schema<T>` — decoded type `T`
- `Schema.Codec<T, E, RD, RE>` — decoded `T`, encoded `E`, decoding services `RD`, encoding services `RE`

```vibe
// run: { const jsonValue = try unpack(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = try pack({ weight: 3.75 }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
schema Parcel { readonly weight: Schema.FiniteFromString }
// Type:    { readonly weight: number }
// Encoded: { readonly weight: string }

type ParcelWire = typeof Parcel.Encoded

effect function unpack() {
  return try Schema.decodeEffect(Parcel)({ weight: "3.75" })
}

effect function pack(parcel: Parcel) {
  return try Schema.encodeEffect(Parcel)(parcel)
}
```

```output
{"weight":3.75}
{"weight":"3.75"}
```

Notice `schema Parcel` declares both the runtime codec `Parcel` and the TypeScript type `Parcel` from a single definition.

## Decoding and encoding `unknown` input

Use `decodeUnknownEffect` for untrusted boundary data, and `decodeEffect` / `encodeEffect` when the input type is already known statically:

```vibe
// run: { const jsonValue = try inspectBoundary("3.75", 2); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Effect.catch(inspectBoundary(3, "2"), (error) => Console.log(error._tag))
effect function inspectBoundary(incoming: unknown, outgoing: unknown) {
  const quantity = try Schema.decodeUnknownEffect(Schema.FiniteFromString)(incoming)
  const text = try Schema.encodeUnknownEffect(Schema.FiniteFromString)(outgoing)
  return { quantity, text }
}
// Inferred: { quantity: number; text: string }!Schema.SchemaError
```

```output
{"quantity":3.75,"text":"2"}
SchemaError
```

## Round-trip behavior

Aim for `decode(encode(domainValue))` to preserve domain values. The reverse direction (`encode(decode(wireValue))`) may normalize formatting such as whitespace:

```vibe
// run: try Console.log(try roundTrip(3.75)); try Console.log(try normalizeText())
effect function roundTrip(value: number) {
  const wire = try Schema.encodeEffect(Schema.FiniteFromString)(value)
  return try Schema.decodeEffect(Schema.FiniteFromString)(wire)
}

effect function normalizeText() {
  const value = try Schema.decodeEffect(Schema.Trim)("  dispatch  ")
  return try Schema.encodeEffect(Schema.Trim)(value) // "dispatch"
}
```

```output
3.75
dispatch
```

## Coming from Effect

`Schema` is in scope without an import. Run `Schema.decodeUnknownEffect` and `Schema.encodeEffect` with `try`, recover `Schema.SchemaError` with `catch`, and use `schema Name { ... }` to avoid writing `Schema.Struct` + `type Name = typeof Name.Type` twice.

[Upstream page](https://effect.website/docs/v4/schema/introduction)
