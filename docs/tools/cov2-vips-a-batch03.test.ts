// Rule-specific pending obligations from the cov2-vips-a assignment.
// Pending because focused compiler and Effect TypeScript witnesses remain unverified.
// These declarations make no claim that the compiler fails or conforms.
import { test } from "bun:test"

// rule-evidence: docs/design/vips/0007-match.md#ffe3c9fa4098261e
// VIP-7: limit binding uses one outer cell
test.todo("VIP-7 limit binding uses one outer cell: A binding in a `for concurrent` limit belongs to the nearest home that encloses the loop, because the limit runs before the head environment exists; it is one cell, not copied into items.")

// rule-evidence: docs/design/vips/0007-match.md#4fa0bef7a356de99
// VIP-7: match arms require final semicolon
test.todo("VIP-7 match arms require final semicolon: *Corrected 2026-10-29: the example ends every `match` arm with `;`, the last one included, as the pinned TC39 grammar requires; a newline is not a separator (found by the round-3 review).*")

// rule-evidence: docs/design/vips/0007-match.md#1427e4d6b181f70e
// VIP-7: project options govern pattern types
test.todo("VIP-7 project options govern pattern types: **Amended 2026-11-01: project options and extraction presence.** Pattern bindings have their specified TypeScript counterpart's types under the project's options; the strict examples do not freeze those types under `exactOptionalPropertyTypes` or `strictNullChecks`.")

// rule-evidence: docs/design/vips/0007-match.md#021d0d8b108648f2
// VIP-7: proven extraction presence with real undefined
test.todo("VIP-7 proven extraction presence with real undefined: Proven element/key presence prevents `noUncheckedIndexedAccess` from adding artificial `undefined`; it does not remove actual payload `undefined`.")

// rule-evidence: docs/design/vips/0007-match.md#0152143a72e9d2c0
// VIP-7: index signature pattern keys
test.todo("VIP-7 index signature pattern keys: Pattern keys are not dotted reads under `noPropertyAccessFromIndexSignature`.")

// rule-evidence: docs/design/vips/0009-service-declarations.md#e174004a9f0b004d
// VIP-9: service declaration forms
test.todo("VIP-9 service declaration forms: `service Name { members }` and `service Name: Type { … }` declare services.")

// rule-evidence: docs/design/vips/0009-service-declarations.md#d557f591f49f34f9
// VIP-9: local service Shape lookup
test.todo("VIP-9 local service Shape lookup: Outside its own shape, a service declared in a function or block has no `S.Shape`; write `Context.Service.Shape<typeof S>`.")

// rule-evidence: docs/design/vips/0009-service-declarations.md#f4c2100e2652d201
// VIP-9: annotated exact nonobject Shape
test.todo("VIP-9 annotated exact nonobject Shape: **Amended 2026-11-02 (accepted foldkit-48):** In `service Name: Type { … }`, the annotation supplies the exact whole Shape, including a non-object type.")

// rule-evidence: docs/design/vips/0009-service-declarations.md#499e41c6ae470458
// VIP-9: annotated service member rejection
test.todo("VIP-9 annotated service member rejection: The required body admits only the existing `key` and `defaultValue` members; another member is `EK0902`.")

// rule-evidence: docs/design/vips/0009-service-declarations.md#9d363431203ab243
// VIP-9: direct Context type and modifier preservation
test.todo("VIP-9 direct Context type and modifier preservation: Pass the type directly to `Context.Service<Name, Type>`, or `Context.Reference<Type>` with a default, preserving its name and modifiers.")

// rule-evidence: docs/design/vips/0009-service-declarations.md#e886de50f83da5fb
// VIP-9: annotated Name Shape resolution
test.todo("VIP-9 annotated Name Shape resolution: `Name.Shape` resolves to that type wherever chapter 005 permits it, without an added helper or namespace.")

// rule-evidence: docs/design/vips/0012-provide.md#8388b81e530b1bc4
// VIP-12: provide comma adjacent line breaks
test.todo("VIP-12 provide comma adjacent line breaks: Relax only comma-adjacent restrictions for recognition: keep the ordinary provider grammar, no break after `provide` and same-line final `{`.")

