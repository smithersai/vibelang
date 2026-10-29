# Schema Projections

Projections work exactly as in Effect: they turn one side of a codec into a schema that validates that representation without running the codec's conversion. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Projecting a codec to its decoded schema

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try inspectCount(4)); for (const value of ["4", 0, 1.5]) { try Effect.catch(inspectCount(value), (error) => Console.log(error._tag)) } })
const CountFromText = Schema.FiniteFromString.check(
  Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)
)
const CountValue = Schema.toType(CountFromText)

effect function inspectCount(input: unknown) {
  return try Schema.decodeUnknownEffect(CountValue)(input)
}
// Accepts 4. Rejects "4", 0, and 1.5.
```

```output
4
SchemaError
SchemaError
SchemaError
```

`toType` makes the original decoded type both the new decoded and encoded type, keeping that side's checks and dropping conversion steps and service requirements. Use it on an already decoded value, or when the first stage of a composed codec has already converted nested elements.

## Projecting a codec to its encoded schema

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(try inspectWireName(" x "))) })
const Name = Schema.String.check(Schema.isMinLength(3)).pipe(
  Schema.decodeTo(Schema.Trim)
)
const NameInput = Schema.toEncoded(Name)

effect function inspectWireName(input: unknown) {
  return try Schema.decodeUnknownEffect(NameInput)(input)
}
// " x " passes unchanged: it has length 3 before trimming.
```

```output
" x "
```

`toEncoded` uses the original encoded type on both sides: it validates the input representation without trimming it and requires no conversion services. Use it to inspect wire data or generate examples of encoded values.

## Retaining checks appropriate to each side

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(JSON.stringify(try compareViews())); try Effect.catch(Schema.decodeUnknownEffect(ParcelCount)("00"), (error) => Console.log(error._tag)) })
const ParcelCount = Schema.String.check(Schema.isMinLength(2)).pipe(
  Schema.decodeTo(Schema.FiniteFromString),
  Schema.check(Schema.isGreaterThan(5))
)
const TextOnly = Schema.toEncoded(ParcelCount)
const NumberOnly = Schema.toType(ParcelCount)

effect function compareViews() {
  const text = try Schema.decodeUnknownEffect(TextOnly)("00") // "00"
  const count = try Schema.decodeUnknownEffect(NumberOnly)(8) // 8
  return { text, count }
}
```

```output
{"text":"00","count":8}
SchemaError
```

`TextOnly` keeps the two-character input check but not the numeric bound; `NumberOnly` keeps the bound above five but no string-length requirement. Neither projection promises that a value can complete the full original conversion: `"00"` satisfies the encoded projection but decodes to a number the original codec rejects.

[Upstream page](https://effect.website/docs/v4/schema/projections)
