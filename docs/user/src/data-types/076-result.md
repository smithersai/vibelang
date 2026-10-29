# Result

`Result` works in VibeLang exactly as in Effect. A `Result.Result<A, E>` stores a synchronous success or an expected failure as data, so validation can return an outcome without raising it in the caller.

## Results and execution exits

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(Result.isSuccess(parseCount("6")), Result.isFailure(parseCount("-1")), Result.isFailure(parseCount("")))
function parseCount(text: string) {
  const count = Number(text)
  return text.trim() !== "" && Number.isInteger(count) && count >= 0
    ? Result.succeed(count)
    : Result.fail("Expected a nonnegative integer")
}
// Result.Result<number, string>
```

```output
true true true
```

Returning a failed `Result` does not throw: `parseCount` is a plain function that returns the result object. `Result` is a choice between A and E and records no defects or interruption; for a computation's complete outcome, use `Exit`.

## Constructing and identifying variants

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(Result.isResult(accepted), Result.isSuccess(accepted), Result.isFailure(rejected)); try Console.log(label(accepted)); try Console.log(label(rejected))
const accepted = Result.succeed(8)
const rejected = Result.fail("limit exceeded")
Result.isResult(accepted) // true
Result.isSuccess(accepted) // true
Result.isFailure(rejected) // true

function label(result: Result.Result<number, string>) {
  if (Result.isSuccess(result)) return `Count: ${result.success}`
  return `Rejected: ${result.failure}`
}
```

```output
true true true
Count: 8
Rejected: limit exceeded
```

A success holds its payload in `.success`, a failure in `.failure`; guards narrow the union before you read them. Neither variant is an Effect subtype, though JavaScript Effect generators can yield a Result.

## Matching and mapping outcomes

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(summarize(Result.succeed(6))); try Console.log(summarize(Result.fail("invalid")))
function summarize(result: Result.Result<number, string>) {
  const increased = Result.map(result, (count) => count + 2)
  const contextual = Result.mapError(increased, (error) => `count: ${error}`)
  const both = Result.mapBoth(contextual, {
    onSuccess: (count) => String(count),
    onFailure: (error) => error.toUpperCase()
  })
  return Result.match(both, {
    onSuccess: (count) => `Accepted ${count}`,
    onFailure: (error) => `Rejected ${error}`
  })
}
```

```output
Accepted 8
Rejected COUNT: INVALID
```

`map` transforms only success and `mapError` only failure; `mapBoth` applies the transformation for the current variant, and `match` handles both and removes the wrapper. Keep these callbacks synchronous; for service work, narrow the result in an effect function and run Effects with `try`.

## Converting results into effects

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(JSON.stringify(try validatePair())); try Console.log(requireCount("-1") catch (error) => `${error._tag} ${error.input}`)
error InvalidCount {
  input: string
}

effect requireCount(input: string) {
  const count = Number(input)
  const result = input.trim() !== "" && Number.isInteger(count) && count >= 0
    ? Result.succeed(count)
    : Result.fail(new InvalidCount({ input }))
  return try fromResult(result)
}
// number!InvalidCount!

effect validatePair() {
  return try all([
    requireCount("6"),
    fromResult(Result.succeed("ready"))
  ])
}
```

```output
[6,"ready"]
InvalidCount -1
```

`try fromResult(result)` runs the Effect: success gives A, failure enters E. Convert explicitly when passing a result to an Effect combinator. Conversely, `try result(work())` collects expected failures into a result: a cause with none still propagates, and so does one with a defect, its expected failures as defects; for an expected failure beside an interruption, Effect returns the first expected failure and discards the interruption. To keep every reason, use `try exit(work())`.

## Sequencing and combining results

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: const result = combine(Result.succeed(" Weekly "), Result.succeed(6)); try Console.log(JSON.stringify([try Effect.try(() => Result.getOrThrow(result.chained)), try Effect.try(() => Result.getOrThrow(result.tuple)), try Effect.try(() => Result.getOrThrow(result.record))])); const failed = combine(Result.fail("missing"), Result.fail("invalid")); try Console.log(Result.getOrElse(failed.chained, (error) => error), Result.getOrElse(failed.tuple, (error) => error), Result.getOrElse(failed.record, (error) => error))
function combine(
  name: Result.Result<string, string>,
  count: Result.Result<number, string>
) {
  const chained = Result.flatMap(name, (name) =>
    Result.map(count, (count) => ({ name: name.trim(), count })))
  const tuple = Result.all([name, count])
  const record = Result.all({ name, count })
  return { chained, tuple, record }
}
```

```output
[{"name":"Weekly","count":6},[" Weekly ",6],{"name":" Weekly ","count":6}]
missing missing missing
```

`flatMap` chains a callback that returns a result, stopping at the first failure. `all` combines a tuple, record, or iterable of results into one, returning the first failure. It combines values already supplied; it is not a concurrency operator.

```ts
// TypeScript (.ts)
// combine-results.ts
// run: console.log(JSON.stringify(Result.getOrThrow(combineResults(Result.succeed(" Weekly "), Result.succeed(6))))); console.log(Result.getOrElse(combineResults(Result.fail("missing"), Result.succeed(6)), (error) => error))
import { Result } from "effect"

export function combineResults(
  title: Result.Result<string, string>,
  count: Result.Result<number, string>
) {
  return Result.gen(function* () {
    const normalized = (yield* title).trim()
    const total = yield* count
    return { title: normalized, count: total }
  })
}
```

```output
{"title":"Weekly","count":6}
missing
```

```vibe
// pending: VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try Effect.try(() => Result.getOrThrow(combinedData()))))
function combinedData() {
  return Result.map(Result.all([Result.succeed(" Weekly "), Result.succeed(6)]), ([title, count]) => ({
    title: title.trim(), count
  }))
}
```

```output
{"title":"Weekly","count":6}
```

`Result.gen` sequences with JavaScript generators: the first yielded failure skips the rest. A plain `function*` keeps its JavaScript meaning in `.vibe`, so the same generator API works there. In VibeLang, use `flatMap` and `all` for the same computation, as above.
