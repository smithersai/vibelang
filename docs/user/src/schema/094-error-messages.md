# Error Messages

A `SchemaError` pairs a formatted string (`error.message`) with a structured issue tree (`error.issue`), including property and index paths. Annotate the node where a failure occurs so messages stay specific to that field or check. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Default validation messages

```vibe
// run: try Console.log(try explainPackage({ label: 7, pieces: "several" })); try Console.log(try explainPackage({ label: "crate", pieces: 2 }))
const Package = Schema.Struct({
  label: Schema.String,
  pieces: Schema.Finite
})

effect function explainPackage(input: unknown) {
  return effect {
    try Schema.decodeUnknownEffect(Package)(input, { errors: "all" })
    return "Accepted"
  } catch (error) => error.message
}
// { label: 7, pieces: "several" } reports both expected types and their paths.
```

```output
Expected string
  at ["label"]
Expected number
  at ["pieces"]
Accepted
```

Type mismatches report `Expected <type>`, missing required fields report `Missing key`, and nested failures append `at [...]`. Pass `{ errors: "all" }` to collect all independent failures instead of stopping at the first. Checks run only after their base type passes.

## Naming schemas with `identifier` and `expected`

```vibe
// run: for (const input of [{ tracking: 1, count: 1 }, { tracking: "pkg", count: NaN }, { tracking: "pkg", count: "1" }]) { try Effect.catch(Schema.decodeUnknownEffect(LabeledPackage)(input), (error) => Console.log(error.message)) }
const Tracking = Schema.String.annotate({ identifier: "TrackingReference" })
const Count = Schema.Finite.annotate({ expected: "a finite package count" })
const LabeledPackage = Schema.Struct({ tracking: Tracking, count: Count }).annotate({
  identifier: "LabeledPackage"
})
```

```output
Expected TrackingReference
  at ["tracking"]
Expected a finite package count
  at ["count"]
Expected number
  at ["count"]
```

- `identifier`: replaces the generic type name with a stable domain identifier.
- `expected`: replaces the expected-value phrase on the annotated node or check (`Count` annotates `Finite`'s check, so `NaN` reports `Expected a finite package count`, while `"1"` fails the earlier `number` check).
- `title`: documentation metadata only; does not alter default messages.

Outer struct annotations apply only to struct-level failures; nested fields keep their own messages.

## Messages on checks and conversions

```vibe
// run: for (const input of [2, "no", "1.5"]) { try Effect.catch(Schema.decodeUnknownEffect(WholeCount)(input), (error) => Console.log(error.message)) }; try Effect.catch(Schema.decodeUnknownEffect(TrackingText)("x"), (error) => Console.log(error.message))
const WholeCount = Schema.String.annotate({
  message: "Enter the count as text"
}).pipe(
  Schema.decodeTo(
    Schema.Int.annotate({ message: "Use a whole package count" }),
    {
      decode: SchemaGetter.transformEffect(effect (text) => {
        if (text.trim() === "" || !Number.isFinite(Number(text))) {
          throw new SchemaIssue.InvalidValue({ message: "Count is not numeric" })
        }
        return Number(text)
      }),
      encode: SchemaGetter.transform((count) => String(count))
    }
  )
)
const TrackingText = Schema.String.check(
  Schema.isMinLength(4, { message: "Reference needs at least four characters" }),
  Schema.isMaxLength(24, { message: "Reference is too long" })
)
```

```output
Enter the count as text
Count is not numeric
Use a whole package count
Reference needs at least four characters
```

A conversion has three distinct failure sites: source validation, the getter itself, and target validation. For multiple checks, pass `{ message }` to each check constructor—`.annotate({ message })` after `.check(...)` targets only the final check.

## Scalar and compound messages

```vibe
// run: try Console.log(try explainOrders({ contacts: [], delivery: "air" })); try Console.log(try explainOrders({ contacts: [1], delivery: "courier" }))
const Contact = Schema.String.annotate({ message: "Contact must be text" })
const Delivery = Schema.Union([
  Schema.Literal("collect"), Schema.Literal("courier")
]).annotate({ message: "Choose collection or courier" })
const Orders = Schema.Struct({
  contacts: Schema.Array(Contact).check(
    Schema.isMinLength(1, { message: "Add a delivery contact" })
  ),
  delivery: Delivery
})

effect function explainOrders(input: unknown) {
  return effect {
    try Schema.decodeUnknownEffect(Orders)(input, { errors: "all" })
    return "Accepted"
  } catch (error) => error.message
}
```

```output
Add a delivery contact
  at ["contacts"]
Choose collection or courier
  at ["delivery"]
Contact must be text
  at ["contacts"][0]
```

A union `message` summarizes failure when every branch fails; a collection check explains size or container constraints; element failures keep their own messages and index paths.

## Missing fields and tuple elements

```vibe
// run: try Effect.catch(Schema.decodeUnknownEffect(Dispatch)({}), (error) => Console.log(error.message)); try Effect.catch(readCoordinates([]), (error) => Console.log(error.message))
const Dispatch = Schema.Struct({
  tracking: Schema.String.annotateKey({
    messageMissingKey: "Supply a tracking reference"
  })
})
const Coordinates = Schema.Tuple([
  Schema.Finite.annotateKey({ messageMissingKey: "Supply longitude" }),
  Schema.Finite.annotateKey({ messageMissingKey: "Supply latitude" })
])

effect function readCoordinates(input: unknown) {
  return try Schema.decodeUnknownEffect(Coordinates)(input, { errors: "all" })
}
```

```output
Supply a tracking reference
  at ["tracking"]
Supply longitude
  at [0]
Supply latitude
  at [1]
```

Attach `messageMissingKey` via `.annotateKey(...)` to distinguish an omitted field or tuple element from a present invalid value, which still reports the value schema's message.

[Upstream page](https://effect.website/docs/v4/schema/error-messages)
