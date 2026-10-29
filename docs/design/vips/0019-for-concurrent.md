# VIP-19: `for concurrent`

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
for concurrent (const id of ids) { try sync(id) }    // every item in its own fiber, all at once
for concurrent(4) (const id of ids) { … }            // at most 4 at a time

// exactly this Effect TS
yield* Effect.forEach(ids, (id) => Effect.gen(function* () { yield* sync(id) }),
                      { concurrency: "unbounded", discard: true })   // or concurrency: 4
```

- All items join before the loop ends, and one failure interrupts the rest. It is a statement inside an `effect` function or block.
- `continue` ends that one item. `break` and `return` are compile errors, because no loop runs on the body's fiber.
- Results are discarded; `try.all ids.map(…)` (VIP-18) keeps them.
- **Ambiguity: none.** JavaScript's `for` can only be followed by `(` or `await`.

## History

One finding, in round 5.

## Prior art

JavaScript's `for await (…)`, which puts a keyword between `for` and `(`; Rayon's `par_iter().for_each`.

## Will's words

> "recomendation is good"
