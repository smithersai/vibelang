# Error Channel Operations

Error-channel combinators transform, reject, observe, or reify failures on an Effect value without rewriting the surrounding control flow. Reach for them in combinator pipelines; use `if`/`throw` and `catch` expressions for multi-statement local logic.

[Upstream page](https://effect.website/docs/v4/error-management/error-channel-operations)

| Goal | Combinators | Changes outcome? |
| --- | --- | --- |
| Transform channel values | `mapError`, `mapBoth` | Maps `E` (and `A`) synchronously; failures stay failures |
| Reject a success | `filterOrFail`, `filterOrElse` | Fails or runs fallback when predicate is false |
| Observe without handling | `tapError`, `tapErrorTag`, `tapCause`, `tapDefect` | Preserves original outcome if observer succeeds |
| Reify failure into `A` | `result`, `exit` | Moves typed `E` (`Result`) or full `Cause` (`Exit`) into `A` |
| Swap `A` and `E` | `flip` | Exchanges success and typed error channels |

## Mapping failures or both outcomes

```vibe
// run: try Console.log(try publicQuantity(2)); try Console.log(try flip(publicQuantity(0))); try Console.log(try quantityMessage(2)); try Console.log(try flip(quantityMessage(0)))
error InvalidQuantity {
  value: number
}

effect function quantity(value: number) {
  if (value < 1) throw new InvalidQuantity({ value })
  return value
}

effect function publicQuantity(value: number) {
  return try mapError(
    quantity(value),
    (error) => `Quantity must be positive: ${error.value}`
  )
}
// number!string

effect function quantityMessage(value: number) {
  return try mapBoth(quantity(value), {
    onFailure: (error) => `Rejected quantity ${error.value}`,
    onSuccess: (count) => `${count} units`
  })
}
// string!string
```

```output
2
Quantity must be positive: 0
2 units
Rejected quantity 0
```

`mapError` transforms `E` while leaving successes intact; `mapBoth` transforms both channels while keeping failures in `E`. Both callbacks are synchronous plain functions—use a `catch` expression with an `effect` handler when transformation itself needs Effects.

`mapError` transforms every expected failure in place while preserving defects and interruption; a cause that already carries a defect has no expected failure left to map. By contrast, a `catch` expression recovers only the first expected failure of a defect-free cause and handles the entire cause. `mapErrorEager` and `mapBothEager` are eager optimizations with the same semantics, not effectful variants.

## Rejecting successes with a predicate

```vibe
// run: try Console.log(try boundedQuantity(20)); try Console.log(try flip(boundedQuantity(21))); try Console.log(try cappedQuantity(21)); try Console.log((try flip(cappedQuantity(0)))._tag)
effect function boundedQuantity(value: number) {
  return try filterOrFail(
    quantity(value),
    (count) => count <= 20,
    (count) => `Maximum is 20; received ${count}`
  )
}

effect function cappedQuantity(value: number) {
  return try filterOrElse(
    quantity(value),
    (count) => count <= 20,
    () => succeed(20)
  )
}
```

```output
20
Maximum is 20; received 21
20
InvalidQuantity
```

`filterOrFail` keeps successes that satisfy the predicate and fails with the supplied error otherwise; a type-guard predicate narrows the success type. `filterOrElse` runs a replacement Effect on rejected successes, so the fallback may use services or fail.

In statement style, write an `if` followed by `throw`. Neither form alters failures already produced by the source Effect.

## Observing errors, tags, causes, and defects

```vibe
// run: try Console.log(try observeQuantity(2)); try Console.log((try flip(observeQuantity(0)))._tag); try Console.log(try matchCause(observeDefect(), { onFailure: (cause) => Cause.hasDies(cause), onSuccess: () => false }))
effect function observeQuantity(value: number) {
  const logged = tapError(quantity(value), (error) => Console.log(`Rejected quantity ${error.value}`))
  const tagged = tapErrorTag(logged, "InvalidQuantity", () => Console.log("Quantity validation failed"))
  return try tapCause(tagged, effect (cause) =>
    try Console.log("Failure kinds", try Effect.try(() => JSON.stringify(cause.reasons.map((reason) => reason._tag)))))
}

effect function observeDefect() {
  return try tapDefect(
    die(new Error("inventory invariant")),
    () => Console.log("Inventory defect recorded")
  )
}
```

```output
2
Rejected quantity 0
Quantity validation failed
Failure kinds ["Fail"]
InvalidQuantity
Inventory defect recorded
true
```

`tapError` observes typed failures, `tapErrorTag` narrows to a single `_tag`, `tapCause` inspects the entire cause (including interruption and combined reasons), and `tapDefect` observes defects. When the observer succeeds, the original outcome propagates untouched.

A failing observer alters the resulting cause, so keep observation callbacks infallible whenever preserving the original failure matters, and log structured diagnostic fields rather than customer payloads or credentials. For local observation of typed errors, a `catch` expression can also log and rethrow.

## Exposing failures as successes

```vibe
// run: { const jsonValue = try inspectQuantity(2); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = try inspectQuantity(0); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(try quantityOrErrorValue(2)); const value = try quantityOrErrorValue(0); try Console.log(typeof value === "number" ? value : value._tag)
effect function inspectQuantity(value: number) {
  const outcome = try result(quantity(value))
  const summary = Result.match(outcome, {
    onFailure: () => "Rejected",
    onSuccess: (count) => `Accepted ${count}`
  })
  const completed = try exit(quantity(value))
  return { summary, completed: Exit.isSuccess(completed) }
}

effect function quantityOrErrorValue(value: number) {
  return quantity(value) catch effect (error) => error
}
// (number | InvalidQuantity)!!
```

```output
{"summary":"Accepted 2","completed":true}
{"summary":"Rejected","completed":false}
2
InvalidQuantity
```

`result` wraps typed failures and successes into a `Result`, leaving defects and interruption in the failure channel; `exit` captures the complete `Exit` including its full `Cause`. Returning the error directly from `catch` merges both types into a single success union without resolving the domain failure itself.

## Swapping channels

```vibe
// run: try Console.log((try rejectedQuantity())._tag)
effect function rejectedQuantity() {
  return try flip(quantity(0))
}
// InvalidQuantity!number
```

```output
InvalidQuantity
```

`flip` exchanges the success and typed error channels. Causes without an expected failure still propagate, causes with a defect promote their failures to defects, and an expected failure beside an interruption succeeds while dropping the interruption. Reach for `flip` when asserting on errors in tests; use `mapError` or `catch` for production error transforms.
