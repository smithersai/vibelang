# VIP-16: `data` declarations (tagged unions)

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// VibeLang
data Delivery { Waiting; Sent { tracking: string }; Rejected { reason: string } }
const d = Delivery.Sent({ tracking: "1Z" })
match (d) { when { _tag: "Sent", let tracking }: tracking; default: "none"; }

// exactly this Effect TS
type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { tracking: string }; Rejected: { reason: string } }>
const Delivery = Data.taggedEnum<Delivery>()
```

- `data Name { Variant; Variant { fields } }` declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name.
- Variant names `$is` and `$match` are `EK1602`, including in generic data: those properties are Effect's helpers. Rename the variant and its resolved references; other variants retain the exact `Data.taggedEnum` constructors.
- Variants are matched with TC39 object patterns on `_tag` (VIP-7). In the pinned TC39 snapshot, a bare key such as `{ tracking }` only tests that the property exists; binding it takes `let tracking`, the snapshot's shorthand for `tracking: let tracking`. The variant constructors get no custom matchers.
- Generic unions (`data Result<A, E> { … }`) are left to a later VIP.
- **Ambiguity: none.** `data` is a contextual keyword on the same line as its name, so `const data = …` still works.
- **Amended 2026-10-29: zero variants.** `data Empty {}` is allowed: an exact empty `Data.TaggedEnum` (the old EK2122 is deleted). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.

- **Amended 2026-10-30: named default exports.** A direct `export default data D { … }` is `EK1603`: declare `D` and write `export { D as default }`. This catalogs the existing named-declaration grammar and changes neither generic data support nor the variant payload/helper diagnostics.

## History

One lego finding (D405): an exhaustive `match` over a `data` value skipped its last arm's test. VIP-7 settles it, because the exhaustiveness check never changes what runs.

## Prior art

Rust and Swift enums with payloads, Kotlin sealed classes, Effect's `Data.TaggedEnum`.

## Will's words

> "OK I accpet with your recomendations"

(The recommendations: match with object patterns, and decide generic unions in a later VIP.)

*Corrected 2026-10-29: the example now binds with `let`, using TC39's `let tracking` shorthand (found by the differential fuzz suite).*

*Corrected 2026-10-29: the example ends every `match` arm with `;`, the last one included, as the pinned TC39 grammar requires; a newline is not a separator (found by the round-3 review).*
