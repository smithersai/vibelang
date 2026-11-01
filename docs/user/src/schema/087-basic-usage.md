# Basic Usage

Schema constructors work as in Effect. Combine small descriptions into arrays, objects, and alternatives, then run a parser inside a function. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

In a schema declaration, a field named `__proto__` is an own data field. The generated schema uses `["__proto__"]` as its key, including quoted or escaped source names and fields in nested structs. Decoding validates and preserves that field like any other field; encoding includes it.

A native `Schema.Struct({ __proto__: codec })` uses JavaScript's prototype-setter syntax. `vibelang --fix` keeps that expression, since replacing it with an own schema field would change decoding. Shorthand `{ __proto__ }` and computed `{ ["__proto__"]: codec }` properties are ordinary own properties.

Encoding produces the selected codecs' encoded representation. For JSON boundaries, choose JSON-compatible codecs and property keys; raw bigints, symbols, undefined values, nonfinite numbers and cyclic values do not all survive ordinary JSON serialization. `Schema.BigIntFromString` gives a bigint a string representation.

The specification assigns `EK1501` to a direct default `schema` declaration and `EK1502` to schema type parameters. Declare a name and use `export { Name as default }`; use an ordinary generic TypeScript factory for parameterized Schema construction.

A VibeLang `schema` reference must preserve its written decoded-key modifiers (`EK2109`). Required fields, required fixed tuple slots and record values need a required value schema; readonly fields and readonly record values need readonly key flags. This includes every `schema error` payload field, whose readonlyness is implicit. Checks follow aliases and nested positions. Use the unmodified value schema and write optionality or mutability on the declaration; `number | undefined` allows a present `undefined` without allowing a missing required field or slot.

JSDoc on a `schema` declaration belongs to its constant. Its companion type alias stays bare; `stripInternal` removes an `@internal` constant while retaining the alias, as TypeScript does for the equivalent Effect Schema pair.

Mapped array schemas follow the resolved TypeScript-library type. `globalThis.Array<number>` and a renamed library import map to a mutable array; a binding to `ReadonlyArray` maps to a readonly array even when imported as `Array`. Value-only bindings do not hide the separate library type. Ordinary generic type aliases and interfaces are not expanded into schemas.

Earlier compilers selected array mutability from the written name. If an imported `Array` actually names the library `ReadonlyArray`, or the reverse, `vibelang --fix --fix-migration-only` writes the previous decoder explicitly and preserves its public type. Ordinary compilation uses the resolved library meaning. This compatibility rewrite only covers previously supported canonical spellings; it does not invent old decoders for new qualified or renamed forms.

A declaration such as `schema Values = globalThis.Record<"key", number>` and a renamed library `Record` binding use the record decoder with writable decoded keys. The same mapping applies when that library type is imported as `Array` or `Readonly`: its resolved binding and two arguments select the record mapping.

If an earlier compiler accepted `Record<K, V>` while that name actually referred to a different library type, `vibelang --fix` preserves the previous record decoder with explicit Effect Schema code. A newly supported qualified or renamed form receives no compatibility rewrite.


## Modeling primitives, symbols, literals, enums, and template strings

```vibe
// run: try Console.log(Schema.is(Measurement)(Infinity), Schema.is(UnrestrictedNumber)(Infinity)); try Console.log(Schema.is(MarkerSchema)(Marker), Schema.is(MarkerSchema)(Symbol("shipping/marker"))); try Console.log(Schema.is(PendingState)("sent"), Schema.is(TrackingCode)("pkg_76"), Schema.is(PrioritySchema)("urgent"))
const Measurement = Schema.Finite
const UnrestrictedNumber = Schema.Number
const Enabled = Schema.Boolean
const Counter = Schema.BigInt
const Payload = Schema.Unknown
const Marker = Symbol.for("shipping/marker")
const MarkerSchema = Schema.UniqueSymbol(Marker)
const State = Schema.Literals(["queued", "packed", "sent"])
const PendingState = State.pick(["queued", "packed"])
const TrackingCode = Schema.TemplateLiteral(["pkg_", Schema.String])

enum Priority { Normal = "normal", Urgent = "urgent" }
const PrioritySchema = Schema.Enum(Priority)
```

```output
false true
true false
false true true
```

`Schema.String`, `Boolean`, `BigInt`, and `Symbol` describe their JavaScript primitives. `Finite` rejects `NaN` and infinities; `Number` permits them. `ObjectKeyword` describes objects, `Undefined` and `Void` undefined values, and `Null` null; `Unknown` accepts anything safely, `Any` opts out of type safety, and `Never` accepts nothing.

