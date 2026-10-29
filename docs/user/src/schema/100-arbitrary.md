# Schema to Arbitrary

Effect's native `Arbitrary` module derives generators and shrinkers from schemas exactly as in Effect. Use it to explore valid inputs and check properties across many examples. The module and replay format are unstable in Effect 4.1.0. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Generating schema-conforming random values

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const values = try sampleParcels(); try Console.log(values.length, values.every(Schema.is(Parcel))) })
const Parcel = Schema.Struct({
  label: Schema.NonEmptyString,
  count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 24 }))
})

effect function sampleParcels() {
  const generator = try sync(() => Arbitrary.schema(Parcel))
  return try Arbitrary.sampleEffect(generator, { count: 12, seed: "parcel-samples" })
}
```

```output
12 true
```

`Arbitrary.schema` derives a generator immediately; unsupported derivation is a defect. `sampleEffect` runs generation and takes `count`, `size`, `maxDiscards`, and `seed`. A seed makes sampling reproducible; `size` is a local complexity budget for each collection or recursive component, not one global maximum length.

## Translating filters into generation constraints

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const generator = try sync(() => Arbitrary.schema(EvenCapacity)); const values = try Arbitrary.sampleEffect(generator, { count: 12, seed: 17 }); try Console.log(values.length, values.every(Schema.is(EvenCapacity))) })
const EvenCapacity = Schema.Number.check(Schema.makeFilter(
  (value) => Number.isInteger(value) && value >= 2 && value <= 40 && value % 2 === 0,
  {
    expected: "an even capacity from 2 to 40",
    arbitraryConstraint: {
      order: Order.Number,
      minimum: 2,
      maximum: 40,
      number: "integer"
    }
  }
))
```

```output
12 true
```

Built-in bounds, lengths, patterns, property counts, and uniqueness checks give constructive constraints where supported. Custom `arbitraryConstraint` metadata guides construction without replacing the predicate: the example constructs integers in range and the predicate rejects odd ones. Every generated root and shrink candidate still passes the schema's filters.

## Handling opaque checks and transformed values

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const values = try sampleRepresentations(); try Console.log(values.numbers.length, values.numbers.every(Number.isFinite)); try Console.log(values.strings.length, values.strings.every((value) => typeof value === "string")); try Console.log(values.strings.some((value) => Schema.decodeUnknownResult(Schema.FiniteFromString)(value).isFailure())) })
effect function sampleRepresentations() {
  const decoded = try sync(() => Arbitrary.schema(Schema.FiniteFromString))
  const encoded = try sync(() => Arbitrary.schema(Schema.toEncoded(Schema.FiniteFromString)))
  const numbers = try Arbitrary.sampleEffect(decoded, { count: 4, seed: 17 })
  const strings = try Arbitrary.sampleEffect(encoded, { count: 4, seed: 17 })
  return { numbers, strings }
}
```

```output
4 true
4 true
true
```

Generation targets the decoded type, so a string-to-number codec generates numbers. Derive from `toEncoded` to generate values the encoded-side schema accepts; here that is `String`, so the strings need not decode as finite numbers. For valid wire values, encode generated decoded values. Opaque predicates without constructive metadata still run, but rejected candidates use up the discard budget. When it runs out, sampling fails with `SampleError` and property checking returns `Exhausted`.

## Checking properties

```vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log((try checkCountRoundTrip())._tag) })
effect function checkCountRoundTrip() {
  const Count = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
  const generator = Arbitrary.schema(Count)
  const result = try Arbitrary.checkEffect(generator, effect (count): boolean!Schema.SchemaError!never => {
    const wire = try Schema.encodeEffect(Schema.FiniteFromString)(count)
    return (try Schema.decodeEffect(Schema.FiniteFromString)(wire)) === count
  }, { runs: 200, seed: "count-round-trip" })
  return result
}
```

```output
Passed
```

`checkEffect` takes a pure or effectful boolean property. False results and expected failures are shrinkable falsifications; defects and interruption fail the checking Effect itself. The result is `Passed`, `Falsified`, `Exhausted`, or `ReplayMismatch`.

A falsification includes `shrunkInput` and a `replay` token. To reproduce it, call `checkEffect` with the same property and `{ replay: result.replay }`; the token sets the seed, attempt, size, and shrink path, overriding other checking options. `formatCheckFailure` returns a diagnostic for unsuccessful results and undefined for `Passed`.

## Composing generators and customizing shrinking

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const values = try sampleDispatchPlans(); try Console.log(values.length, values.every((plan) => plan.label === "test-dispatch" && Number.isInteger(plan.count) && plan.count >= 0 && plan.count <= 32)) })
effect function sampleDispatchPlans() {
  const counts = try sync(() => Arbitrary.schema(Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 32 })
  ), {
    shrink: (value) => value === 0 ? [] : [Math.floor(value / 2)]
  }))
  const plans = Arbitrary.all({
    count: counts,
    label: Arbitrary.Constant("test-dispatch")
  })
  return try Arbitrary.sampleEffect(plans, { count: 6, seed: 91 })
}
```

```output
6 true
```

`map` transforms values and shrink candidates; `flatMap` selects dependent generators; `all` combines a tuple, iterable, or record. `filter` and `filterMap` discard rejected values, while `Constant` produces one value with no shrink candidates. Prefer constructive schema constraints when valid values are rare.

A custom `shrink` replaces the derived shrink strategy, not root generation. It must be synchronous, deterministic, terminating, and free of mutation. The schema validates candidates before the property sees them. Treat generated values as immutable: checking, shrinking, and replay can examine them repeatedly.

## Supporting custom declarations

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const values = try sampleShelves(); try Console.log(values.length, values.every((shelf) => shelf instanceof ShelfRef && shelf.code.startsWith("shelf_"))) })
class ShelfRef {
  constructor(readonly code: `shelf_${string}`) {}
}
const ShelfRefSchema = Schema.instanceOf(ShelfRef, {
  toCodecArbitrary: () => Schema.link<ShelfRef>()(
    Schema.TemplateLiteral(["shelf_", Schema.String]),
    SchemaTransformation.transform({
      decode: (code) => new ShelfRef(code),
      encode: (ref) => ref.code
    })
  )
})

effect function sampleShelves() {
  const generator = try sync(() => Arbitrary.schema(ShelfRefSchema))
  return try Arbitrary.sampleEffect(generator, { count: 5, seed: 23 })
}
```

```output
5 true
```

An opaque declaration needs a generatable representation through `toCodecArbitrary`; the link converts generated representation values into domain values. Parameterized declarations receive decoded parameter schemas and normalized constraints in their annotation callback.

## Diagnosing derivation failures

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-7, VIP-14, VIP-26
// run: await runPromise(effect { try reportImpossibleGenerator() })
effect function reportImpossibleGenerator() {
  const outcome = try exit(sync(() => Arbitrary.schema(Schema.Never)))
  if (outcome is Exit.Failure) {
    try Console.log("Arbitrary derivation failed for the empty domain")
  }
}
```

```output
Arbitrary derivation failed for the empty domain
```

`exit` captures the derivation defect as an `Exit.Failure`. Derivation fails immediately for impossible constraints, `Never`, unsupported declarations, and recursion with no finite generation path. For runtime exhaustion, inspect the effective seed and discard budget, then add constructive constraints or fix the predicate. Keep the seed and replay token with a failing test to reexamine the same counterexample.

[Upstream page](https://effect.website/docs/v4/schema/arbitrary)
