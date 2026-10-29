# Cause

`Cause` works in VibeLang exactly as in Effect. It records every reason a computation failed (typed errors, defects, interruption); use it when the error channel alone cannot explain an outcome.

## Representing failure reasons

```vibe
// pending: VIP-5, VIP-14
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

`Cause.fail` stores an error in E, `Cause.die` a defect outside E, and `Cause.interrupt` an interruption with an optional numeric fiber ID. An empty cause has no reasons; there is no `Empty` reason variant.

## Combining reasons

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify(combined.reasons.map((reason) => reason._tag))); try Console.log(Cause.combine(Cause.fail("same error"), Cause.fail("same error")).reasons.length)
const combined = Cause.combine(Cause.fail("export failed"), Cause.die(new Error("cleanup failed")))
combined.reasons.map((reason) => reason._tag) // ["Fail", "Die"]
Cause.combine(Cause.fail("same error"), Cause.fail("same error")).reasons.length // 1
```

```output
["Fail","Die"]
1
```

Effect 4 stores reasons in a flat array: `combine` merges both sets and drops equal duplicates, building no sequential or parallel tree. `combine` keeps an expected failure beside a defect, but where the runtime combines them, at a cleanup or a concurrent sibling, the failure becomes a defect of the same error. Inspect a mixed cause as a whole.

## Extracting a computation's cause

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log((try diagnose()).split("\n")[0].trim())
error MissingRecord {
  id: string
}

effect diagnose() {
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

`try exit(program)` runs the Effect and returns its full outcome as data. A failure exit's `.cause` includes defects and interruption, which ordinary `catch` does not handle. `try failCause(cause)` propagates the entire cause again, while `throw cause` fails with the cause object itself as a typed error; to branch on the whole outcome, `match` the exit with `Exit.Success(let value)` and `Exit.Failure(let cause)` arms.

## Identifying reason variants

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(JSON.stringify(try classify(Cause.combine(Cause.combine(Cause.fail("missing"), Cause.die("broken")), Cause.interrupt(17))))); try Console.log(JSON.stringify(try classify(Cause.empty)))
effect classify<E>(cause: Cause.Cause<E>) {
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

Cause predicates test whether a kind of reason is present. Reason guards narrow one entry to `Fail`, `Die`, or `Interrupt`, exposing `.error`, `.defect`, or `.fiberId`. An empty cause has `reasons.length === 0`.

## Formatting and inspecting errors

```vibe
// pending: VIP-5, VIP-14
// run: const result = inspect(Cause.combine(Cause.fail("missing"), Cause.die("broken"))); try Console.log(JSON.stringify({ failures: result.failures, defects: result.defects })); try Console.log(JSON.stringify(inspect(Cause.empty)))
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

`Cause.pretty` renders errors and traces readably, and returns an empty string for `Cause.empty`. Select individual reasons when a reporting boundary needs separate counts or categories. Error fields and messages can hold sensitive application data, so format only errors fit for the destination.

## Coming from Effect

A VibeLang `catch` uses Effect's `catch`: a defect or a cause with no typed failure propagates; a typed failure can be recovered even beside an interruption. To inspect the full outcome, use `try exit(work())`, which keeps the complete cause.
