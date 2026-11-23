# Result

`Result.Result<A, E>` represents a synchronous outcome as data—either `Success<A>` or an expected `Failure<E>`. Use it in plain functions such as parsers and validators to return typed errors without throwing or invoking Effect.

| Operation | Purpose |
| --- | --- |
| `succeed(a)`, `fail(e)` | Construct success or failure values |
| `isResult`, `isSuccess`, `isFailure` | Narrow to `.success` or `.failure` |
| `map`, `mapError`, `mapBoth`, `match` | Transform or unwrap payloads synchronously |
| `flatMap`, `all` | Sequence or combine multiple results, short-circuiting on first failure |
| `fromResult(r)`, `result(eff)` | Bridge between `Result` and Effect's typed error channel |

## Results and execution exits

```vibe
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

Returning `Result.fail` never throws; the caller receives the failure value directly. Because `Result` models only `A | E` with no defects or interruption, use `Exit` when you need a computation's complete execution outcome.

## Constructing and identifying variants

```vibe
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

Guards narrow a `Result` to expose `.success` on success or `.failure` on failure. `Result` is plain data rather than an Effect subtype, even though TypeScript `Effect.gen` allows yielding one.

## Matching and mapping outcomes

```vibe
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

`map` updates the success payload, `mapError` updates the failure payload, `mapBoth` transforms whichever branch is present, and `match` unwraps both branches to a single return value. Keep these callbacks synchronous; when handling a variant requires services or effects, narrow the `Result` inside an effect function and use `try`.

## Converting results into effects

```vibe
// run: { const jsonValue = try validatePair(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(requireCount("-1") catch (error) => `${error._tag} ${error.input}`)
error InvalidCount {
  input: string
}

effect function requireCount(input: string) {
  const count = Number(input)
  const result = input.trim() !== "" && Number.isInteger(count) && count >= 0
    ? Result.succeed(count)
    : Result.fail(new InvalidCount({ input }))
  return try fromResult(result)
}
// number!InvalidCount

effect function validatePair() {
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

`try fromResult(r)` lifts a `Result` into Effect: success yields `A` and failure enters `E`. In the reverse direction, `try result(work())` captures expected failures as `Result.fail`—causes with defects or without a typed failure still propagate, and a typed failure combined with interruption returns the first typed failure while discarding the interruption. Use `try exit(work())` to preserve all causes.

## Sequencing and combining results

```vibe
// run: const result = combine(Result.succeed(" Weekly "), Result.succeed(6)); { const jsonValue = [try Effect.try(() => Result.getOrThrow(result.chained)), try Effect.try(() => Result.getOrThrow(result.tuple)), try Effect.try(() => Result.getOrThrow(result.record))]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; const failed = combine(Result.fail("missing"), Result.fail("invalid")); try Console.log(Result.getOrElse(failed.chained, (error) => error), Result.getOrElse(failed.tuple, (error) => error), Result.getOrElse(failed.record, (error) => error))
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

`Result.flatMap` chains dependent validations and `Result.all` combines tuples, records, or iterables of existing results, short-circuiting on the first failure. Because inputs are already-computed values, `Result.all` performs no concurrency.

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
// run: { const jsonValue = try Effect.try(() => Result.getOrThrow(combinedData())); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
function combinedData() {
  return Result.map(Result.all([Result.succeed(" Weekly "), Result.succeed(6)]), ([title, count]) => ({
    title: title.trim(), count
  }))
}
```

```output
{"title":"Weekly","count":6}
```

`Result.gen` short-circuits on the first yielded failure using a plain JavaScript generator (`function*`, which keeps its standard meaning in `.vibe` without `EK1002`, unlike `effect function*`). In VibeLang, prefer `Result.flatMap` and `Result.all` directly.
