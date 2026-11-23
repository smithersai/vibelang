# Advanced Usage

Declarations for opaque values, brands for static types, field presence combinators, and `suspend` for recursion all work as in Effect. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Custom scalar and parameterized declarations

```vibe
// run: try Console.log((try readShelf(new Shelf("S-12"))).code); try Effect.catch(readShelf({ code: "S-12" }), (error) => Console.log(error._tag))
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

`Schema.declare` establishes identity via a type guard (inferred from `instanceof`). It does not validate fields automatically—chain `.check(...)` if fields need validation. Because declarations are opaque, interpreters have no structural AST to traverse unless you provide hooks.

```vibe
// run: try Console.log((try Schema.decodeUnknownEffect(BoxedCount)(new Box("12"))).value); try Console.log((try Schema.encodeEffect(BoxedCount)(new Box(12))).value)
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

`declareConstructor` passes directional codecs for each type parameter into the parser factory. Return the decoded instance or fail with a raw `SchemaIssue.Issue` (wrapped in `SchemaError` by the outer parser). Any service requirements must originate from the parameter schemas.

## Interpreter hooks

```vibe
// run: const codec = Schema.toCodecJson(PortableShelf); try Console.log(try Schema.encodeEffect(codec)(new Shelf("S-12"))); try Console.log((try Schema.decodeUnknownEffect(codec)("S-12")) instanceof Shelf)
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

Provide `toCodec` for a shared canonical representation (or `toCodecJson`, `toCodecStringTree`, `toCodecIso` per format), `toCodecArbitrary` for generators, and `toFormatter` / `toEquivalence` for display and equality. Parameterized declarations receive the matching parameter interpretations in each hook.

## Branded schemas

```vibe
// run: try Console.log(try ShelfId.makeEffect("rack-18")); try Console.log(try TrackingIdSchema.makeEffect("pkg-76")); try Console.log(Schema.is(ShelfId)(""))
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

Brands add static distinction with zero runtime representation change and no validation of their own; pair them with a validating schema. `fromBrand` attaches an existing `Brand` constructor.

## Constructor defaults

```vibe
// run: { const jsonValue = try createParcel(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(Parcel)({ shelf: "rack-18" }))
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

`withConstructorDefault` makes a field optional for construction only—not decoding—and evaluates its Effect when omitted. In Effect 4.1.1, `makeEffect` fails with a raw `SchemaIssue.Issue`.

## Optional keys, optional values, null, and defaults

```vibe
// run: try Console.log(Schema.is(Presence)({ requiredUndefined: undefined, requiredNullable: null })); try Console.log(Schema.is(Presence)({ exact: undefined, requiredUndefined: undefined, requiredNullable: null })); { const jsonValue = try Schema.decodeUnknownEffect(WithDecodeDefault)({ copies: undefined }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Effect.catch(Schema.decodeUnknownEffect(WithDecodeDefault)({ rank: undefined }), (error) => Console.log(error._tag))
const Presence = Schema.Struct({
  exact: Schema.optionalKey(Schema.String),
  loose: Schema.optional(Schema.String),
  requiredUndefined: Schema.UndefinedOr(Schema.String),
  requiredNullable: Schema.NullOr(Schema.String),
  prohibited: Schema.optionalKey(Schema.Never)
})
const WithDecodeDefault = Schema.Struct({
  copies: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultType(Effect.succeed(1))),
  rank: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0)))
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

Decoding defaults take an Effect value (`Effect.succeed(v)` or `effect { ... }`):
- `withDecodingDefaultType` / `withDecodingDefaultTypeKey`: default in the decoded type (missing or `undefined` vs. missing key only).
- `withDecodingDefault` / `withDecodingDefaultKey`: default in the encoded type.

Decoding defaults do not add constructor defaults. Enable `exactOptionalPropertyTypes` to reflect these rules in static types.

## Mapping optional fields to `Option`

```vibe
// run: const value = try readPreferences(); try Console.log(value.note.isNone(), value.weight.isNone(), value.alias.isNone()); { const jsonValue = try Schema.encodeEffect(Preferences)(value); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
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

The decoded keys are always present and hold `Option` values; encoding `None` omits the key by default. `OptionFromOptionalKey` rejects explicit `undefined`; `OptionFromOptional` accepts `undefined` as `None`; `OptionFromOptionalNullOr` accepts both `undefined` and `null`. For required keys that allow `null` or `undefined`, use `OptionFromNullOr`, `OptionFromUndefinedOr`, or `OptionFromNullishOr`.

## Transforming field presence

```vibe
// run: const value = try Schema.decodeUnknownEffect(Form)({ note: "", memo: "" }); try Console.log(try Effect.try(() => JSON.stringify(value))); { const jsonValue = try Schema.encodeEffect(Form)(value); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
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

`SchemaGetter.transformOptional` receives `Option.none()` for an absent key and `Option.some(v)` for a present key (including `Option.some(undefined)`). Returning `Option.none()` drops the key.

## Extending and renaming fields

```vibe
// run: { const jsonValue = try Schema.encodeEffect(WireDestination)({ city: "Oslo", dock: 2, route: "north" }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const Address = Schema.Struct({ city: Schema.String })
const Destination = Schema.Struct({ ...Address.fields, dock: Schema.Int })
const Routed = Destination.pipe(Schema.fieldsAssign({ route: Schema.String }))
const WireDestination = Routed.pipe(Schema.encodeKeys({ dock: "dock_number" }))
```

```output
{"city":"Oslo","dock_number":2,"route":"north"}
```

Extend structs by spreading `.fields` or calling `fieldsAssign`. `encodeKeys` maps decoded field names to wire names while preserving optionality; `mapMembers` transforms every struct member in a union.

## Recursive and mutually recursive codecs

```vibe
// run: { const jsonValue = try readCrate({ count: "2", children: [{ count: "1", children: [] }] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = try Schema.decodeUnknownEffect(Branch)({ leaves: [{ owner: null }] }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
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

`Schema.suspend` defers resolution so self-referential and mutually recursive schemas do not read uninitialized bindings. Annotate the thunk's return type (`Schema.Codec<T, E, RD, RE>`) to break TypeScript's inference cycle, and define a separate encoded interface whenever decoded and wire shapes differ.

[Upstream page](https://effect.website/docs/v4/schema/advanced-usage)
