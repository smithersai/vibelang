# VIP-15: `schema` declarations

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// VibeLang
schema User { id: string; nickname?: string; role: "admin" | "member"; home: Address }
schema Code = "root_missing" | "read_failed"           // alias form

// exactly this Effect TS
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

## History

One minor finding, a wrong Effect API name, fixed.

## Prior art

Effect's `Schema.Struct`; Zod's `z.object`; Pydantic models.

## TODO (Will)

> "we also need to mark as a TODO creating a smithers generation script that properly updates the library as schema changes"

## Will's words

> "Yup I'm accepting this"
