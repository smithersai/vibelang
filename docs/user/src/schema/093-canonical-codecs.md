# Canonical Codecs

Canonical codec derivation works as in Effect: it preserves a schema's decoded type and chooses a standard external representation for JSON, string trees, or structural updates. Derivation only builds a codec; parsing and encoding are separate calls. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Deriving JSON, string-tree, and isomorphism codecs

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try encodeAudit({ created: new Date("2026-01-02T00:00:00Z"), sequence: 12n, labels: ["fragile"] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
const AuditRecord = Schema.Struct({
  created: Schema.Date,
  sequence: Schema.BigInt,
  labels: Schema.Array(Schema.String)
})

effect function encodeAudit(input: unknown) {
  const value = try Schema.decodeUnknownEffect(AuditRecord)(input)
  const jsonCodec = Schema.toCodecJson(AuditRecord)
  return try Schema.encodeEffect(jsonCodec)(value)
}
// The JSON representation contains date and bigint strings.
```

```output
{"created":"2026-01-02T00:00:00.000Z","sequence":"12","labels":["fragile"]}
```

`toCodecJson` recursively chooses JSON-compatible encodings for domain values, nested declarations with built-in representations included. It keeps explicit encodings: a date explicitly encoded as epoch milliseconds stays numeric. Its output is a JSON value, not serialized JSON text; for text, use `fromJsonString`.

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try encodeSearch(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
const Search = Schema.Struct({
  offset: Schema.Int,
  archived: Schema.Boolean,
  labels: Schema.Array(Schema.String)
})

effect function encodeSearch() {
  const codec = try sync(() => Schema.toCodecStringTree(Search))
  return try Schema.encodeEffect(codec)({ offset: 20, archived: false, labels: ["large"] })
}
// { offset: "20", archived: "false", labels: ["large"] }
```

```output
{"offset":"20","archived":"false","labels":["large"]}
```

`toCodecStringTree` preserves object and array structure and converts leaves to strings. A string tree can also contain `undefined`, so it is not limited to JSON values. It suits configuration, forms, and query parameters.

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const slot = try slotRepresentation({ row: 2, column: 3 }); try Console.log(slot instanceof Slot, slot.row, slot.column) })
class Slot extends Schema.Class<Slot>("Slot")({
  row: Schema.Int,
  column: Schema.Int
}) {}

effect function slotRepresentation(input: unknown) {
  const slot = try Schema.decodeUnknownEffect(Slot)(input)
  const codec = Schema.toCodecIso(Slot)
  const structural = try Schema.encodeEffect(codec)(slot)
  return try Schema.decodeUnknownEffect(codec)(structural)
}
```

```output
true 2 3
```

`toCodecIso` selects the schema's `Iso` representation, such as plain fields for a class, for tools that update plain objects and arrays, then reconstruct the domain value. It is a structural isomorphism codec: it does not guarantee that the original runtime object is retained by identity.

## Supplying canonical conversions for custom declarations

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try encodeDepot(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
class DepotRef {
  constructor(readonly region: string, readonly number: number) {}
}

const DepotRefSchema = Schema.instanceOf(DepotRef, {
  toCodecJson: () => Schema.link<DepotRef>()(
    Schema.Struct({ region: Schema.String, number: Schema.Int }),
    SchemaTransformation.transform({
      decode: (data) => new DepotRef(data.region, data.number),
      encode: (ref) => ({ region: ref.region, number: ref.number })
    })
  )
})

effect function encodeDepot() {
  const codec = try sync(() => Schema.toCodecStringTree(DepotRefSchema))
  return try Schema.encodeEffect(codec)(new DepotRef("nw", 14))
}
// { region: "nw", number: "14" }
```

```output
{"region":"nw","number":"14"}
```

Declarations are opaque, so give derivation a structural codec. JSON prefers `toCodecJson`, then `toCodec`; StringTree prefers `toCodecStringTree`, then `toCodecJson`, then `toCodec`; Iso prefers `toCodecIso`, then `toCodec`. A JSON or StringTree hook can return `undefined` to mark the declaration as already canonical.

Without a hook, JSON uses an unconstrained JSON fallback and parsing can still fail; StringTree derivation throws; Iso keeps the declaration's own representation. Hooks can use effectful conversions but cannot add services absent from the resulting codec's service type. The separate `Schema.toIso` helper consumes its Iso conversion synchronously.

## Relating canonical representations to JSON Schema output

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try Effect.try(() => JSON.stringify(describeDepotJson()))) })
function describeDepotJson() {
  return Schema.toJsonSchemaDocument(DepotRefSchema)
}
```

```output
{"dialect":"draft-2020-12","schema":{"type":"object","properties":{"region":{"type":"string"},"number":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991}},"required":["region","number"],"additionalProperties":true},"definitions":{}}
```

JSON Schema export derives the canonical JSON codec first and describes its encoded side, so the custom depot representation appears as an object with a region and number. A custom JSON hook controls both runtime serialization and the exported shape; an opaque declaration without a structural hook yields an unconstrained document.

[Upstream page](https://effect.website/docs/v4/schema/canonical-codecs)
