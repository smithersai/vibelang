# LIP-2: `effect { }` blocks, and `do { }` as TC39 defines it

> Historical copy. The current decision is [VIP-2](../../vips/0002-effect-blocks-and-do.md).

**Status:** accepted 2026-10-28.

## Decision

```ts
const p = effect { console.log("hi"); return 1 }   // an Effect, not yet run
await p                                            // prints "hi", gives 1
await p                                            // prints "hi" again: each run reruns the block

await retry(effect { await save(await fetchUser(id)) }, policy)
await.race [effect { … }, effect { … }]
Layer.effect(Users, effect { … })

const x = do { const a = 1; a + 1 }                // TC39 do expression: runs now, x = 2
```

- `effect { … }` is an expression. It builds an Effect from the block without running it, and each time the Effect runs, the block runs again.
  - It is Effect TS's `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.
  - Inside it, `await` runs Effects, as in an `effect` function (LIP-1).
- `effect` before a function makes a function that returns an Effect (LIP-1). `effect` before a block makes the Effect itself.
- `do { … }` is exactly TC39's do expression, everywhere, with no exceptions. It runs now and gives its last statement's value, like an IIFE. As TC39 specifies, `await` inside `do` belongs to the enclosing function.
- No other syntax builds a program. A function literal never turns into a program because the parameter it's passed to expects an Effect.

## Prior art

- Rust: `async fn` is a function, and `async { }` is the value.
- F#'s `async { }`, Kotlin's `suspend { }`, TC39's `async do { }` proposal.
- Effect's `Effect.gen`.
- TC39 do expressions (stage 1).

## Original proposal

> "No no exceptions do should just be shorthand for an iiffe and have exact same spec as tc39 proposal"

> "Ok I approve this one"

## Supersedes

- D322's exception, under which a `do { }` element of an await operation became a program.
- D551's conversion of a function literal at an `Effect` parameter. This follows from LIP-1's "syntax decides".
- The function-literal conversion of D480 and D188's block-after-call program form, where the parameter's type decided.
