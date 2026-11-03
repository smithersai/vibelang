# Data

Sources: [VIP-15](../vips/0015-schema-declarations.md), [VIP-16](../vips/0016-data-declarations.md), [VIP-28](../vips/0028-generic-data.md).

## `schema` declarations

### Syntax

[SchemaDeclaration](900-appendices.md#schemadeclaration), which begins with [SchemaStart](900-appendices.md#schemastart), with [Field](900-appendices.md#field)s and [Separator](900-appendices.md#separator)s shared with `error` and `data`. `schema` and `data` are declaration keywords under the one rule of [Declaration keywords](900-appendices.md#declaration-keywords), as `type` is in TypeScript: the keyword and the name on one line, where a declaration can start; anything else, such as `const ok = schema satisfies Schema.Top`, is ordinary TypeScript. A field type is parsed greedily as in a TypeScript type member: a line break separates members only after the type is complete. Thus `role:` followed by `| "admin"` on the next line continues the type. Fields use TypeScript's type-member separators, so `{ a: string b: number }` is a syntax error, `EK1504`. `schema error { … }` and `schema error = T` name a schema `error`; `schema error Name` declares a schema error ([Failures](003-failures.md#error-declarations)).

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

In this table, `S`, `A` and `B` are the recursively mapped schemas of the corresponding type syntax. A reference names a Schema value, not an expanded TypeScript type alias, interface, enum or class. The generic built-ins `Array<T>`, `ReadonlyArray<T>`, `Record<K, V>` and `Readonly<T>` in the table mean the corresponding TypeScript-library type bindings, selected by ordinary type lookup and alias resolution, not by spelling. A local or imported type binding can shadow a library type; a value-only binding does not by itself replace the separate library type binding. When the resolved binding is not a mapped built-in, apply the existing Schema-value lookup and arity rules. A reference with no suitable Schema value is `EK2109`: declare a schema or name a Schema value. This does not expand arbitrary user type aliases or introduce generic Schema declarations. The generic rows require these resolved library bindings; `T[]` and `readonly T[]` are syntax mappings independent of a written `Array` name.

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
| string, numeric or computed field key | the field property key; computed names use the runtime schema-object rules below |
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

`Schema.optional` accepts a missing key or `undefined`, matching TypeScript’s default. `Schema.mutableKey` changes the property, not its nested value; `Schema.mutable` changes an array or tuple, not its elements. Record keys must satisfy Effect’s `Schema.Record.Key` constraint. Computed schema field names use native TypeScript runtime object-literal grammar and property-key type checks. A key call, parenthesized key or element-access key is admitted when that runtime object counterpart is admitted; type-member restrictions do not apply merely because the field's value is written as a type. Evaluate each admitted key once at the declaration's existing execution point in native property evaluation order, preserving getters, coercion, TDZ, thrown values and source-context throw checks. This follows ECMA-262's [property definition evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-propertydefinitionevaluation) and [property-key conversion](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-topropertykey). The key expression is not a schema type reference. Infer the public type from the actual `Schema` value rather than a fabricated type literal containing the expression. A computed key of non-literal type gives an index-signature type, but the runtime struct checks only the key the expression evaluates to, exactly as in Effect TypeScript. With default decoding options, extra keys are ignored and stripped, as in `Schema.Struct`.

A noncomputed field named `__proto__` denotes an own data field, including quoted or escaped names and fields in nested structs. Its generated schema-fields object uses `["__proto__"]`, preserving the field instead of invoking JavaScript object-literal prototype-setting semantics. Already-computed keys keep their existing evaluation order.

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

The numeric keys below use call, parenthesized and element-access expressions. All pass native runtime object-key checks; the schema error also satisfies the existing reserved-`_tag` check because its key domain is numeric.

```vibe es
// compiler-gap: pending VIP-15, VIP-29
let schemaKeyCalls = 0
function schemaKey(): number { schemaKeyCalls++; return 42 }
const Box = { get field(): number { schemaKeyCalls++; return 43 } }
schema RuntimeCounts { [schemaKey()]: number; [(Box.field)]: number }
schema error RuntimeCountError { [Box["field"]]: number }
```

```ts effect
import { Effect, Exit, Schema } from "effect"

let schemaKeyCalls = 0
function schemaKey(): number { schemaKeyCalls++; return 42 }
const Box = { get field(): number { schemaKeyCalls++; return 43 } }
const RuntimeCounts = Schema.Struct({
  [schemaKey()]: Schema.mutableKey(Schema.Number),
  [(Box.field)]: Schema.mutableKey(Schema.Number)
})
type RuntimeCounts = typeof RuntimeCounts.Type
class RuntimeCountError extends Schema.TaggedError<RuntimeCountError>()("RuntimeCountError", {
  [Box["field"]]: Schema.Number
}) {}
const runtimeKeysExit = Effect.runSyncExit(Effect.gen(function* () {
  const decoded = yield* Schema.decodeUnknownEffect(RuntimeCounts)({ 42: 1, 43: 2, 44: 99 })
  const missing = Schema.decodeUnknownExit(RuntimeCounts)({ 42: 1 })
  return [
    schemaKeyCalls, decoded[42], decoded[43], Object.hasOwn(decoded, "44"),
    Exit.isFailure(missing), new RuntimeCountError({ 43: 7 })[43]
  ]
}))
console.log(runtimeKeysExit) // Success([3, 1, 2, false, true, 7])
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

Refinements and transformations stay Schema constants. In a schema type, an identifier or qualified name is looked up as a value and must satisfy Effect's `Schema.Top`; a type of the same name is not expanded. Imports and shadowing follow TypeScript value lookup. The generic built-in rows first identify the library type binding as specified above. `typeof Name.Type` is the declared type.

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
| two fields on one line with no separator, `{ a: string b: number }`; write `;` or a line break between them (quick fix: insert `;`) | `EK1504` |
| a field type outside the mapping (including a shadowing type without a suitable Schema value), or a referenced schema with conflicting or unprovable decoded-key flags at a required or effectively readonly position; use an unmodified value schema and write the modifiers on the declaration (for `Date`, use `Schema.Date`) | `EK2109` |


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

`data` follows [Declaration keywords](900-appendices.md#declaration-keywords), so `return data as User[]` and `const data = …` still work. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are those of `schema` declarations. A missing separator between two variants or two fields of a variant, `data D { A B }` or `A { x: number y: string }`, is `EK1605`. Variant names are TypeScript `IdentifierName`s, including reserved words such as `default`. Variant field keys follow TypeScript's type-member checks. A broad entity-name key can produce an index signature; an arbitrary computed expression is not admitted merely because its type is a valid property-key type (`TS1170` can apply); the resulting payload must still satisfy Effect’s `Data.TaggedEnum` constraint forbidding `_tag`. In particular, a string index signature includes `_tag` and fails that constraint; it is not a `TS1170` error. Duplicate variant and field declarations receive the native TypeScript checks for their type members, rather than an unconditional duplicate-identifier diagnostic. Computed members with the same resolved name can merge when TypeScript admits them. Variants are separated as fields are, as the members of the `Data.TaggedEnum` type literal are, and a variant's fields may be `readonly`. A variant's `{` starts its field body even after line breaks; the `LineTerminator` alternative of [Separator](900-appendices.md#separator) does not apply before that `{`.

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

A data payload is emitted as a TypeScript type literal in `Data.TaggedEnum`. Its computed key expressions are type checked and erased: declaring or constructing data does not run those expressions. Ordinary value declarations keep their evaluation; a separate key initializer still runs where its statement stands. Schema field keys retain their documented runtime evaluation.

```vibe es
// compiler-gap: pending VIP-16
let keyReads = 0; let initializerRuns = 0
const Keys = { get field(): number { keyReads++; throw new Error("not evaluated") } }
const initializedKey = (++initializerRuns, 2)
data Reads { Item { [Keys.field]: string } }
data Initialized { Item { [initializedKey]: string } }
const read = Reads.Item({ 1: "read" })
const eager = Initialized.Item({ 2: "eager" })
effect function observeDataKeys() {
  return [keyReads, initializerRuns, read[1], eager[2], keyReads]
}
// data Calls { Item { [dynamicKey()]: string } } // TS1170 when dynamicKey returns number
```

```ts effect
import { Data, Effect, Exit } from "effect"

let keyReads = 0; let initializerRuns = 0
const Keys = { get field(): number { keyReads++; throw new Error("not evaluated") } }
const initializedKey = (++initializerRuns, 2)
type Reads = Data.TaggedEnum<{ Item: { [Keys.field]: string } }>
const Reads = Data.taggedEnum<Reads>()
type Initialized = Data.TaggedEnum<{ Item: { [initializedKey]: string } }>
const Initialized = Data.taggedEnum<Initialized>()
const read = Reads.Item({ 1: "read" })
const eager = Initialized.Item({ 2: "eager" })
function observeDataKeys() {
  return Effect.gen(function* () {
    return [keyReads, initializerRuns, read[1], eager[2], keyReads]
  })
}
const dataKeyExit = Effect.runSyncExit(observeDataKeys())
console.log(dataKeyExit) // Success([0, 1, "read", "eager", 0])
```

Computed payload members use TypeScript's own duplicate-member checks. The repeated computed field below is admitted with matching types; incompatible computed declarations instead receive the native `TS2717` check.

```vibe es
// compiler-gap: pending VIP-16
const slot = "x" as const
data Repeated { Row { [slot]: number; ["x"]: number } }
effect function readRepeated() { return Repeated.Row({ x: 7 }).x }
```

```ts effect
import { Data, Effect } from "effect"

const slot = "x" as const
type Repeated = Data.TaggedEnum<{
  Row: { readonly [slot]: number; readonly ["x"]: number }
}>
const Repeated = Data.taggedEnum<Repeated>()
type IncompatibleComputed = {
  ["x"]: number
  // @ts-expect-error TS2717: subsequent computed members must have the same type
  ["x"]: string
}
const duplicateKeyExit = Effect.runSyncExit(Effect.sync(() => Repeated.Row({ x: 7 }).x))
console.log(duplicateKeyExit) // Success(7)
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
| two variants, or two fields of a variant, on one line with no separator, `data D { A B }` or `A { x: number y: string }`; write `;` or a line break between them (quick fix: insert `;`) | `EK1605` |


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

### Shadowing mapped built-ins

```vibe es
// fragment
// compiler-gap: pending VIP-15
export {}
type Record<K, V> = { k: K; v: V }
schema S { a: Record<string, number> } // EK2109: no Schema value for the local type
```

A repair supplies the actual decoder instead of silently selecting the library's dictionary mapping:

```vibe es
schema Entry { readonly k: string; readonly v: number }
schema S { readonly a: Entry }
```

```ts effect
import * as Schema from "effect/Schema"

const Entry = Schema.Struct({ k: Schema.String, v: Schema.Number })
type Entry = typeof Entry.Type
const S = Schema.Struct({ a: Entry })
type S = typeof S.Type
```

### Declaration output

Exported `schema` and `data` declarations emit the TypeScript declarations of their Effect TypeScript counterparts above: a schema constant and its `typeof Name.Type` alias, or a `Data.TaggedEnum` alias and typed constructor constant. Generic data also emits the `WithGenerics` helper, named as above, when the exported constant references it; the helper is an implementation name, not a reserved source identifier. TypeScript declaration emission preserves inferred readonly payloads and the constructor signatures; it adds no runtime matcher.

A JSDoc comment on a `schema` declaration is emitted on its `declare const` only; its `typeof Name.Type` alias has no comment. This includes `@internal`, `@public` and `@deprecated`, as on the ordinary Effect TypeScript pair. Native `removeComments` and `stripInternal` behavior is unchanged.

```vibe es
import * as Schema from "effect/Schema"

/** A message on the wire. */
export schema Message { readonly id: string }
```

```ts effect
import * as Schema from "effect/Schema"

/** A message on the wire. */
export const Message = Schema.Struct({ id: Schema.String })
export type Message = typeof Message.Type
```

Declaration emit retains the comment on the constant and leaves the type alias bare. To retain distinct documentation on a constant and its type alias, keep the ordinary TypeScript pair.

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. Principles are numbered as in [the introduction's Details](000-intro.md#details).

### Detail 111

**Schema field objects emit a noncomputed __proto__ key as a computed string key.** (live `006-schema-proto-field`; owner `spec-fix-c`; VIP-15/VIP-29; detail 12.) For every noncomputed field whose property name is `"__proto__"`, emit `["__proto__"]:` in the generated schema-fields object. This includes identifier and quoted source keys, nested structs, and schema-error fields. Preserve already-computed keys and their evaluation order. An object-type property denotes an own field; JavaScript object-literal prototype-setting syntax must not remove it from validation.
    ```vibe
    schema Payload { "__proto__": string }
    // {} and { ["__proto__"]: 42 } must fail decoding; a string field succeeds
    ```
    Effect TS: `const Payload = Schema.Struct({ ["__proto__"]: Schema.mutableKey(Schema.String) })`. Decided by the agent from principle 2 (TypeScript object-type field meaning) and VIP-15's per-field schema mapping, 2026-10-29. This repairs the counterpart's key construction without changing Effect or adding syntax.

### Detail 132

**Source field modifiers control decoded keys; reject conflicting referenced-schema flags for now.** (live `006-reference-key-modifiers`; VIP-15/VIP-29; detail 12.) Choose the recommended conservative admission rule, not silent modifier loss. For a required source field, the reference's decoded `"~type.optionality"` must be `"required"`; for an effectively readonly source field (written `readonly`, or any schema-error payload field, detail 167) its decoded `"~type.mutability"` must be `"readonly"`. Check the inferred/aliased schema type's flags, not the spelling of a call or identifier. When the required flag cannot be established (including a union that may conflict), report `EK2109` and suggest using the unmodified value schema with the modifiers written on the field. Writable fields still use mutableKey; optional fields still use optional. Apply the check to nested structs and schema errors. Encoded/constructor-input defaults remain Effect's; the source property promise describes the decoded Type.
    **Immutable-main source portion (fb3e96, 132).** 006/AppendixB publish decoded-key optionality/mutability proof checks at required and effectively readonly mapped positions, aliases/unions/nesting, EK2109 for conflict/unprovable flags, preserving encoded/default behavior. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Status: applied in 1f98199496d8b360641fefb4e2de6f59ed6c7db6 (spec-fix-c; queued, not yet a main receipt).
    Current replacement: applied in 9db43ccce6abed9d140b7f8c6e86ebd68085d8ab (spec-fix-c; supersedes d2753525aef1 after main rebase and current-release placement; queued, not a main receipt).
    **Immutable-main source receipt (54182a, 132).** Immutable main `54182a644026` publishes the conservative decoded-key optionality/mutability admission in public VIP15 and effective readonly schema-error payload keys in VIP29 (history `df720a2221da`). This is the public modifier/reference portion only, not a full proof of every schema JSON/transport or compiler requirement.
    Public schema publication: relevant VIP15/29 amendments applied in 5a5f50ed1e2e14f0c674ecb6dad891316dc71ee0 (spec-fix-c; queued, not on main). This publishes the owned schema rules; other213 public-authority work remains with its owners.
    Status: applied in d2753525aef1249635ae947ca7a12ad2cac6f4b7 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    const OptionalNumber = Schema.optional(Schema.Number)
    const MutableString = Schema.mutableKey(Schema.String)
    schema Bad { must: OptionalNumber; readonly frozen: MutableString } // EK2109 at each conflict
    schema Good { must?: number; readonly frozen: string }
    ```
    Effect TS: `const Good = Schema.Struct({ must: Schema.optional(Schema.mutableKey(Schema.Number)), frozen: Schema.String })`, whose decoded keys match the written modifiers. No generic flag-reset/unwrap API is invented. A later supported normalization can relax the error. Decided by the agent from VIP-15/detail 12's TypeScript modifier promise, principle 2 (required/readonly decoded property meanings), and principle 8 (reject a contradictory reference now; relax later), 2026-10-29. No unconditional promise is weakened to follow an accidental nested flag.

    **Transport clarification, 2026-10-30 (live `006-schema-json-compatibility`).** The selected schema preserves its actual `Type`/`Encoded` representation; encoding is not an implicit JSON conversion and adds no universal JSON, worker or RPC compatibility guarantee. Choose a codec or serializer supported by the actual transport. For example, raw `Schema.BigInt` encodes a `bigint`, which `JSON.stringify` rejects; `Schema.BigIntFromString` explicitly encodes a string and decodes it back. A structured-clone transport can preserve a raw `bigint`, so do not turn the JSON limitation into a blanket worker ban.
    ```vibe
    const DecimalBigInt = Schema.BigIntFromString
    schema error RawCount { readonly value: bigint }
    schema error TextCount { readonly value: DecimalBigInt }
    ```
    Effect TS: `class RawCount extends Schema.TaggedError<RawCount>()("RawCount", { value: Schema.BigInt }) {}` versus the same declaration using `Schema.BigIntFromString`; `Schema.encodeSync` preserves the selected codec's encoded type and `Schema.decodeUnknownSync` restores its decoded type. Decided by the agent from VIP-15/VIP-29's exact Schema counterparts and principle 1 (idiomatic Effect codec semantics), 2026-10-30. This clarifies an existing contract, changes no language/package API, and authorizes no automatic coercion. `schema-json-reference.log` independently verifies the raw JSON failure, successful raw structured clone, and explicit string-codec JSON round trip on Effect 4.1.0. It is native reference evidence, not compiler or RPC-library conformance.
    Transport: landed on main f58798560fe7 (commit 22d525f4fe69; 003/006/user pages) and its public VIP-29 counterpart on main 9e56d6a17aaf (commit 3e963e0e6868).

### Detail 137

**Required fixed tuple slots cannot inherit optional-element flags from schema references.** (live `006-tuple-reference-optionality`; extends detail 132 under VIP-15.) At every required fixed tuple position, before or after a rest element, require the inferred/aliased referenced element schema's decoded `"~type.optionality"` to be `"required"`. A tuple root's own required field flag does not establish its elements' cardinality. A conflict or unprovable required flag is `EK2109`; suggest an unmodified value schema, or a required union with undefined when a present undefined element is intended. Optional source slots keep their existing optional mapping. Apply recursively in nested structs and schema errors; do not add generic runtime unwrapping.
    **Immutable-main source portion (fb3e96, 137).** 006 includes required fixed tuple slots before or after rest in the referenced-schema optionality check; this does not add optional/rest-position permissions. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Status: applied in 1f98199496d8b360641fefb4e2de6f59ed6c7db6 (spec-fix-c; queued, not yet a main receipt).
    Current replacement: applied in 9db43ccce6abed9d140b7f8c6e86ebd68085d8ab (spec-fix-c; supersedes d2753525aef1 after main rebase and current-release placement; queued, not a main receipt).
    Public schema publication: relevant VIP15/29 amendments applied in 5a5f50ed1e2e14f0c674ecb6dad891316dc71ee0 (spec-fix-c; queued, not on main). This publishes the owned schema rules; other213 public-authority work remains with its owners.
    Status: applied in d2753525aef1249635ae947ca7a12ad2cac6f4b7 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    const OptionalNumber = Schema.optional(Schema.Number)
    schema Bad { tuple: [OptionalNumber] } // EK2109: source slot is required
    schema Good { tuple: [number | undefined] } // [] invalid, [undefined] valid
    ```
    Effect TS: `Schema.mutable(Schema.Tuple([Schema.Union([Schema.Number, Schema.Undefined])]))` preserves the required present slot. Decided by the agent from VIP-15/detail 12's TypeScript tuple promise, principle 2 (required slots retain their length even when undefined is a value), and principle 8 (the conflicting reference can be normalized/admitted later), 2026-10-30. This is the same conservative admission policy as detail 132, applied at the element that carries the flag.

### Detail 143

**A computed `schema error` field key whose type admits `"_tag"` is `EK2117`** (live `006-computed-error-tag`; VIP-13/VIP-29; replaces detail 134's runtime-guard default with its option A; keeps details 111 and 133). In a `schema error` body, a computed key is `EK2117` when the string literal type `"_tag"` is assignable to the key expression's type: `string`, `any`, `unknown`, `PropertyKey` and `` `${string}` `` all admit it. A key of a literal type other than `"_tag"`, a literal union without it, `number`, `symbol`, `unique symbol`, or a template type that excludes it (`` `x_${string}` ``) is accepted and emitted as written. A statically known `"_tag"` stays `EK2117`. No runtime `_tag` guard is emitted. The message says "use a literal key or a symbol". The rule can relax to detail 134's runtime guard later without breaking code.
    Predicate correction: superseded by223; replacement source applied in a135733913d6b849719fbc706eda30217b25d26e (spec-fix-c, submitted). The older raw-predicate entry6f5437815f7b is superseded in the queue; it is not a main receipt.
    Status: applied in 6f5437815f7bd6993dff0b62115f973e7e2da756 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    declare const k: string
    const tag = Symbol("tag")
    schema error Dynamic { [k]: number }             // EK2117: k may be "_tag"
    schema error Keyed { ["count"]: number }         // ok
    schema error Sym { [tag]: number }               // ok
    ```
    Effect TS: `class Keyed extends Schema.TaggedError<Keyed>()("Keyed", { count: Schema.Number }) {}`. Effect's `Schema.Struct` fields are a literal record; a `string`-typed key collapses the field type to an index signature the decoder does not validate. Decided by the agent from principle 8 (a compile error can relax later; an admitted key cannot be withdrawn) and principle 7 (dynamic error fields are not idiomatic Effect), 2026-10-30. Breaks no existing code: none of the 1117 `.vibe` files on `main@github` has a computed `schema error` key, and the current compiler (`postmerge`, 0.0.11) compiles `schema error Dynamic { [key]: number }` to `Schema.TaggedError()("Dynamic", {})` with a bare class field `[key]` (probe `~/vibe/fix/alpha/decide-r20-scratch/probe/a.vibe`), so no program works with broad keys today. Will can override in `will-overrides.md`.


    **Predicate correction: detail223 supersedes only the raw nominal-assignability test above.** The accepted no-tag-override policy, safe-domain admission, diagnostic identity and no-runtime-guard rule remain. The earlier6f5437815f7b source receipt does not independently cover this later generic/enum/brand correction.

### Detail 149

**Record value-key flags obey source required/readonly modifiers at the mapped value, not just the outer field.** (follow-up under live `006-reference-key-modifiers`; extends details 132/137.) A Record<K,V> maps required properties, so require the mapped value reference's decoded optionality to be required; a readonly Record mapping likewise requires its decoded key mutability to be readonly before the source mapping is applied. Use inferred/aliased schema flags, not constructor spellings. A conflict or unprovable required flag is EK2109; recommend an unmodified value schema and source modifiers. Checking only the record root's field flags misses this conflict. Writable-record mutableKey mapping and optional source-field mapping remain unchanged.
    **Immutable-main source portion (fb3e96, 149).** 006 includes required Record values and readonly Record-value positions in decoded-key modifier proof checks, separately from the outer field. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Status: applied in 1f98199496d8b360641fefb4e2de6f59ed6c7db6 (spec-fix-c; queued, not yet a main receipt).
    Current replacement: applied in 9db43ccce6abed9d140b7f8c6e86ebd68085d8ab (spec-fix-c; supersedes d2753525aef1 after main rebase and current-release placement; queued, not a main receipt).
    Public schema publication: relevant VIP15/29 amendments applied in 5a5f50ed1e2e14f0c674ecb6dad891316dc71ee0 (spec-fix-c; queued, not on main). This publishes the owned schema rules; other213 public-authority work remains with its owners.
    Status: applied in d2753525aef1249635ae947ca7a12ad2cac6f4b7 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    const OptionalNumber = Schema.optional(Schema.Number)
    schema Bad { entries: Record<"a", OptionalNumber> } // EK2109: a must remain required
    schema Good { entries: Record<"a", number | undefined> } // {} invalid; { a: undefined } valid
    ```
    Effect TS: `Schema.Record(Schema.Literal("a"), Schema.mutableKey(Schema.Union([Schema.Number, Schema.Undefined])))` preserves the required finite property. Decided by the agent from VIP-15/detail 12's TypeScript mapped-property promise, principle 2 (Record does not make its keys optional), and principle 8 (the same conservative admission policy as named fields and fixed tuple slots), 2026-10-30. This is the existing schema-reference conflict in another mapped-key position, not a new runtime unwrapping API.

### Detail 167

**The schema-reference mutability check uses effective field readonlyness, including schema-error defaults.** (follow-up to live `006-reference-key-modifiers`; corrects detail 132's phrase explicitly readonly; VIP-13/VIP-29.) Every schema-error payload field is readonly even when no redundant readonly token is written. Therefore the referenced schema for each such field must have readonly decoded-key mutability under detail 132's conservative EK2109 admission rule. Apply the check to effective source modifiers, not just the presence of a token. This is shallow field readonlyness; it does not make a nested mutable value deeply readonly.
    **Immutable-main source portion (fb3e96, 167).** 003/006/AppendixB apply referenced-key readonly checks to every schema-error payload by effective readonlyness, without deep-freezing mutable nested values. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    Status: applied in 1f98199496d8b360641fefb4e2de6f59ed6c7db6 (spec-fix-c; queued, not yet a main receipt).
    Current replacement: applied in 9db43ccce6abed9d140b7f8c6e86ebd68085d8ab (spec-fix-c; supersedes d2753525aef1 after main rebase and current-release placement; queued, not a main receipt).
    Public schema publication: relevant VIP15/29 amendments applied in 5a5f50ed1e2e14f0c674ecb6dad891316dc71ee0 (spec-fix-c; queued, not on main). This publishes the owned schema rules; other213 public-authority work remains with its owners.
    Status: applied in d2753525aef1249635ae947ca7a12ad2cac6f4b7 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    const MutableString = Schema.mutableKey(Schema.String)
    schema error E { value: MutableString } // EK2109: the payload field is effectively readonly
    schema error Good { value: string }      // readonly field, as already promised
    ```
    Effect TS: `class Good extends Schema.TaggedError<Good>()("Good", { value: Schema.String }) {}`; its field retains the default readonly key flag. Decided by the agent from VIP-13/VIP-29's existing readonly-payload rule, detail 132's source-modifier precedence, and principle 4 (one effective-modifier check), 2026-10-30. No separate new bug policy or deep-readonly transformation is introduced.

### Detail 233

**Computed-key admission follows the declaration's actual native counterpart.** (live `006-schema-computed-key-admission`; accepted VIP-15/VIP-29 Schema counterparts and VIP-13/VIP-16 payload counterparts; details 111/133/143/223/232.) Ordinary `schema` and `schema error` computed field keys use native TypeScript runtime object-literal computed-property-name grammar and key-type checks, as in the emitted Schema fields object. Do not apply TypeLiteral-member restrictions merely because a source field's value is written as a type. A numeric key call, parenthesized key or element-access key is admitted when its native runtime Schema object counterpart is admitted, even if the same expression in a TypeLiteral receives `TS1170`. Invalid native object keys retain TypeScript's own diagnostics; no new code is allocated.
    **Immutable-main error-key companion (9a7f38, 233).** Chapter003/publicVIP13 now publish plain-error TypeLiteral key admission/erasure versus runtime schema-error object admission, preserving existing reserved-tag checks and actual method/getter evaluation. The complete two-file,7,121-character diff was independently read. This verifies the B companion; it does not certify full233's separately owned006/AppendixA/publicVIP15/16/29 application, selector-test byte identity or compiler behavior. `main-9a7-source-receipt.json` records exact scope.
    Earlier queued Chapter003/VIP13 companion receipt (before main `9a7f385aa855`): applied in6e02b2bc5970 (spec-fix-b; corrected replacement queued, not a main receipt; e37eee4a3b31 guarded-superseded after the decoder-selector repair). Native TypeLiteral payload admission/erasure and runtime schema-error object admission are distinct, including numeric entity-name acceptance and four TS1170 shape rejections. Node4/Bun4, strict TypeScript5.9.3 matrix, getter0/1 native controls and regen/forms/spec/docs pass. C retains006/AppendixA/VIP15/16/29; this does not claim the whole decision delivered.

    Status: landed on main ab92e0dad56f (commit 58349afe0ca0; spec-fix-c 006/Appendix A/VIP-15/16/29 half, queued as f277c4678e25). The 003/VIP-13 half is on main 9a7f385aa855 (spec-fix-b).
    **Immutable-main source scope (d0cdbe, 233).** The new runtime-Schema versus erased-TypeLiteral admission distinction is not included in this batch; its source application remains separately pending. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Evaluate admitted runtime keys once at their source declaration's existing execution point, in native property evaluation order. Preserve calls/getters, coercion, TDZ, thrown values and existing source-context throw checks; map value schemas/modifiers by the current rules. Infer the public schema type from the actual Schema value rather than fabricating a TypeLiteral containing a key call. A broad/indexed inferred key type does not promise validation of every possible key: the fields object contains its actual computed keys, with pinned Schema handling of extra input keys. Preserve reference-modifier admission, the noncomputed `__proto__` reconciliation and all unrelated declaration/member rules. `schema error` still additionally requires detail 223's runtime-domain proof excluding `_tag`, including enum/generic/branded domains; no runtime guard or reserved-tag escape is added, and transport compatibility is not implied.
    Plain `error` payload fields and `data` variant fields instead retain native TypeLiteral-member admission and erasure under `Data.TaggedError`/`Data.TaggedEnum`. Native TypeScript accepts some broad entity-name keys but rejects several call, parenthesized and element-access forms with `TS1170`, even a literal-returning call; neither blanket rejection nor blanket admission by key type is correct. An admitted type-only key is never evaluated; a separate runtime initializer keeps its native behavior. Preserve Data's payload constraints and existing reserved-tag rules. Correct `006-data.md`'s universal 'any key type' sentence and the claim that these declaration families have identical key admission.
    ```vibe
    function key(): number { return 42 }
    schema Counts { [key()]: number }           // runtime object key: admitted
    schema error CountError { [key()]: number } // number domain excludes _tag
    data CountsData { Row { [key()]: number } } // native TypeLiteral: TS1170
    ```
    Effect TS:
    ```ts
    const Counts = Schema.Struct({ [key()]: Schema.mutableKey(Schema.Number) })
    type Counts = typeof Counts.Type
    class CountError extends Schema.TaggedError<CountError>()("CountError", { [key()]: Schema.Number }) {}
    type CountsData = Data.TaggedEnum<{ Row: { readonly [key()]: number } }> // TS1170
    ```
    Decided by the agent from accepted VIP-15/VIP-29's exact runtime Schema counterparts, VIP-13/VIP-16's exact erased payload counterparts, principle 1 (idiomatic Effect), principle 2 (the native rule for the actual emitted construct), and principle 4 (one counterpart distinction instead of expression-shape exceptions), 2026-10-30. This derives admission from approved counterparts and preserves existing bans; it adds no runtime API or breaking removal of a valid form and needs no Will question. Reconcile `003-failures.md`/`006-data.md`/Appendix A and public VIP amendments under detail 213. `root-key-admission-reference.log` independently checks strict TypeScript5.9.3/Effect4.1.0: ten runtime Schema key shapes admitted, four corresponding TypeLiteral `TS1170` rejections, once-only call/getter order, actual-key decoding/extra-input stripping, and a numeric schema-error key evaluated once. These are native references only; no VibeLang compiler admission/emission, source application or main landing is verified.


    Landed003/VIP13/plain-error-guide companion: 6e02b2bc5970 -> main9a7f385aa855 (spec-fix-b10, officialmq-10310219-20). Original finite native TypeLiteral/erasure/required-field controls and all selector assertions retained; finalNode6/Bun6/fullDocsTools,regen/forms/spec/docs pass. This receipt covers this companion only; compiler conformance and other owners’ slices remain separate.

### Detail 241

**A missing member separator in a VibeLang declaration body gets the owning VIP code, never a TypeScript code.** (spec-fix-c `005-006-body-separator-code`, found 2026-10-31 on main a899a2fcb3cc; details 231/232; VIP-34; mirrors `EK0701`.) Appendix A `Separator` is a VibeLang production, so by detail 232 the rejection it produces belongs to the VIP that owns the body, whichever TypeScript parser helper implements it: `EK0908` for a `service` body (VIP-9), `EK1306` for an `error` or `schema error` body (VIP-13, amended by VIP-29), `EK1504` for a `schema` body (VIP-15) and `EK1605` for the field list of a `data` variant (VIP-16). Each is the next free code in its block after the codes of detail 231 (`EK0907`, `EK1503`, `EK1604`); the fixer confirms they are free on main and renumbers to the next free code if a queued commit took one. One rule for every body: the compiler stops printing `TS1442` (the class-parse message about a property initializer) and `TS1005` (the interface-parse expectation of `;`); 005 l.9, 006 l.9 and Appendix A l.840 name the code beside "syntax error". Message in plain words (VIP-34): the two members need a separator, write `;` or a line break between them. Quick fix: insert `;` after the first member, as `EK0701` does after a `match` arm; offered, never applied by formatting. Native `class` and `interface` members in `.ts` files keep the TypeScript codes (detail 232). What counts as a separator is unchanged: Appendix A `Separator`, defined as TypeScript parseTypeMemberSemicolon.
    ```vibe
    service S { a: number b: string }      // EK0908: write a: number; b: string, or put b on its own line
    error E { a: number b: string }        // EK1306
    schema P { a: number b: string }       // EK1504
    data D { A { x: number y: string } }   // EK1605
    service T { a: number; b: string }     // valid; one member per line is valid too
    ```
    Effect TS: the rejected lines have no counterpart; tsc 5.9.3 reports `TS1005` for `interface I { a: number b: string }` and `TS1442` for `class C { a: number b: string }` (spec-fix-c `c9/sep/`, compiler built from main a899a2fcb3cc). The repaired declarations keep the existing counterparts of 005 and 006 (the service class over `{ readonly a: number; readonly b: string }`; `Data.TaggedError`, `Schema.Struct` and the tagged-variant forms). Decided by the agent from detail 232 (a rejection that depends on a VibeLang production has the owning VIP code; implementing it with a TypeScript parser helper does not make the grammar native), detail 231 (owner-block codes per declaration form), VIP-34 (every diagnostic has an `EK` code and a message that says how to fix it) and principle 4 (one rule for every VibeLang body instead of a class/interface split), 2026-10-31. Add the four Appendix B rows with the quick fix, the 005/006 sentences and the Appendix A l.840 note; the `service` `TS1442` message is a compiler bug under either option and goes with this fix.
    Status: spec half landed on main f58798560fe7 (commit 7e0750a37d08; spec-fix-c, stack 815bb0b4841c), extended to the data variant list; the 003 statement of EK1306 queued in 50332f45ca81. Compiler half handed off in fuzz-coverage/bugs.md as 005-006-body-separator-code:compiler.

    **Immutable-main source publication (773bddb1d57f, 241).** Chapter 003 now states `EK1306` in its error declaration syntax and static table. Appendix B may point to Appendix A `Separator`, which supplies that same code. No parser/quick-fix implementation was checked. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.
