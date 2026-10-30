# Getting Started

`Schema` uses the same descriptions and interpreters as in Effect. Start with a struct, extract its types, then pick a parser whose failure behavior fits the caller. The [call rules](085-introduction.md#configuring-compiler-prerequisites) apply to the plain builders below.

The `Schema` module is in scope without an import. An explicit `import { Schema } from "effect"` also works when only `schema` or `schema error` declarations need it; their generated code keeps the runtime schema module available.

## Declaring schemas

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try receive({ tracking: "box-76", pieces: "2" }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
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

Each field describes its own representation and checks; the struct combines them into one codec, so `pieces` arrives as text and becomes a number. Declaring `Shipment` builds a description and decodes nothing.

A required `schema` field must reference a codec with required decoded key flags (`EK2109`). Use an unmodified value codec and write optionality on the field. To retain an existing optional-key codec, `vibelang --fix` writes the explicit `Schema.Struct` value.

An empty type argument list on a schema reference, such as `Address<>`, reports `EK2109`. `vibelang --fix` removes the empty list and keeps its comments.

## Extracting decoded, encoded, and service types

```vibe
// pending: VIP-14
type Shipment = typeof Shipment.Type
type ShipmentWire = typeof Shipment.Encoded
type ReadServices = typeof Shipment.DecodingServices
type WriteServices = typeof Shipment.EncodingServices

type SameShipment = Schema.Schema.Type<typeof Shipment>
type SameWire = Schema.Codec.Encoded<typeof Shipment>
type SameReadServices = Schema.Codec.DecodingServices<typeof Shipment>
type SameWriteServices = Schema.Codec.EncodingServices<typeof Shipment>
```

The decoded `pieces` is a number, the encoded one a string, and both service types are `never`. Generic helpers should keep the directional service types so a future effectful conversion keeps its requirements.

## Understanding default immutability

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-15, VIP-26
// run: await runPromise(effect { { const jsonValue = try Schema.decodeUnknownEffect(Batch)({ shipments: [{ tracking: "box-76", pieces: "2" }] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
schema Batch {
  shipments: ReadonlyArray<Shipment>
}
// Batch: { shipments: ReadonlyArray<Shipment> }
```

```output
{"shipments":[{"tracking":"box-76","pieces":2}]}
```

`schema Batch { ... }` declares both the struct `Batch` and its decoded type, the type `Batch`. A field names its type; a schema such as `Shipment` stands for its own decoded type. A field's type maps to a schema when it is a primitive (`string`, `number`, `boolean`, `bigint`, `symbol`, `undefined` or `null`), a literal, a union, an array, a tuple, a `Record`, an object type, or another schema's name, and an optional field `name?: T` accepts a missing key or `undefined`, through `Schema.optional`. Any other type is EK2109. `unknown`, `any`, `never`, `object` and `void` are not primitives: name their schema, as in `payload: Schema.Unknown`, which `vibelang --fix` writes. A field is writable unless written `readonly`. Array, tuple, and `Record` mappings preserve collection mutability: `T[]`, `Array<T>`, and `[A, B]` use `Schema.mutable`; `Record<K, V>` uses `Schema.mutableKey` on its value schema. The `readonly T[]`, `ReadonlyArray<T>`, `readonly [A, B]`, and `Readonly<Record<K, V>>` forms remain readonly. `vibelang --fix` preserves these distinctions when converting explicit schema combinators to declarations. JavaScript objects are not frozen.

Schema references keep TypeScript’s declaration order and temporal dead zone. Forward and cyclic schema initializers receive TypeScript’s own initialization diagnostics; the compiler does not reorder them or insert `Schema.suspend`.

Separate `schema` declaration fields with `;`, `,` or a new line. The current compiler still reports a comma as `EK1013`, and `vibelang --fix` replaces it with `;`. Nested object types and alias types retain TypeScript’s comma separators.

## Declaring a schema for any type

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-15, VIP-26
// run: await runPromise(effect { { const jsonValue = try Schema.decodeUnknownEffect(Delivery)({ status: "delivered", shipments: [] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(Status)("lost")) })
schema Status = "pending" | "delivered" | "returned"
schema Delivery = { status: Status; shipments: ReadonlyArray<Shipment> }
// Status: "pending" | "delivered" | "returned"
```

```output
{"status":"delivered","shipments":[]}
false
```

`schema Status = ...` declares the schema `Status`, here `Schema.Literals(["pending", "delivered", "returned"])`, and the type `Status`, `typeof Status.Type`, in one declaration. The type after `=` maps to a schema as a struct field's type does: a union of literals is `Schema.Literals`, another union is `Schema.Union`, and arrays, tuples, records, object types, and the names of other schemas map as they do in a field. Refinements and transformations such as `Schema.NonEmptyString` and `Schema.FiniteFromString` stay `Schema` constants, as `Shipment` shows. A type outside the mapping, such as a function type, is EK2109.

## Choosing synchronous, result, or effect decoding

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log((try decodeWithEffects({ tracking: "box-76", pieces: "2" })).pieces); try Console.log(decodeAsData({ tracking: "box-76", pieces: "2" })); try Console.log((try decodeWithDomainError({ tracking: "box-76", pieces: "2" })).pieces); try Effect.catch(decodeWithDomainError({}), (error) => Console.log(error._tag)); try Console.log(decodeAsData({})) })
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

