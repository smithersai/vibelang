# Error Handling in Streams

Stream recovery replaces a failed source with another. Recover during consumption with stream operators, or use a `catch` expression on the consuming Effect when the whole consuming function handles a typed failure. Elements emitted before a failure are not rolled back.

## Recovering typed failures and defects

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
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

`Stream.catch` receives a typed failure and returns the replacement Stream. Recovery abandons the rest of the failed source; it does not resume after the failing step. Tag each source with `Result` when downstream code must tell live data from fallback.

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try Stream.runCollect(boundary); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const boundary = Stream.catchDefect(
  Stream.die(new Error("decoder invariant failed")),
  () => Stream.succeed("unreadable")
)
// Output: ["unreadable"]
```

`catchDefect` handles defects at a deliberate boundary. `catchCause` receives the full Cause, with failure, defect, and interruption reasons; use it only when you need all of it. A VibeLang `catch` expression handles typed failures only, as `Effect.catch` does. It propagates a cause with a defect, whose typed failures are defects by then, and an interruption without a typed failure.

## Selective recovery

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-7, VIP-13, VIP-14
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

`catchTag` removes the handled tagged error from the output failure type. `catchFilter` handles the values a Filter selects and keeps the failures it rejects. `catchCauseFilter` selects from the full Cause; `Cause.findDie` selects a defect reason instead of treating every failure as recoverable.

## Cleanup after failure

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
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

`onError` runs its callback on an unsuccessful stream exit and keeps the failure if the callback succeeds: use it for source diagnostics. Use `Stream.ensuring(source, cleanup)` for every stream exit, or `try ensuring(consume(), cleanup)` around the consuming Effect. Cleanup failure is never silently discarded.

## Retrying a source

```vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-4, VIP-5, VIP-6, VIP-9, VIP-12, VIP-13, VIP-14
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

`retry` restarts the wrapped source after a typed failure, per its schedule. A retried multi-element source can repeat delivered elements, so retry the smallest source that represents the operation and make downstream side effects safe to repeat. An exponential schedule adds backoff; a finite recurrence schedule bounds the retries.

## Narrowing error types

```vibe
// pending: VIP-5, VIP-6, VIP-14
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

Refail the errors callers are expected to handle and turn impossible failures into defects; `Stream.orDie(source)` makes every typed failure a defect. These operators change the failure channel; they don't make a faulty source succeed.

## Timeout failures and replacement sources

```vibe
// pending: VIP-2, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14, VIP-18
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

`timeout` completes normally when an upstream pull waits too long. `timeoutOrElse` switches to the Stream `orElse` returns, which can fail, defect, or emit fallback data. The timeout applies to each upstream pull, not total consumption time, and does not time the replacement stream.
