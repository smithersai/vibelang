# Data

Sources: [VIP-15](../vips/0015-schema-declarations.md), [VIP-16](../vips/0016-data-declarations.md), [VIP-28](../vips/0028-generic-data.md).

## `schema` declarations

### Syntax

```text
SchemaDeclaration = "export"? "schema" Name "{" Field* "}"
                  | "export"? "schema" Name "=" Type
Field             = "readonly"? PropertyName "?"? ":" Type Separator
Separator         = ";" | "," | LineTerminator | before "}"   (as between interface members)
```

`Field` and `Separator` are the productions of [Appendix A](900-appendices.md#productions), shared with `error` and `data`. `schema` is a contextual keyword on the same line as its name. Fields use TypeScript's type-member separators, so `{ a: string b: number }` is a syntax error. `schema error { … }` and `schema error = T` name a schema `error`; `schema error Name` declares a schema error ([Failures](003-failures.md#error-declarations)).

### Meaning

`schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name. Mappings preserve TypeScript mutability: properties are writable unless `readonly`; arrays and tuples are mutable unless `readonly`.

```vibe es
// compiler-gap: pending VIP-15
schema Address { city: string }
schema User { id: string; nickname?: string; role: "admin" | "member"; home: Address }
schema Code = "root_missing" | "read_failed"
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

In this table, `S`, `A` and `B` are the recursively mapped schemas of the corresponding types.

| Type or field | Effect 4.1.0 schema |
| --- | --- |
| `string`, `number`, `boolean`, `bigint` | `Schema.String`, `Schema.Number`, `Schema.Boolean`, `Schema.BigInt` |
| single literal `"a"` | `Schema.Literal("a")` (likewise numeric, boolean and bigint literals) |
| union consisting entirely of literals `"a" \| "b"` | `Schema.Literals(["a", "b"])` |
| other union `A \| B` | `Schema.Union([A, B])`, each member mapped separately in source order |
| `null`, `undefined` | `Schema.Null`, `Schema.Undefined` |
| another schema name `Address` | `Address` |
| `T[]`, `Array<T>` | `Schema.mutable(Schema.Array(S))` |
| `readonly T[]`, `ReadonlyArray<T>` | `Schema.Array(S)` |
| `[A, B]` | `Schema.mutable(Schema.Tuple([A, B]))` |
| `readonly [A, B]` | `Schema.Tuple([A, B])` |
| `Record<K, V>` | `Schema.Record(K, Schema.mutableKey(V))` |
| `Readonly<Record<K, V>>` | `Schema.Record(K, V)` |
| nested object `{ name: T }` | `Schema.Struct({ name: Schema.mutableKey(S) })` |
| writable field `name: T` | `name: Schema.mutableKey(S)` |
| writable optional field `name?: T` | `name: Schema.mutableKey(Schema.optional(S))` |
| readonly field `readonly name: T` | `name: S` |
| readonly optional field `readonly name?: T` | `name: Schema.optional(S)` |

For example, `"a" | "b" | null` maps to `Schema.Union([Schema.Literal("a"), Schema.Literal("b"), Schema.Null])`; it does not group the string literals into `Schema.Literals`.

`Schema.optional` accepts a missing key or `undefined`, matching TypeScript’s default. `Schema.mutableKey` changes the property, not its nested value; `Schema.mutable` changes an array or tuple, not its elements. Record keys must satisfy Effect’s `Schema.Record.Key` constraint.

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

Refinements and transformations stay Schema constants, which a field names, as in `name: NonEmptyString`. `typeof Name.Type` is the declared type.

The generated constants keep TypeScript declaration order and temporal dead zone: declare `Address` before a schema that reads it. There is no implicit reordering or `Schema.suspend`; a forward or cyclic value reference has the same initialization behavior as the shown TypeScript.

| Rule | Diagnostic |
| --- | --- |
| a field type outside the mapping | EK2109 |

## `data` declarations

### Syntax

```text
DataDeclaration = "export"? "data" Name TypeParameters? "{" Variant (Separator Variant)* Separator? "}"
Variant         = Name ("{" Field* "}")?
```

`data` is a contextual keyword on the same line as its name, so `const data = …` still works. `Field` and `Separator` are those of `schema` declarations. Variants are separated as fields are, as the members of the `Data.TaggedEnum` type literal are, and a variant's fields may be `readonly`.

### Meaning

`data Name { Variant; Variant { fields } }` declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name.

```vibe es
// compiler-gap: pending VIP-16
data Delivery { Waiting; Sent { tracking: string }; Rejected { reason: string } }
const tracking = "outer"
const d = Delivery.Sent({ tracking: "1Z" })
const label = match (d) { when { _tag: "Sent", let tracking }: tracking; default: "none"; }
```

```ts effect
// fragment
type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { tracking: string }; Rejected: { reason: string } }>
const Delivery = Data.taggedEnum<Delivery>()
const tracking = "outer"
const d: Delivery = Delivery.Sent({ tracking: "1Z" })
let label: string
if (d._tag === "Sent" && "tracking" in d) {
  const tracking = d.tracking
  label = tracking
} else {
  label = "none"
}
```

Variants are matched with TC39 object patterns on `_tag` ([Pattern matching](004-match.md)). A bare key such as `{ tracking }` only tests that the property exists; binding it takes `let tracking`. Here `label` is `"1Z"`; replacing `let tracking` with `tracking` would read `"outer"`. The variant constructors get no custom matchers.

### Generic unions

A `data` declaration may have up to 4 type parameters, the limit of Effect's own `WithGenerics`.

```vibe es
// compiler-gap: pending VIP-28
data Outcome<A, E> { Ok { value: A }; Err { error: E } }
```

```ts effect
// fragment
type Outcome<A, E> = Data.TaggedEnum<{ Ok: { value: A }; Err: { error: E } }>
interface OutcomeDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: Outcome<this["A"], this["B"]>
}
const Outcome = Data.taggedEnum<OutcomeDefinition>()
```

| Rule | Diagnostic |
| --- | --- |
| more than 4 type parameters; the message names the limit | code pending |
