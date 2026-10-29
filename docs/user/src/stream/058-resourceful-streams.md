# Resourceful Streams

A stream can hold a connection, file, or subscription open while its elements are consumed. Acquire during stream execution and attach release to the stream's Scope, so normal completion, early stopping, failure, and interruption all close the resource.

## Acquiring for the stream lifetime

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try readLines(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function openReader() {
  try Console.log("reader opened")
  return { lines: ["header", "entry-a", "entry-b"] }
}

const lines = Stream.fromEffect(acquireRelease(
  openReader(),
  () => Console.log("reader closed")
)).pipe(
  Stream.flatMap((reader) => Stream.fromArray(reader.lines)),
  Stream.scoped
)

effect function readLines() {
  return try Stream.runCollect(lines)
}
// Output: reader opened
// Output: reader closed
// Output: ["header","entry-a","entry-b"]
```

`Effect.acquireRelease` registers its release action in Scope, `Stream.fromEffect` defers acquisition until consumption, and `Stream.scoped` manages that Scope. Wrap the whole pipeline that uses the resource so every stage can reach it. Defining `lines` opens nothing; each consumption acquires again.

## Release after stopping or interruption

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try readHeader(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; const outcome = try result(readWithDeadline()); if (Result.isFailure(outcome)) try Console.log(outcome.failure._tag)
effect function readHeader() {
  return try Stream.runCollect(Stream.take(lines, 1))
}
// Returns ["header"] and closes the reader.

effect function readWithDeadline() {
  return try timeout(
    Stream.runForEach(lines, effect (line) => {
      try sleep("1 second")
      try Console.log(line)
    }),
    "100 millis"
  )
}
// Output: reader opened
// Output: reader closed
// Output: ["header"]
// Output: reader opened
// Output: reader closed
// Output: TimeoutError
```

The timeout interrupts consumption and waits for release before reporting failure. A `scoped(effect { … })` that acquires a resource and only returns a Stream closes when its Effect completes, so acquire inside the stream: that acquisition belongs to the supplied Scope, as this lifetime requires.

## Registering finalizers

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try readAudited(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const audited = Stream.ensuring(lines, effect {
  try Console.log("reader resources released")
  try Console.log("consumption finished")
})

effect function readAudited() {
  return try Stream.runCollect(audited)
}
// Output: reader opened
// Output: reader closed
// Output: reader resources released
// Output: consumption finished
// Output: ["header","entry-a","entry-b"]
```

`Stream.ensuring` runs its Effect after the wrapped stream's own finalizers, on every exit. Pass an `effect { }` block so the logging runs at finalization, not construction. The finalizer's expected error channel must be `never`, so handle expected cleanup errors inside it; cleanup defects stay in the reported cause.

## Coming from Effect

- Keep `Stream.scoped`, `Stream.fromEffect`, and `Stream.ensuring` as stream lifetime operators.
- Use `try scoped(effect { … })` for Effect resources the consuming operation owns. Acquire resources the stream owns in the Effect passed to `Stream.fromEffect`.
