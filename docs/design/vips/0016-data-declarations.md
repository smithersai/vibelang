# VIP-16: `data` declarations (tagged unions)

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// VibeLang
data Delivery { Waiting; Sent { tracking: string }; Rejected { reason: string } }
const d = Delivery.Sent({ tracking: "1Z" })
match (d) { when { _tag: "Sent", let tracking }: tracking; default: "none" }

// exactly this Effect TS
type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { tracking: string }; Rejected: { reason: string } }>
const Delivery = Data.taggedEnum<Delivery>()
```

- `data Name { Variant; Variant { fields } }` declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name.
- Variants are matched with TC39 object patterns on `_tag` (VIP-7). In the pinned TC39 snapshot, a bare key such as `{ tracking }` only tests that the property exists; binding it takes `let tracking`, the snapshot's shorthand for `tracking: let tracking`. The variant constructors get no custom matchers.
- Generic unions (`data Result<A, E> { … }`) are left to a later VIP.
- **Ambiguity: none.** `data` is a contextual keyword on the same line as its name, so `const data = …` still works.

## History

One lego finding (D405): an exhaustive `match` over a `data` value skipped its last arm's test. VIP-7 settles it, because the exhaustiveness check never changes what runs.

## Prior art

Rust and Swift enums with payloads, Kotlin sealed classes, Effect's `Data.TaggedEnum`.

## Will's words

> "OK I accpet with your recomendations"

(The recommendations: match with object patterns, and decide generic unions in a later VIP.)

*Corrected 2026-10-29: the example now binds with `let`, using TC39's `let tracking` shorthand (found by the differential fuzz suite).*
