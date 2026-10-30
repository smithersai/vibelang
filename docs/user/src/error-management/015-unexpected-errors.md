# Unexpected Errors

Defects report bugs and broken invariants, outside the typed error contract. Domain recovery handles expected errors; inspect defects at a boundary that can report or isolate the failed operation.

[Upstream page](https://effect.website/docs/v4/error-management/unexpected-errors)

## Creating defects

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try decodeOpcode(1)); try Console.log(try matchCause(decodeOpcode(2), { onFailure: (cause) => Cause.hasDies(cause), onSuccess: () => false }))
effect function decodeOpcode(opcode: number) {
  if (opcode !== 1) try die(new Error("unknown internal opcode"))
  return "start"
}
// string!!
```

```output
start
true
```

`die` terminates the computation with a defect, preferably an `Error` with a useful message so diagnostics include its stack. An implicit JavaScript exception, such as an invalid property access, is also a defect.

An explicit `throw` in an effect function, even `throw new Error(...)`, is a typed failure. In a plain or async function, `throw` is JavaScript's. Wrap a synchronous call that may throw with `Effect.try` to expose its exception as a typed failure. A tracked throwing callback is not assignable to `sync`'s non-throwing thunk; use `orDie(Effect.try(() => call()))` when that exception should be a defect.

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try firstLabel(["one"])); try Console.log(try firstLabel([]))
effect function firstLabel(labels: ReadonlyArray<string>) {
  return fromOption(Option.fromNullishOr(labels[0])) catch () => "No label"
}
```

```output
one
No label
```

`Option.getOrThrow`, and the decoders that `Schema.decodeUnknownSync(schema)` and `Schema.decodeSync(schema)` return, may throw; building either decoder doesn't. An effect function wraps those calls with `Effect.try`; `orDie` then promotes the failure to a defect, which a catch expression doesn't see. When callers need recovery, use a typed form: `fromOption`, as above, or `Schema.decodeUnknownEffect`. A JavaScript catch inside `Effect.gen` sees synchronous exceptions; a catch expression in Effect code follows the expected-failure contract. A plain function's catch handles JavaScript exceptions.

## Promoting typed failures to defects

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try matchCause(startup(), { onFailure: (cause) => Cause.hasDies(cause), onSuccess: () => false })); try Console.log(try matchCause(startupWithMessage(), { onFailure: (cause) => Cause.hasDies(cause), onSuccess: () => false }))
error MissingSetting {
  name: string
}

effect function requireSetting(name: string) {
  throw new MissingSetting({ name })
}

effect function startup() {
  return try orDie(requireSetting("region"))
}
// never!!

effect function startupWithMessage() {
  return try orDie(
    mapError(requireSetting("region"), (error) => new Error(`Startup needs ${error.name}`))
  )
}
```

```output
true
true
```

`orDie` removes `E` by moving typed failures into defect reasons, which callers can't recover from; use it where a failure violates a required invariant. For a clearer defect message, map the error first.

## Examining complete execution results

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try inspectStartup())
effect function inspectStartup() {
  const outcome = try exit(startup())
  if (Exit.isFailure(outcome)) {
    return Cause.hasDies(outcome.cause) ? "startup defect" : "startup stopped"
  }
  return "started"
}
```

```output
startup defect
```

`exit` succeeds with an `Exit<A, E>`. A failure exit keeps the full cause: defects, interruption reasons, and combinations of reasons. `result` exposes domain failures only. Capturing an exit doesn't make an externally cancelled fiber immune to cancellation.

An `Exit` returned by a call stays data, and `Exit.succeed(value)` constructs one without running it; `try outcome` runs a held exit.

## Recovering defects at a boundary

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try isolateDecoder(1)); try Console.log(try isolateDecoder(2))
effect function isolateDecoder(opcode: number) {
  return try catchDefect(decodeOpcode(opcode), effect (defect) => {
    if (defect instanceof Error && defect.message === "unknown internal opcode") {
      try Console.log("Decoder disabled after an invariant failure")
      return "disabled"
    }
    return try die(defect)
  })
}
```

```output
start
Decoder disabled after an invariant failure
disabled
```

`catchDefect` selects the first defect and runs recovery; a cause with no defect propagates. A typed failure beside a defect is a defect by then, so the handler receives that failure's error, and recovery consumes the other reasons too; use `catchCause` when every reason must inform the decision. Reraise defects you don't recognize. A catch expression never intercepts a defect, even one that is an instance of a domain error class.

## Recovering a complete cause

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-7, VIP-14
// run: try Console.log(try decoderBoundary(1)); try Console.log(try decoderBoundary(2))
effect function decoderBoundary(opcode: number) {
  const outcome = try exit(decodeOpcode(opcode))
  if (outcome is Exit.Success(let value)) return value
  const cause = outcome.cause
  if (Cause.hasInterrupts(cause)) return try failCause(cause)
  if (Cause.hasDies(cause)) {
    try Console.log("Decoder failed", JSON.stringify(cause.reasons.map((reason) => reason._tag)))
    return "disabled"
  }
  return try failCause(cause)
}
```

```output
start
Decoder failed ["Die"]
disabled
```

`try exit(program)` returns the whole outcome, as Effect's `exit` does: a `Failure` exit's cause holds every reason, including the defects and interruption that ordinary catch leaves alone or drops. Test it with `is` or `match` on `Exit.Success` and `Exit.Failure`. `failCause(cause)` restores the original failure with every reason. `throw` fails with the value it is given, so `throw cause` would make the cause object a typed error; the compiler rejects it with EK2140. Inspect every reason before recovering from a mixed cause, and preserve cancellation unless the boundary has a reason to consume it.
