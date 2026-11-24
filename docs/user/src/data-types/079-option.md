# Option

`Option.Option<A>` models an optional value as either `Some<A>` (present) or `None` (absent). Use it for lookups, explicit absence in data models, and validations where no error payload is needed.

| Category | Key APIs |
| --- | --- |
| Construct & guard | `some`, `none`, `fromNullishOr`, `liftPredicate`, `isSome`, `isNone` |
| Transform & combine | `map`, `flatMap`, `filter`, `zipWith`, `all` |
| Extract & fallback | `match`, `getOrElse`, `getOrNull`, `getOrUndefined`, `getOrThrow`, `orElse`, `firstSomeOf` |
| Effect & traits | `fromOption`, `makeEquivalence`, `makeOrder` |

## Representing optional values and properties

```vibe
// run: try Console.log(Option.getOrNull(named.nickname), Option.isNone(unnamed.nickname))
interface Contact {
  name: string
  nickname: Option.Option<string>
}

const named: Contact = { name: "Mina", nickname: Option.some("Mi") }
const unnamed: Contact = { name: "Sol", nickname: Option.none() }
```

```output
Mi true
```

An `Option` field is always present on the object and explicitly encodes presence or absence, whereas an optional TypeScript property (`nickname?: string`) permits omitting the key itself.

## Constructing and identifying variants

```vibe
// run: try Console.log(Option.isNone(positive(-2)), Option.isSome(present), Option.isNone(absent)); try Console.log(label(present)); try Console.log(label(absent))
const present = Option.some(24)
const absent = Option.none<number>()
const positive = Option.liftPredicate((n: number) => n > 0)
positive(-2) // None
Option.isSome(present) // true
Option.isNone(absent) // true

function label(value: Option.Option<number>) {
  if (Option.isSome(value)) return `Limit: ${value.value}`
  return "No limit"
}
```

```output
true true true
Limit: 24
No limit
```

`Option.some` wraps a value, `Option.none` constructs absence, and `Option.liftPredicate` turns a predicate into an `Option`-returning function. `Option.isSome` narrows the union to expose `.value`.

```vibe
// run: try Console.log(describe(Option.some("Mina"))); try Console.log(describe(Option.none()))
function describe(value: Option.Option<string>) {
  return match (value) {
    when Option.Some(let name): `Signed in as ${name}`;
    when Option.None: "Anonymous";
  }
}
```

```output
Signed in as Mina
Anonymous
```

`match` handles `Option.Some(let x)` and `Option.None` exhaustively. Inside an effect function, arms may run Effects directly with `try`.

## Mapping, sequencing, and filtering present values

```vibe
// run: try Console.log(Option.getOrNull(streetLabel(Option.some({ street: Option.some(" Main St ") })))); try Console.log(Option.isNone(streetLabel(Option.some({ street: Option.some(" ") }))), Option.isNone(streetLabel(Option.none())))
interface Address {
  street: Option.Option<string>
}

function streetLabel(address: Option.Option<Address>) {
  const street = Option.flatMap(address, (value) => value.street)
  const trimmed = Option.map(street, (value) => value.trim())
  return Option.filter(trimmed, (value) => value.length > 0)
}
```

```output
Main St
true true
```

`map` transforms a `Some` payload and passes `None` through unchanged. `flatMap` chains `Option`-returning callbacks without nesting, and `filter` demotes non-matching values to `None`.

## Extracting values with defaults or exceptions

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([extract(Option.some("Mina")), extract(Option.none())]))); try Console.log(certain); const failed = try exit(Effect.try(() => Option.getOrThrow(Option.none()))); if (Exit.isFailure(failed)) try Console.log(Cause.hasDies(failed.cause), Cause.hasFails(failed.cause))
function extract(value: Option.Option<string>) {
  return {
    defaulted: Option.getOrElse(value, () => "Guest"),
    nullable: Option.getOrNull(value),
    optional: Option.getOrUndefined(value)
  }
}

const certain = Option.getOrElse(Option.some("known"), () => "fallback")
```

```output
[{"defaulted":"Mina","nullable":"Mina","optional":"Mina"},{"defaulted":"Guest","nullable":null}]
known
false true
```

`getOrElse` evaluates its fallback lazily on `None`, while `getOrNull` and `getOrUndefined` adapt to nullable JavaScript APIs. `getOrThrow` throws on `None`—wrap it in `Effect.try` (not `sync`, which requires non-throwing callbacks) if called in effect code, or prefer `fromOption` when absence is expected.

## Choosing fallback options

```vibe
// run: try Console.log(Option.getOrNull(choose(Option.some("preferred"), Option.some("backup"))), Option.getOrNull(choose(Option.none(), Option.some("backup"))), Option.getOrNull(first))
function choose(
  preferred: Option.Option<string>,
  backup: Option.Option<string>
) {
  return Option.orElse(preferred, () => backup)
}

