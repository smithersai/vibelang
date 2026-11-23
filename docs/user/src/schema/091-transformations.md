# Schema Transformations

`Schema.decodeTo` connects two schemas into a codec that validates the source, converts it, and validates the target. Supply synchronous functions for pure conversions or effectful getters for fallible and service-backed ones. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Reversible infallible conversions

```vibe
// run: try Console.log(try readAvailability("ready"), try readAvailability("held")); try Console.log(try Schema.encodeEffect(Availability)(true))
const Availability = Schema.Literals(["ready", "held"]).pipe(
  Schema.decodeTo(Schema.Boolean, SchemaTransformation.transform({
    decode: (status) => status === "ready",
    encode: (available) => available ? "ready" : "held"
  }))
)

effect function readAvailability(input: unknown) {
  return try Schema.decodeUnknownEffect(Availability)(input)
}
```

```output
true false
ready
```

`SchemaTransformation.transform` takes pure, synchronous `decode` and `encode` functions. Input validation still runs before conversion and output validation after.

## Transformation boundaries

```vibe
// run: try Console.log(try readNumericAvailability()); try Console.log(try Schema.encodeEffect(NumericAvailability)(true))
const NumericAvailability = Schema.FiniteFromString.pipe(
  Schema.decodeTo(Availability, SchemaTransformation.transform({
    decode: (quantity) => quantity > 0 ? "ready" : "held",
    encode: (status) => status === "ready" ? 1 : 0
  }))
)

effect function readNumericAvailability() {
  return try Schema.decodeEffect(NumericAvailability)("12") // true
}
```

```output
true
1
```

Decoding runs `source -> decode -> target`; encoding runs `target -> encode -> source` in reverse. The conversion connects the source's `Type` (`number`) to the target's `Encoded` (`"ready" | "held"`), while the resulting codec connects `string` to `boolean`. Normalizing conversions are lossy: encoding `true` yields `"1"`, not `"12"`.

## Fallible conversions

```vibe
// run: try Console.log(try Schema.decodeUnknownEffect(DeliveryMode)(" RAIL ")); try Effect.catch(Schema.decodeUnknownEffect(DeliveryMode)("air"), (error) => Console.log(error.message))
const DeliveryMode = Schema.String.pipe(
  Schema.decodeTo(Schema.Literals(["road", "rail"]), {
    decode: SchemaGetter.transformEffect<"road" | "rail", string>(effect (text) => {
      const mode = text.trim().toLowerCase()
      if (mode === "road" || mode === "rail") return mode
      throw new SchemaIssue.InvalidValue({ message: "Choose road or rail" })
    }),
    encode: SchemaGetter.passthrough()
  })
)
```

```output
rail
Choose road or rail
```

`SchemaGetter.transformEffect` takes an `effect` function that returns the converted value or throws a `SchemaIssue.Issue`, which the parser wraps in `SchemaError`. Translate domain errors to schema issues before returning.

## Asynchronous conversions with services

```vibe
// run: try Console.log(try previewRoute()); provide Routes = { effect check(code) { throw new UnknownRoute({ code }) } } { try Effect.catch(readRoute("missing"), (error) => Console.log(error.message)) }
error UnknownRoute {
  code: string
}

service Routes {
  check(code: string): void!UnknownRoute
}

const RouteCode = Schema.String.pipe(
  Schema.decodeTo(Schema.NonEmptyString, {
    decode: SchemaGetter.transformEffect(effect (code) => {
      const routes = try Routes
      return effect {
        try routes.check(code)
        return code
      } catch effect (_error) => {
        throw new SchemaIssue.InvalidValue({ message: "Route is unavailable" })
      }
    }),
    encode: SchemaGetter.passthrough()
  })
)

effect function readRoute(input: unknown) {
  return try Schema.decodeUnknownEffect(RouteCode)(input)
}
// string!Schema.SchemaError!Routes

const TestRoutes = Layer.succeed(Routes, {
  effect check(_code) {}
})

effect function previewRoute() {
  provide TestRoutes { return try readRoute("coastal") }
}
```

```output
coastal
Route is unavailable
```

Service requirements attach per direction: decoding `RouteCode` requires `Routes`, while `passthrough()` encoding does not. Use Effect-based interpreters (`decodeUnknownEffect`, `encodeEffect`) whenever services or async steps are present. Catching expected service errors preserves defects and interruption.

## Forbidding one direction

