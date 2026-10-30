# VIP-22: interruption blocks: `uninterruptible`, `restore`, `interruptible`

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
uninterruptible {
  try charge(card)
  restore { try notify(user) }          // interruptible again inside
  try record(receipt)
}
interruptible { try poll() }

// exactly this Effect TS
yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
  yield* charge(card)
  yield* restore(Effect.gen(function* () { yield* notify(user) }))
  yield* record(receipt)
}))
yield* Effect.interruptible(Effect.gen(function* () { yield* poll() }))
```

- These are statements inside an `effect` function or block, like `provide` (VIP-12). Each is exact sugar for Effect's function.
- `restore { … }` is allowed only inside an `uninterruptible` block; anywhere else it is a compile error.
- **Amended 2026-10-29: these are ordinary blocks.** `return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block. (`for concurrent` and `for try` keep their own rule, because their bodies run once per item.) Recorded under Will's standing approval of recommendations.
- **Amended 2026-10-29: `restore` is lexical.** A `restore` inside an `effect` arrow or `effect` block nested in an `uninterruptible` block is a compile error: the nested Effect can run after the mask ends. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 51).
- Under VIP-6, the keywords remove the globals of the same name, so Effect's functions are written `Effect.uninterruptible` and `Effect.interruptible`.
- **Ambiguity: none.** These are contextual keywords followed by `{` on the same line.

## History

About 20 findings, all about masking during `using` acquisitions. VIP-8 removed `using`'s Effect rules, so none apply.

## Prior art

Haskell's `mask $ \restore -> …`, Cats Effect's `uncancelable { poll => }`, ZIO's `uninterruptibleMask`, Kotlin's `withContext(NonCancellable) { }`.

## Will's words

> "ok we are on a streak of me accepting your recomendation. Keep showing them to me 1 at a time but assume I accept now. I will interrupt you if I need to"
