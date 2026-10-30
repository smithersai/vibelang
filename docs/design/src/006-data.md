# Data

Sources: [VIP-15](../vips/0015-schema-declarations.md), [VIP-16](../vips/0016-data-declarations.md), [VIP-28](../vips/0028-generic-data.md).

## `schema` declarations

### Syntax

[SchemaDeclaration](900-appendices.md#schemadeclaration), which begins with [SchemaStart](900-appendices.md#schemastart), with [Field](900-appendices.md#field)s and [Separator](900-appendices.md#separator)s shared with `error` and `data`. `schema` and `data` are declaration keywords under the one rule of [Declaration keywords](900-appendices.md#declaration-keywords), as `type` is in TypeScript: the keyword and the name on one line, where a declaration can start; anything else, such as `const ok = schema satisfies Schema.Top`, is ordinary TypeScript. A field type is parsed greedily as in a TypeScript type member: a line break separates members only after the type is complete. Thus `role:` followed by `| "admin"` on the next line continues the type. Fields use TypeScript's type-member separators, so `{ a: string b: number }` is a syntax error. `schema error { … }` and `schema error = T` name a schema `error`; `schema error Name` declares a schema error ([Failures](003-failures.md#error-declarations)).

A `schema` declaration requires a field body or `= type`; a `data` declaration requires a variant body, even if empty. Unlike `error`, neither has a bodyless form. A recognized ordinary schema header missing its required declaration form is `EK1503`; a recognized data header missing its variant body is `EK1604`. These diagnostics do not turn a missing body into an empty one, reject an admitted schema alias, or remove the bodyless `error` and `schema error` forms. So `schema as T;`, `schema satisfies T;`, `data as T;` and `data satisfies T;` are syntax errors at statement start, and `schema as = Schema.String` and `data as {}` declare names `as`.


The incomplete forms below have no runtime counterpart. The repairs retain the existing declaration meanings, including empty bodies, schema aliases and bodyless errors:

```vibe es
// compiler-gap: pending VIP-9, VIP-15, VIP-16
service MissingService // EK0906
schema MissingSchema // EK1503
data MissingData // EK1604
declare service AmbientService // EK0907, not an additional EK0906

service RuntimeService { static readonly key = "examples/RuntimeService" }
schema EmptySchema {}
schema SchemaAlias = Schema.String
data NoCases {}
error Allowed
schema error AlsoAllowed
```

```ts effect
import { Context, Data, Effect, Exit, Layer, Schema } from "effect"

type RuntimeShape = {}
class RuntimeService extends Context.Service<RuntimeService, RuntimeShape>()("examples/RuntimeService") {}
const EmptySchema = Schema.Struct({})
const SchemaAlias = Schema.String
type NoCases = Data.TaggedEnum<{}>
const NoCases = Data.taggedEnum<NoCases>()
class Allowed extends Data.TaggedError("Allowed") {}
class AlsoAllowed extends Schema.TaggedError<AlsoAllowed>()("AlsoAllowed", {}) {}
const declarationRepairExit = Effect.runSyncExit(Effect.provide(Effect.gen(function* () {
  const service = yield* RuntimeService
  const empty = yield* Schema.decodeUnknownEffect(EmptySchema)({})
  const alias = yield* Schema.decodeUnknownEffect(SchemaAlias)("ok")
  return [
    Object.keys(service).length, Object.keys(empty).length, alias,
    new Allowed()._tag, new AlsoAllowed()._tag, Object.keys(NoCases).length
  ]
}), Layer.succeed(RuntimeService, {})))
console.log(declarationRepairExit) // Success([0, 0, "ok", "Allowed", "AlsoAllowed", 0])
```

### Meaning

`schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name. Mappings preserve TypeScript mutability: properties are writable unless `readonly`; arrays and tuples are mutable unless `readonly`.

```vibe es
// compiler-gap: pending VIP-15
schema Address
{ city: string }
schema User {
  id: string; nickname?: string;
  role:
    | "admin"
    | "member";
  home: Address;
}
schema Code
  = "root_missing" | "read_failed"
```

```ts effect
// fragment
const Address = Schema.Struct({ city: Schema.mutableKey(Schema.String) })
type Address = typeof Address.Type
const User = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  nickname: Schema.mutableKey(Schema.optional(Schema.String)),
  role: Schema.mutableKey(Schema.Literals(["admin", "member"])),
  home: Schema.mutableKey(Address),
})
type User = typeof User.Type
const Code = Schema.Literals(["root_missing", "read_failed"])
type Code = typeof Code.Type
```

In this table, `S`, `A` and `B` are the recursively mapped schemas of the corresponding type syntax. A reference names a Schema value, not an expanded TypeScript type alias, interface, enum or class. Apart from the mapped built-ins below, a reference without a Schema value is `EK2109`: declare it with `schema`.

| Type or field | Effect 4.1.0 schema |
| --- | --- |
| `(T)` | the mapping of `T`; parentheses only group |
| `string`, `number`, `boolean`, `bigint`, `symbol` | `Schema.String`, `Schema.Number`, `Schema.Boolean`, `Schema.BigInt`, `Schema.Symbol` |
| single literal `"a"` | `Schema.Literal("a")` (likewise numeric, boolean and bigint literals) |
| union consisting entirely of literals `"a" \| "b"` | `Schema.Literals(["a", "b"])` |
| other union `A \| B` | `Schema.Union([A, B])`, each member mapped separately in source order |
| `null`, `undefined` | `Schema.Null`, `Schema.Undefined` |
| identifier or qualified name resolving to a Schema value (`Address`, `NonEmptyString`, `Schema.String`) | that value, emitted as written |
| `T[]`, `Array<T>` | `Schema.mutable(Schema.Array(S))` |
| `readonly T[]`, `ReadonlyArray<T>` | `Schema.Array(S)` |
| `[A, B]` | `Schema.mutable(Schema.Tuple([A, B]))` |
| `readonly [A, B]` | `Schema.Tuple([A, B])` |
| `[A, B?]` | `Schema.mutable(Schema.Tuple([A, Schema.optional(B)]))` |
| `[A, ...B[]]` | `Schema.mutable(Schema.TupleWithRest(Schema.Tuple([A]), [B]))` |
| `Record<K, V>` | `Schema.Record(K, Schema.mutableKey(V))` |
| `Readonly<Record<K, V>>` | `Schema.Record(K, V)` |
| nested object `{ name: T }` | `Schema.Struct({ name: Schema.mutableKey(S) })` |
| string, numeric or computed field key | the same key, emitted as written, as in a TypeScript object type |
| writable field `name: T` | `name: Schema.mutableKey(S)` |
| writable optional field `name?: T` | `name: Schema.mutableKey(Schema.optional(S))` |
| readonly field `readonly name: T` | `name: S` |
| readonly optional field `readonly name?: T` | `name: Schema.optional(S)` |

Parenthesized unions within a union are flattened in source order, as in TypeScript: `("a" | "b") | null` maps as `"a" | "b" | null`. In `("a" | "b")[]`, the element maps to `Schema.Literals(["a", "b"])`.

For example, `"a" | "b" | null` maps to `Schema.Union([Schema.Literal("a"), Schema.Literal("b"), Schema.Null])`; it does not group the string literals into `Schema.Literals`.

Optional tuple elements use `Schema.optional`, as optional fields do: `[string, number?]` admits `["a", undefined]`, matching TypeScript’s default.

Tuple element labels (`[name: A, count?: B]`) do not change the mapping. Optional and rest tuples omit `Schema.mutable` when `readonly`; rest elements map recursively, with any trailing required elements passed after the rest schema to `Schema.TupleWithRest`.

```vibe es
// compiler-gap: pending VIP-15
schema TupleForms {
  token: symbol;
  optional: [name: string, count?: number];
  readonly rest: readonly [string, ...number[]];
}
```

```ts effect
// fragment
const TupleForms = Schema.Struct({
  token: Schema.mutableKey(Schema.Symbol),
  optional: Schema.mutableKey(Schema.mutable(Schema.Tuple([
    Schema.String, Schema.optional(Schema.Number),
  ]))),
  rest: Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number]),
})
type TupleForms = typeof TupleForms.Type
const tupleForms = Schema.decodeUnknownSync(TupleForms)({
  token: Symbol.for("token"), optional: ["name", undefined], rest: ["name", 1, 2],
})
tupleForms.optional.push(3)
```

`Schema.optional` accepts a missing key or `undefined`, matching TypeScript’s default. `Schema.mutableKey` changes the property, not its nested value; `Schema.mutable` changes an array or tuple, not its elements. Record keys must satisfy Effect’s `Schema.Record.Key` constraint. Field names follow TypeScript object types, which accept a computed name of any key type (TypeScript 5.9). Its expression is evaluated in declaration order, as in the emitted object literal; it is not a schema type reference. A computed key of non-literal type gives an index-signature type, but the runtime struct checks only the key the expression evaluates to, exactly as in Effect TypeScript. With default decoding options, extra keys are ignored and stripped, as in `Schema.Struct`.

```vibe es
// compiler-gap: pending VIP-15
schema Sample {
  kind: "sample";
  value: string | null;
  absent: undefined;
  items: number[];
  readonly pair: readonly [string, number];
  counts: Record<string, number>;
  nested: { active: boolean };
}
```

```ts effect
// fragment
const Sample = Schema.Struct({
  kind: Schema.mutableKey(Schema.Literal("sample")),
  value: Schema.mutableKey(Schema.Union([Schema.String, Schema.Null])),
  absent: Schema.mutableKey(Schema.Undefined),
  items: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Number))),
  pair: Schema.Tuple([Schema.String, Schema.Number]),
  counts: Schema.mutableKey(Schema.Record(Schema.String, Schema.mutableKey(Schema.Number))),
  nested: Schema.mutableKey(Schema.Struct({ active: Schema.mutableKey(Schema.Boolean) })),
})
type Sample = typeof Sample.Type
const sample = Schema.decodeUnknownSync(Sample)({
  kind: "sample", value: null, absent: undefined, items: [1],
  pair: ["a", 2], counts: { a: 1 }, nested: { active: true },
})
sample.items.push(2)
sample.counts.a = 2
```

Referenced schemas must preserve the source's decoded-key modifiers. At every required field, required fixed tuple slot (before or after a rest), and `Record` value, the inferred schema type's `"~type.optionality"` must be `"required"`. At every effectively readonly field or readonly `Record` value, `"~type.mutability"` must be `"readonly"`; all `schema error` payload fields are effectively readonly even without a written `readonly`. These checks apply at the mapped position, recursively in nested structs and schema errors, through aliases and unions. A conflicting or unprovable flag is `EK2109`: use an unmodified value schema and write modifiers on the declaration. Writable and optional source positions retain the mappings above. The checks describe decoded `Type`; encoded-key and constructor-input defaults keep Effect's behavior. Field readonlyness is shallow and does not freeze nested mutable values.

```vibe es
// compiler-gap: pending VIP-15, VIP-29
const OptionalNumber = Schema.optional(Schema.Number)
const MutableString = Schema.mutableKey(Schema.String)
// schema Bad { must: OptionalNumber; readonly frozen: MutableString; tuple: [OptionalNumber]; entries: Record<"a", OptionalNumber> }
// schema error BadError { value: MutableString }
// EK2109 at each conflicting reference: the written required/readonly position controls.
schema FlagIntent {
  must: number | undefined;
  readonly frozen: string;
  tuple: [number | undefined];
  entries: Record<"a", number | undefined>;
}
schema error FlagError { value: string }
```

```ts effect
import { Schema } from "effect"

