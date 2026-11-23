# Two Types of Errors

Not all failures are created equal.

A user typing an unknown SKU is **expected** — your UI should show `"No price for pen"`. A broken invariant like dividing by a pre-validated zero is a **bug** — no caller can meaningfully recover from it, and polluting every function signature in your codebase with `| DivisionByZeroBug` would bury real domain errors under noise.

VibeLang separates these into two distinct tracks, plus a third for cancellation:

![Expected failures travel in E and reach catch; defects and interruption bypass catch while still running cleanup](/diagrams/two-error-rails.svg)

## Expected failures (`E`) vs. defects (`die`)

In an `effect` function, `throw` puts a failure onto the **Expected (`E`)** track. Callers see it in the type signature and recover it with `catch`:

```vibe
// run: try Console.log(try displayPrice("notebook")); try Console.log(try displayPrice("pen"))
error UnknownProduct {
  sku: string
}

effect function price(sku: string) {
  if (sku !== "notebook") throw new UnknownProduct({ sku })
  return 12
}
// Inferred: number!UnknownProduct

effect function displayPrice(sku: string) {
  return effect {
    return `$${try price(sku)}`
  } catch (error) => `No price for ${error.sku}`
}
```

```output
$12
No price for pen
```

Now contrast that with a **defect** — an unexpected crash created with `try die(...)` (or caused by a JavaScript runtime error like reading a property of `undefined`):

```vibe
// run: try Console.log(try percentage(1, 4)); try Console.log(try matchCause(percentage(1, 0), { onFailure: (cause) => Cause.hasDies(cause), onSuccess: () => false }))
effect function percentage(part: number, total: number) {
  if (total <= 0) {
    try die(new Error("validated total must be positive"))
  }
  return part / total * 100
}
// Inferred: number!!   (E is never — defects do not enter E)
```

```output
25
true
```

Notice `percentage`'s inferred type is `number!!` (`E = never`):

- **`catch` never catches a defect.** Ordinary error handlers stay focused on business failures instead of accidentally swallowing `TypeError`s or broken invariants.
- **Cleanup still runs.** Both defects and interruption always execute `ensuring`, `onExit`, and `scoped` resource finalizers before terminating the fiber.
- **Boundaries can still inspect everything.** A top-level supervisor or HTTP error middleware uses `exit`, `catchDefect`, or `catchCause` to log defects and return HTTP 500.

## How to choose

Ask one question: **can the caller do something useful if this fails?**

| Situation | Track | How to signal it |
| --- | --- | --- |
| Missing user, invalid form input, rate limit, network timeout | **Expected (`E`)** | `throw new MyError({ ... })` |
| Violated precondition, impossible `default` branch, corrupt internal state | **Defect** | `try die(new Error("..."))` or `try orDie(program)` |
| Parent fiber timed out, race lost, user cancelled request | **Interruption** | `Fiber.interrupt(fiber)` or `try interrupt` |

> **Wait — what if a cause has *both* an expected failure and a defect (for example in parallel work)?**
> Defects win: a cause containing a defect bypasses ordinary `catch`, with its sibling expected failures preserved inside the `Cause`. A cause with an expected failure beside an interruption is still recovered by `catch`, and when several expected failures occur together with no defect, `catch` receives the first and handles the whole cause. Use `catchCause` when you need to inspect every reason in a composite `Cause`.

## Coming from Effect

- `throw new UnknownProduct({ sku })` inside an `effect` function compiles to `Effect.fail(...)`.
- `x catch (err) => ...` recovers expected failures only, just like `Effect.catch`.
- Use `ensuring` or `onExit` for guaranteed cleanup across all three outcomes.

**Next:** [Basic Concurrency](../concurrency/007-basic-concurrency.md) — run work in parallel, bound concurrency, and cancel losers cleanly.
