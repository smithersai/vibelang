# Filters

Filters work as in Effect: they add validation without changing the decoded type, and run after the underlying schema accepts the value. Use synchronous predicates for local checks and effectful getters for checks that need services. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Defining predicate-based checks

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try readShelf("S-12")); try Effect.catch(readShelf("A-12"), (error) => Console.log(error.message)) })
const ShelfCode = Schema.String.check(
  Schema.makeFilter((code) => code.startsWith("S-") || "Use an S- shelf code")
)

effect readShelf(input: unknown) {
  return try Schema.decodeUnknownEffect(ShelfCode)(input)
}
```

```output
S-12
Use an S- shelf code
```

A predicate receives the value, the schema AST, and the active parse options. Returning `true` or `undefined` accepts the value; `false` rejects it with the default message, and a string with that message. It can also return a `SchemaIssue.Issue`, a path-and-issue object, or an array of issues.

Filters keep the original TypeScript type; add a brand to give validated values a distinct static identity. A plain filter callback must complete synchronously, with no typed failures or service calls; effectful checks use `SchemaGetter.checkEffect`.

## Annotating validation checks

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(Schema.is(FourDigits)("1234")); try Effect.catch(Schema.decodeUnknownEffect(FourDigits)("abc"), (error) => Console.log(error.message)) })
const FourDigits = Schema.String.check(
  Schema.makeFilter((text) => /^\d{4}$/.test(text), {
    expected: "four decimal digits",
    description: "The depot's four-digit routing code",
    toJsonSchema: () => ({ pattern: "^[0-9]{4}$" })
  })
)
```

```output
true
Expected four decimal digits
```

`expected` supplies the default formatter's description; `message` replaces its message. `toJsonSchema` explains the constraint to the JSON Schema interpreter. A custom predicate alone cannot tell a generator or document exporter its meaning; add `arbitraryConstraint` when the generator can construct matching values.

## Assigning issue paths and reporting several issues

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Effect.catch(validateWindow({ start: 2, end: 1, destination: "" }), (error) => Console.log(error.message)) })
const DispatchWindow = Schema.Struct({
  start: Schema.Int,
  end: Schema.Int,
  destination: Schema.String
}).check(
  Schema.makeFilter((window) => {
    const issues: Array<Schema.FilterIssue> = []
    if (window.end <= window.start) {
      issues.push({ path: ["end"], issue: "End must follow start" })
    }
    if (window.destination.length === 0) {
      issues.push({ path: ["destination"], issue: "Choose a destination" })
    }
    return issues
  })
)

effect validateWindow(input: unknown) {
  return try Schema.decodeUnknownEffect(DispatchWindow)(input, { errors: "all" })
}
```

```output
End must follow start
  at ["end"]
Choose a destination
  at ["destination"]
```

Paths are relative to the checked value and can contain keys or array indices. Each returned issue attaches to its own field; an empty list succeeds. `errors: "all"` also collects independent failures elsewhere in the schema. The cross-field check runs only on a valid struct value.

## Applying built-in constraints

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(Schema.is(Label)(" ok"), Schema.is(Count)(4), Schema.is(Count)(3), Schema.is(Ratio)(2), Schema.is(Batch)([]), Schema.is(Serial)(1n)) })
const Label = Schema.String.check(
  Schema.isMinLength(2), Schema.isMaxLength(40), Schema.isTrimmed()
)
const Count = Schema.Finite.check(
  Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isMultipleOf(2)
)
const Ratio = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const Batch = Schema.Array(Schema.String).check(Schema.isBetweenLength(1, 8))
const Serial = Schema.BigInt.check(Schema.isGreaterThanBigInt(0n))
```

```output
false true false false false true
```

String checks include `isNonEmpty`, `isPattern`, `isStartingWith`, `isEndingWith`, `isIncluding`, `isTrimmed`, `isLowercased`, `isUppercased`, `isCapitalized`, and `isUncapitalized`. Length checks work on strings and arrays; `isBetweenLength(n, n)` is an exact length. `Schema.NonEmptyString` is a ready-made nonempty string schema.

Numbers have strict and inclusive lower and upper bounds, `isBetween`, `isInt`, and `isMultipleOf`; bigints have the matching `BigInt` bounds, `isBetweenBigInt` included. Checks only validate: they do not round numbers, change case, or trim strings.

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(Schema.is(ShipDate)(new Date("2026-06-01T00:00:00Z")), Schema.is(ShipDate)(new Date("invalid"))); try Console.log(Schema.is(try sync(() => boundedPriceSchema()))(try sync(() => BigDecimal.fromStringUnsafe("1.25")))); try Console.log(Schema.is(HoldDuration)(Duration.seconds(5)), Schema.is(HoldDuration)(Duration.seconds(31))) })
const ShipDate = Schema.Date.check(
  Schema.isBetweenDate({
    minimum: new Date("2026-01-01T00:00:00.000Z"),
    maximum: new Date("2026-12-31T23:59:59.999Z")
  })
)

function boundedPriceSchema() {
  const zero = BigDecimal.fromNumberUnsafe(0)
  return Schema.BigDecimal.check(Schema.isGreaterThanOrEqualToBigDecimal(zero))
}

const HoldDuration = Schema.Duration.check(
  Schema.makeFilter((duration) => duration.between({
    minimum: Duration.seconds(1), maximum: Duration.seconds(30)
  }))
)
```

```output
true false
true
true false
```

`Schema.Date` rejects invalid dates before date bounds run. Date and BigDecimal checks have strict, inclusive, and range variants with `Date` and `BigDecimal` suffixes. For durations, write a custom filter with `Duration.isGreaterThan`, `isLessThan`, their inclusive variants, or `between`.

Fixed date parsing is deterministic. For a bound relative to the current time, read the time through Effect's clock APIs inside a function and build the schema there.

[Upstream page](https://effect.website/docs/v4/schema/filters)