// rule-evidence: docs/design/vips/0012-provide.md#0389c0b3f7cfe23c
// VIP-12: provide ordinary expression boundaries
test.todo("VIP-12 provide ordinary expression boundaries: Breaks inside provider expressions, ordinary calls without that body and expression readings after `return` are unchanged.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#4b381b6567c0ed0b
// VIP-14: implicit core Effect module inventory
test.todo("VIP-14 implicit core Effect module inventory: Every root export of the core `effect` package (149 in effect 4.1.1, such as `Schema`, `Layer`, `Stream`, `Option`, `Data`, `Context`, `Schedule`, `Duration`) is in scope in a `.vibe` file without an import.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#2c8f4c8c273232dd
// VIP-14: used module subpath imports
test.todo("VIP-14 used module subpath imports: Emitted code imports each module it uses from `effect/<Module>`.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#3bb89b00c090d8f6
// VIP-14: effectModules tsconfig option
test.todo("VIP-14 effectModules tsconfig option: This is configurable in `tsconfig.json`, as VIP-6's globals are.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#db3c1e5c04740fd4
// VIP-14: colliding module qualified access
test.todo("VIP-14 colliding module qualified access: Effect's module of the same name is then reachable as `Effect.X`, or by import.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#c624b110bd90860e
// VIP-14: JavaScript constructor precedence
test.todo("VIP-14 JavaScript constructor precedence: | `Array`, `String`, `Number`, `Boolean`, `BigInt`, `Symbol`, `Function`, `RegExp` | JavaScript's | `Effect.Array`, `Effect.String`, … |")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#504be02c19e42f12
// VIP-14: TypeScript global type precedence
test.todo("VIP-14 TypeScript global type precedence: | `Record`, `Iterable` | TypeScript's types | `Effect.Record`, `Effect.Iterable` |")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#c9b3819185b9895d
// VIP-14: DOM Crypto remains bare
test.todo("VIP-14 DOM Crypto remains bare: **Amended 2026-10-29: no `Crypto` row.** effect 4.1.1 has no root `Crypto` module, so bare `Crypto` is the DOM's.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#1208eefaff58f384
// VIP-14: ambiguous module exporter quick fixes
test.todo("VIP-14 ambiguous module exporter quick fixes: Using it is a compile error that names every exporter and offers one import per exporter: in 4.1.1, `Model`, `Prompt` and `Utils`.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#ced49d533ed360e1
// VIP-14: implicit Effect qualifier identity
test.todo("VIP-14 implicit Effect qualifier identity: **Amended 2026-11-01: collision qualifiers use the implicit binding.** `Effect.Array`, `Effect.String`, `Effect.Record` and other colliding-module qualifiers are intrinsic to the compiler's implicit `Effect`; they are not exports of `effect/Effect`.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#71bbe865e952070f
// VIP-14: explicit Effect namespace rejects Array
test.todo("VIP-14 explicit Effect namespace rejects Array: An explicit namespace has no `Array` member (`TS2339`); use `import { Array as Arr } from \"effect\"`.")

// rule-evidence: docs/design/vips/0014-effect-modules-in-scope.md#571c1372931c9190
// VIP-14: disabled implicit modules preserve imports
test.todo("VIP-14 disabled implicit modules preserve imports: Turning `vibe.effectModules` off removes the implicit qualifier without changing explicit imports.")

// rule-evidence: docs/design/vips/0015-schema-declarations.md#4ac134df22b1ec5c
// VIP-15: schema Record mutability and literal unions
test.todo("VIP-15 schema Record mutability and literal unions: *Corrected 2026-10-29: under \"mutability included\", a writable `Record<K, V>` is `Schema.Record(K, Schema.mutableKey(V))` and `Readonly<Record<K, V>>` is `Schema.Record(K, V)`, because `Schema.Record(K, V).Type` is readonly in effect 4.1.1; and a union made only of literals is `Schema.Literals([...])`, as the decision example writes it (found by the round-3 review).*")

// rule-evidence: docs/design/vips/0015-schema-declarations.md#8c5ff28bde25ed71
// VIP-15: schema tuple mutability
test.todo("VIP-15 schema tuple mutability: *Corrected 2026-10-29: a mutable tuple `[A, B]` is `Schema.mutable(Schema.Tuple([A, B]))`, because `Schema.Tuple([A, B]).Type` is readonly in effect 4.1.1; `readonly [A, B]` is `Schema.Tuple([A, B])` (found by the round-4 review).*")

// rule-evidence: docs/design/vips/0015-schema-declarations.md#67f33caed1673941
// VIP-15: schema nonfield EK1505
test.todo("VIP-15 schema nonfield EK1505: **Amended 2026-10-31: non-field members.** A member of an ordinary `schema` body that is not a `Field` is `EK1505`.")

// rule-evidence: docs/design/vips/0015-schema-declarations.md#15fca8692bd36be1
// VIP-15: written schema type alias in either order
test.todo("VIP-15 written schema type alias in either order: **Amended 2026-11-02: written schema types (foldkit-9, accepted by Will).** For either ordinary `schema X` form, one written, nongeneric `type X = typeof X.Type` in the same scope replaces the synthesized alias, in either source order.")

// rule-evidence: docs/design/vips/0016-data-declarations.md#39d812e34a5dd91e
// VIP-16: variant rename resolved reference identity
test.todo("VIP-16 variant rename resolved reference identity: Rename the variant and its resolved references; other variants retain the exact `Data.taggedEnum` constructors.")

// rule-evidence: docs/design/vips/0016-data-declarations.md#1507266455d5f769
// VIP-16: malformed data variant EK1606
test.todo("VIP-16 malformed data variant EK1606: **Amended 2026-10-31: malformed variants.** A malformed `data` variant or a payload member that is not a `Field` is `EK1606`.")

// rule-evidence: docs/design/vips/0017-fork.md#538fd6720428de85
// VIP-17: fork UnaryExpression operand
test.todo("VIP-17 fork UnaryExpression operand: **Amended 2026-10-29: the operand and bindings.** `ForkOperand` is a `UnaryExpression`, `await`'s operand.")
