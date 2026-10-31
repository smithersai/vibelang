# Sequencing Effects

VibeLang sequences computations with effect functions and `try`, covering the control-flow tasks `Effect.gen` handles in TypeScript. `effect function*` produces Streams; plain `function*` keeps its JavaScript meaning.

A function declaration keeps `function`: write `effect function load()` or `async function load()`. The removed shorthands `effect load()` and `async load()` report `EK0101`; the quick fix and `vibelang --fix` insert `function`. Methods keep `effect load()` and `async load()`, as in TypeScript. Computed names work in classes and object literals too: `effect [key]() { … }`, `static effect [key]() { … }` and `effect [key]<T>(value: T) { … }`.

`effect` and `async` remain identifiers outside their modifier positions. Expressions such as `effect as (Handler)` and `async satisfies (Handler)` keep TypeScript's assertion and checking rules.

Typed `effect` arrows put their parameters in parentheses: `effect (x: number) => x`. Type parameters also require parentheses, as in `effect <T>(x: T) => x`. A bare typed or generic head reports `EK0109`, including with `--noCheck`; its quick fix and `vibelang --fix` insert the parentheses and preserve the body and comments.

Optional class methods use `effect read?() { … }` or `effect [key]?() { … }`, as `async` methods do.

Method names follow TypeScript's property-name rules, including bigint literals: `effect 1n() { … }` works in a class or object literal.

A class can extend a value named `effect`: in `class Derived extends effect { }`, the braces are the class body.

`try` keeps native delegated iteration even when it is the function's only return. An unchecked empty iterable succeeds with `undefined`, an unchecked noniterable dies with its native `TypeError`, and iterator getters keep their evaluation order. An iterator getter on an `Effect` is still observed.

Comments do not supply a keyword: `export /* function */ effect load() { }` still needs `function` before `load`, and its quick fix preserves the comment.

Pattern tests such as `effect is (Number)` and `async is (String)` keep their pattern meaning, including at the start of a statement. A method named `is` still uses `effect is(...) { ... }` or `async is(...) { ... }`.

## Sequence computations

```vibe
// run: try Console.log(try Effect.provide(invoice(3), ConfigProvider.layer(ConfigProvider.fromUnknown({ UNIT_PRICE: 4 }))))
effect function invoice(quantity: number) {
  const unitPrice = try Config.Finite("UNIT_PRICE")
  const subtotal = quantity * unitPrice
  try Console.log(`subtotal=${subtotal}`)
  return subtotal
}
// Output: subtotal=12
// Output: 12
```

Each `try` completes before the next statement runs. `Config.Finite("UNIT_PRICE")` builds a descriptor; `try` loads the setting and returns a number, and a loading failure stops the function. Effect functions use `try` where Effect TypeScript writes `yield*`; `Effect.gen` stays available as a library function.

## Relate calls to async functions

```vibe
// run: try Console.log(try greeting())
effect function delayedLabel(name: string) {
  try sleep("30 millis")
  return name.toUpperCase()
}

effect function greeting() {
  const label = try delayedLabel("sora")
  return `Hello ${label}`
}
// Output: Hello SORA
```

`try delayedLabel("sora")` waits for the callee; the computation can pause and keeps typed errors, service requirements, and interruption support. At a promise-based framework boundary, run the exported function through a runner from `.ts`.

`try` runs an Effect only in effect code: the body of an `effect` function, method or arrow, or an `effect { }` block. A plain function nested in an effect function is plain, so `try` in it is `EK0501`; mark that function `effect`. A return type written on an effect function is an Effect type, such as `effect function load(id: string): User!NotFound`; `User` alone is `EK0106`.

## Branches and loops

```vibe
// run: try Console.log(try reportEven([1, 2, 3, 4, -1, 6]))
effect function reportEven(values: ReadonlyArray<number>) {
  let count = 0
  for (const value of values) {
    if (value < 0) break
    if (value % 2 !== 0) continue
    try Console.log(`even=${value}`)
    count += 1
  }
  return count
}
// Output: even=2
// Output: even=4
// Output: 2
```

Conditions, local variables, `break`, `continue`, and early returns keep JavaScript's evaluation order. This loop runs sequentially; for overlapping iterations, use `Effect.forEach` with an explicit concurrency limit.

## Raise failures and stop early

```vibe
// run: try Console.log(try optionalTitle(undefined))
error MissingTitle

effect function titleLength(title: string | undefined) {
  if (title === undefined) throw new MissingTitle()
  return title.length
}
// number!MissingTitle

effect function optionalTitle(title: string | undefined) {
  return titleLength(title) catch () => 0
}
// Output: 0
```

A throw stops the current sequence and adds its type to `E`. Control-flow analysis knows the missing-title branch cannot continue, so `title` is narrowed afterward. A `catch` expression handles expected failures; defects and interruption propagate. Use `try ensuring(work, cleanup)` to run cleanup when work ends. A cause containing a defect bypasses `catch`, with its expected failures re-raised as defects. A cause with an expected failure and no defect is recovered, even beside an interruption.

When a cause contains several expected failures and no defect or interruption, `catch` receives the first and handles the cause as a whole; use `Effect.catchCause` to inspect every failure. To keep processing after a failure without catching it immediately, use `try result(titleLength(title))` and inspect the resulting `Result`.

## Retain the receiver

```vibe
// run: try Console.log(try label())
class Prefixer {
  constructor(readonly prefix: string) {}

  effect format(value: string) {
    try Console.log("formatting label")
    return `${this.prefix}: ${value}`
  }
}

effect function label() {
  const prefixer = new Prefixer("item")
  return try prefixer.format("marker")
}
// Output: formatting label
// Output: item: marker
```

Method calls preserve `this` and evaluate the receiver once: the compiler passes the method's `this` to its generator. To pass its Effect to an operator, use `prefixer.format("marker")`; the method call returns it unrun.

## Generators produce values and streams

```vibe
// run: { const jsonValue = try firstTwo(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function* ticks() {
  for (let n = 0; n < 3; n += 1) {
    try sleep("10 millis")
    yield n
  }
}

effect function firstTwo() {
  const values: number[] = []
  for try (const n of ticks()) {
    values.push(n)
    if (values.length === 2) break
  }
  return values
}
// Output: [0,1]
```

An `effect function*` returns a Stream for `for try`; `yield` emits a value, and `try` runs an Effect. Leaving the loop early runs the producer's cleanup. A plain `function*` remains a JavaScript generator. Existing `Effect.gen` code stays in `.ts` files, where JavaScript generators keep their usual Effect meaning.

A producer returns a `Stream` directly, so `Stream.take(ticks(), 2)` uses Effect's operators directly. It compiles to `Stream.callback` with one element of buffer, so the producer may run up to two elements ahead of the consumer: one in the buffer and one waiting to be offered. Closing it interrupts the producer's fiber and runs its cleanup. `for try` consumes an Effect Stream in order and closes it when the loop exits.

## Coming from Effect

To convert a sequence, declare an effect function and replace each `yield*` with `try`. Use `effect function*` for a function that produces a Stream of values.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/using-generators)
