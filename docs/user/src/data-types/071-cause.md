# Cause

`Cause` is a lossless record of why an Effect failed, capturing typed errors, unexpected defects, and fiber interruptions together. Use it at logging, telemetry, or supervision boundaries where the typed error channel `E` alone omits defects or cancellation.

| Reason `_tag` | Constructor | Guard | Payload field |
| --- | --- | --- | --- |
| `"Fail"` | `Cause.fail(e)` | `Cause.isFailReason` | `.error` |
| `"Die"` | `Cause.die(d)` | `Cause.isDieReason` | `.defect` |
| `"Interrupt"` | `Cause.interrupt(fiberId?)` | `Cause.isInterruptReason` | `.fiberId` |

## Representing failure reasons

```vibe
// run: try Console.log(expected.reasons[0]._tag, defect.reasons[0]._tag, interrupted.reasons[0]._tag, empty.reasons.length)
const expected = Cause.fail("record missing")
const defect = Cause.die(new Error("invariant broken"))
const interrupted = Cause.interrupt(17)
const empty = Cause.empty
empty.reasons.length // 0
```

```output
Fail Die Interrupt 0
```

`Cause.fail` wraps a typed error in `E`, `Cause.die` wraps an untyped defect, and `Cause.interrupt` records cancellation with an optional numeric fiber ID. `Cause.empty` has an empty `reasons` array rather than a separate `Empty` variant.

## Combining reasons

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(combined.reasons.map((reason) => reason._tag)))); try Console.log(Cause.combine(Cause.fail("same error"), Cause.fail("same error")).reasons.length)
const combined = Cause.combine(Cause.fail("export failed"), Cause.die(new Error("cleanup failed")))
combined.reasons.map((reason) => reason._tag) // ["Fail", "Die"]
Cause.combine(Cause.fail("same error"), Cause.fail("same error")).reasons.length // 1
```

```output
["Fail","Die"]
1
```

Effect 4 represents causes as a flat `reasons` array: `Cause.combine` merges both arrays and deduplicates equal reasons without building nested trees. When the runtime merges a typed failure with a defect (such as during cleanup or concurrent failure), the typed failure is promoted to a defect, so inspect mixed causes as a whole.

## Extracting a computation's cause

```vibe
// run: try Console.log((try diagnose()).split("\n")[0].trim())
error MissingRecord {
  id: string
}

effect function diagnose() {
  const outcome = try exit(effect {
    throw new MissingRecord({ id: "r-9" })
  })
  if (Exit.isFailure(outcome)) {
    return Cause.pretty(outcome.cause)
  }
  return "completed"
}
```

```output
MissingRecord:
```

`try exit(program)` executes `program` and returns its complete `Exit` as data, exposing `.cause` for failures including defects and interruptions that `catch` bypasses. Re-raise a captured cause with `try failCause(cause)` (whereas `throw cause` fails with the `Cause` object itself as a typed error), or dispatch with `match` over `Exit.Success(let value)` and `Exit.Failure(let cause)`.

## Identifying reason variants

```vibe
// run: { const jsonValue = try classify(Cause.combine(Cause.combine(Cause.fail("missing"), Cause.die("broken")), Cause.interrupt(17))); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = try classify(Cause.empty); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function classify<E>(cause: Cause.Cause<E>) {
  const summary = {
    failed: Cause.hasFails(cause),
    defective: Cause.hasDies(cause),
    interrupted: Cause.hasInterrupts(cause),
    interruptionOnly: Cause.hasInterruptsOnly(cause)
  }
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) try Console.log("expected failure")
    else if (Cause.isDieReason(reason)) try Console.log("defect")
    else if (Cause.isInterruptReason(reason)) {
      try Console.log(`interruption: ${reason.fiberId}`)
    }
  }
  return summary
}
```

```output
expected failure
defect
interruption: 17
{"failed":true,"defective":true,"interrupted":true,"interruptionOnly":false}
{"failed":false,"defective":false,"interrupted":false,"interruptionOnly":false}
```

Summary predicates (`hasFails`, `hasDies`, `hasInterrupts`, `hasInterruptsOnly`) check the whole cause, while per-entry guards (`isFailReason`, `isDieReason`, `isInterruptReason`) narrow each element of `cause.reasons`. An empty cause has `reasons.length === 0`.

## Formatting and inspecting errors

```vibe
// run: const result = inspect(Cause.combine(Cause.fail("missing"), Cause.die("broken"))); try Console.log(try Effect.try(() => JSON.stringify({ failures: result.failures, defects: result.defects }))); try Console.log(try Effect.try(() => JSON.stringify(inspect(Cause.empty))))
function inspect<E>(cause: Cause.Cause<E>) {
  const failures = cause.reasons
    .filter(Cause.isFailReason)
    .map((reason) => reason.error)
  const defects = cause.reasons
    .filter(Cause.isDieReason)
    .map((reason) => reason.defect)
  return { failures, defects, rendered: Cause.pretty(cause) }
}
```

```output
{"failures":["missing"],"defects":["broken"]}
{"failures":[],"defects":[],"rendered":""}
```

`Cause.pretty` formats errors and stack traces for diagnostics and returns `""` for `Cause.empty`. Filter `cause.reasons` directly when structured reporting needs counts or separate buckets, and avoid logging errors whose fields contain sensitive data.

## Coming from Effect

VibeLang's `catch` handles typed failures only—defects and causes without a typed failure propagate unchanged, while a typed failure can still be recovered alongside an interruption. Use `try exit(work())` whenever you need the full `Cause`.
