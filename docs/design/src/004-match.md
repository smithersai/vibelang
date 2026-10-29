# Pattern matching

Source: [VIP-7](../vips/0007-match.md).

## Syntax and meaning

```vibe es
// compiler-gap: pending VIP-7
effect function label(d: { _tag: "Sent"; tracking: string } | { _tag: "Waiting" }) {
  const tracking = "outer"
  return match (d) {
    when { _tag: "Sent", let tracking }: try Effect.succeed(tracking)
    default: tracking
  }
}
```

```ts effect
import { Effect } from "effect"

function label(d: { _tag: "Sent"; tracking: string } | { _tag: "Waiting" }) {
  return Effect.gen(function* () {
    const tracking = "outer"
    const subject = d
    if (subject._tag === "Sent" && "tracking" in subject) {
      const tracking = subject.tracking
      return yield* Effect.succeed(tracking)
    }
    return tracking
  })
}
```

`match`, `when`, `is`, patterns, guards, `and`, `or`, `not` and `default` follow the [vendored TC39 snapshot](../vips/tc39-pattern-matching/README.md): commit `ba73ffe42f30f0cf56ece28bebdc28f955f2a52e`, dated `2025-10-03`, with the reconciliations listed there. VibeLang moves to a newer snapshot deliberately, never automatically. The full proposal is in the language, including regular-expression patterns, relational patterns and `async match`.

`match` evaluates its subject once and tests arms in order. It introduces no function or Effect boundary: its ordered tests and selected arm stay in the enclosing activation, so an arm's `try` becomes `yield*` in the enclosing Effect generator, as above. Only the selected arm runs. `async match` explicitly produces a `Promise`, as the snapshot describes. When no arm matches and there is no `default`, it throws a `TypeError`; in effect code that is a defect, not a failure.

- In an object pattern, a bare key such as `{ tracking }` only tests that the property exists. Binding it takes `let tracking`, shorthand for `tracking: let tracking` (VIP-16). Replacing `let tracking` with `tracking` above would return `"outer"`, not the field.
- An arm's body may be `throw e`, as VIP-5's example writes it. In effect code it fails the Effect ([Failures](003-failures.md#throw)).

## Exhaustiveness

VibeLang adds one check to TC39's proposal.

| Rule | Diagnostic |
| --- | --- |
| a `match` with no `default` over a finite union that misses a case | code pending |

The check only reports errors. It never changes what runs: a `match` that passes the check compiles to the same tests as one that doesn't need it.

**Undecided (pending VIP):** which subject types count as a finite union for the check (literal unions, `data` unions, unions of `error` classes, `boolean`, enums), and how a case counts as covered when an arm has a guard.

## Class patterns

A class arm such as `when NotFound:` uses the class's `Symbol.customMatcher`, as TC39 says.

- An `error` class ([Failures](003-failures.md#error-declarations)), including a `schema error`, gets a matcher that tests `_tag`. It returns `[subject]` on a match and `false` otherwise; `when NotFound(let e):` binds that subject. Thus `when NotFound:` matches across copies of the same package. The TypeScript counterpart is in [Failures](003-failures.md#error-declarations).
- `data` variants get no custom matchers. Match them with object patterns on `_tag`: `when { _tag: "Sent", let tracking }: …` ([Data](006-data.md#data-declarations)).
- **No run-time patching of Effect.** Until Effect ships custom matchers for `Option`, `Exit`, `Result` and its tagged errors, the compiler tests those types with fixed checks: `when Option.Some(let v):` compiles to a test of the value's tag and binds its `value` field to `v`. VibeLang proposes the matchers upstream.
- Where an engine lacks `Symbol.customMatcher`, a small runtime shim defines it ([Runtime guarantees](008-runtime.md)).