Prefer `decodeUnknownEffect`: it can pause, requires the codec's decoding services, and fails with `Schema.SchemaError`. `decodeUnknownResult` returns success or failure as data and needs a synchronous, service-free decoding path. An unexpected exception from a synchronous callback is a defect, which `catch` does not handle.

`decodeUnknownSync` throws on invalid input. Wrap that call with `Effect.try` before calling it from effect code; the example instead maps `decodeUnknownEffect`’s expected failure to `InvalidShipment` with `catch effect`. The `Exit` and `Option` variants give other synchronous result shapes; an `Exit` stays data until run with `try`. The `Promise` variant decodes asynchronously without services and is wrapped with `tryPromise` in effect code. The synchronous variants cannot complete asynchronous conversions, even with no services.

## Encoding values

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try send({ tracking: "box-76", pieces: 2 }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Effect.catch(sendUntrusted({ tracking: "box-76", pieces: "2" }), (error) => Console.log(error._tag)) })
effect function send(shipment: Shipment) {
  return try Schema.encodeEffect(Shipment)(shipment)
}
// ShipmentWire!Schema.SchemaError

effect function sendUntrusted(input: unknown) {
  return try Schema.encodeUnknownEffect(Shipment)(input)
}
```

```output
{"tracking":"box-76","pieces":"2"}
SchemaError
```

Encoding reverses the conversion, numeric `pieces` included. `encodeEffect` accepts the decoded type; `encodeUnknownEffect` accepts unknown input and validates it. Encoding also has `Sync`, `Result`, `Option`, `Exit`, and `Promise` variants, with decoding's execution limits.

## Handling schema failures

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try receiveOrExplain({ tracking: "box-76", pieces: "2" })); try Console.log(try receiveOrExplain({})) })
effect function receiveOrExplain(input: unknown) {
  return effect {
    const shipment = try receive(input)
    return `accepted ${shipment.tracking}`
  } catch (error) => error.message
}
// string!!
```

```output
accepted box-76
Missing key
  at ["tracking"]
```

The parser's expected failure is a `SchemaError` with `_tag: "SchemaError"`: its `issue` holds the structured failure and its `message` readable text. `catch` handles it; defects and interruption still propagate.

## Configuring excess properties and error collection

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Effect.catch(receiveStrict({ tracking: "box-76", pieces: "2", extra: true }), (error) => Console.log(error._tag)); { const jsonValue = try Schema.decodeUnknownEffect(ShipmentWithExtras)({ tracking: "box-76", pieces: "2", extra: true }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
effect function receiveStrict(input: unknown) {
  return try Schema.decodeUnknownEffect(Shipment)(input, {
    onExcessProperty: "error",
    errors: "all"
  })
}

const ShipmentWithExtras = Schema.StructWithRest(Shipment, [
  Schema.Record(Schema.String, Schema.Unknown)
])
```

```output
SchemaError
{"tracking":"box-76","pieces":2,"extra":true}
```

By default, parsing removes unmodeled keys and stops at the first issue. `onExcessProperty: "error"` rejects extra keys; `errors: "all"` collects independent issues. To keep extra values, describe an index signature with `StructWithRest`.

Pass options when creating the parser or when calling it; call options take precedence. Schema annotations do not override them for nested nodes.

## Deriving guards and assertions

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(shipmentTracking({ tracking: "box-76", pieces: 2 })); try Console.log(shipmentTracking({ tracking: "box-76", pieces: "2" })); try Console.log(try Effect.try(() => assertShipment({ tracking: "box-76", pieces: 2 }))) })
const isShipment = Schema.is(Shipment)

function shipmentTracking(input: unknown) {
  if (isShipment(input)) return input.tracking
  return undefined
}

function assertShipment(input: unknown) {
  Schema.asserts(Shipment, input)
  return input.tracking
}
```

```output
box-76
undefined
box-76
```

Guards and assertions check the decoded type: a numeric `pieces` is valid, a string `pieces` is not. `Schema.is` returns a type predicate; `Schema.asserts(schema, input)` throws a generic validation error whose `cause` holds the issue. Both calls keep TypeScript's narrowing in the current plain function. Wrap a throwing assertion with `Effect.try` before calling it from effect code. For typed validation failures, use `decodeUnknownEffect`.

## Coming from Effect

`Schema.decodeUnknownEffect(Shipment)(input)` returns an Effect. Inside an `effect` function, `try` runs it and gives the shipment. Use `catch` on the Effect value to recover from schema failures. A `const` that holds a `Schema.Struct` draws EK4832 when a `schema` declaration writes the same struct, and its quick fix writes the declaration ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)).

[Upstream page](https://effect.website/docs/v4/schema/getting-started)