```vibe
// run: try Console.log(try readInitial("Ada")); try Effect.catch(Schema.encodeEffect(Initial)("A"), (error) => Console.log(error.message))
const Initial = Schema.NonEmptyString.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((name) => name[0]),
    encode: SchemaGetter.forbidden(() => "An initial cannot recover the full name")
  })
)

effect function readInitial(input: unknown) {
  return try Schema.decodeUnknownEffect(Initial)(input)
}
```

```output
A
An initial cannot recover the full name
```

Use `SchemaGetter.forbidden` for one-way projections so encoding fails explicitly instead of fabricating lost data.

## Composing pipelines and effectful checks

```vibe
// run: { const jsonValue = try readNumbers(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(try Schema.decodeEffect(DeferredLabel)("crate")); try Effect.catch(Schema.decodeEffect(DeferredLabel)("x"), (error) => Console.log(error.message))
const SemicolonNumbers = Schema.String.pipe(
  Schema.decodeTo(Schema.Array(Schema.String), SchemaTransformation.transform({
    decode: (text): ReadonlyArray<string> => text.split(";"),
    encode: (items) => items.join(";")
  })),
  Schema.decodeTo(Schema.Array(Schema.FiniteFromString))
)

const DeferredLabel = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.checkEffect(effect (label) => {
      try sleep("5 millis")
      return label.length > 2 || "Label is too short"
    }),
    encode: SchemaGetter.passthrough()
  })
)

effect function readNumbers() {
  return try Schema.decodeEffect(SemicolonNumbers)("2;5;8")
}
```

```output
[2,5,8]
crate
Label is too short
```

Omit the conversion argument in `decodeTo` when the source's `Type` already matches the target's `Encoded`. Use `Schema.toType(elementSchema)` on target collections whose elements are already decoded so inner conversions do not run twice. `SchemaGetter.checkEffect` validates asynchronously or with services without changing the value.

## String case, JSON, and binary encodings

```vibe
// run: { const jsonValue = try decodeTextFormats(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const LowerLabel = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String.check(Schema.isLowercased()),
    SchemaTransformation.toLowerCase()
  )
)
const JsonLabel = Schema.fromJsonString(Schema.Struct({ label: Schema.String }))

effect function decodeTextFormats() {
  const trimmed = try Schema.decodeEffect(Schema.Trim)("  crate  ")
  const lower = try Schema.decodeEffect(LowerLabel)("CRATE")
  const data = try Schema.decodeEffect(JsonLabel)('{"label":"crate"}')
  const base64 = try Schema.decodeEffect(Schema.StringFromBase64)("Y3JhdGU=")
  const hex = try Schema.decodeEffect(Schema.StringFromHex)("6372617465")
  return { trimmed, lower, data, base64, hex }
}
```

```output
{"trimmed":"crate","lower":"crate","data":{"label":"crate"},"base64":"crate","hex":"crate"}
```

- **Whitespace & case**: `Schema.Trim`, plus `SchemaTransformation.toLowerCase`, `toUpperCase`, `capitalize`, and `uncapitalize` (pair each with its matching target check). All normalize and discard original spelling.
- **Structured & encoded text**: `Schema.fromJsonString`, `StringFromBase64`, `StringFromBase64Url`, `StringFromHex`, and `StringFromUriComponent`.

## Numbers, dates, and decimals

```vibe
// run: const value = try readManifest({ units: "3.5", sequence: "12", departure: "2026-01-02T00:00:00Z", price: "1.25" }); try Console.log(value.units, String(value.sequence), value.departure.toISOString(), BigDecimal.format(value.price)); try Effect.catch(readManifest({ units: "Infinity", sequence: "12", departure: "invalid", price: "bad" }), (error) => Console.log(error._tag))
const Manifest = Schema.Struct({
  units: Schema.FiniteFromString,
  sequence: Schema.BigIntFromString,
  departure: Schema.DateFromString,
  price: Schema.BigDecimalFromString
})

effect function readManifest(input: unknown) {
  return try Schema.decodeUnknownEffect(Manifest)(input)
}
```

```output
3.5 12 2026-01-02T00:00:00.000Z 1.25
SchemaError
```

- `FiniteFromString`: rejects non-numeric text, `NaN`, and infinities (add `Schema.isInt()` for integers).
- `BigIntFromString`: rejects fractions and malformed bigint text.
- `DateFromString`: validates `Date` instances and encodes to normalized ISO strings.
- `BigDecimalFromString`: preserves exact decimal precision without passing through IEEE 754 `number`.

## Coming from Effect

Pass an `effect` arrow to `SchemaGetter.transformEffect`, run service methods with `try`, and `throw` a `SchemaIssue.Issue` for expected conversion failures.

[Upstream page](https://effect.website/docs/v4/schema/transformations)
