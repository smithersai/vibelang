# Advanced Usage

The advanced Schema APIs work as in Effect: declarations for opaque runtime values, brands for static distinctions, field combinators for presence rules, and suspension for recursive descriptions. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Declaring custom scalar and parameterized schemas

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log((try readShelf(new Shelf("S-12"))).code); try Effect.catch(readShelf({ code: "S-12" }), (error) => Console.log(error._tag)) })
class Shelf {
  constructor(readonly code: string) {}
}

const ShelfSchema = Schema.declare(
  (input: unknown) => input instanceof Shelf,
  { identifier: "Shelf", description: "A warehouse shelf handle" }
)

effect function readShelf(input: unknown) {
  return try Schema.decodeUnknownEffect(ShelfSchema)(input)
}
```

```output
S-12
SchemaError
```

A declaration's guard establishes identity, with its type predicate inferred from `instanceof`; it does not validate members automatically, so add checks when fields need validation. Unlike a struct, an opaque declaration gives interpreters no structural description to traverse.

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log((try Schema.decodeUnknownEffect(BoxedCount)(new Box("12"))).value); try Console.log((try Schema.encodeEffect(BoxedCount)(new Box(12))).value) })
class Box<A> {
  constructor(readonly value: A) {}
}

function BoxSchema<S extends Schema.Constraint>(value: S) {
  return Schema.declareConstructor<Box<S["Type"]>, Box<S["Encoded"]>>()(
    [value],
    ([element]) => effect (input, ast, options) => {
      if (!(input instanceof Box)) throw new SchemaIssue.InvalidType(ast)
      const decoded = try SchemaParser.decodeUnknownEffect(element)(input.value, options)
      return new Box(decoded)
    },
    { expected: "Box" }
  )
}

const BoxedCount = BoxSchema(Schema.FiniteFromString)
```

```output
12
12
```

`declareConstructor` passes the type parameters' codecs to its parser factory. The parser returns the declared decoded value or fails with a raw `SchemaIssue.Issue`, which the outer Schema interpreter wraps in a `SchemaError`. Encoding reuses the declaration machinery with the directional parameter codecs. Service requirements must come from the parameter schemas; the declaration parser cannot introduce an unrelated service.

## Adding interpreter support

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const codec = Schema.toCodecJson(PortableShelf); try Console.log(try Schema.encodeEffect(codec)(new Shelf("S-12"))); try Console.log((try Schema.decodeUnknownEffect(codec)("S-12")) instanceof Shelf) })
const PortableShelf = Schema.declare(
  (input: unknown) => input instanceof Shelf,
  {
    identifier: "PortableShelf",
    toCodec: () => Schema.link<Shelf>()(
      Schema.NonEmptyString,
      SchemaTransformation.transform({
        decode: (code) => new Shelf(code),
        encode: (shelf) => shelf.code
      })
    ),
    toCodecArbitrary: () => Schema.link<Shelf>()(
      Schema.NonEmptyString,
      SchemaTransformation.transform({
        decode: (code) => new Shelf(code),
        encode: (shelf) => shelf.code
      })
    ),
    toFormatter: () => (shelf) => `Shelf(${shelf.code})`,
    toEquivalence: () => (left, right) => left.code === right.code
  }
)
```

```output
S-12
true
```

`toCodec` supplies a structural representation shared by canonical codecs; `toCodecJson`, `toCodecStringTree`, or `toCodecIso` give one format its own. `toCodecArbitrary` supplies a generatable representation, and the formatter and equivalence annotations supply those interpreters' behavior. For a parameterized declaration, interpreter callbacks receive the matching parameter interpretations.

## Creating branded schemas

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(try ShelfId.makeEffect("rack-18")); try Console.log(try TrackingIdSchema.makeEffect("pkg-76")); try Console.log(Schema.is(ShelfId)("")) })
const ShelfId = Schema.NonEmptyString.pipe(Schema.brand("ShelfId"))
type ShelfId = typeof ShelfId.Type

type TrackingId = string & Brand.Brand<"TrackingId">
const TrackingId = Brand.nominal<TrackingId>()
const TrackingIdSchema = Schema.String.pipe(Schema.fromBrand("TrackingId", TrackingId))
```

