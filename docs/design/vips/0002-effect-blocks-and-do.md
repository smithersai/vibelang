# VIP-2: `effect { }` blocks, and `do { }` as TC39 defines it

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
const p = effect { console.log("hi"); return 1 }   // an Effect, not yet run
try p                                              // prints "hi", gives 1
try p                                              // prints "hi" again: each run reruns the block

try retry(effect { try save(try fetchUser(id)) }, policy)
Layer.effect(Users, effect { … })

const x = do { const a = 1; a + 1 }                // TC39 do expression: runs now, x = 2
```

- `effect { … }` is an expression. It builds an Effect from the block without running it, and each time the Effect runs, the block runs again.
  - It is Effect TS's `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.
  - Inside it, `try` runs Effects, as in an `effect` function (VIP-5).
- `effect` before a function makes a function that returns an Effect (VIP-1). `effect` before a block makes the Effect itself.
- `do { … }` is exactly TC39's do expression, pinned to a dated snapshot of the proposal (moved deliberately, as VIP-7 does for `match`), everywhere, with no exceptions. It runs now and gives its last statement's value, like an IIFE. As TC39 specifies, `await` inside `do` belongs to the enclosing function, and so does `try`.
- No other syntax builds a program. A function literal never turns into a program because the parameter it's passed to expects an Effect.
- **Amended 2026-10-29: `do` follows TC39 exactly.** VibeLang adds no limits on `var`, `break` or `continue` inside a `do` block (the old EK1019 is deleted). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: the pinned snapshot.** `do` is pinned to `tc39/proposal-do-expressions` commit `3ef6d463b8163cbf222846b40d17178cca36e9e1`, the head on 2026-10-28 (UTC), vendored in [`tc39-do-expressions/`](tc39-do-expressions/README.md), as pattern matching is pinned. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 52).

## Prior art

- Rust: `async fn` is a function, and `async { }` is the value.
- F#'s `async { }`, Kotlin's `suspend { }`, TC39's `async do { }` proposal.
- Effect's `Effect.gen`.
- TC39 do expressions (stage 1).

## Will's words

> "No no exceptions do should just be shorthand for an iiffe and have exact same spec as tc39 proposal"

> "Ok I approve this one"

*Updated by VIP-5 (2026-10-28): examples use `try` to run Effects. Updated by VIP-7: the proposal is pinned to a dated snapshot.*

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


- D322's exception, under which a `do { }` element of an await operation became a program.
- D551's conversion of a function literal at an `Effect` parameter. This follows from VIP-1's "syntax decides".
- The function-literal conversion of D480, where the parameter's type decided.
