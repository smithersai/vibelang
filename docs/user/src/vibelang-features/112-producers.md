# Producers

A producer emits values and can run Effects between yields. Declare one with `effect function*` and consume its Stream with `for try`.

## Yield values on demand

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-20, VIP-21
// run: try Console.log(try firstAlert())
effect function* readings() {
  try addFinalizer(() => Console.log("sensor closed"))
  for (const celsius of [18, 21, 25, 19, 28, 30]) {
    yield celsius
  }
}

effect function firstAlert() {
  let alert: number | undefined
  for try (const celsius of readings()) {
    if (celsius >= 25) {
      alert = celsius
      break
    }
  }
  return alert
}
// (number | undefined)!!
// Output: sensor closed
// Output: 25
```

`readings()` constructs a lazy Stream. Its body starts when the Stream runs. Each `yield` emits one value. The producer uses `Stream.callback` with a one-element buffer and can run up to two elements ahead of the consumer: one in the buffer and one waiting to be offered.

The consumer stops at 25; before `firstAlert` returns, the producer's finalizer logs `sensor closed`. `break` or a failure in the loop body closes the Stream and runs its cleanup. Iterating the Stream again starts a new run.

In `.vibe`, `effect function*` declares a producer; use a plain `function*` for `Effect.gen` or other generator-based APIs. A plain `function*`, with or without a JavaScript iterator return type, is a JavaScript generator ([below](#javascript-generators)). Generator methods on objects remain JavaScript generators unless marked `effect`.

A bare `return` ends a producer. `return value` is an error (`EK2128`) because a Stream has no return value; `vibelang --fix` writes `return` and keeps the value's evaluation. A `return` inside a `for try` head's binding initialization or body is also an error (`EK2002`); nested functions keep their own return targets. Save the result and use `break` instead.

## Call services between yields

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-20, VIP-21, VIP-33
// run: provide NodeServices.layer { try scoped(effect { const fs = try FileSystem.FileSystem; const dir = try fs.makeTempDirectoryScoped(); try fs.writeFileString(`${dir}/a.txt`, "short"); try fs.writeFileString(`${dir}/b.txt`, "x".repeat(1001)); try Console.log((try firstLargeFile(dir)) === `${dir}/b.txt`) }) }
import * as NodeServices from "@effect/platform-node/NodeServices"

effect function* fileTexts(directory: string) {
  const fs = try FileSystem.FileSystem
  const path = try Path.Path
  const names = (try fs.readDirectory(directory)).sort()
  for (const name of names) {
    const filename = path.join(directory, name)
    const info = try fs.stat(filename)
    if (info.type === "File") {
      yield { path: filename, text: try fs.readFileString(filename) }
    }
  }
}

effect function firstLargeFile(directory: string) {
  let found: string | undefined
  for try (const file of fileTexts(directory)) {
    if (file.text.length > 1000) {
      found = file.path
      break
    }
  }
  return found
}
// Output: true
```

Look up each service with `try`, then call its members. Run each returned Effect with `try`, and the producer's failures and requirements join the consuming function's contract. At the application boundary, provide `FileSystem` and `Path` from `NodeServices.layer`, as in `examples/file-tree`.

Resources a producer acquires in its Effect Scope stay open between yields and close when consumption finishes or stops early. Use `scoped(effect { ... })` to own Effect resources. This example reads one whole file at a time; with the one-element buffer, a read after the selected file may already have started when consumption stops.

## Use a producer as a Stream

```vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-20
// run: { const jsonValue = try alerts(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function alerts() {
  const selected = readings().pipe(
    Stream.filter((value) => value >= 25),
    Stream.map((value) => `${value} C`),
    Stream.take(2)
  )
  const result: string[] = []
  for try (const alert of selected) result.push(alert)
  return result
}
// Output: sensor closed
// Output: ["25 C","28 C"]
```

A producer has type `Stream.Stream<Value, Error, Requirements>`: Stream operators accept it directly, and TypeScript consumers see a Stream in its declaration file. `examples/pipeline` uses this filter, map, and take pattern.

When Stream operators consume a producer, `Stream.callback` runs it on its own fiber with a one-element buffer, and closing the Stream interrupts it and runs cleanup.

## Iterate any Stream

```vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-20
// run: try Console.log(try sumStream())
effect function sumStream() {
  let total = 0
  for try (const value of Stream.fromIterable([1, 2, 3])) {
    total += value
  }
  return total
}
// Output: 6
```

`for try` pulls an Effect Stream and closes it when the loop exits, including on `break`. `continue` skips an element, and a failure in the body fails the loop. `return` in the item's head binding initialization or body is a compile error. A labeled `break` or `continue` naming a statement that encloses the `for try` is `EK2003`. One naming the `for try` itself means its unlabeled `break` or `continue`, as in JavaScript: `scan: for try (const x of s) { continue scan }` skips an element. Labels targeting statements inside the body keep their TypeScript meaning.

Arrays, maps, sets, and strings iterate as in JavaScript with ordinary `for...of`. As in JavaScript, a loop that exits early through `break`, `return` or a JavaScript throw calls its iterator's `return()`, also for an array with its own iterator: a type annotation does not change cleanup. A typed failure run by `try`, or an interruption, abandons the effect function's generator instead, so the iterator is not closed; use `scoped` with `acquireRelease` for cleanup on every exit.

Array destructuring follows the same protocol for JavaScript exits. An exhausted iterator is not closed again. An error from `return()` replaces a jump, as ECMA-262's IteratorClose specifies. A JavaScript throw, such as a getter's, wins over an error from closing and becomes a defect. A failed `try` abandons the generator, so nothing closes.

For JavaScript iterables, use `for (using value of source)` when each element needs disposal at the end of its iteration. On an early exit through JavaScript control flow, the element is disposed before the iterator closes; a typed failure or an interruption skips `using` disposal, so use `scoped` and `acquireDisposable` for Effect exits. `using` keeps TypeScript's meaning, so an element of a Stream that needs an Effect resource opens it in its own scope: `for try (const path of paths) { try scoped(effect { const file = try acquireRelease(open(path), close); try process(file) }) }` releases each file before the next element. `Array.from(source)` is not a Stream consumer; `try Stream.runCollect(source)` collects all the elements into an array.

## JavaScript generators

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log([...countdown(3)].join(","))
function* countdown(from: number): Generator<number> {
  for (let n = from; n > 0; n--) yield n
}
// Output: 3,2,1
```

A plain `function*` is a JavaScript generator, with or without a return annotation such as `Generator`, `Iterator`, `Iterable`, or their async forms, for APIs that call `.next()`. Its `throw`, `try`/`catch`, and iterator protocol keep their JavaScript meaning. A generator method, `*[Symbol.iterator]() { … }` in a class or an object literal, is a JavaScript generator too. Yield an Effect value, `load()`, to hand one out without running it. An `async function*` is an AsyncIterable. Use `effect function*` for a Stream, or `effect *name()` for a producer method.

## Coming from Effect

Declare a generator-based Stream source with `effect function*`. Write `try` for Effects between `yield` statements, and reserve `yield` for emitted values. Use Stream's existing operators when they express the transformation you need.