```output
rack-18
pkg-76
false
```

A brand distinguishes values statically without changing their runtime representation. It adds no check; combine it with a validating schema. `fromBrand` reuses an existing branded constructor.

## Applying constructor defaults

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try createParcel(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(Parcel)({ shelf: "rack-18" })) })
const Parcel = Schema.Struct({
  shelf: ShelfId,
  priority: Schema.Int.pipe(Schema.withConstructorDefault(effect { return 1 }))
})

effect function createParcel() {
  const shelf = try ShelfId.makeEffect("rack-18")
  return try Parcel.makeEffect({ shelf })
}
```

```output
{"shelf":"rack-18","priority":1}
false
```

`withConstructorDefault` makes a field optional for construction, not decoding, and runs its default Effect when needed. Constructor failures are raw schema issues in local Effect 4.1.0.

## Distinguishing optional keys, optional values, null, and absence

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(Schema.is(Presence)({ requiredUndefined: undefined, requiredNullable: null })); try Console.log(Schema.is(Presence)({ exact: undefined, requiredUndefined: undefined, requiredNullable: null })); { const jsonValue = try Schema.decodeUnknownEffect(WithDecodeDefault)({ copies: undefined }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Effect.catch(Schema.decodeUnknownEffect(WithDecodeDefault)({ rank: undefined }), (error) => Console.log(error._tag)) })
const Presence = Schema.Struct({
  exact: Schema.optionalKey(Schema.String),
  loose: Schema.optional(Schema.String),
  requiredUndefined: Schema.UndefinedOr(Schema.String),
  requiredNullable: Schema.NullOr(Schema.String),
  prohibited: Schema.optionalKey(Schema.Never)
})
const WithDecodeDefault = Schema.Struct({
  copies: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultType(() => 1)),
  rank: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultTypeKey(() => 0))
})
```

```output
true
false
{"copies":1,"rank":0}
SchemaError
```

| Field form | Missing key | Explicit `undefined` | Explicit `null` |
| --- | --- | --- | --- |
| `optionalKey(String)` | accepted | rejected | rejected |
| `optional(String)` | accepted | accepted | rejected |
| `UndefinedOr(String)` | rejected | accepted | rejected |
| `NullOr(String)` | rejected | rejected | accepted |
| `optionalKey(Never)` | accepted | rejected | rejected |

`withDecodingDefaultType` applies a decoded default to a missing or undefined input; the `Key` variant only to a missing key. `withDecodingDefault` and `withDecodingDefaultKey` instead take defaults in the encoded representation. No decoding default implies a constructor default. Enable `exactOptionalPropertyTypes` to keep these distinctions visible in static types.

