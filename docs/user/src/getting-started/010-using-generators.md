# Sequencing Effects

In Effect TypeScript, sequential code requires `Effect.gen(function* () { ... yield* ... })`. In VibeLang, you just write an `effect function` and use `try` where `async` functions use `await`.

If you already know `async`/`await`, you already know 90% of VibeLang's control flow:

| JavaScript `async` | VibeLang `effect` |
| --- | --- |
| `async function load()` | `effect function load()` |
| `async (x: number) => ...` | `effect (x: number) => ...` |
| `class C { async run() {} }` | `class C { effect run() {} }` |
| `await promise` | `try effectValue` |
| `throw err` (untyped) | `throw new MyError()` (typed in `E`) |

Always write `effect function name()` at declaration level (`effect name()` outside a class or object literal is `EK0101`), and parenthesize typed or generic arrow parameters: `effect (x: number) => x` (`EK0109`). Plain `function*` keeps JavaScript's generator meaning; `effect function*` builds a [Stream producer](../vibelang-features/112-producers.md).

## Step-by-step execution

Each `try` runs its Effect to completion before the next statement executes:

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

If `Config.Finite("UNIT_PRICE")` fails, execution short-circuits immediately — `Console.log` never runs, and `Config.ConfigError` flows into `invoice`'s error channel `E`.

## Calling other effect functions

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

> **Watch out for nested plain callbacks (`EK0501`).**
> `try` is valid only inside an `effect` function, `effect` method, `effect` arrow, or `effect { ... }` block. A plain callback nested inside an effect function is still plain — mark it `effect` (or use `forEach` / `for` loops) if it needs to run Effects.

## Ordinary `if`, `for`, `break`, and `continue`

Normal JavaScript control flow works as expected inside `effect` functions:

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

A standard `for...of` runs iterations sequentially. To run iterations in parallel with a concurrency cap, use `for concurrent(4) (const value of values) { ... }` or `Effect.forEach`.

## Failing early and narrowing types

Throwing a typed error exits the function immediately, so TypeScript's control-flow narrowing knows the error path cannot continue:

```vibe
// run: try Console.log(try optionalTitle(undefined))
error MissingTitle

effect function titleLength(title: string | undefined) {
  if (title === undefined) throw new MissingTitle()
  return title.length
}
// Inferred: number!MissingTitle

effect function optionalTitle(title: string | undefined) {
  return titleLength(title) catch () => 0
}
// Output: 0
```

After the `if (...) throw`, `title` is narrowed to `string`. `catch` recovers expected failures; defects and interruption pass through while still running `ensuring` cleanup.

## Methods keep `this`

An `effect` method on a class or object literal preserves `this` naturally — no `Effect.gen(this, function* () { ... })` boilerplate:

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
  return try prefixer.format("notebook")
}
// Output: formatting label
// Output: item: notebook
```

## Coming from Effect

`effect function` and `effect { ... }` replace `Effect.gen(function* () { ... })` and `Effect.fn`, and `try` replaces `yield*`. `Effect.gen` remains available as a library function when you need it.

**Next:** [Building Pipelines](011-building-pipelines.md) — combine statements with the `|>` pipe operator.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/using-generators)
