# VIP-29: serializable errors: `schema error`

**Status:** accepted, 2026-10-29, under Will's standing approval of recommendations ("assume I accept now. I will interrupt you if I need to").

## Decision

```ts
schema error NotFound { id: string }

// exactly Effect TS
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}
```

Crossing JSON uses Effect's Schema API (VIP-14), for example:

```ts
const json = try Schema.encodeEffect(NotFound)(err)
const back = try Schema.decodeUnknownEffect(NotFound)(json)
```

- `schema error Name { fields }` combines VIP-13 (`error`) and VIP-15 (field mapping). Fields are written as TypeScript types and mapped to Schemas, and the error can be decoded from JSON, so it crosses workers and RPC.
- The body rules are VIP-13's: methods and getters are allowed, and a constructor or a `_tag` override is not.
- **Ambiguity: none.** `schema error NotFound {` and the alias form `schema error = …` differ at the next token.
- **Amended 2026-10-29: no braces.** `schema error Timeout`, with no body, is allowed, like VIP-13's `error Timeout`. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: the constructor's thrown type.** A generated `schema error` constructor is `@throws {never}`, a static contract like `error` and `data` constructors. A validation failure at construction (effect 4.1.0 throws a plain `Error`) is a defect, as any implicit throw inside `Effect.gen` is. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 42).