## Mapping optional fields to options

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const value = try readPreferences(); try Console.log(value.note.isNone(), value.weight.isNone(), value.alias.isNone()); { const jsonValue = try Schema.encodeEffect(Preferences)(value); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
const Preferences = Schema.Struct({
  note: Schema.OptionFromOptionalKey(Schema.String),
  weight: Schema.OptionFromOptional(Schema.FiniteFromString),
  alias: Schema.OptionFromOptionalNullOr(Schema.String)
})

effect function readPreferences() {
  return try Schema.decodeUnknownEffect(Preferences)({ weight: undefined, alias: null })
}
// All three fields contain Option.none().
```

```output
true true true
{}
```

The decoded keys are required and hold `Option` values. The exact-key variant rejects explicit `undefined`; `OptionFromOptional` treats it as absent, and `OptionFromOptionalNullOr` treats null as absent too. Encoding `None` omits the key by default. For a required value that can be null or undefined, use the matching `OptionFromNullOr`, `OptionFromUndefinedOr`, or `OptionFromNullishOr`.

## Transforming field presence

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { const value = try Schema.decodeUnknownEffect(Form)({ note: "", memo: "" }); try Console.log(try Effect.try(() => JSON.stringify(value))); { const jsonValue = try Schema.encodeEffect(Form)(value); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
const Form = Schema.Struct({
  note: Schema.optionalKey(Schema.String).pipe(
    Schema.decodeTo(Schema.optionalKey(Schema.String), {
      decode: SchemaGetter.transformOptional((value) =>
        value.isSome() && value.value === "" ? Option.none() : value
      ),
      encode: SchemaGetter.transformOptional((value) => value)
    })
  ),
  label: Schema.optionalKey(Schema.String).pipe(
    Schema.decodeTo(Schema.NullOr(Schema.String), {
      decode: SchemaGetter.transformOptional((value) =>
        value.isNone() ? Option.some(null) : value
      ),
      encode: SchemaGetter.transformOptional((value) =>
        value.isNone() || value.value === null ? Option.none() : Option.some(value.value)
      )
    })
  ),
  memo: Schema.String.pipe(
    Schema.decodeTo(Schema.optionalKey(Schema.String), {
      decode: SchemaGetter.transformOptional((value) =>
        value.isSome() && value.value === "" ? Option.none() : value
      ),
      encode: SchemaGetter.transformOptional((value) =>
        value.isNone() ? Option.some("") : value
      )
    })
  )
})
```

```output
{"label":null}
{"memo":""}
```

Optional getters receive an `Option`: `None` means the key is absent, `Some(undefined)` that it is present with an undefined value. Returning `None` removes a key. `note` converts optional to optional, `label` supplies a required nullable output, and `memo` turns a required empty string into an absent decoded field and restores it when encoding. When null should count as absence, filter it out of the input Option.

## Extending and renaming fields

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try Schema.encodeEffect(WireDestination)({ city: "Oslo", dock: 2, route: "north" }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
const Address = Schema.Struct({ city: Schema.String })
const Destination = Schema.Struct({ ...Address.fields, dock: Schema.Int })
const Routed = Destination.pipe(Schema.fieldsAssign({ route: Schema.String }))
const WireDestination = Routed.pipe(Schema.encodeKeys({ dock: "dock_number" }))
```

```output
{"city":"Oslo","dock_number":2,"route":"north"}
```

Add fields by spreading `.fields` or with `fieldsAssign`. `encodeKeys` maps decoded names to external names and preserves field optionality. To rename the decoded model, create a field map with the new name and map it back to the original wire key. `mapMembers` applies an operation to each struct in a union.

## Modeling recursive and mutually recursive codecs

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try readCrate({ count: "2", children: [{ count: "1", children: [] }] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = try Schema.decodeUnknownEffect(Branch)({ leaves: [{ owner: null }] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } })
interface Crate {
  count: number
  children: ReadonlyArray<Crate>
}
interface CrateWire {
  count: string
  children: ReadonlyArray<CrateWire>
}

const Crate = Schema.Struct({
  count: Schema.FiniteFromString,
  children: Schema.Array(
    Schema.suspend((): Schema.Codec<Crate, CrateWire> => Crate)
  )
})

interface Branch { leaves: ReadonlyArray<Leaf> }
interface Leaf { owner: Branch | null }

const Branch = Schema.Struct({
  leaves: Schema.Array(Schema.suspend((): Schema.Codec<Leaf> => Leaf))
})
const Leaf = Schema.Struct({ owner: Schema.NullOr(Branch) })

effect function readCrate(input: unknown) {
  return try Schema.decodeUnknownEffect(Crate)(input)
}
```

```output
{"count":2,"children":[{"count":1,"children":[]}]}
{"leaves":[{"owner":null}]}
```

`suspend` delays resolving a schema reference, so schemas can refer to themselves or to each other without reading an uninitialized binding. Write the recursive callback's return type to break the inference cycle: `(): Schema.Codec<Crate, CrateWire> => Crate` is a plain function that returns the codec as data, as Schema expects. When encoded and decoded fields differ, define both recursive interfaces and keep both in `Codec`; `Codec<Crate>` would wrongly claim the wire count is already a number. Decoding and encoding services go in the inner `Schema.Codec<T, E, RD, RE>` type.

[Upstream page](https://effect.website/docs/v4/schema/advanced-usage)
