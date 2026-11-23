# Error Handling in Streams

When a stream fails, elements already emitted stay emitted—stream recovery cannot roll them back. Instead, recovery operators intercept the failure and switch to a replacement stream, or let the consuming Effect handle the typed error with `catch`.

| Operator | Intercepts | Effect on stream |
| --- | --- | --- |
| `Stream.catch` | All typed failures (`E`) | Switches to fallback stream |
| `Stream.catchTag` | One tagged error variant | Removes handled tag from `E` |
| `Stream.catchFilter` | Typed failures matching a `Filter` | Keeps unmatched failures in `E` |
| `Stream.catchDefect` | Unchecked defects | Recovers at an explicit fault boundary |
| `Stream.catchCause` / `catchCauseFilter` | Full `Cause` (failures, defects, interruption) | Low-level cause-aware recovery |
| `Stream.retry` | Typed failures (`E`) | Restarts source according to a `Schedule` |
| `Stream.timeout` / `timeoutOrElse` | Pull idle longer than duration | Ends stream or switches to replacement |

## Recovering typed failures and defects

```vibe
// run: { const jsonValue = [try readRecovered(), (try Stream.runCollect(tagged)).map((outcome) => outcome._tag)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
error Disconnected

const primary = Stream.concat(Stream.make("live-a", "live-b"), Stream.fail(new Disconnected()))
const recovered = Stream.catch(primary, () => Stream.succeed("cached"))

effect function readRecovered() {
  return try Stream.runCollect(recovered) // ["live-a", "live-b", "cached"]
}

const tagged = Stream.catch(
  Stream.map(primary, (value) => Result.succeed(value)),
  () => Stream.map(Stream.make("cached"), (value) => Result.fail(value))
)
// Output: [["live-a","live-b","cached"],["Success","Success","Failure"]]
```

`Stream.catch` discards the remainder of the failed source and appends the fallback stream. When downstream consumers need to distinguish live items from fallback items, wrap each branch in `Result`.

```vibe
// run: { const jsonValue = try Stream.runCollect(boundary); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const boundary = Stream.catchDefect(
  Stream.die(new Error("decoder invariant failed")),
  () => Stream.succeed("unreadable")
)
// Output: ["unreadable"]
```

Reserve `Stream.catchDefect` and `Stream.catchCause` for deliberate isolation boundaries. A VibeLang `catch` expression on a consuming Effect handles typed failures only (matching `Effect.catch`), letting defects and interruptions propagate untouched.

## Selective recovery

```vibe
// run: { const jsonValue = [try Stream.runCollect(recoverKnown(Stream.fail(new NotReady()))), try Stream.runCollect(selected), try Stream.runCollect(defectOnly)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; const outcome = try result(Stream.runCollect(recoverKnown(Stream.fail(new AccessDenied())))); if (Result.isFailure(outcome)) match (outcome.failure) { when AccessDenied: try Console.log(outcome.failure._tag); }
error NotReady
error AccessDenied

function recoverKnown(source: Stream.Stream<string, NotReady | AccessDenied>) {
  return Stream.catchTag(source, "NotReady", () => Stream.succeed("pending"))
}

const selected = Stream.catchFilter(
  Stream.fail("busy" as "busy" | "forbidden"),
  Filter.fromPredicate((error: "busy" | "forbidden") => error === "busy"),
  () => Stream.succeed("try later")
)

const defectOnly = Stream.catchCauseFilter(Stream.die("corrupt frame"), Cause.findDie, () => Stream.empty)
// Output: [["pending"],["try later"],[]]
// Output: AccessDenied
```

`catchTag` eliminates the matched `_tag` from the stream's error union while leaving unhandled errors (`AccessDenied`) intact. `catchFilter` matches non-tagged error values through a `Filter`, and `catchCauseFilter` targets specific `Cause` slices (such as `Cause.findDie` for defects alone).

## Cleanup after failure

