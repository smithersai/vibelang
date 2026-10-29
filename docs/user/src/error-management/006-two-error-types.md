# Two Types of Errors

A missing record and a broken invariant need different responses: VibeLang tracks recoverable domain failures in `Effect<A, E, R>`, and defects in the runtime's failure cause.

[Upstream page](https://effect.website/docs/v4/error-management/two-error-types)

## Separating failures from defects

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-13, VIP-14
// run: try Console.log(try displayPrice("notebook")); try Console.log(try displayPrice("pen"))
error UnknownProduct {
  sku: string
}

effect function price(sku: string) {
  if (sku !== "notebook") throw new UnknownProduct({ sku })
  return 12
}
// number!UnknownProduct!

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

`throw` in an effect function declares an expected failure. A catch expression recovers it, and the caught value's type is inferred from the Effect it runs. A defect, such as an invalid property access or `die(new Error("broken invariant"))`, bypasses `catch`.

Expected failures also come from a callee's `E` and from synchronous exceptions wrapped with `Effect.try`. When a cause holds several expected failures and nothing else, `catch` receives the first and handles the whole cause; `catchCause` inspects every reason.

Interruption, a third kind of termination, bypasses `catch` when the cause has no expected failure. Defects and interruption still run `ensuring` cleanup and release scoped resources. A cause that mixes a failure with a defect passes through ordinary `catch` whole.

## Choosing the error type

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try percentage(1, 4)); try Console.log(try matchCause(percentage(1, 0), { onFailure: (cause) => Cause.hasDies(cause), onSuccess: () => false }))
effect function percentage(part: number, total: number) {
  if (total <= 0) {
    try die(new Error("validated total must be positive"))
  }
  return part / total * 100
}
// number!!
```

```output
25
true
```

Use this contract only when validation already established the invariant; if users can submit an invalid total, throw a typed error. Put a failure in `E` when callers have a useful response, such as asking for corrected input or choosing another source.

`E = never` promises that no expected failure escapes, not that bugs or cancellation can't occur. A boundary that must examine those uses `exit`, `catchDefect`, or `catchCause`.

Precisely, `E` describes every expected failure a cause holds: a defect turns the expected failures beside it into defects, and catch recovers a failure beside an interruption.

## Coming from Effect

- Write `throw error` in an effect function where a generator would yield a failure.
- Use a catch expression for domain recovery and `ensuring` or `onExit` for cleanup.