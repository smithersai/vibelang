# Option

`Option` works in VibeLang exactly as in Effect. It represents a present (`Some<A>`) or absent (`None`) value, for lookups, optional fields, and validation that needs no error description.

## Representing optional values and properties

```vibe
// pending: VIP-5, VIP-14
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

The `nickname` property always exists and its value records presence; an optional TypeScript property instead lets the key itself be missing. Choose by the distinction you need.

## Constructing and identifying variants

```vibe
// pending: VIP-5, VIP-14
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

`some` wraps a value; `none` carries no payload. `liftPredicate` makes a function that returns `Some` only for values that pass its predicate. Guards narrow the union; only `Some` has `.value`.

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(describe(Option.some("Mina"))); try Console.log(describe(Option.none()))
function describe(value: Option.Option<string>) {
  return Option.match(value, {
    onNone: () => "Anonymous",
    onSome: (name) => `Signed in as ${name}`
  })
}
```

```output
Signed in as Mina
Anonymous
```

`Option.match` handles both cases and removes the wrapper. Its callbacks only compute values; when handling presence needs services or other Effects, use a branch inside an effect function and run Effects with `try`.

## Mapping, sequencing, and filtering present values

```vibe
// pending: VIP-5, VIP-14
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

`map` transforms a present payload and skips `None`. `flatMap` sequences a callback that returns another option, without nesting wrappers. `filter` keeps a present value only if the predicate passes.

## Extracting values with defaults or exceptions

```vibe
// pending: VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify([extract(Option.some("Mina")), extract(Option.none())])); try Console.log(certain); const failed = try exit(sync(() => Option.getOrThrow(Option.none()))); if (Exit.isFailure(failed)) try Console.log(Cause.hasDies(failed.cause), Cause.hasFails(failed.cause))
function extract(value: Option.Option<string>) {
  return {
    defaulted: Option.getOrElse(value, () => "Guest"),
    nullable: Option.getOrNull(value),
    optional: Option.getOrUndefined(value)
  }
}

const certain = Option.getOrThrow(Option.some("known"))
```

```output
[{"defaulted":"Mina","nullable":"Mina","optional":"Mina"},{"defaulted":"Guest","nullable":null}]
known
true false
```

`getOrElse` computes its fallback only for `None`; `getOrNull` and `getOrUndefined` suit APIs that expect nullish values. `getOrThrow` throws a JavaScript exception on `None`. In Effect code, `sync(() => Option.getOrThrow(value))` treats that exception as a defect; `Effect.try` captures it as a typed failure. When absence is expected rather than a programming error, prefer a guard, a default, or `fromOption`.

## Choosing fallback options

```vibe
// pending: VIP-5, VIP-14
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

`orElse` calls its fallback only when the first option is absent; `firstSomeOf` picks the first present option in an iterable. Neither retries Effects: both operate on optional data.

## Adapting nullable values

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(Option.isNone(Option.fromNullishOr(null)), Option.isNone(Option.fromNullishOr(undefined)), Option.getOrNull(Option.fromNullishOr(0)), JSON.stringify(Option.getOrNull(Option.fromNullishOr(""))))
Option.fromNullishOr(null) // None
Option.fromNullishOr(undefined) // None
Option.fromNullishOr(0) // Some containing 0
Option.fromNullishOr("") // Some containing ""
```

```output
true true 0 ""
```

`fromNullishOr` treats only `null` and `undefined` as absent and keeps other falsy values, including zero, false, and the empty string. At an interop boundary, convert back with `getOrNull` or `getOrUndefined`.

## Converting options into effects

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try requiredPair())); try Console.log(requiredName(Option.none()) catch (error) => error._tag)
effect function requiredName(name: Option.Option<string>) {
  return try fromOption(name)
}
// string!Cause.NoSuchElementError!

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

`try fromOption(name)` gives the present value or fails with `NoSuchElementError` for `None`; import that error from `Cause` for its type or guard. Option is not an Effect subtype, so conversion is explicit: calling a function that returns an option gives the option object.

## Combining options

```vibe
// pending: VIP-5, VIP-14
// run: const result = combine(Option.some("Mina"), Option.some(3)); try Console.log(JSON.stringify([Option.getOrNull(result.record), Option.getOrNull(result.tuple), Option.getOrNull(result.fields)])); const absent = combine(Option.none(), Option.some(3)); try Console.log(Option.isNone(absent.record), Option.isNone(absent.tuple), Option.isNone(absent.fields))
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

`zipWith` combines two present values with a callback; `all` combines a tuple, record, or iterable of options into one. If any value is absent, the result is `None`.

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
// pending: VIP-5, VIP-14
// run: try Console.log(JSON.stringify(Option.getOrNull(combinedData())))
function combinedData() {
  return Option.map(Option.all([Option.some(" Daily "), Option.some(3)]), ([title, total]) => ({
    title: title.trim(), total
  }))
}
```

```output
{"title":"Daily","total":3}
```

`Option.gen` sequences JavaScript generator yields and stops at the first `None`. A plain `function*` keeps its JavaScript meaning in `.vibe`, so the same generator API works there. In VibeLang, use `flatMap`, `zipWith`, and `all` for the same computation, as above.

## Deriving equality and ordering

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(same(Option.some(4), Option.some(4)), same(Option.none(), Option.some(4))); try Console.log(JSON.stringify([sorted.map((item) => Option.getOrNull(item)), descending.map((item) => Option.getOrNull(item))]))
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

`makeEquivalence` compares present values with a chosen relation; two absent options are equivalent. `makeOrder` puts `None` before `Some` and compares present values with the supplied order. Flipping the whole option order reverses present values and moves `None` to the end.