const PresentNumber = Schema.Union([Schema.Number, Schema.Undefined])
const FlagIntent = Schema.Struct({
  must: Schema.mutableKey(PresentNumber),
  frozen: Schema.String,
  tuple: Schema.mutableKey(Schema.mutable(Schema.Tuple([PresentNumber]))),
  entries: Schema.mutableKey(Schema.Record(Schema.Literal("a"), Schema.mutableKey(PresentNumber))),
})
type FlagIntent = typeof FlagIntent.Type
class FlagError extends Schema.TaggedError<FlagError>()("FlagError", { value: Schema.String }) {}
const decodeFlagIntent = Schema.decodeUnknownExit(FlagIntent)
decodeFlagIntent({ must: undefined, frozen: "ok", tuple: [undefined], entries: { a: undefined } }) // Success
decodeFlagIntent({ frozen: "ok", tuple: [undefined], entries: { a: undefined } })                  // Failure: required field
decodeFlagIntent({ must: undefined, frozen: "ok", tuple: [], entries: { a: undefined } })          // Failure: required tuple slot
decodeFlagIntent({ must: undefined, frozen: "ok", tuple: [undefined], entries: {} })               // Failure: required record key
```

A schema's encoded representation follows its field codecs. JSON and other transports must support that representation; a declaration does not automatically convert unsupported values or property keys. For example, raw `Schema.BigInt` encodes a bigint, which JSON cannot serialize, while `Schema.BigIntFromString` encodes a string. Ordinary JSON omits object properties with `undefined`, symbol or function values, ignores symbol keys, and converts nonfinite numbers to `null`. Cycles and user serialization hooks retain their ordinary JSON behavior. Choose codecs and a transport that preserve the required data, including for [schema errors](003-failures.md#schema-error-declarations).

```vibe es
// compiler-gap: pending VIP-15, VIP-29
schema error BigCount { count: bigint }
schema error JsonCount { count: Schema.BigIntFromString }
```

```ts effect
import { Effect, Schema } from "effect"

