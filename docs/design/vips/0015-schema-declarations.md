# VIP-15: `schema` declarations

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// fragment
// VibeLang
schema User { id: string; nickname?: string; role: "admin" | "member"; home: Address }
schema Code = "root_missing" | "read_failed"           // alias form

// exactly this Effect TS
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

Using one is Effect's own Schema API (VIP-14), for example:

```ts
const user = try Schema.decodeUnknownEffect(User)(input)   // fails with a SchemaError
```

- `schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name.
- Each field's schema is written from its TypeScript type: primitives, literals, unions, arrays, tuples, `Record`, nested object types, or another schema's name. A type outside that mapping is a compile error.
- `name?: T` means `Schema.optional`, which accepts a missing key or `undefined`, matching TypeScript's default.
- Refinements and transformations stay Schema constants, which a field names, as in `name: NonEmptyString`.
- **Ambiguity: none.** `schema` is a contextual keyword on the same line as its name.
- **Amended 2026-10-29: the type mappings mirror TypeScript, mutability included.**
  - `"a"` → `Schema.Literal("a")`;
  - a union → `Schema.Union([...])`;
  - `null` / `undefined` → `Schema.Null` / `Schema.Undefined`;
  - `T[]` → `Schema.mutable(Schema.Array(S))`, and `readonly T[]` → `Schema.Array(S)`;
  - `[A, B]` → `Schema.Tuple([A, B])`, mutable unless `readonly`;
  - `Record<K, V>` → `Schema.Record(K, V)`;
  - a struct → `Schema.Struct`, with `Schema.mutableKey` for mutable fields.

  Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.

*Corrected 2026-10-29: under "mutability included", a writable `Record<K, V>` is `Schema.Record(K, Schema.mutableKey(V))` and `Readonly<Record<K, V>>` is `Schema.Record(K, V)`, because `Schema.Record(K, V).Type` is readonly in effect 4.1.0; and a union made only of literals is `Schema.Literals([...])`, as the decision example writes it (found by the round-3 review).*

*Corrected 2026-10-29: a mutable tuple `[A, B]` is `Schema.mutable(Schema.Tuple([A, B]))`, because `Schema.Tuple([A, B]).Type` is readonly in effect 4.1.0; `readonly [A, B]` is `Schema.Tuple([A, B])` (found by the round-4 review).*


- **Amended 2026-10-30: referenced schemas preserve source modifier promises by conservative admission.** A required source field, a required fixed tuple position (before or after rest), or a required `Record` value position requires the referenced schema's inferred decoded-key optionality to be required. An effectively readonly field or readonly `Record` value position requires readonly decoded-key mutability. Check resolved schema flags through aliases; conflicting or unprovable needed flags are rejected by the field-mapping rule, with the repair to use an unmodified value schema and write modifiers on the source occurrence. Apply this recursively in nested mappings. Writable fields/records and optional source occurrences keep their existing mappings. This checks the flags at the mapped occurrence, not constructor spellings; it invents no flag-reset or unwrapping API. Encoded and constructor-input defaults retain Effect's behavior. Schema-error payload keys are effectively readonly even without a written `readonly`; this is shallow key readonlyness, not a deeply readonly decoded value. The [Data chapter's mapping](../src/006-data.md#schema-declarations) states the admitted cases.

## History

One minor finding, a wrong Effect API name, fixed.

## Prior art

Effect's `Schema.Struct`; Zod's `z.object`; Pydantic models.

## TODO (Will)

> "we also need to mark as a TODO creating a smithers generation script that properly updates the library as schema changes"

## Will's words

> "Yup I'm accepting this"
