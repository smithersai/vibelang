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

## History

Old VibeLang's four-parameter limit (D374) was the same limit. No findings.