class BigCount extends Schema.TaggedError<BigCount>()("BigCount", { count: Schema.BigInt }) {}
class JsonCount extends Schema.TaggedError<JsonCount>()("JsonCount", { count: Schema.BigIntFromString }) {}
const encodedBigCount = Schema.encodeSync(BigCount)(new BigCount({ count: 1n }))
const jsonTransportExit = Effect.runSyncExit(Effect.try({
  try: () => JSON.stringify(encodedBigCount), catch: (error) => error,
})) // Failure(TypeError): the encoded count is still a bigint
const encodedJsonCount = Schema.encodeSync(JsonCount)(new JsonCount({ count: 1n }))
const jsonRoundTripExit = Schema.decodeUnknownExit(JsonCount)(JSON.parse(JSON.stringify(encodedJsonCount)))
// Success(JsonCount({ count: 1n })); the encoded count was "1"
```

Refinements and transformations stay Schema constants. In a schema type, an identifier or qualified name is looked up as a value and must satisfy Effect's `Schema.Top`; a type of the same name is not expanded. Imports and shadowing follow TypeScript value lookup. `typeof Name.Type` is the declared type.

```vibe es
// compiler-gap: pending VIP-15
import { NonEmptyString } from "effect/Schema"
schema Profile { name: NonEmptyString; title: Schema.String }
// type Role = "admin" | "member"
// schema Invalid { role: Role } // EK2109: declare Role with schema
```

```ts effect
// fragment
import { NonEmptyString } from "effect/Schema"
const Profile = Schema.Struct({
  name: Schema.mutableKey(NonEmptyString),
  title: Schema.mutableKey(Schema.String),
})
type Profile = typeof Profile.Type
```

```vibe es
// compiler-gap: pending VIP-15
const key = Symbol("key")
schema Keys { "a-b": string; 1: number; [key]: boolean }
```

```ts effect
// fragment
const key = Symbol("key")
const Keys = Schema.Struct({
  "a-b": Schema.mutableKey(Schema.String),
  1: Schema.mutableKey(Schema.Number),
  [key]: Schema.mutableKey(Schema.Boolean),
})
type Keys = typeof Keys.Type
```

```vibe es
// compiler-gap: pending VIP-15
const field: string = "actual"
schema Dynamic { [field]: number }
```

```ts effect
// fragment
const field: string = "actual"
const Dynamic = Schema.Struct({ [field]: Schema.mutableKey(Schema.Number) })
type Dynamic = typeof Dynamic.Type
const admitted: Dynamic = { other: 1 } // index-signature type
const decoded = Schema.decodeUnknownExit(Dynamic)(admitted) // failure: missing actual
const kept = Schema.decodeUnknownSync(Dynamic)({ actual: 1, other: 2 }) // { actual: 1 }
```

Computed `schema error` field keys also obey the [reserved-tag rule](003-failures.md#error-declarations): reject a runtime key domain that cannot be proved to exclude `"_tag"`, including generic, enum or branded string domains that may produce it. A nominal brand alone grants no exception. This restriction does not apply to ordinary `schema` struct keys.

The generated constants keep TypeScript declaration order and temporal dead zone: declare `Address` before a schema that reads it. There is no implicit reordering or `Schema.suspend`; a forward or cyclic value reference has the same initialization behavior as the shown TypeScript.

| Rule | Diagnostic |
| --- | --- |
| `export default schema S { … }` or `export default schema S = T`; declare the name and write `export { S as default }` | `EK1501` |
| type parameters on a `schema` declaration; use an ordinary generic TypeScript factory returning a Schema value | `EK1502` |
| a recognized ordinary schema declaration missing its required body or admitted alias form | `EK1503` |
| a field type outside the mapping, or a referenced schema with conflicting or unprovable decoded-key flags at a required or effectively readonly position; use an unmodified value schema and write the modifiers on the declaration (for `Date`, use `Schema.Date`) | `EK2109` |


A `schema error` keeps the error-declaration diagnostic `EK1305`; it does not use `EK1501`. A schema's named default export and an ordinary generic factory are normal TypeScript:

```ts effect
import { Schema } from "effect"
const S = Schema.Struct({ value: Schema.mutableKey(Schema.Number) })
type S = typeof S.Type
export { S as default }
function schemaBox<A extends Schema.Constraint>(value: A) {
  return Schema.Struct({ value: Schema.mutableKey(value) })
}
const NumberBox = schemaBox(Schema.Number)
const namedSchemaExit = Schema.decodeUnknownExit(S)({ value: 1 }) // Success({ value: 1 })
const genericSchemaExit = Schema.decodeUnknownExit(NumberBox)({ value: 2 }) // Success({ value: 2 })
```

## `data` declarations

### Syntax

[DataDeclaration](900-appendices.md#datadeclaration), which begins with [DataStart](900-appendices.md#datastart), is a list of [Variant](900-appendices.md#variant)s, possibly empty.

`data` follows [Declaration keywords](900-appendices.md#declaration-keywords), so `return data as User[]` and `const data = …` still work. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are those of `schema` declarations. Variant names are TypeScript `IdentifierName`s, including reserved words such as `default`. Variant field keys follow TypeScript type literals, which accept computed names of any key type (TypeScript 5.9), as for `schema` fields. A non-literal key produces an index-signature type; the resulting payload must still satisfy Effect’s `Data.TaggedEnum` constraint forbidding `_tag`. In particular, a string index signature includes `_tag` and fails that constraint; it is not a `TS1170` error. Duplicate variant or field names get TypeScript’s duplicate-identifier diagnostic on the source name. Variants are separated as fields are, as the members of the `Data.TaggedEnum` type literal are, and a variant's fields may be `readonly`. A variant's `{` starts its field body even after line breaks; the `LineTerminator` alternative of [Separator](900-appendices.md#separator) does not apply before that `{`.

### Meaning

`data Name { Variant; Variant { fields } }` declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name. Zero variants are allowed: `data Empty {}` maps to `type Empty = Data.TaggedEnum<{}>; const Empty = Data.taggedEnum<Empty>()`.

```vibe es
// compiler-gap: pending VIP-16
data Delivery
{
  Waiting;
  Sent

  { tracking: string };
  Rejected { reason: string };
}
const tracking = "outer"
const d = Delivery.Sent({ tracking: "1Z" })
const label = match (d) { when { _tag: "Sent", let tracking }: tracking; default: "none"; }
```

```ts effect
// fragment
type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { tracking: string }; Rejected: { reason: string } }>
const Delivery = Data.taggedEnum<Delivery>()
const tracking = "outer"
const d = Delivery.Sent({ tracking: "1Z" })
let label: string
if ((typeof d === "object" || typeof d === "function") && d !== null && "_tag" in d &&
    d._tag === "Sent" && "tracking" in d) {
  const tracking = d.tracking
  label = tracking
} else {
  label = "none"
}
```

`$is` and `$match` are reserved variant names in every `data` declaration, generic or not (`EK1602`): Effect's `Data.taggedEnum` uses those properties as helpers, so calling them does not construct the named variant. Rename the variant and its resolved references, for example to a fresh `Is` or `Match`. Other names retain the same constructors and nonthrowing contract.

```vibe es
// compiler-gap: pending VIP-16
// data Invalid { $is; $match; Normal } // EK1602 on each reserved name
// data InvalidGeneric<A> { $match { value: A } } // EK1602
data SafeNames { Is; Match; Normal }
```

```ts effect
import { Data, Effect } from "effect"

type SafeNames = Data.TaggedEnum<{ Is: {}; Match: {}; Normal: {} }>
const SafeNames = Data.taggedEnum<SafeNames>()
const safeNameExit = Effect.runSyncExit(Effect.sync(() => [SafeNames.Is(), SafeNames.Match(), SafeNames.Normal()]))
// Success([{ _tag: "Is" }, { _tag: "Match" }, { _tag: "Normal" }])
```

A generated variant constructor has the static contract `@throws {never}` (decided detail 42), independently of the foreign-callable default in VIP-4. Calling `Delivery.Sent({ tracking: "1Z" })` constructs the value directly; no `Effect.try` wrapper is needed. This adds no runtime validation or wrapping to `Data.taggedEnum`. Variant payload properties are readonly in the resulting type, even without a written `readonly`, as in Effect's `Data.TaggedEnum`.

The object-pattern test first checks for an ECMAScript object (including functions) and property presence, then reads the tag; see [Pattern matching](004-match.md).

Variants are matched with TC39 object patterns on `_tag` ([Pattern matching](004-match.md)). A bare key such as `{ tracking }` only tests that the property exists; binding it takes `let tracking`. Here `label` is `"1Z"`; replacing `let tracking` with `tracking` would read `"outer"`. The variant constructors get no custom matchers.

VIP-7 includes `data` unions and [tagged members](004-match.md#tagged-members) in the exhaustiveness check (`EK4701`). Every normalized subject member must be one of the checked kinds in [Exhaustiveness](004-match.md#exhaustiveness); another member turns the check off. Coverage is defined there too, and never changes the ordered tests that run. A class pattern naming a `data` declaration or variant is `EK0702` ([Class patterns](004-match.md#class-patterns)).

| Rule | Diagnostic |
| --- | --- |
| a variant field named `_tag`; rename it, because the variant name supplies the tag | `EK1601` |
| a variant named `$is` or `$match`, generic data included; rename it and its resolved references to a fresh name | `EK1602` |
| `export default data D { … }`; declare the name and write `export { D as default }` | `EK1603` |
| a recognized data declaration missing its required variant body | `EK1604` |


The named default-export counterpart is:

```ts effect
import { Data, Effect } from "effect"
type D = Data.TaggedEnum<{ A: {} }>
const D = Data.taggedEnum<D>()
export { D as default }
const namedDataExit = Effect.runSyncExit(Effect.sync(() => D.A())) // Success({ _tag: "A" })
```

### Generic unions

A `data` declaration may have up to 4 type parameters, the limit of Effect's own `WithGenerics`. Parameters map by position to `this["A"]`, `this["B"]`, `this["C"]` and `this["D"]`, whatever their source names. Constraints such as `<A extends string>` and defaults such as `<A = string>` are compile errors (`EK2126` and `EK2803`). Write a default on a separate TypeScript type alias. TypeScript variance annotations `in` and `out` are preserved on the generated type alias and checked by TypeScript; `const` is rejected on the source parameter with TypeScript’s `TS1277`, as on a type alias. The helper for `data Outcome<A, E>` is named `$Outcome$Definition`, or `$Outcome$Definition$2`, `$3`, … when the module already declares that name, so it never collides with a user name and is the same on every build (decided detail 83).

```vibe es
// compiler-gap: pending VIP-28
data Outcome<A, E> { Ok { value: A }; Err { error: E } }
```

```ts effect
// fragment
type Outcome<A, E> = Data.TaggedEnum<{ Ok: { value: A }; Err: { error: E } }>
interface $Outcome$Definition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: Outcome<this["A"], this["B"]>
}
const Outcome = Data.taggedEnum<$Outcome$Definition>()
```

| Rule | Diagnostic |
| --- | --- |
| more than 4 type parameters; remove parameters beyond the limit of 4 | `EK2801` |
| a constraint on a type parameter; remove the constraint | `EK2126` |
| a default on a type parameter; move it to a separate type alias | `EK2803` |

```vibe es
// compiler-gap: pending VIP-28
// data Box<A = string> { Value { value: A } } // EK2803
data Box<A> { Value { value: A } }
type StringBox<A = string> = Box<A>
const boxed: StringBox = Box.Value({ value: "hello" })
```

```ts effect
// fragment
type Box<A> = Data.TaggedEnum<{ Value: { value: A } }>
interface $Box$Definition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: Box<this["A"]>
}
const Box = Data.taggedEnum<$Box$Definition>()
type StringBox<A = string> = Box<A>
const boxed: StringBox = Box.Value({ value: "hello" })
```

### Declaration output

Exported `schema` and `data` declarations emit the TypeScript declarations of their Effect TypeScript counterparts above: a schema constant and its `typeof Name.Type` alias, or a `Data.TaggedEnum` alias and typed constructor constant. Generic data also emits the `WithGenerics` helper, named as above, when the exported constant references it; the helper is an implementation name, not a reserved source identifier. TypeScript declaration emission preserves inferred readonly payloads and the constructor signatures; it adds no runtime matcher.
