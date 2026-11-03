# VIP-29: serializable errors: `schema error`

**Status:** accepted, 2026-10-29, under Will's standing approval of recommendations ("assume I accept now. I will interrupt you if I need to").

## Decision

```ts
schema error NotFound { id: string }

// exactly Effect TS
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}
```

Encoding and decoding use Effect's Schema API (VIP-14). The encoded value follows the field codecs; encoding is not JSON serialization:

```ts
const encoded = try Schema.encodeEffect(NotFound)(err)
const back = try Schema.decodeUnknownEffect(NotFound)(encoded)
```

JSON, worker messages and RPC transports must support that encoded representation. The declaration adds no implicit wire conversion. For example, `Schema.BigInt` encodes a bigint, which ordinary JSON cannot serialize; `Schema.BigIntFromString` encodes a string. Choose compatible codecs and a transport that preserves the required values and property keys.

```ts effect
import { Effect, Schema } from "effect"

class BigCount extends Schema.TaggedError<BigCount>()("BigCount", { count: Schema.BigInt }) {}
class JsonCount extends Schema.TaggedError<JsonCount>()("JsonCount", { count: Schema.BigIntFromString }) {}
const encodedBigCount = Schema.encodeSync(BigCount)(new BigCount({ count: 1n }))
const jsonTransportExit = Effect.runSyncExit(Effect.try({
  try: () => JSON.stringify(encodedBigCount), catch: (error) => error,
})) // Failure(TypeError): count is still a bigint
const encodedJsonCount = Schema.encodeSync(JsonCount)(new JsonCount({ count: 1n }))
const jsonRoundTripExit = Schema.decodeUnknownExit(JsonCount)(JSON.parse(JSON.stringify(encodedJsonCount)))
// Success(JsonCount({ count: 1n })); the encoded count was "1"
```

- `schema error Name { fields }` combines VIP-13 (`error`) and VIP-15 (field mapping). Fields are written as TypeScript types and mapped to Schemas. Transport compatibility follows their encoded representations, as above.
- The body rules are VIP-13's: methods and getters are allowed, and a constructor or a `_tag` override is not.
- **Ambiguity: none.** `schema error NotFound {` and the alias form `schema error = …` differ at the next token.
- **Amended 2026-10-29: no braces.** `schema error Timeout`, with no body, is allowed, like VIP-13's `error Timeout`. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: the constructor's thrown type.** A generated `schema error` constructor is `@throws {never}`, a static contract like `error` and `data` constructors. A validation failure at construction (effect 4.1.0 throws a plain `Error`) is a defect, as any implicit throw inside `Effect.gen` is. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 42).


**Amended 2026-10-30: referenced payload modifiers.** Schema-error payload keys are readonly even when no `readonly` token is written. The referenced schema therefore needs readonly decoded-key mutability, and a required field needs required decoded-key optionality, under [VIP-15's conservative reference admission](0015-schema-declarations.md#decision). Conflicting or unprovable needed flags are rejected by those field-mapping rules; use an unmodified value schema. This checks effective field modifiers and keeps mutable nested values mutable.


**Amended 2026-10-30: computed keys preserve the discriminant.** A computed payload field key is rejected by the existing reserved-tag diagnostic unless its well-typed runtime property-key domain is proved to exclude `"_tag"`. Effective generic constraints and enum underlying values matter; opaque primitive brands/refinements do not change a string's possible runtime keys. Retain genuine literal/template constraints in intersections and require every union component to exclude the reserved value. Known numeric/symbol domains, safe literal/template domains and their brands remain admitted; `never` has no key. Reject `any`, `unknown` and unresolved or unprovable domains conservatively. Accepted keys retain native evaluation/order, with no value unwrapping, decoder execution or runtime tag guard. Ordinary TypeScript invalid-key rules remain independent.

- **Amended 2026-10-30: computed-key counterparts.** Computed field keys use native runtime object-literal admission and evaluation, as for schema declarations. They must additionally prove their runtime key domain excludes `_tag`; native key admission does not relax that reserved-tag check, add a runtime guard or imply transport compatibility. Plain error payloads retain their separate erased TypeScript type-member counterpart.

## Details

Decided details folded in on 2026-11-03. Each keeps its old number as history. The conflict pass deleted superseded, duplicate and relic details and resolved contradictions in favor of Will's words, then accepted VIPs, then later details. Principles are numbered as in [the introduction's Details](../src/000-intro.md#details).

### Detail 16

(VIP-29) `schema error Timeout` with no braces is allowed, like VIP-13's `error Timeout`.

### Detail 42

(NW 33; VIP-29) A generated `schema error` constructor is `@throws {never}`, a static contract like `error` and `data` constructors. A validation failure at construction (Effect 4.1.0 throws a plain `Error`) is a defect, as any implicit throw inside `Effect.gen` is.
    ```vibe
    schema error Invalid { name: NonEmptyString }
    effect function f() { throw new Invalid({ name: "" }) }   // compiles; dies with Error at run time
    ```
    Effect TS: `Effect.gen(function* () { return yield* Effect.fail(new Invalid({ name: "" })) })`, where the constructor's throw is a defect. Decided by the agent from principle 1 (the same `Exit` as Effect TS) and VIP-29's `throw new E(…)` idiom, which tracking `Error` would break; 2026-10-29.

    **Generated-constructor implicit-throw clarification.** The existing `@throws {never}` contract for generated `error`, `data` and `schema error` constructors is static; it does not promise that every well-typed JavaScript argument completes construction. Preserve the respective native Effect counterpart, including observable property reads, enumeration/copy operations and construction metadata. A user getter, setter, proxy trap or native target-state failure reached implicitly by those operations remains an untracked implicit throw under VIP-4/details81/205. Preserve its original value and phase: an ordinary native call can throw it, ordinary JavaScript `catch` catches it, and construction inside `Effect.gen` produces a defect. Do not add validation, suppress the exception, wrap it as typed failure, or change copy/prototype/tag behavior merely to enforce a runtime reading of `never`. Explicit evaluation of constructor arguments retains its own ordinary call/throws rules before construction. The accepted schema-error validation-defect rule above remains unchanged.
    ```vibe
    error CopyError { value: number }
    const token = { failure: "copy" }
    const payload = { get value(): number { throw token } }
    effect function example() { return new CopyError(payload) } // construction dies with the original token
    ```
    Effect TS: `class CopyError extends Data.TaggedError("CopyError")<{ value: number }> {}` followed by `Effect.runSyncExit(Effect.gen(function* () { return new CopyError(payload) }))` has a `Die` carrying the original getter exception. `Data.taggedEnum` variant construction has the same implicit-throw classification, while retaining its own object-spread copy behavior rather than the tagged-error constructor's assignment protocol. These are not interchangeable lowering recipes.
    Decided by the agent from detail42's explicit static contract and validation-defect rule, accepted VIP-4's implicit-throw split, details81/205 and principle1 (the native Effect result), principle2 (JavaScript getters/proxies/catch), and principle4 (one implicit-throw rule rather than a constructor exception), 2026-10-30. The fixer's complete retained reference source, empty strict TypeScript5.9.3 diagnostic log, native Effect4.1.0 results and saved core/record/enum implementation excerpts were read, not rerun: the probes cover `Data.TaggedError` and `Data.taggedEnum`, not schema-error constructors or compiled VibeLang. The corrected three-read truthy-cause observation and its earlier exploratory failure stay attributed. Source correction remains with spec-fix-b; no new diagnostic, API, canonical number or Will question is introduced.
