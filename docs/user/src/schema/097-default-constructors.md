# Default Constructors

Schema constructors operate on decoded types: they apply constructor defaults and type-side filters without running encoded-to-decoded conversions. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Structs and records

```vibe
// run: { const jsonValue = try makeLabels(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const Label = Schema.Struct({ text: Schema.NonEmptyString })
const LabelsById = Schema.Record(Schema.String, Schema.NonEmptyString)

effect function makeLabels() {
  const label = try Label.makeEffect({ text: "Keep upright" })
  const byId = try LabelsById.makeEffect({ handling: label.text })
  return { label, byId }
}
```

```output
{"label":{"text":"Keep upright"},"byId":{"handling":"Keep upright"}}
```

Every schema exposes `make`, `makeOption`, and `makeEffect`. Each expects the decoded constructor input (for instance, `FiniteFromString.makeEffect(6)` takes a `number`, not `"6"`) and validates all fields or record entries.

## Filters and brands

```vibe
// run: try Console.log(try makeCaseCount(6)); try Effect.catch(makeCaseCount(0), (issue) => Console.log(issue._tag))
const CaseCount = Schema.FiniteFromString.check(
  Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 48 })
).pipe(Schema.brand("CaseCount"))

effect function makeCaseCount(value: number) {
  return try CaseCount.makeEffect(value)
}
```

```output
6
Composite
```

Type-side checks run during construction, and brands attach statically without changing the runtime value. Passing `{ disableChecks: true }` skips validation without proving the value conforms.

## Constructor failures

```vibe
// run: try Console.log(try constructOrExplain(6)); try Console.log(constructAsOption(0).isNone()); try Effect.catch(constructWithExpectedFailure(0), (error) => Console.log("Construction rejected"))
effect function constructOrExplain(value: number) {
  return effect {
    return String(try CaseCount.makeEffect(value))
  } catch (issue) => SchemaIssue.makeFormatterDefault()(issue)
}

function constructAsOption(value: number) {
  return CaseCount.makeOption(value)
}

effect function constructWithExpectedFailure(value: number) {
  return try CaseCount.makeEffect(value)
}
```

```output
6
true
Construction rejected
```

- `makeEffect`: fails in the typed error channel with a raw `SchemaIssue.Issue` (Effect 4.1.1—not wrapped in `SchemaError`). Format it directly or map it to a domain error.
- `makeOption`: returns `Option.none()` on schema failure, discarding issue details.
- `make`: throws a validation `Error` with the issue on `cause`.

Unexpected non-schema exceptions or asynchronous defaults in `make` / `makeOption` throw as defects; prefer `makeEffect` for expected validation failures.

## Nested and lazy defaults

```vibe
// run: const first = try makePacking(); const second = try makePacking(); try Console.log(try Effect.try(() => JSON.stringify(first))); try Console.log(first.labels === second.labels)
const Packing = Schema.Struct({
  handling: Schema.String.pipe(Schema.withConstructorDefault(effect { return "standard" })),
  dimensions: Schema.Struct({
    unit: Schema.String.pipe(Schema.withConstructorDefault(effect { return "cm" })),
    width: Schema.Finite
  }).pipe(Schema.withConstructorDefault(effect { return { width: 10 } })),
  labels: Schema.Array(Schema.String).pipe(Schema.withConstructorDefault(effect { return [] }))
})

effect function makePacking() {
  return try Packing.makeEffect({})
}
// { handling: "standard", dimensions: { unit: "cm", width: 10 }, labels: [] }
```

```output
{"handling":"standard","dimensions":{"unit":"cm","width":10},"labels":[]}
false
```

`Schema.withConstructorDefault` runs its Effect lazily only when the field is omitted—each call allocates a fresh `[]` for `labels`, and nested defaults fill missing inner fields after an outer default runs. Default Effects may fail with schema issues but cannot require services; pass service-derived values explicitly. Use `makeEffect` if any default is asynchronous.

## Reusing defaults

```vibe
// run: { const jsonValue = try makeReturnPacking(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const ReturnPacking = Schema.Struct({
  reason: Schema.String,
  handling: Packing.fields.handling,
  labels: Packing.fields.labels
})

effect function makeReturnPacking() {
  return try ReturnPacking.makeEffect({ reason: "inspection" })
}
```

```output
{"reason":"inspection","handling":"standard","labels":[]}
```

Constructor defaults travel with field schemas when reused via `.fields`. A `default` annotation is documentation only, and constructor defaults never apply during decoding—add a decoding default separately when needed.

## Schema-backed classes

```vibe
// run: const value = try createPackingRequest("pkg-94"); try Console.log(value instanceof PackingRequest); try Console.log(try Effect.try(() => JSON.stringify(value)))
class PackingRequest extends Schema.Class<PackingRequest>("PackingRequest")({
  reference: Schema.String,
  handling: Packing.fields.handling,
  labels: Packing.fields.labels
}) {}

effect function createPackingRequest(reference: string) {
  return try PackingRequest.makeEffect({ reference })
}
```

```output
true
{"reference":"pkg-94","handling":"standard","labels":[]}
```

Classes reuse the same field defaults in both `makeEffect` and `new`. Inside `effect` code, wrap throwing `new` calls with `Effect.try` if validation failure is expected; `new` never executes an Effect on its own.

[Upstream page](https://effect.website/docs/v4/schema/default-constructors)