```vibe
// run: const outcome = try result(consumeChecked()); if (Result.isFailure(outcome)) try Console.log(outcome.failure)
effect function consumeChecked() {
  const source = Stream.succeed("accepted").pipe(
    Stream.concat(Stream.fail("read failed")),
    Stream.onError(() => Console.log("input failed; closing reader"))
  )
  return try ensuring(
    Stream.runCollect(source),
    Console.log("consumer finished")
  )
}
// Output: input failed; closing reader
// Output: consumer finished
// Output: read failed
```

`Stream.onError` runs a side effect only on unsuccessful stream exits while preserving the original failure. For cleanup that must run on *every* exit (success, failure, or interruption), attach `Stream.ensuring` to the stream or wrap the consumer in `try ensuring(...)`. Finalizer failures are never silently dropped.

## Retrying a source

```vibe
// run: let attempts = 0; provide Sensor = { read: effect () => { attempts++; if (attempts < 4) throw new Offline(); return 42 } } { { const jsonValue = try Stream.runCollect(readings); try Console.log(try Effect.try(() => JSON.stringify(jsonValue)), attempts) } }
error Offline

service Sensor {
  read(): number!Offline
}

const readings = Stream.fromEffect(effect {
  const sensor = try Sensor
  return try sensor.read()
}).pipe(Stream.retry(Schedule.recurs(3)))
// Output: [42] 4
```

`Stream.retry(schedule)` restarts the wrapped stream from its beginning after a typed failure. Because restarting a multi-element stream can re-emit earlier elements, wrap the narrowest failing unit possible (such as a single page or RPC call) and keep downstream handlers idempotent. Combine exponential backoff with a finite cap (`Schedule.recurs`) in production.

## Narrowing error types

```vibe
// run: const outcome = try result(Stream.runCollect(keepSyntaxErrors(Stream.fail(new SyntaxError("bad syntax"))))); if (Result.isFailure(outcome)) try Console.log(outcome.failure.message); try Console.log(Exit.isFailure(try exit(Stream.runCollect(keepSyntaxErrors(Stream.fail(new Error("defect")))))))
function keepSyntaxErrors(source: Stream.Stream<string, Error>) {
  return Stream.catch(source, (error) => {
    if (error instanceof SyntaxError) return Stream.fail(error)
    return Stream.die(error)
  })
}
// The returned Stream has E = SyntaxError.
// Output: bad syntax
// Output: true
```

Keep recoverable domain errors in `E` and escalate unrecoverable errors with `Stream.die` (or escalate all typed errors at once with `Stream.orDie`). Escalation tightens the error signature without masking the underlying failure.

## Timeout failures and replacement sources

```vibe
// run: { const jsonValue = try.all [Stream.runCollect(endWhenIdle), effect { const outcome = try result(Stream.runCollect(failWhenIdle)); return outcome._tag }, effect { const outcome = try exit(Stream.runCollect(defectWhenIdle)); return Exit.isFailure(outcome) }, Stream.runCollect(fallbackWhenIdle)]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
error Idle

const endWhenIdle = Stream.timeout(Stream.never, "3 seconds")
const failWhenIdle = Stream.timeoutOrElse(Stream.never, {
  duration: "3 seconds",
  orElse: () => Stream.fail(new Idle())
})
const defectWhenIdle = Stream.timeoutOrElse(Stream.never, {
  duration: "3 seconds",
  orElse: () => Stream.failCause(Cause.die("idle invariant"))
})
const fallbackWhenIdle = Stream.timeoutOrElse(Stream.never, {
  duration: "3 seconds",
  orElse: () => Stream.make("backup-a", "backup-b")
})
// Output: [[],"Failure",true,["backup-a","backup-b"]]
```

`Stream.timeout` ends the stream cleanly when an upstream pull waits longer than `duration`; `Stream.timeoutOrElse` switches to the stream returned by `orElse` (which may fail, die, or emit fallback elements). The deadline applies *per upstream pull*, not to total stream lifetime, and does not govern the replacement stream.
