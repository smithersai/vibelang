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

- **Amended 2026-10-30: payload key admission and erasure.** Payload fields use the ordinary TypeScript type-member computed-name checks. Duplicate members retain native TypeScript checking and merging. A broad entity-name key can form an index signature, while a dynamic expression can still be `TS1170`; a `PropertyKey` result alone is not an admission proof. These payload types are erased, so their key expressions add no runtime lookup, call or TDZ read when data is declared or constructed. Separate value declarations retain their normal evaluation. The generated `Data.TaggedEnum` constraint still rejects a payload that conflicts with `_tag`.

- **Amended 2026-10-30: named default exports.** A direct `export default data D { … }` is `EK1603`: declare `D` and write `export { D as default }`. This catalogs the existing named-declaration grammar and changes neither generic data support nor the variant payload/helper diagnostics.

- **Amended 2026-10-30: incomplete declaration diagnostics.** A recognized data declaration missing its required variant body is `EK1604`. An explicitly written empty body remains admitted; recovery does not supply one automatically. These codes label existing rejections; they add no admitted syntax.

## History

One lego finding (D405): an exhaustive `match` over a `data` value skipped its last arm's test. VIP-7 settles it, because the exhaustiveness check never changes what runs.

## Prior art

Rust and Swift enums with payloads, Kotlin sealed classes, Effect's `Data.TaggedEnum`.

## Will's words

> "OK I accpet with your recomendations"

(The recommendations: match with object patterns, and decide generic unions in a later VIP.)

*Corrected 2026-10-29: the example now binds with `let`, using TC39's `let tracking` shorthand (found by the differential fuzz suite).*

*Corrected 2026-10-29: the example ends every `match` arm with `;`, the last one included, as the pinned TC39 grammar requires; a newline is not a separator (found by the round-3 review).*

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. Principles are numbered as in [the introduction's Details](../src/000-intro.md#details).

### Detail 25

(VIP-16) `data Empty {}` with zero variants is allowed: an exact empty `Data.TaggedEnum` (delete EK2122).

### Detail 122

**Data variants cannot be named $is or $match, Effect's own helper properties.** (live `900-data-helper-variants`; VIP-16/VIP-28; `EK1602`, corrected by detail 130.) Diagnose either name on a `data` variant, generic data included, and offer a rename of the declaration and its resolved references (for example `Is` or `Match`, choosing a fresh name). Leave the grammar broad enough to issue this semantic diagnostic. Other variant names retain the exact `Data.TaggedEnum`/`Data.taggedEnum` counterpart and their existing nonthrowing constructor contract. Do not replace the runtime proxy or claim its two reserved helper properties construct variants.
    **Immutable-main source scope (f6fe7a, 122).** 006/AppendixB/publicVIP16 now reserve$is/$match for nongeneric/generic data under1602. The006 summary row is detached after a TSfence and has a separate formattingfollowup under the activeCsourceclaim. `root-mainf6-source-receipt.json` and `root-mainf6-throws-audit.json` preserve reviewed-prose/structured-artifact limits; no full raw9.19MB human-read or owncompiler/Go/generator/test/gate claim.
    Current replacement: applied in 19fd0465084af57fee4f75742cfdd19e5fd8c106 (spec-fix-c; supersedes 83f85800f5ad after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 83f85800f5adeb1558eb4e9cf01dbe365be302be (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    data D { $is; $match; Normal } // EK1602 on $is and $match
    data D2 { Is; Match; Normal }  // constructors preserve the promised variant behavior
    ```
    Effect TS: `type D2 = Data.TaggedEnum<{ Is: {}; Match: {}; Normal: {} }>; const D2 = Data.taggedEnum<D2>()`. `Data.taggedEnum` always interprets `$is`/`$match` as helpers; a typed zero-argument call can return a predicate or throw instead of constructing a variant. Decided by the agent from principle 8 (reject the unusable constructor names; this can be relaxed later), principle 7 (keep Effect's actual taggedEnum behavior), and VIP-16's exact counterpart, 2026-10-29. The main corpus search found no variant declaration using either name; this is a VIP-16 amendment, not a silent runtime shim.
    **Independent f6fe7 source portion (122).** Chapter006/publicVIP16 and the catalog now reserve$is/$match for all data declarations, including generic data, withEK1602 and rename-resolved-reference advice. Full27,227-character nongenerateddiffread; sourceonly, no decide-livecompiler/gaterun. `main-f6f-source-receipt.json` records limits.
