# VIP-28: generic `data` unions

**Status:** accepted, 2026-10-29, under Will's standing approval of recommendations ("assume I accept now. I will interrupt you if I need to").

## Decision

```ts
data Outcome<A, E> { Ok { value: A }; Err { error: E } }

// exactly Effect TS's generic TaggedEnum pattern
type Outcome<A, E> = Data.TaggedEnum<{ Ok: { value: A }; Err: { error: E } }>
interface OutcomeDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: Outcome<this["A"], this["B"]>
}
const Outcome = Data.taggedEnum<OutcomeDefinition>()
```

- A `data` declaration (VIP-16) may have up to 4 type parameters, which is the limit of Effect's own `WithGenerics`. More is a compile error that names the limit.
- **Ambiguity: none.**
- **Amended 2026-10-29: a hygienic helper.** The generated generic-data helper (`XDefinition` in the example) gets a fresh name; it is not a reserved user-visible name. Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: no constraints.** A constraint on a generic `data` type parameter (`<A extends string>`) is a compile error, since this VIP doesn't add them (EK2126 keeps that part). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: no defaults.** A default on a generic `data` type parameter (`data Box<A = string>`) is a compile error, as a constraint is. Write the default on a separate `type` alias. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 63).

## History

Old VibeLang's four-parameter limit (D374) was the same limit. No findings.
