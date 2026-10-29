# Sandboxing

Sandboxing puts the complete runtime failure cause in the typed error channel, for an inspection pipeline that must treat defects, interruption, and expected failures as explicit error data.

[Upstream page](https://effect.website/docs/v4/error-management/sandboxing)

## Moving causes into the error channel

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log((try flip(readRow())).line); try Console.log(JSON.stringify((try flip(sandboxedRow())).reasons.map((reason) => reason._tag)))
error InvalidRow {
  line: number
}

effect function readRow() {
  throw new InvalidRow({ line: 8 })
}

effect function sandboxedRow() {
  return try sandbox(readRow())
}
// never!Cause.Cause<InvalidRow>!
```

```output
8
["Fail"]
```

`Cause` is in scope in `.vibe` files. `sandbox` changes `A!E!R` into `A!Cause.Cause<E>!R`: a defect in the original computation becomes a `Die` reason inside a typed cause value, not a defect at the outer level.

## Inspecting individual reasons

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(JSON.stringify(try rowFailureKinds()))
effect function rowFailureKinds() {
  return sandboxedRow() catch (cause) => cause.reasons.map((reason) => {
    if (Cause.isFailReason(reason)) return `row ${reason.error.line}`
    if (Cause.isDieReason(reason)) return "defect"
    return "interruption"
  })
}
```

```output
["row 8"]
```

Effect 4 stores reasons in a flat readonly array; one outcome can hold several, so inspect them all. `Cause.isFailReason` exposes `error`, `Cause.isDieReason` exposes `defect`, and `Cause.isInterruptReason` identifies cancellation.

## Recovering selected variants

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try rowOrPlaceholder())
effect function rowOrPlaceholder() {
  return try Effect.catch(sandboxedRow(), effect (cause) => {
    if (!Cause.hasDies(cause) && !Cause.hasInterrupts(cause)) {
      return "Malformed row omitted"
    }
    return try failCause(cause)
  })
}
```

```output
Malformed row omitted
```

This boundary recovers only causes made entirely of domain failures; checking only for a `Fail` reason would also consume a mixed cause's defects or interruption. Sandboxing makes that decision explicit; you still need a recovery policy.

## Restoring causes after inspection

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log((try flip(readWithInspection())).line)
effect function readWithInspection() {
  return try Effect.catch(sandboxedRow(), effect (cause) => {
    try Console.log("Row computation stopped", JSON.stringify(cause.reasons.map((reason) => reason._tag)))
    return try failCause(cause)
  })
}
// never!InvalidRow!
```

```output
Row computation stopped ["Fail"]
8
```

`failCause(cause)` restores the original failure model, with every expected failure, defect, and interruption in the cause; `fail(cause)` instead keeps the cause as typed error data, which is why `throw cause` is EK2140. For a single inspection or recovery step, `catchCause(readRow(), handler)` avoids changing the error channel first.
