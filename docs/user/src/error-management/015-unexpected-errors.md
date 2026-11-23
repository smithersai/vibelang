# Unexpected Errors

Defects represent bugs and broken invariants, not domain failures. They live outside channel `E` so ordinary `catch` handlers never accidentally swallow them. Inspect or isolate defects only at supervision boundaries (request handlers, background workers, plugin hosts).

![Expected failures travel in E; defects and interruption live in Cause and bypass catch](/diagrams/two-error-rails.svg)

## Creating defects (`die`)

```vibe
// run: try Console.log(try decodeOpcode(1)); try Console.log(try matchCause(decodeOpcode(2), { onFailure: (cause) => Cause.hasDies(cause), onSuccess: () => false }))
effect function decodeOpcode(opcode: number) {
  if (opcode !== 1) try die(new Error("unknown internal opcode"))
  return "start"
}
// Inferred: string!!
```

```output
start
true
```

`die` terminates the fiber with a defect. Pass an `Error` instance so failure reports keep a stack trace. Implicit JavaScript runtime errors (such as dereferencing `undefined`) also become defects.

An explicit `throw` in an `effect` function is always a typed failure in `E`, never a defect. A `throw` in a plain function is `EK0401`; make the function `effect` for a typed failure. In an `async` function, `throw` rejects the Promise. When calling a throwing JS/Effect helper like `Option.getOrThrow` or `Schema.decodeUnknownSync`, wrap it in `Effect.try` (and `orDie` if failure is a bug) — or prefer the typed Effect equivalents (`fromOption`, `Schema.decodeUnknownEffect`):

```vibe
// run: try Console.log(try firstLabel(["one"])); try Console.log(try firstLabel([]))
effect function firstLabel(labels: ReadonlyArray<string>) {
  return fromOption(Option.fromNullishOr(labels[0])) catch () => "No label"
}
```

```output
one
No label
```

## Promoting typed failures to defects (`orDie`)

When a failure violates a startup invariant and callers cannot recover, move it out of `E` with `orDie`:

```vibe
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
// Inferred: never!!

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

## Inspecting full execution results (`exit`)

`exit` turns any execution into an `Exit<A, E>` value without catching or erasing defects or interruption:

```vibe
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

## Isolating defects at a boundary (`catchDefect` and `exit`)

Use `catchDefect` when a boundary isolates a subsystem and re-raises defects it does not recognize:

```vibe
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

To inspect every reason in a `Cause` while always preserving cancellation, match on `try exit(...)` and re-fail unhandled causes with `try failCause(cause)`:

```vibe
// run: try Console.log(try decoderBoundary(1)); try Console.log(try decoderBoundary(2))
effect function decoderBoundary(opcode: number) {
  const outcome = try exit(decodeOpcode(opcode))
  if (outcome is Exit.Success(let value)) return value
  const cause = outcome.cause
  if (Cause.hasInterrupts(cause)) return try failCause(cause)
  if (Cause.hasDies(cause)) {
    try Console.log("Decoder failed", try Effect.try(() => JSON.stringify(cause.reasons.map((reason) => reason._tag))))
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

Never write `throw cause` to re-raise a `Cause`: `throw` puts the `Cause` object into `E` as a typed error. Always use `try failCause(cause)` to restore the original defect or interruption intact.

The retired `catch (cause: Cause)` form is `EK2113`. Put the protected expression inside an `effect` block and match `try exit(...)` instead; the work runs inside `exit`, so its failures remain available to the fallback.

[Upstream Effect page](https://effect.website/docs/v4/error-management/unexpected-errors)