`Literal(value)` accepts one string, number, boolean, or bigint; `Literals([...])` combines exact values; null uses `Schema.Null`. Literal collections expose `.literals`, enum schemas `.enums`, and `revealCodec(schema)` reveals the full codec type without changing the value. `UniqueSymbol` checks one particular symbol, not any symbol.

```vibe
// run: { const jsonValue = try locateBin("bin:12/upper"); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const BinPosition = Schema.TemplateLiteralParser([
  "bin:", Schema.FiniteFromString, "/", Schema.NonEmptyString
])

effect function locateBin(input: unknown) {
  return try Schema.decodeUnknownEffect(BinPosition)(input)
}
// "bin:12/upper" becomes ["bin:", 12, "/", "upper"]
```

```output
["bin:",12,"/","upper"]
```

`TemplateLiteral` validates a string pattern of literal, string, finite-number, union, or branded spans. `TemplateLiteralParser` also splits it into a tuple and applies the spans' conversions; encoding the tuple rebuilds the string.

A reference in a `schema` declaration must satisfy Effect's `Schema.Top` contract; copying the schema marker onto an ordinary object is insufficient and reports `EK2109`. For an existing non-schema alias with a public `Type` member, `vibelang --fix` writes the original `const` and `type` pair, preserving its value and public type.

## Building unions and tagged alternatives

```vibe
// run: try Console.log(try describeLocation({ _tag: "Warehouse", aisle: "A3" })); try Console.log(try describeLocation({ _tag: "Courier", route: 7 }))
const Warehouse = Schema.TaggedStruct("Warehouse", { aisle: Schema.String })
const Courier = Schema.TaggedStruct("Courier", { route: Schema.Int })
const Location = Schema.Union([Warehouse, Courier])
const TextOrCount = Schema.Union([Schema.String, Schema.Finite])
const NullableText = Schema.NullOr(Schema.String)
const MaybeText = Schema.UndefinedOr(Schema.String)
const NullishText = Schema.NullishOr(Schema.String)

effect function describeLocation(input: unknown) {
  const location = try Schema.decodeUnknownEffect(Location)(input)
  return location._tag === "Warehouse" ? location.aisle : String(location.route)
}
```

```output
A3
7
```

A union accepts one of its members, exposed as `.members`. When alternatives overlap, the first successful member wins; put the more specific object first so a broader match does not strip its fields. Literal discriminator fields make alternatives unambiguous and enable ordinary TypeScript narrowing.

For a tag absent from the wire representation, add a field with `Schema.tagDefaultOmit("Warehouse")`: decoding supplies the tag and encoding omits it. `NullOr`, `UndefinedOr`, and `NullishOr` accept values in addition to the wrapped schema; they do not make an object key optional.

In a `schema` declaration, a `Record<K, V>` value schema must have required decoded keys. A `Readonly<Record<K, V>>` value schema must also keep those keys readonly. Conflicting or uncertain inferred flags, including aliased schema values built with `Schema.optionalKey` or `Schema.mutableKey`, report `EK2109`. Use an unmodified value schema and write the modifiers on the `Record` type. A required value union with `undefined` keeps finite keys present; readonly keys can still hold mutable arrays. Run `vibelang --fix` to preserve existing decoding with explicit Effect codecs and the same declaration types. In a `schema error`, it names the field codecs and keeps the constructor, methods and matcher. The migration also runs with `--fix-migration-only`.

## Defining tuples with optional and rest elements

A fixed tuple spread such as `[string, ...[number, boolean]]` contributes fixed positions, as `[string, number, boolean]` does. This includes readonly rest operands, nested fixed spreads and fixed positions after an array rest. Literal spreads also follow native tuple normalization: `[number?, ...[string]]` requires two positions, with `number | undefined` first. Nested array rests retain their repeating and trailing positions.

```vibe
// run: try Console.log(Schema.is(Coordinate)([1, 2]), Schema.is(Extended)([1, 2, "dock", true])); try Console.log(Schema.is(Readings)(["sensor"]), Schema.is(Readings)(["sensor", 2, true]), Schema.is(Readings)(["sensor", true])); try Console.log(Schema.is(BoundedReadings)(["sensor", 1, 2, false]))
const Coordinate = Schema.Tuple([
  Schema.Finite.annotateKey({ title: "Longitude" }),
  Schema.Finite,
  Schema.optionalKey(Schema.String)
])
const Extended = Schema.Tuple([...Coordinate.elements, Schema.optionalKey(Schema.Boolean)])
const Readings = Schema.TupleWithRest(
  Schema.Tuple([Schema.String, Schema.optionalKey(Schema.Finite)]),
  [Schema.Boolean]
)
const BoundedReadings = Schema.TupleWithRest(
  Schema.Tuple([Schema.String]),
  [Schema.Finite, Schema.Boolean]
)
```