const first = Option.firstSomeOf([
  Option.none(), Option.some("regional"), Option.some("global")
]) // Some containing "regional"
```

```output
preferred backup regional
```

`orElse` computes a fallback `Option` only on `None`, and `firstSomeOf` returns the first `Some` in an iterable. Both operate purely on optional data rather than retrying Effects.

## Adapting nullable values

```vibe
// run: try Console.log(Option.isNone(Option.fromNullishOr(null)), Option.isNone(Option.fromNullishOr(undefined)), Option.getOrNull(Option.fromNullishOr(0)), try Effect.try(() => JSON.stringify(Option.getOrNull(Option.fromNullishOr("")))))
Option.fromNullishOr(null) // None
Option.fromNullishOr(undefined) // None
Option.fromNullishOr(0) // Some containing 0
Option.fromNullishOr("") // Some containing ""
```

```output
true true 0 ""
```

`Option.fromNullishOr` maps only `null` and `undefined` to `None`, preserving falsy values (`0`, `false`, `""`). Convert back at interop boundaries with `getOrNull` or `getOrUndefined`.

## Converting options into effects

```vibe
// run: { const jsonValue = try requiredPair(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(requiredName(Option.none()) catch (error) => error._tag)
effect function requiredName(name: Option.Option<string>) {
  return try fromOption(name)
}
// string!Cause.NoSuchElementError

effect function requiredPair() {
  return try all([
    fromOption(Option.some("east")),
    fromOption(Option.some(3))
  ])
}
```

```output
["east",3]
NoSuchElementError
```

`try fromOption(opt)` unwraps `Some` or fails in `E` with `Cause.NoSuchElementError` on `None`. Because `Option` is not an Effect subtype, convert explicitly with `fromOption` before passing it to Effect combinators.

## Combining options

```vibe
// run: const result = combine(Option.some("Mina"), Option.some(3)); try Console.log(try Effect.try(() => JSON.stringify([Option.getOrNull(result.record), Option.getOrNull(result.tuple), Option.getOrNull(result.fields)]))); const absent = combine(Option.none(), Option.some(3)); try Console.log(Option.isNone(absent.record), Option.isNone(absent.tuple), Option.isNone(absent.fields))
function combine(
  name: Option.Option<string>,
  count: Option.Option<number>
) {
  const record = Option.zipWith(name, count, (name, count) => ({ name, count }))
  const tuple = Option.all([name, count])
  const fields = Option.all({ name, count })
  return { record, tuple, fields }
}
```

```output
[{"name":"Mina","count":3},["Mina",3],{"name":"Mina","count":3}]
true true true
```

`zipWith` combines two present options through a callback, and `all` combines tuples, records, or iterables of options. Any `None` input yields `None`.

## Combining several options

```ts
// TypeScript (.ts)
// combine-options.ts
// run: console.log(JSON.stringify(Option.getOrNull(combineOptions(Option.some(" Daily "), Option.some(3))))); console.log(Option.isNone(combineOptions(Option.none(), Option.some(3))))
import { Option } from "effect"

export function combineOptions(
  name: Option.Option<string>,
  count: Option.Option<number>
) {
  return Option.gen(function* () {
    const title = (yield* name).trim()
    const total = yield* count
    return { title, total }
  })
}
```

```output
{"title":"Daily","total":3}
true
```

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(Option.getOrNull(combinedData()))))
function combinedData() {
  return Option.map(Option.all([Option.some(" Daily "), Option.some(3)]), ([title, total]) => ({
    title: title.trim(), total
  }))
}
```

```output
{"title":"Daily","total":3}
```

`Option.gen` uses a plain JavaScript generator (`function*`, which keeps standard JS semantics in `.vibe`) to short-circuit on the first `None`. In VibeLang, prefer `Option.flatMap`, `Option.zipWith`, and `Option.all`.

## Deriving equality and ordering

```vibe
// run: try Console.log(same(Option.some(4), Option.some(4)), same(Option.none(), Option.some(4))); try Console.log(try Effect.try(() => JSON.stringify([sorted.map((item) => Option.getOrNull(item)), descending.map((item) => Option.getOrNull(item))])))
const same = Option.makeEquivalence(Equivalence.Number)
same(Option.some(4), Option.some(4)) // true
same(Option.none(), Option.some(4)) // false

const ascending = Option.makeOrder(Order.Number)
const items = [Option.some(8), Option.none(), Option.some(2)]
const sorted = Effect.Array.sort(items, ascending)
// [None, Some(2), Some(8)]
const descending = Effect.Array.sort(items, Order.flip(ascending))
// [Some(8), Some(2), None]
```

```output
true false
[[null,2,8],[8,2,null]]
```

`makeEquivalence` considers two `None` values equal and delegates `Some` pairs to the inner equivalence. `makeOrder` sorts `None` before `Some` and orders present values with the inner order; `Order.flip` reverses both present values and `None`'s position.
