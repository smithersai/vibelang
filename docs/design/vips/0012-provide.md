# VIP-12: `provide` blocks

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
// VibeLang
provide AppLive, Users = testUsers {
  try a()
  try b()
}

// exactly this Effect TS
yield* Effect.provide(
  Effect.gen(function* () { yield* a(); yield* b() }),
  [AppLive, Layer.succeed(Users, testUsers)]
)
```

- `provide providers { … }` is exact sugar for `Effect.provide`. It is a statement that runs where it stands, like `do { }`, and every Effect inside it is still run with `try`.
- A provider is a Layer, or `Key = value`, which means `Layer.succeed(Key, value)`. Effect's own `provide` types everything, so VibeLang adds no typing rules of its own.
- **Ambiguity: none.** `provide` is a contextual keyword, and its providers and block must be on one line, as with `async`. Trailing blocks don't exist (VIP-11), so `provide(x) { … }` can't be read as a call.
- **Amended 2026-10-29: these are ordinary blocks.** `return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block. (`for concurrent` and `for try` keep their own rule, because their bodies run once per item.) Recorded under Will's standing approval of recommendations.
- Under VIP-6's rule, a keyword removes the global of the same name, so Effect's function is written `Effect.provide`.

## History

A union of providers was mistyped in round 1 (local, fixed). Nothing since.

## Prior art

Effect's `Effect.provide`; Kotlin's `withContext(ctx) { … }`.

## Will's words

> "I really like this syntax"

> "Ok so with that I'm pretty sure all the issues for service and provide go away in which case I accept the proposal"

*Corrected 2026-10-29: the example names a declared service (`Users`), so it runs.*
