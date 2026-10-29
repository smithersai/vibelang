# VIP-20: iterating a Stream with `for try`

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
for try (const row of rows) {
  if (row.skip) continue
  if (row.last) break
  try save(row)
}

// exactly this Effect TS
yield* Stream.runForEachWhile(rows, (row) => Effect.gen(function* () {
  if (row.skip) return true
  if (row.last) return false
  yield* save(row); return true
}))
```

- `for try (const x of stream)` consumes a Stream inside an `effect` function or block, pulling one element at a time, in order. It mirrors `for await` over AsyncIterables, which keeps its JavaScript meaning (VIP-5).
- `continue` skips one element, and `break` stops consuming. `return` from the enclosing function is a compile error. A failure in the body fails the loop.
- **Ambiguity: none.** `try` is a reserved word, and JavaScript's `for` can only be followed by `(` or `await`.

## History

About 9 findings, mostly about producers, which have their own VIP. The round-11 major, where a type decided whether `for…of` consumed a Stream, doesn't apply: `for try` is syntax.

## Prior art

JavaScript's `for await`; Kotlin's `flow.collect { }`; Rust's `while let Some(x) = s.next().await`.

## Will's words

> "good recomendation"
