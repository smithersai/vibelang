# Building Pipelines

Use plain statements (`const`, `try`, `if`) when steps depend on earlier results, and use the **pipe operator `|>`** when transforming a single value or wrapping an Effect through a chain of combinators.

In `x |> f(%)`, the topic token `%` stands for the value of the previous stage. You can place `%` in any argument position — no currying or data-last overloads required.

## Chaining transformations with `|>`

```vibe
// run: try Console.log(try priceLabel())
function addMargin(n: number) { return n + 3 }
function double(n: number) { return n * 2 }

effect function priceLabel() {
  return 9 |> addMargin(%) |> double(%) |> `Price: ${%}`
}
// Inferred: string!!  ("Price: 24")
// Output: Price: 24
```

Each stage evaluates once, left to right. Every pipe body must use `%`, and an arrow function as an entire pipe stage needs parentheses: `1 |> (() => %)` (`EK2301`).

### Wrapping Effects with combinators

Because calling an effect function returns an unrun Effect, you can wrap it with `retry`, `timeout`, and `withSpan` either by nesting calls or piping with `|>`:

```vibe
// run: try Console.log(try preparedPrice())
effect function preparedPrice() {
  return try (priceLabel() |> timeout(%, "1 second") |> withSpan(%, "price-label"))
}
// Output: Price: 24
```

Store the piped expression before `try` (`const prepared = priceLabel() |> timeout(%, "1 second")`) whenever you want to reuse the wrapped blueprint.

## Replacing `map`, `as`, `flatMap`, and `tap` with statements

In Effect TypeScript, pipelines often exist just to chain `map`, `flatMap`, and `tap`. In VibeLang, ordinary statements are shorter and clearer:

### Transforming and logging (`map`, `as`, `tap`)

```vibe
// run: try Console.log(try adjustedPrice())
effect function adjustedPrice() {
  const price = 24
  return price + 5
}

effect function recordPrice() {
  try log(`price=${try adjustedPrice()}`)
  return "recorded"
}
// Output: 29
```

### Dependent steps (`flatMap` / `andThen`)

```vibe
// run: try Console.log(try total())
error InvalidRate

effect function discounted(price: number, percent: number) {
  if (percent < 0 || percent > 100) throw new InvalidRate()
  return price * (1 - percent / 100)
}

effect function total() {
  const price = try adjustedPrice()
  const reduced = try discounted(price, 12)
  return reduced + 2
}
// Inferred: number!InvalidRate
// Output: 27.52
```

### Observing intermediate values (`tap`)

```vibe
// run: try Console.log(try quotedTotal())
effect function quotedTotal() {
  const amount = try total()
  try Console.log(`quoted amount=${amount}`)
  return amount
}
// Output: quoted amount=27.52
// Output: 27.52
```

## Lifting `Option` and `Result` into Effects

`Option` and `Result` are plain data types. Convert them into Effects explicitly when you want a `None` or `Failure` to short-circuit on the `E` channel:

```vibe
// run: try Console.log([try positive(2), try validated(0)].join(", "))
effect function positive(value: number) {
  const optional = value > 0 ? Option.some(value) : Option.none()
  return try fromOption(optional)
}
// Inferred: number!NoSuchElementError

effect function validated(value: number) {
  const checked = value >= 0
    ? Result.succeed(value)
    : Result.fail("negative value")
  return try fromResult(checked)
}
// Inferred: number!string
// Output: 2, 0
```

## Transforming data types (`Option`, `Stream`, `Chunk`)

Effect data types expose standalone module functions (`Option.map`, `Stream.filter`, `Stream.take`). Chain them with `|>`:

```vibe
// run: { const jsonValue = [nickname(-1), try Stream.runCollect(warnings(Stream.make(24, 26, 30, 28, 40)))]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
function nickname(id: number) {
  return Option.some(id)
    |> Option.filter(%, (n) => n > 0)
    |> Option.map(%, (n) => `user-${n}`)
    |> Option.getOrElse(%, () => "anonymous")
}

function warnings(readings: Stream.Stream<number>) {
  return readings
    |> Stream.filter(%, (celsius) => celsius > 25)
    |> Stream.map(%, (celsius) => `${celsius} C`)
    |> Stream.take(%, 3)
}
// Output: ["anonymous",["26 C","30 C","28 C"]]
```

Or pass a curried module helper straight to JavaScript's `Array.prototype.map`:

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(totals([Option.some(2), Option.none()]))))
function totals(values: ReadonlyArray<Option.Option<number>>) {
  return values.map(Option.getOrElse(() => 0))
}
// Output: [2,0]
```

## Collecting multiple Effects

`all` accepts either a tuple or a record of Effect values and preserves its shape:

```vibe
// run: try Console.log(try summary())
effect function summary() {
  const details = try all({
    price: total(),
    label: priceLabel()
  }, { concurrency: 2 })
  return `${details.label}, total=${details.price}`
}
// Output: Price: 24, total=27.52
```

## Never discard a cold Effect

An Effect expression without `try`, `catch`, `fork`, or a runner is just an unused value — its body never runs (`EK4801` warns when an Effect statement is discarded):

```vibe
// run: try saveNotice()
effect function saveNotice() {
  const notice = Console.log("saved")
  try notice
  try Console.log("finished")
}
// Output: saved
// Output: finished
```

## Coming from Effect

- Statements + `try` replace `Effect.map`, `Effect.flatMap`, `Effect.andThen`, and `Effect.tap`.
- `x |> f(%)` replaces `x.pipe(f)` and `pipe(x, f)`. The global `pipe` function remains available for data-last combinators.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/building-pipelines)
