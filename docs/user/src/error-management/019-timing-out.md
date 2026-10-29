# Timing Out

A timeout limits how long a caller waits for work. Effect interrupts the timed computation, waits for its cleanup, then produces the chosen timeout outcome.

[Upstream page](https://effect.website/docs/v4/error-management/timing-out)

## Limiting execution duration

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try buildPreview()); try Console.log((try flip(previewWithDeadline()))._tag)
effect buildPreview() {
  try sleep("3 seconds")
  try Console.log("Preview rendered")
  return "Rendered preview"
}

effect previewWithDeadline() {
  return try timeout(buildPreview(), "500 millis")
}
// string!Cause.TimeoutError!
```

```output
Preview rendered
Rendered preview
TimeoutError
```

`timeout` adds `Cause.TimeoutError` to `E`. A timely success keeps its value, and a domain failure before the deadline keeps its error. Pass the Effect value, `buildPreview()`, so the timer surrounds its execution.

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try previewLabel())
effect previewLabel() {
  return previewWithDeadline() catch (error) => {
    // error._tag is "TimeoutError"
    return "Preview still unavailable"
  }
}
```

```output
Preview still unavailable
```

The internal interruption that stops the source is separate from the typed timeout error the caller receives; a catch expression inside `buildPreview` can't consume it.

> **Current limitation.** Timeout waits for the interrupted source's cleanup, but Effect 4.0.6 drops that cleanup's failures at the timeout boundary. This affects `timeout`, `timeoutOption`, and `timeoutOrElse`, including `ensuring` and scoped resource cleanup. VibeLang keeps Effect's semantics, including dropping a loser's cleanup failure.

## Representing timeout as absence

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try optionalPreview())
effect optionalPreview() {
  const preview = try timeoutOption(buildPreview(), "500 millis")
  return Option.isNone(preview) ? "No preview yet" : preview.value
}
```

```output
No preview yet
```

`timeoutOption` returns `None` for a timeout and `Some(value)` for a timely success. The source's expected failures stay in `E`, not `None`.

## Choosing an alternative or custom failure

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try previewOrPlaceholder()); try Console.log((try flip(requiredPreview("doc-1"))).documentId)
effect previewOrPlaceholder() {
  return try timeoutOrElse(buildPreview(), {
    duration: "500 millis",
    orElse: () => succeed("Static placeholder")
  })
}

error PreviewDeadline {
  documentId: string
}

effect requiredPreview(documentId: string) {
  return try timeoutOrElse(buildPreview(), {
    duration: "500 millis",
    orElse: effect () => { throw new PreviewDeadline({ documentId }) }
  })
}
// string!PreviewDeadline!
```

```output
Static placeholder
doc-1
```

The alternative Effect runs lazily, after the timer wins, and can use services, fail, or return another success type; those channels join the overall contract. Use a typed failure for an expected deadline, and a defect only when timing out breaks an invariant.

## Interruption of protected work

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-22
// run: try Console.log((try flip(protectedPreview()))._tag)
effect protectedPreview() {
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

The `Preview rendered` log precedes the timeout failure because the protected work finishes before interruption takes effect: uninterruptible work defers cancellation, so this call can take longer than 500 milliseconds. `ensuring` cleanup and resource releases, even slow ones, complete before timeout returns. Give work that must outlive a request an explicit fiber lifetime; don't assume a timeout stops it instantly.
