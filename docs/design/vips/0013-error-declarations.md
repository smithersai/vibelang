# VIP-13: `error` declarations

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// VibeLang
error NotFound { id: string }
error Timeout                                   // an error with no fields

// exactly this Effect TS
class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}
class Timeout extends Data.TaggedError("Timeout") {}

// using one (VIP-4, VIP-5, VIP-7)
throw new NotFound({ id })                      // in an effect function: fails with NotFound
fetchUser(id) catch (e) => match (e) { when NotFound: guest; }
```

- `error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly.
- The body may hold methods and getters, as any class can, for example `get message() { return \`no user ${this.id}\` }`. It may not hold a constructor or a `_tag` override.
- **Amended 2026-10-29: no `extends`.** An `error` declaration always extends `Data.TaggedError`, so `error UserNotFound extends NotFound { … }` is a compile error. Errors are grouped with a union, as in `type LookupError = NotFound | Timeout`, because tagged errors are matched by `_tag` and a subclass would match two tags. Recorded under Will's standing approval of recommendations.
- The base is `Data.TaggedError`, which can't be decoded from JSON. Serializable, Schema-based errors are left to the `schema` VIP.
- Two packages that both declare `error NotFound` match each other, as with Effect's `catchTag`, because VIP-7's matcher tests `_tag`.
- **Ambiguity: none.** `error` is a contextual keyword on the same line as its name, so `const error = …` and `catch (error)` still work.
- **Amended 2026-10-29: no user-written `static` members or setters** in `error` or `schema error` bodies, for now. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: no type parameters.** `error Invalid<T> { value: T }` is a compile error, for now. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: exactly VIP-13.** `error` declarations allow no `extends` and no `_tag` override; EK2117 enforces it. Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.

*Corrected 2026-10-29: the example ends every `match` arm with `;`, the last one included, as the pinned TC39 grammar requires; a newline is not a separator (found by the round-3 review).*

## History

Every finding was about error classes combined with `match` exhaustiveness: round 2 M7 and round 8 M1 (majors), plus five minors, all lego-kind. VIP-7's custom matcher, which tests `_tag`, settles them. The declaration syntax itself drew no findings.

## Prior art

Zig's `error{NotFound}`, Swift's `enum: Error`, Rust's `thiserror`, Effect's `Data.TaggedError`.

## Will's words

> "Ok accept. Your best judgement on the questions is correct"

(The questions: the base, Data rather than Schema; and the body, methods and getters but no constructor or `_tag` override.)
