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
- **Amended 2026-10-29: bindings and operands.** The head takes every `ForBinding` that `for…of` takes (`const`, `let`, destructuring), minus `var`. The operand is a `Stream` only; an AsyncIterable is a compile error that points to `Stream.fromAsyncIterable`. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 48).
- **Amended 2026-10-29: no labeled jump out.** A labeled `break` or `continue` from a `for try` body to a statement outside it is a compile error, as `for concurrent` already rules. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 49).
- **Amended 2026-10-30: source head scope and item checks.** Evaluate the operand in ECMAScript's separate lexical environment with uninitialized head bindings. RHS closures retain those TDZ cells; each item receives fresh initialized bindings and the body keeps its own block. Apply the loop's outward-jump restrictions to head binding initialization and body, including defaults and computed keys, while nested source functions keep their own targets. The RHS retains the enclosing activation's permitted outward completions. Preserve the native per-element true/false protocol after the item completes; see [Running Effects](../src/002-running.md#for-try).

## History

About 9 findings, mostly about producers, which have their own VIP. The round-11 major, where a type decided whether `for…of` consumed a Stream, doesn't apply: `for try` is syntax.

## Prior art

JavaScript's `for await`; Kotlin's `flow.collect { }`; Rust's `while let Some(x) = s.next().await`.

## Will's words

> "good recomendation"
