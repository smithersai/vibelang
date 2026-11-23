# Timing Out

Timeouts cap how long a caller waits for an Effect. When the deadline expires, Effect interrupts the work, waits for its cleanup to finish, and produces the chosen timeout result.

[Upstream page](https://effect.website/docs/v4/error-management/timing-out)

| Combinator | On timeout | On timely success | Source errors `E` |
| --- | --- | --- | --- |
| `timeout` | Fails with `Cause.TimeoutError` | Returns `A` | Preserved alongside `TimeoutError` |
| `timeoutOption` | Succeeds with `Option.none()` | Returns `Option.some(A)` | Preserved in `E` |
| `timeoutOrElse` | Runs lazy `orElse` Effect | Returns `A` | Preserved alongside `orElse` errors |

## Limiting execution duration

```vibe
// run: try Console.log(try buildPreview()); try Console.log((try flip(previewWithDeadline()))._tag)
effect function buildPreview() {
  try sleep("3 seconds")
  try Console.log("Preview rendered")
  return "Rendered preview"
}

effect function previewWithDeadline() {
  return try timeout(buildPreview(), "500 millis")
}
// string!Cause.TimeoutError
```

```output
Preview rendered
Rendered preview
TimeoutError
```

`timeout` adds `Cause.TimeoutError` to `E`. A timely success returns its value and a domain failure before the deadline keeps its original error. Pass the unexecuted Effect (`buildPreview()`) so the timer brackets its run.

```vibe
// run: try Console.log(try previewLabel())
effect function previewLabel() {
  return previewWithDeadline() catch (error) => {
    // error._tag is "TimeoutError"
    return "Preview still unavailable"
  }
}
```

```output
Preview still unavailable
```

The interruption that stops `buildPreview` is separate from the typed `TimeoutError` delivered to the caller, so a `catch` inside `buildPreview` cannot intercept it.

> **Current limitation.** Timeout waits for the interrupted source's cleanup, but Effect 4.1.1 drops cleanup failures at the timeout boundary. This applies to `timeout`, `timeoutOption`, and `timeoutOrElse`, including `ensuring` and scoped resource releases. VibeLang preserves Effect's semantics, including dropping a loser's cleanup failure.

## Representing timeout as absence

```vibe
// run: try Console.log(try optionalPreview())
effect function optionalPreview() {
  const preview = try timeoutOption(buildPreview(), "500 millis")
  return Option.isNone(preview) ? "No preview yet" : preview.value
}
```

```output
No preview yet
```

`timeoutOption` turns a timeout into `None` and wraps a timely result in `Some(value)`. Expected domain failures from the source still surface in `E` rather than `None`.

## Choosing an alternative or custom failure

```vibe
// run: try Console.log(try previewOrPlaceholder()); try Console.log((try flip(requiredPreview("doc-1"))).documentId)
effect function previewOrPlaceholder() {
  return try timeoutOrElse(buildPreview(), {
    duration: "500 millis",
    orElse: () => succeed("Static placeholder")
  })
}

error PreviewDeadline {
  documentId: string
}

effect function requiredPreview(documentId: string) {
  return try timeoutOrElse(buildPreview(), {
    duration: "500 millis",
    orElse: effect () => { throw new PreviewDeadline({ documentId }) }
  })
}
// string!PreviewDeadline
```

```output
Static placeholder
doc-1
```

`orElse` runs lazily only after the timer wins and may use services, fail, or return a different success type; its channels join the result's contract. Fail with a typed error for an expected deadline, and reserve defects for broken invariants.

## Interruption of protected work

```vibe
// run: try Console.log((try flip(protectedPreview()))._tag)
effect function protectedPreview() {
  return try timeout(
    Effect.uninterruptible(buildPreview()),
    "500 millis"
  )
}
```

```output
Preview rendered
TimeoutError
```

`Preview rendered` prints before `TimeoutError` because `Effect.uninterruptible` defers cancellation until the protected block exits, letting the call exceed 500 milliseconds. `ensuring` finalizers and scoped releases also run to completion before a timeout returns. Give work that must outlive a request an explicit fiber lifetime instead of relying on a timeout to stop it immediately.
