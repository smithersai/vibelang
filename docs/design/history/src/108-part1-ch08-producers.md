### 8. Producers: streams of values

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

A `function*` in VibeLang is a **producer**: it yields values one at a time and can do anything a VibeLang function does between yields, including calling services and waiting. `for...of` consumes it. Both sides below build the same reusable, lazy line source over the same `Files` service.

```ts effect
const lines = (path: string) =>
  Stream.unwrap(Effect.gen(function* () {
    const files = yield* Files
    const file = yield* files.open(path)                // closes when the stream ends
    return Stream.fromEffectRepeat(file.readLine()).pipe(
      Stream.takeWhile((line): line is string => line !== undefined)
    )
  }))

const firstErrors = Effect.fn("firstErrors")(function* (path: string) {
  return yield* lines(path).pipe(
    Stream.filter((line) => line.startsWith("ERROR")),
    Stream.take(3),
    Stream.runCollect
  )
})
```

```ts es
function* lines(path: string) {
  using file = Files.open(path)
  while (true) {
    const line = file.readLine()        // a service call: may wait on I/O
    if (line === undefined) return
    yield line
  }
}

function firstErrors(path: string) {
  const found: string[] = []
  for (const line of lines(path)) {
    if (line.startsWith("ERROR")) found.push(line)
    if (found.length === 3) break       // the file closes here
  }
  return found
}
// string[]!IOError!Files
```

How a producer behaves:

- **Lazy.** Calling `lines(path)` runs none of its body; the file opens when the loop asks for the first line.
- **One value at a time.** Each `yield` hands one value to the loop body; when the body finishes, the producer continues to the next `yield`.
- **Cleanup on early exit.** `break`, `return`, or an error in the loop body stops the producer, and its `using` and `finally` run before the loop exits. Here the file closes after the third error line.
- **One pass per run.** Iterating the same producer again restarts it from the beginning.
- **Constant stack.** A loop over a million elements uses the stack depth of a loop over three (Chapter 26).

A JavaScript generator cannot do this: its body runs synchronously inside `next()`, so it cannot wait for a service between values. A VibeLang producer can, because each `yield` is a control operation that the loop handles (Chapter 9 shows the machinery, Part III how it runs). Every `function*` is a producer, so passing one to `Effect.gen`, `Option.gen`, or another JavaScript generator API is EK1002 (Chapter 10).

Which functions are producers is decided by syntax alone [Rule] (D370):

- A generator function, a `function*` declaration or `function*` expression, is a producer, whatever its return annotation says. An annotation is checked against the producer's type, `Stream<T, E, R>`; a JavaScript iterator type there, such as `Generator<T>` or `AsyncIterable<T>`, is EK1002.
- A generator method, `*name() { … }` in a class or an object literal, is a JavaScript generator, as in TypeScript, so a class can implement `[Symbol.iterator]`. Its body is plain code: it cannot pause or fail (D282), as any plain function cannot, so a `throw` or a listed failure that can escape it is EK2003, a call that runs an Effect there is EK2003 too, and its own `catch` sees typed failures only (D296, D399).
- A JavaScript generator function, such as a coroutine that a caller drives with `next()` and `throw()`, is written in a `module` block or a `.ts` file (Chapter 11). An `async function*` is EK1003 outside them, as every `async` function is.

#### What `for...of` does depends on what it iterates

What a loop does depends only on the value it iterates [Rule] (D371, D402):

| Iterated value | What `for...of` does |
| --- | --- |
| A producer, the value a `function*` call returns | Runs the producer on the loop's fiber under a `Yield` handler: the loop body runs once per `yield` |
| Any other `Stream` | Pulls the stream chunk by chunk; leaving the loop closes the stream |
| Anything else: an array, a `Map`, a `Set`, a string, any iterable | Iterates it with the iterator protocol, and calls the iterator's `return()` on every exit before the end: a jump out of the loop, a failure in the body, the head, a default, or a destructuring, or an interruption; a failing `return()` joins the exit (D356) |

The value decides, whatever its static type: a producer that reached the loop through a variable or a parameter typed `Stream`, or as a function's result, is still a producer, and the loop runs it on the loop's fiber (D402). A static type that is a union, `any`, or `unknown` selects nothing. A producer's body runs on the loop's fiber, so its control operations reach the handlers around the loop; another Stream may run its work on other fibers (Chapter 9).

The compiler may emit JavaScript's own `for...of` for a loop over an iterable, as an optimization that rule E11 holds to this loop's observations (D404). Neither the iterated expression's static type nor a body that cannot pause makes the two loops equal: when the body, or the head's destructuring or a default, fails and the iterator's `return()` then throws too, ECMAScript's `IteratorClose` keeps the first failure and drops the second, and Chapter 17's iterator rule keeps both. So the native loop is emitted only with the runtime's close helper around every exit that can close the iterator, the head's included, which combines a failing `return()` with the failure in flight as the iterator rule does (D424). The helper looks `return` up only when it closes the iterator, once per close, as `IteratorClose` does. No check at the loop's entry stands in for it: a custom iterator may gain a `return` method while the loop runs, and an extra lookup is an observation a getter sees. Effect abandons a generator frame without calling `return()` (Chapter 24), so a loop whose body can pause runs through the runtime's loop.

#### Producers and Effect streams

To TypeScript, a producer is a `Stream`: the declaration file types `lines` as `(path: string) => Stream.Stream<string, IOError, Files>`. It is one from the moment the call makes it [Rule] (D402): the value a `function*` call returns is a `Stream` that carries its producer, so nothing converts it. A declared type, a parameter, or a return passes the same value on, and Stream's operators apply to it directly:

```ts es
function errorCount(path: string) {
  return lines(path).filter((line) => line.startsWith("ERROR")).runCount()
}
// number!IOError!Files
```

A producer has two kinds of consumer. `for...of` over the value runs the producer on the loop's fiber, as above. Every other consumer, a Stream operator or runner, or TypeScript code, reads it through the `Stream` interface, whose pull runs the producer on a fiber of its own, the adapter, and hands over each element only when the stream pulls it, through an unbuffered handoff, so a pull from any fiber works and the producer never runs ahead of its consumer. Each such consumption runs the producer afresh, and closing the stream interrupts the adapter's fiber, which runs the producer's cleanup. On that fiber no handler around the consumer can be reached, so a `Stream` whose R holds a control operation, other than a producer's own `yield`, is EK4201 where it reaches any consumer but `for...of`: a Stream function, a runner, or a TypeScript function that takes a `Stream` (Chapter 9). Handle the operation inside the producer, or consume it with `for...of`.

The other direction needs no adapter: Stream's functions take callbacks that return Effects, so VibeLang callbacks work there, and `for...of` iterates a `Stream` directly:

```ts es
function auditAll(events: Stream.Stream<Event, EventError>) {
  for (const event of events) Audit.record(event)
}
// void!EventError!Audit
```
