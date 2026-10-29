# Pattern matching

Source: [VIP-7](../vips/0007-match.md).

## Syntax and meaning

`match`, `when`, `is`, patterns, guards, `and`, `or`, `not` and `default` are exactly the [TC39 pattern-matching proposal](https://github.com/tc39/proposal-pattern-matching), pinned to a dated snapshot. VibeLang moves to a newer snapshot deliberately, never automatically. The full proposal is in the language, including regular-expression patterns, relational patterns and `async match`. A copy of the proposal is kept with the VIPs (`docs/design/vips/tc39-pattern-matching/`).

`match` is plain JavaScript, not an Effect. Its arms are tested in order and its subject is evaluated once. It compiles to ordered tests on the subject, with no Effect involved.

```vibe es
// compiler-gap: pending VIP-7
effect recover(e: NotFound | DbError, retryable: boolean) {
  return match (e) {
    when NotFound: guest                     // NotFound's Symbol.customMatcher decides
    when DbError and if (retryable): try retry(load(), policy)
    default: fallback
  }
}
```

**Undecided (pending VIP):** the date of the TC39 pattern-matching snapshot VibeLang pins.

## Exhaustiveness

VibeLang adds one check to TC39's proposal.

| Rule | Diagnostic |
| --- | --- |
| a `match` with no `default` over a finite union that misses a case | code pending |

The check only reports errors. It never changes what runs: a `match` that passes the check compiles to the same tests as one that doesn't need it.

**Undecided (pending VIP):** which subject types count as a finite union for the check (literal unions, `data` unions, unions of `error` classes, `boolean`, enums), and how a case counts as covered when an arm has a guard.

## Class patterns

A class arm such as `when NotFound:` uses the class's `Symbol.customMatcher`, as TC39 says.

- An `error` class ([Failures](003-failures.md#error-declarations)) gets a matcher that tests `_tag`. So `when NotFound:` matches a `NotFound` from another copy of the same package.
- `data` variants get no custom matchers. Match them with object patterns on `_tag`: `when { _tag: "Sent", tracking }: …` ([Data](006-data.md#data-declarations)).
- **No run-time patching of Effect.** Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler tests those types with fixed checks: `when Option.Some(let v):` compiles to a test of the value's tag. VibeLang proposes the matchers upstream.
- Where an engine lacks `Symbol.customMatcher`, a small runtime shim defines it ([Runtime guarantees](008-runtime.md)).