```output
true true
true true false
true
```

Tuples are readonly and position-sensitive. Optional elements use `optionalKey`; a present element must still match its schema. `TupleWithRest` takes a fixed tuple and a rest list: its first schema repeats, and later schemas are required trailing elements. `Readings` accepts a label, an optional finite reading, then booleans. It can end after the label, but booleans need the reading in its fixed position: `["sensor", 2, true]` is valid, `["sensor", true]` is not. `BoundedReadings` ends with a boolean after any repeated numbers.

Tuple types in `schema` declarations are mutable unless written `readonly`; mutable tuples wrap the mapped tuple in `Schema.mutable`. A `schema` declaration can also write named and optional tuple elements: `schema Position = readonly [name: string, count?: number]` maps to `Schema.Tuple([Schema.String, Schema.optional(Schema.Number)])`. Rest positions such as `readonly [string, ...number[], boolean]` use `Schema.TupleWithRest`, retaining the fixed prefix, repeating element and required trailing positions. TypeScript's tuple syntax checks still apply: required elements cannot follow optional elements, optional elements cannot follow a rest element, and a tuple cannot have two rest elements. Labels do not affect decoding; an optional position may be absent or contain explicit `undefined`, as with TypeScript tuple syntax. Rest arrays may use `T[]`, `readonly T[]`, `Array<T>` or `ReadonlyArray<T>`; the outer tuple's `readonly` modifier controls the tuple's mutability.

A required position in a `schema` tuple must reference a schema whose decoded key is required. A reference to `Schema.optionalKey(Schema.Number)`, including an alias or an uncertain union of flags, reports `EK2109` in that position. Use the unmodified value schema for a required slot. If a present `undefined` is intended, `schema Slot = readonly [number | undefined]` accepts `[undefined]` but rejects `[]`. Keep an explicit `Schema.Tuple` constant when its optional-key behavior is intended. Run `vibelang --fix` to preserve an existing tuple's decoding: it expands the enclosing schema to explicit codecs and its type alias. In a `schema error`, it retains the error declaration and names the field codecs, preserving the constructor, methods and matcher. The migration also runs with `--fix-migration-only`. Generated helper names avoid existing bindings, including names written with Unicode escapes.

Fixed elements are `.elements`, or `.schema.elements` on a tuple with rest, whose `.rest` describes the repeating and trailing schemas. Element annotations describe single positions.

## Modeling mutable and nonempty arrays

```vibe
// run: { const jsonValue = try addLabel(["fragile"]); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(RequiredLabels)([]))
const Labels = Schema.Array(Schema.String)
const EditableLabels = Schema.mutable(Labels)
const RequiredLabels = Schema.NonEmptyArray(Schema.NonEmptyString)

effect function addLabel(input: unknown) {
  const labels = try Schema.decodeUnknownEffect(EditableLabels)(input)
  labels.push("inspected")
  return labels
}
```

```output
["fragile","inspected"]
false
```

`Array` accepts zero or more elements, `NonEmptyArray` at least one; both expose the element schema as `.value`. `mutable` makes only the outer array mutable, not nested structs.

## Declaring records and index signatures

In a `schema` declaration, `Readonly<Record<K, V>>` maps to `Schema.Record`. Parentheses only group its argument: `Readonly<(Record<string, number>)>` produces the same codec and readonly decoded properties.

```vibe
// run: { const jsonValue = try Schema.decodeUnknownEffect(NormalizedStock)({ NORTH: 2, north: 3 }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(RegionalStock)({ east: 1 }), Schema.is(LabeledCounters)({ total: 3, east: 3 }))
const Stock = Schema.Record(Schema.String, Schema.Int)
const SymbolStock = Schema.Record(Schema.Symbol, Schema.Int)
const RegionalStock = Schema.Record(Schema.Literals(["east", "west"]), Schema.Int)
const NamedCounters = Schema.Record(
  Schema.TemplateLiteral(["count_", Schema.String]), Schema.Int
)
const NormalizedStock = Schema.Record(
  Schema.String.pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase())),
  Schema.Int
)
const LabeledCounters = Schema.StructWithRest(
  Schema.Struct({ total: Schema.Int }),
  [Schema.Record(Schema.String, Schema.Int)]
)
```

```output
{"north":3}
false true
```

A record describes string or symbol keys and a value schema. A finite literal key set describes required properties; template literals and string checks restrict an open key space. A key that fails the key check is normally discarded as excess; `onExcessProperty: "error"` rejects it.

