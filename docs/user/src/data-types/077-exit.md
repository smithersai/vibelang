# Exit

`Exit` works in VibeLang exactly as in Effect. Use `Exit.Exit<A, E>` to inspect a success or an entire failure cause, defects and interruption included. A plain call that returns an Exit returns data; `try outcome` runs its recorded outcome.

## Representing full outcomes

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try inspectExport())
error ExportRejected {
  reason: string
}

effect function inspectExport() {
  const outcome = try exit(effect {
    throw new ExportRejected({ reason: "empty selection" })
  })
  if (Exit.isFailure(outcome)) return outcome.cause.reasons.length
  return 0
}
```

```output
1
```

An exit is `Success` with `.value` or `Failure` with `.cause`. `try exit(program)` runs an Effect and succeeds with its outcome, which the caller inspects without re-raising the failure.

## Creating success and cause-based failure exits

```vibe
// pending: VIP-5, VIP-14
// run: const outcomes = sampleOutcomes(); try Console.log(Exit.isSuccess(outcomes.successful), Exit.isFailure(outcomes.failed), Exit.isSuccess(constantSuccess())); if (Exit.isFailure(outcomes.failed)) try Console.log(JSON.stringify(outcomes.failed.cause.reasons.map((reason) => reason._tag)))
function sampleOutcomes() {
  const successful = Exit.succeed(12)
  const failed = Exit.failCause(
    Cause.combine(Cause.fail("write rejected"), Cause.die(new Error("release failed")))
  )
  return { successful, failed }
}

function constantSuccess() {
  return Exit.succeed(12)
}
// Exit.Exit<number>
```

```output
true true true
["Fail","Die"]
```

`Exit.succeed` and `Exit.failCause` build exit data, even at a module's top level: `Exit.succeed(12)` is a success exit holding `12`, and `Exit.failCause(cause)` a failure exit holding the cause. Neither raises a failure.

## Matching exit variants

```vibe
// pending: VIP-5, VIP-7, VIP-14
// run: try Console.log(describe(Exit.succeed(12))); try Console.log(describe(Exit.failCause(Cause.empty)) === "")
function describe<A, E>(outcome: Exit.Exit<A, E>) {
  return match (outcome) {
    when Exit.Success(let value): `Completed: ${String(value)}`;
    when Exit.Failure(let cause): Cause.pretty(cause);
  }
}
```

```output
Completed: 12
true
```

`Exit.Success(let value)` binds the success value and `Exit.Failure(let cause)` the complete cause. The exhaustiveness check doesn't cover `Exit` (it covers literal unions, `boolean`, `data` and `error` unions and enums), so write both arms or a `default`. Arms are ordinary expressions and can run Effects with `try` inside an effect function; `Exit.match(outcome, { onSuccess, onFailure })` also works when the callbacks compute values synchronously. To test one variant, write `outcome is Exit.Failure`.

## Relating exits to results

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(try Effect.try(() => Result.getOrThrow(asResult(Exit.succeed(12))))); const failed = asResult(Exit.failCause(Cause.combine(Cause.fail("rejected"), Cause.die("broken")))); if (Result.isFailure(failed)) try Console.log(JSON.stringify(failed.failure.reasons.map((reason) => reason._tag)))
function asResult<A, E>(outcome: Exit.Exit<A, E>) {
  if (Exit.isSuccess(outcome)) return Result.succeed(outcome.value)
  return Result.fail(outcome.cause)
}
// Result.Result<A, Cause.Cause<E>>
```

```output
12
["Fail","Die"]
```

An exit carries roughly the information of `Result.Result<A, Cause.Cause<E>>`; a `Result.Result<A, E>` cannot express the defect and interruption reasons. Keep the full cause when you move an outcome into another data structure.

## Relating exits to effects

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-14
// run: try Console.log(try replay(Exit.succeed(12))); const failed = try exit(replay(Exit.failCause(Cause.combine(Cause.fail("rejected"), Cause.die("broken"))))); if (Exit.isFailure(failed)) try Console.log(JSON.stringify(failed.cause.reasons.map((reason) => reason._tag)))
effect function replay<A, E>(outcome: Exit.Exit<A, E>) {
  return try outcome
}
// A!E
```

```output
12
["Fail","Die"]
```

`try outcome` runs a held exit's constant outcome: success returns the stored value and failure propagates the stored cause, without repeating the original work. So taking an exit with `try exit(program)` and running it later with `try` separates inspection from propagation. `try onExit(program, (outcome) => cleanup(outcome))` runs cleanup with the program's own exit.

## Coming from Effect

`const outcome = Exit.succeed(value)` still builds an exit object; `try outcome` propagates it, and `try exit(work())` captures a program's outcome. Exit extends Effect, and its constructors return data.
