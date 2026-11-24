# Getting Started with Schema

Define your first struct or `schema` declaration, extract its decoded and encoded types, and choose the right decoder for your boundary.

![Schema decode and encode flow](/diagrams/schema-codec-flow.svg)

## Building a struct schema

```vibe
// run: { const jsonValue = try receive({ tracking: "box-76", pieces: "2" }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const Shipment = Schema.Struct({
  tracking: Schema.NonEmptyString,
  pieces: Schema.FiniteFromString
})

effect function receive(input: unknown) {
  return try Schema.decodeUnknownEffect(Shipment)(input)
}
```

```output
{"tracking":"box-76","pieces":2}
```

`pieces` arrives as `"2"` on the wire and decodes to `2: number`. Extract the types directly from the schema value:

```vibe
// expect-warning: EK4841
type Shipment = typeof Shipment.Type
type ShipmentWire = typeof Shipment.Encoded
type ReadServices = typeof Shipment.DecodingServices
type WriteServices = typeof Shipment.EncodingServices

type SameShipment = Schema.Schema.Type<typeof Shipment>
type SameWire = Schema.Codec.Encoded<typeof Shipment>
type SameReadServices = Schema.Codec.DecodingServices<typeof Shipment>
type SameWriteServices = Schema.Codec.EncodingServices<typeof Shipment>
```

## Declaring schemas with `schema`

In `.vibe` files, a `schema` declaration defines both the runtime codec and its decoded TypeScript type in one statement:

```vibe
// run: { const jsonValue = try Schema.decodeUnknownEffect(Batch)({ shipments: [{ tracking: "box-76", pieces: "2" }] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
schema Batch {
  shipments: ReadonlyArray<Shipment>
}
// Value: Schema.Struct({ shipments: Schema.mutableKey(Schema.Array(Shipment)) })
// Type:  { shipments: ReadonlyArray<Shipment> }
```

```output
{"shipments":[{"tracking":"box-76","pieces":2}]}
```

And use `schema Name = Type` for literal unions, aliases, or struct expressions:

```vibe
// run: { const jsonValue = try Schema.decodeUnknownEffect(Delivery)({ status: "delivered", shipments: [] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(Status)("lost"))
schema Status = "pending" | "delivered" | "returned"
schema Delivery = { status: Status; shipments: ReadonlyArray<Shipment> }
```

```output
{"status":"delivered","shipments":[]}
false
```

### Type-to-schema mapping rules

- **Supported types:** primitives (`string`, `number`, `boolean`, `bigint`, `symbol`, `undefined`, `null`), literals, unions, arrays, tuples, `Record<K, V>`, nested object types, and other schemas (like `Shipment`, `Schema.FiniteFromString`, `Schema.Unknown`).
- **Unsupported types** (functions, bare `unknown`/`any`/`never`/`object`, or shadowed library types) report `EK2109` — name an explicit schema such as `Schema.Unknown`.
- **Mutability:** fields are writable unless marked `readonly`; `T[]` / `Array<T>` / `[A, B]` map to mutable schemas, while `readonly T[]` / `ReadonlyArray<T>` / `readonly [A, B]` stay readonly.
- **Optional fields (`name?: T`):** follow `exactOptionalPropertyTypes`. With it on, `name?: string` maps to `Schema.optionalKey` and rejects an explicit `undefined`; with it off, or with `name?: string | undefined`, the field maps to `Schema.optional` and accepts one.

```vibe
// run: try Console.log(Schema.is(Nickname)({}), Schema.is(Nickname)({ name: undefined }))
schema Nickname { name?: string | undefined }
```

```output
true true
```

The same program, with each field spelling and setting, prints:

| `exactOptionalPropertyTypes` | Field | Output |
| --- | --- | --- |
| `true` | `name?: string` | `true false` |
| `false` | `name?: string` | `true true` |
| `true` | `name?: string \| undefined` | `true true` |

Use typed fields in a `schema` body. See [Schema declarations](../../../design/src/006-data.md#schema-declarations) for the full mapping and diagnostics.

## Choosing a decoder

```vibe
// run: try Console.log((try decodeWithEffects({ tracking: "box-76", pieces: "2" })).pieces); try Console.log(decodeAsData({ tracking: "box-76", pieces: "2" })); try Console.log((try decodeWithDomainError({ tracking: "box-76", pieces: "2" })).pieces); try Effect.catch(decodeWithDomainError({}), (error) => Console.log(error._tag)); try Console.log(decodeAsData({}))
effect function decodeWithEffects(input: unknown) {
  return try Schema.decodeUnknownEffect(Shipment)(input)
}

function decodeAsData(input: unknown) {
  const result = Schema.decodeUnknownResult(Shipment)(input)
  if (result.isFailure()) return result.failure.message
  return `received ${result.success.tracking}`
}

effect function decodeWithDomainError(input: unknown) {
  return Schema.decodeUnknownEffect(Shipment)(input) catch effect (cause) => { throw new InvalidShipment({ cause }) }
}

error InvalidShipment {
  cause: unknown
}
```

```output
2
received box-76
2
InvalidShipment
Missing key
  at ["tracking"]
```

| Decoder | Returns | Use when |
| --- | --- | --- |
| `Schema.decodeUnknownEffect(S)(x)` | `T!SchemaError!RD` | **Default in effect code** — supports async & services, typed error |
| `Schema.decodeUnknownResult(S)(x)` | `Result<T, SchemaError>` | Pure synchronous code with no services |
| `Schema.decodeUnknownOption(S)(x)` | `Option<T>` | Synchronous code when you only care whether input is valid |
| `Schema.decodeUnknownSync(S)(x)` | `T` (throws!) | Plain TypeScript only; wrap in `Effect.try` if called from effect code |

## Encoding values back to wire format

```vibe
// run: { const jsonValue = try send({ tracking: "box-76", pieces: 2 }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Effect.catch(sendUntrusted({ tracking: "box-76", pieces: "2" }), (error) => Console.log(error._tag))
effect function send(shipment: Shipment) {
  return try Schema.encodeEffect(Shipment)(shipment)
}
// Inferred: ShipmentWire!Schema.SchemaError

effect function sendUntrusted(input: unknown) {
  return try Schema.encodeUnknownEffect(Shipment)(input)
}
```

```output
{"tracking":"box-76","pieces":"2"}
SchemaError
```

## Type guards and assertions

```vibe
// run: try Console.log(isValid({ tracking: "box-76", pieces: 2 }), isValid({ tracking: "", pieces: 2 })); try Console.log(requireShipment({ tracking: "box-76", pieces: 2 }).tracking)
const isValid = Schema.is(Shipment)

function requireShipment(input: unknown): Shipment {
  try {
    Schema.asserts(Shipment, input)
    return input
  } catch {
    return { tracking: "fallback", pieces: 0 }
  }
}
```

```output
true false
box-76
```

`Schema.is` returns a plain boolean type guard (never throws). `Schema.asserts` throws on invalid input, so call it inside a plain `try`/`catch` or wrap with `Effect.try` in effect code.

[Upstream page](https://effect.website/docs/v4/schema/getting-started)