Record key codecs can transform selected keys: `NormalizedStock` decodes `{ NORTH: 2 }` to `{ north: 2 }`. Selection uses encoded property names, before transforming them. With sequential parsing, when transformed keys collide, the later selected property overwrites the earlier value. For another collision policy, use a whole-object transformation.

`StructWithRest` combines fixed fields with index signatures, even several for one key kind. Keep fixed-field types compatible with the index value type, or split the fixed and indexed data into separate structures.

A record exposes `.key` and `.value`; a struct with rest, `.schema.fields` and `.records`. For mutable record entries, apply `Schema.mutableKey` to the value schema.

## Creating structs and tagged structs

```vibe
// run: { const jsonValue = try createPacked(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(Packed)({ reference: "box-76", weight: 2 }))
const Package = Schema.Struct({
  reference: Schema.String,
  weight: Schema.Finite,
  comment: Schema.optionalKey(Schema.String)
})
const Packed = Schema.TaggedStruct("Packed", Package.fields)
const Marked = Schema.Struct({
  _tag: Schema.tag("Marked"),
  category: Schema.tag("fragile"),
  reference: Schema.String
})

effect function createPacked() {
  return try Packed.makeEffect({ reference: "box-76", weight: 2 })
}
```

```output
{"_tag":"Packed","reference":"box-76","weight":2}
false
```

A struct describes fixed fields, exposed as `.fields`. `Struct({})` accepts any non-nullish value; use a more specific description when the object shape matters. `mutableKey` changes a field's mutability.

`tag` supplies a constructor default; `TaggedStruct` adds the `_tag` field for you. Construction can omit the tag, but ordinary decoding requires it in the input; `tagDefaultOmit` makes decoding supply it too.

## Validating class instances

```vibe
// run: try Console.log((try readPallet(new Pallet("P-1"))).code); try Effect.catch(readPallet({ code: "P-1" }), (error) => Console.log(error._tag))
class Pallet {
  constructor(readonly code: string) {}
}

const PalletSchema = Schema.instanceOf(Pallet).check(
  Schema.makeFilter((pallet) => pallet.code.length > 0 || "Pallet code is empty")
)

effect function readPallet(input: unknown) {
  return try Schema.decodeUnknownEffect(PalletSchema)(input)
}
```

```output
P-1
SchemaError
```

`instanceOf` checks class identity; an object with a matching `code` field is not an instance. Add checks to validate fields once identity passes. A class with a private constructor needs `Schema.declare` with a type guard instead of `instanceOf`.

## Selecting, removing, and changing optional fields

```vibe
// run: { const jsonValue = try Schema.decodeUnknownEffect(PackageSummary)({ reference: "box-76", weight: 2, comment: "ok" }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(Schema.is(Patch)({ comment: undefined }), Schema.is(LoosePatch)({ comment: undefined }), Schema.is(RequiredPatch)({}))
const PackageSummary = Package.mapFields(Struct.pick(["reference", "weight"]))
const WithoutComment = Package.mapFields(Struct.omit(["comment"]))
const Patch = Package.mapFields(Struct.map(Schema.optionalKey))
const LoosePatch = Package.mapFields(Struct.map(Schema.optional))
const RequiredPatch = Patch.mapFields(Struct.map(Schema.requiredKey))
const Editable = Package.mapFields(Struct.map(Schema.mutableKey))
```

```output
{"reference":"box-76","weight":2}
false true false
```

`mapFields` builds a new struct from transformed field descriptions. `optionalKey` permits omission; `optional` also accepts explicit `undefined`. `requiredKey` removes key optionality but keeps an existing `undefined` union. Field transformations drop whole-struct checks; reapply the ones that still describe the new shape.

[Upstream page](https://effect.website/docs/v4/schema/basic-usage)

A `schema` declaration retains the runtime `Schema` dependency used by its generated initializer, including when an explicit `Schema` import has no other value use.

For an older function-local or namespace `schema` alias, unsupported named, optional or rest tuples used to become `Schema.Unknown`. The explicit compatibility upgrade `vibelang --fix --fix-migration-only` writes that old codec at the affected tuple position, retaining enclosing array or union mappings. Ordinary `--fix` keeps valid new tuple schemas. Module-level aliases and struct fields keep their existing tuple behavior.

Schema aliases use the same mappings inside functions and namespaces. An unsupported type or a reference without a Schema value reports `EK2109` there too; for example, write `Schema.Unknown` instead of `unknown`.

Older compiler versions lowered unsupported keyword types in function-local or namespace `schema` aliases to `Schema.Unknown`. These aliases now report `EK2109`. Their first quick fix, also used by `vibelang --fix`, writes `Schema.Unknown` to preserve the codec and decoded type. The keyword’s explicit schema remains a separate editor action; module-level aliases and struct fields keep their existing suggestions.
