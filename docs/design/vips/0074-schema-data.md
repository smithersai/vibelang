# VIP-74: Serializable tagged unions (`schema data`)

**Status:** accepted 2026-11-27 (language ergonomics wave — twin of VIP-29 `schema error` for VIP-16 `data`).

## Decision

Add `schema data Name { VariantA; VariantB { field: Type } }` as the serializable twin of `data` (VIP-16), parallel to how `schema error` (VIP-29) is the serializable twin of `error` (VIP-13).

### Syntax

```vibe
export schema data Shape {
  Empty
  Circle { readonly radius: number }
  Rectangle { width: number; height?: number }
}
```

- `schema data Name` uses the same two-word introducer rule as `schema error Name` and `schema service Name`: `schema`, `data`, and `Name` appear on the same line without line breaks between them. `schema data { … }` and `schema data = T` continue to declare an ordinary `schema` named `data`.
- Variants use VIP-16's variant syntax (`Name` or `Name { fields }`), separated by `;`, `,`, or line breaks.
- Variant fields follow VIP-15's schema field mapping (`readonly` stays immutable, writable fields wrap in `Schema.mutableKey`, `?` maps to `Schema.optional` or `Schema.optionalKey` under `exactOptionalPropertyTypes`, and nested primitives/arrays/records/unions/schemas map identically to `schema`).
- `export schema data Name { … }` exports both the `Schema.TaggedUnion` constant and its `typeof Name.Type` type companion.

### Lowering & Declaration Output

```ts effect
export const Shape = Schema.TaggedUnion({
  Empty: {},
  Circle: { radius: Schema.Number },
  Rectangle: {
    width: Schema.mutableKey(Schema.Number),
    height: Schema.mutableKey(Schema.optional(Schema.Number)),
  },
})
export type Shape = typeof Shape.Type
```

- Lowers directly to Effect 4's `Schema.TaggedUnion({ ... })` plus `type Name = typeof Name.Type`, preserving 100% compatibility with Effect 4 `Schema.TaggedUnion` (`.cases`, `.guards`, `.isAnyOf`, `.match`, `.matchOrElse`, `Schema.decodeUnknownEffect`, `Schema.encodeEffect`) and `@effect/ui` models/messages.
- Every variant's decoded type carries a literal `_tag` discriminant, so VIP-7 `match (x)` compile-time exhaustiveness checking (`EK4701`) works automatically with `when { _tag: "Variant", ... }`.
- Declaration emit (`.d.ts` and `.d.vibe.ts`) emits `export declare const Name: Schema.TaggedUnion<...>;` followed by `export type Name = typeof Name.Type;`.

### Static rules

| Mistake | Code |
| --- | --- |
| A variant field named `_tag` | `EK1601` |
| `export default schema data Name { … }` | `EK1603` |
| Missing variant body (`schema data Name`) | `EK1604` |
| Missing separator between variants | `EK1605` |
| Invalid variant name or parenthesized payload (`Variant(x: number)`) | `EK1606` |
| Type parameters (`schema data Name<T> { … }`) | `EK1502` |
| Missing separator between variant fields | `EK1504` |
| Non-field member inside a variant body (e.g. a method) | `EK1505` |
| Ambient `declare schema data Name { … }` | `EK1506` |
| Unsupported field type or non-schema reference | `EK2109` |

## Motivation

Real Effect 4 and `@effect/ui` applications frequently define serializable discriminated unions (messages, API responses, persisted state machines). Previously, authors had to choose between `data` (not a `Schema`, no JSON encode/decode) or hand-writing `const Name = Schema.TaggedUnion({ ... }); type Name = typeof Name.Type` with repetitive `Schema.*` boilerplate. `schema data` completes the 2×2 matrix (`error` / `schema error`, `data` / `schema data`, `service` / `schema service`) with zero new runtime helpers.
