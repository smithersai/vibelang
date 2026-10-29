# Data

Sources: [VIP-15](../vips/0015-schema-declarations.md), [VIP-16](../vips/0016-data-declarations.md), [VIP-28](../vips/0028-generic-data.md).

## `schema` declarations

### Syntax

```text
SchemaDeclaration = "export"? "schema" Name "{" SchemaFields "}"
                  | "export"? "schema" Name "=" Type
SchemaFields      = (PropertyName "?"? ":" Type ";"?)*
```

`schema` is a contextual keyword on the same line as its name.

### Meaning

`schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name.

```vibe es
// compiler-gap: pending VIP-15
schema Address { city: string }
schema User { id: string; nickname?: string; role: "admin" | "member"; home: Address }
schema Code = "root_missing" | "read_failed"
```

```ts effect
// fragment
const Address = Schema.Struct({ city: Schema.String })
type Address = typeof Address.Type
const User = Schema.Struct({
  id: Schema.String,
  nickname: Schema.optional(Schema.String),
  role: Schema.Literals(["admin", "member"]),
  home: Address,
})
type User = typeof User.Type
const Code = Schema.Literals(["root_missing", "read_failed"])
type Code = typeof Code.Type
```

Each field's schema is written from its TypeScript type:

| Field type | Schema |
| --- | --- |
| `string`, `number`, `boolean`, `bigint` | `Schema.String`, `Schema.Number`, `Schema.Boolean`, `Schema.BigInt` |
| a union of literals, `"a" \| "b"` | `Schema.Literals(["a", "b"])` |
| another schema's name, `Address` | that schema |
| `name?: T` | `Schema.optional(…)`: a missing key or `undefined`, as TypeScript's default |
| unions, arrays, tuples, `Record`, nested object types | Effect's combinator for each, applied to the mapped parts |

Refinements and transformations stay Schema constants, which a field names, as in `name: NonEmptyString`.

| Rule | Diagnostic |
| --- | --- |
| a field type outside the mapping | code pending |

**Undecided (pending VIP):** the exact mapping of each remaining type: a single literal (`Schema.Literal("a")` or `Schema.Literals(["a"])`), a union mixing literals and other types, `null` and `undefined`, `readonly` arrays and fields, and a nested object type (an inline `Schema.Struct`).

## `data` declarations

### Syntax

```text
DataDeclaration = "export"? "data" Name TypeParameters? "{" Variant (Separator Variant)* Separator? "}"
Separator       = ";" | LineTerminator   (as between interface members)
Variant         = Name ("{" Fields "}")?
```

`data` is a contextual keyword on the same line as its name, so `const data = …` still works.

### Meaning

`data Name { Variant; Variant { fields } }` declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name.

```vibe es
// compiler-gap: pending VIP-16
data Delivery { Waiting; Sent { tracking: string }; Rejected { reason: string } }
const d = Delivery.Sent({ tracking: "1Z" })
const label = match (d) { when { _tag: "Sent", let tracking }: tracking; default: "none" }
```

```ts effect
// fragment
type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { tracking: string }; Rejected: { reason: string } }>
const Delivery = Data.taggedEnum<Delivery>()
```

Variants are matched with TC39 object patterns on `_tag` ([Pattern matching](004-match.md)). A bare key such as `{ tracking }` only tests that the property exists; binding it takes `let tracking`. The variant constructors get no custom matchers.

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
