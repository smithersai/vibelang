# Error Channel Operations

Error-channel operations transform, observe, or expose failures without immediately replacing the whole computation. Ordinary statements still suit local validation and selective recovery.

[Upstream page](https://effect.website/docs/v4/error-management/error-channel-operations)

## Mapping failures or both outcomes

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try publicQuantity(2)); try Console.log(try flip(publicQuantity(0))); try Console.log(try quantityMessage(2)); try Console.log(try flip(quantityMessage(0)))
error InvalidQuantity {
  value: number
}

effect quantity(value: number) {
  if (value < 1) throw new InvalidQuantity({ value })
  return value
}

effect publicQuantity(value: number) {
  return try mapError(
    quantity(value),
    (error) => `Quantity must be positive: ${error.value}`
  )
}
// number!string!

effect quantityMessage(value: number) {
  return try mapBoth(quantity(value), {
    onFailure: (error) => `Rejected quantity ${error.value}`,
    onSuccess: (count) => `${count} units`
  })
}
// string!string!
```

```output
2
Quantity must be positive: 0
2 units
Rejected quantity 0
```

`mapError` changes `E` and preserves successes. `mapBoth` maps each outcome channel separately; failures stay failures. The callbacks are plain synchronous functions, which can't perform Effect operations; for a transformation that needs Effect operations, use a catch expression with an effect handler or an effectful operator.

These combinators keep Effect's own policy: `mapError` maps every expected failure in place and keeps defects and interruption. A cause with a defect has no expected failure left to map. A catch expression recovers the first expected failure of a cause with no defect and handles the whole cause.

`mapErrorEager` and `mapBothEager` are eager optimization variants with the same channel distinction, not substitutes for effectful callbacks.

## Rejecting successes with a predicate

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try boundedQuantity(20)); try Console.log(try flip(boundedQuantity(21))); try Console.log(try cappedQuantity(21)); try Console.log((try flip(cappedQuantity(0)))._tag)
effect boundedQuantity(value: number) {
  return try filterOrFail(
    quantity(value),
    (count) => count <= 20,
    (count) => `Maximum is 20; received ${count}`
  )
}

effect cappedQuantity(value: number) {
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

`filterOrFail` keeps a success that passes the predicate and otherwise adds the generated error to `E`; a type guard can narrow the success type. `filterOrElse` runs a replacement Effect on a rejected success, so that branch can use services or fail.

The statement form is an `if` followed by `throw`. Neither form changes the source's existing failures.

## Observing errors, tags, causes, and defects

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try observeQuantity(2)); try Console.log((try flip(observeQuantity(0)))._tag); try Console.log(try matchCause(observeDefect(), { onFailure: (cause) => Cause.hasDies(cause), onSuccess: () => false }))
effect observeQuantity(value: number) {
  const logged = tapError(quantity(value), (error) => Console.log(`Rejected quantity ${error.value}`))
  const tagged = tapErrorTag(logged, "InvalidQuantity", () => Console.log("Quantity validation failed"))
  return try tapCause(tagged, (cause) =>
    Console.log("Failure kinds", JSON.stringify(cause.reasons.map((reason) => reason._tag))))
}

effect observeDefect() {
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

`tapError` observes typed errors; `tapErrorTag` selects a tagged member without handling it; `tapCause` sees the full cause, interruption and combined reasons included; `tapDefect` observes defect values. After a successful observation, the original outcome propagates.

A failing observation can change the resulting cause, so observe with code that can't fail when preserving the original outcome matters. Log diagnostic fields, not entire customer values or credentials. For local typed error observation, a catch expression with an effect handler can log and rethrow.

## Exposing failures as successes

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try inspectQuantity(2))); try Console.log(JSON.stringify(try inspectQuantity(0))); try Console.log(try quantityOrErrorValue(2)); const value = try quantityOrErrorValue(0); try Console.log(typeof value === "number" ? value : value._tag)
effect inspectQuantity(value: number) {
  const outcome = try result(quantity(value))
  const summary = Result.match(outcome, {
    onFailure: () => "Rejected",
    onSuccess: (count) => `Accepted ${count}`
  })
  const completed = try exit(quantity(value))
  return { summary, completed: Exit.isSuccess(completed) }
}

effect quantityOrErrorValue(value: number) {
  return quantity(value) catch (error) => error
}
// (number | InvalidQuantity)!!
```

```output
{"summary":"Accepted 2","completed":true}
{"summary":"Rejected","completed":false}
2
InvalidQuantity
```

`result` exposes typed errors as `Result` data; `exit` captures the complete outcome with its cause. The last example puts the original number or error directly into one success union; removing `E` this way doesn't resolve the error at the application level.

## Swapping channels

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log((try rejectedQuantity())._tag)
effect rejectedQuantity() {
  return try flip(quantity(0))
}
// InvalidQuantity!number!
```

```output
InvalidQuantity
```

`flip` swaps typed errors and successful values. A cause without an expected failure still propagates, and so does one with a defect, its failures as defects; an expected failure beside an interruption becomes a success and loses the interruption. Use it to inspect an error in a focused test; `mapError` and catch expressions usually express production transformations more clearly.
