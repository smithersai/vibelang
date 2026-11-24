# Expected Errors

![Delete the catch and the failure moves into the type](/videos/type-flip.mp4)

Expected errors are domain failures callers should handle: invalid input, a missing record, a rate-limited request. VibeLang infers them in channel `E` and narrows them when caught.

![Handling one failure class with catch and match removes it from E](/diagrams/try-catch-flow.svg)

## Declaring and throwing typed errors

```vibe
// run: try Console.log(try normalizeCode(" pen ")); try Console.log((try flip(normalizeCode(" ")))._tag)
error InvalidCode {
  input: string
}
error ItemMissing {
  code: string
}

effect function normalizeCode(input: string) {
  const code = input.trim()
  if (code.length === 0) throw new InvalidCode({ input })
  return code.toUpperCase()
}
// Inferred: string!InvalidCode
```

```output
PEN
InvalidCode
```

`error InvalidCode { input: string }` declares a tagged error class — short for `class InvalidCode extends Data.TaggedError("InvalidCode")<{ readonly input: string }> {}`. Every instance has a readonly `_tag` matching the class name, shallowly readonly payload fields, and an object-argument constructor. Omit braces for a fieldless error: `error Timeout`.

Inside an `effect` function, `throw` fails with that typed error (equivalent to `try fail(err)`). A plain function can't throw: a `throw` there is `EK0401`, and so is an unwrapped call known to throw — either make the function `effect`, catch exceptions inside a plain `try`/`catch` block, or keep JavaScript's `throw` in a `module` block (with `@throws {T}`) or a `.ts` file.

```vibe
// run: try Console.log(quantityOr("3", 0)); try Console.log(quantityOr("x", 0))
function quantityOr(text: string, fallback: number): number {
  try {
    const quantity = JSON.parse(text)
    return Number.isInteger(quantity) ? quantity : fallback
  } catch {
    return fallback
  }
}
// Output: 3
// Output: 0
```

## Wrapping throwing TypeScript functions

The compiler tracks what foreign `.ts` and JS functions may throw via `@throws` (unannotated `.ts` callables default to `@throws {unknown}`). In effect code, wrap any call that may throw with `Effect.try` (`EK0403`) and promote unknown exceptions to defects with `die`:

```ts
// TypeScript (.ts)
// quantity.ts
export class InvalidQuantity extends Error {
  readonly _tag = "InvalidQuantity"
}

export function parseQuantity(text: string): number {
  const quantity = Number(text)
  if (!Number.isInteger(quantity)) throw new InvalidQuantity(text)
  return quantity
}
```

```vibe
// run: try Console.log(try quantity("3")); try Console.log((try flip(quantity("x")))._tag)
import { InvalidQuantity, parseQuantity } from "./quantity.ts"

effect function quantity(text: string) {
  return Effect.try(() => parseQuantity(text)) catch effect (error) => {
    if (error.cause instanceof InvalidQuantity) throw error.cause
    return try die(error.cause)
  }
}
```

```output
3
InvalidQuantity
```

## Failing in an expression (`throw` expressions)

`throw` is also an expression (TC39 throw expressions), so it works directly on the right side of `??`, `||`, `&&`, and `?:`:

```vibe
// run: try Console.log(try port(new Map([["PORT", "3000"]]))); try Console.log((try flip(port(new Map())))._tag)
error MissingPort

effect function port(env: Map<string, string>) {
  return env.get("PORT") ?? throw new MissingPort()
}
// Inferred: string!MissingPort
```

```output
3000
MissingPort
```

The `throw` evaluates only when its branch is taken. Parenthesize a `throw` expression before another operator or comma: `f((throw err), next)` (`EK1010`).

## Tracking several error cases

When an effect function runs multiple Effects, their errors accumulate as a union in `E`. Execution stops at the first failure:

```vibe
// run: try Console.log((try findItem("pen")).label); try Console.log((try flip(findItem("book")))._tag); try Console.log((try flip(findItem("")))._tag)
effect function findItem(input: string) {
  const code = try normalizeCode(input)
  if (code !== "PEN") throw new ItemMissing({ code })
  return { code, label: "Fountain pen" }
}
// Inferred: { code: string; label: string }!(InvalidCode | ItemMissing)
```

```output
Fountain pen
ItemMissing
InvalidCode
```

## Turning failures into values (`result` and `option`)

Move `E` into the success channel as ordinary data when you prefer branching over `catch`:

```vibe
// run: try Console.log(try inspectItem("pen")); try Console.log(try inspectItem("")); try Console.log(try inspectItem("book")); try Console.log(try optionalItem("pen")); try Console.log(try optionalItem("book"))
effect function inspectItem(input: string) {
  const outcome = try result(findItem(input))
  return Result.match(outcome, {
    onFailure: (error) => `unavailable: ${error._tag}`,
    onSuccess: (item) => item.label
  })
}

effect function optionalItem(input: string) {
  const item = try option(findItem(input))
  return Option.isNone(item) ? "No item" : item.value.label
}
```

```output
Fountain pen
unavailable: InvalidCode
unavailable: ItemMissing
Fountain pen
No item
```

`result` yields `Result<A, E>`. `option` yields `Option<A>`, discarding error details — use it only when every failure means absence. Neither catches defects; use `exit(...)` to capture defects and interruption as well.

## Catching all expected failures

Attach `catch` directly to an Effect expression or an `effect { ... }` block. The handler receives the inferred union `InvalidCode | ItemMissing`, and `E` collapses to `never`:

```vibe
// run: try Console.log(try itemLabel("pen")); try Console.log(try itemLabel("")); try Console.log(try itemLabel("book"))
effect function itemLabel(input: string) {
  return effect {
    return (try findItem(input)).label
  } catch (error) => `Unavailable (${error._tag})`
}
// Inferred: string!!
```

```output
Fountain pen
Unavailable (InvalidCode)
Unavailable (ItemMissing)
```

For a single call, skip the `effect { ... }` block and write `expr catch (error) => ...` directly (never `try expr catch ...`):

```vibe
// run: try Console.log(try itemLabelInline("pen")); try Console.log(try itemLabelInline("")); try Console.log(try itemLabelInline("book"))
effect function itemLabelInline(input: string) {
  const item = findItem(input) catch (error) => ({
    code: "",
    label: `Unavailable (${error._tag})`
  })
  return item.label
}
// Inferred: string!!
```

```output
Fountain pen
Unavailable (InvalidCode)
Unavailable (ItemMissing)
```

`catch` handles expected failures only. Defects and pure interruptions pass through untouched.

## Catching selected failures (`catch effect` + `match`)

Use `catch effect` with `match` to recover specific error classes and rethrow the rest with their exact types intact:

```vibe
// run: try Console.log(try labelOrMissing("book")); try Console.log((try flip(labelOrMissing("")))._tag); try Console.log((try labelByTag("book")).label); try Console.log((try flip(labelByTag("")))._tag)
// expect-warning: EK4835
effect function labelOrMissing(input: string) {
  return effect {
    return (try findItem(input)).label
  } catch effect (error) => match (error) {
    when ItemMissing: "Out of catalog";
    default: throw error;
  }
}
// Inferred: string!InvalidCode

effect function labelByTag(input: string) {
  return try catchTag(
    findItem(input),
    "ItemMissing",
    (error) => succeed({ code: error.code, label: "Out of catalog" })
  )
}
```

```output
Out of catalog
InvalidCode
Out of catalog
InvalidCode
```

- `when ItemMissing:` matches by `_tag` (even across duplicate package copies) and removes `ItemMissing` from `E`.
- `default: throw error;` rethrows the remaining union (`InvalidCode`), preserving the caller's type.
- Omitting `default` on a finite union enforces exhaustiveness (`EK4701`) — add a new error class later and the compiler flags every unhandled `match`.

Effect's combinators (`catchTags`, `catchFilter`, `catchIf`) remain available when you want reusable filter values:

```vibe
// run: try Console.log((try withTagTable("")).label); try Console.log((try withFilter("book")).label); try Console.log((try withPredicate("book")).label); try Console.log((try flip(withFilter("")))._tag); try Console.log((try flip(withPredicate("")))._tag)
// expect-warning: EK4835
effect function withTagTable(input: string) {
  return try catchTags(findItem(input), {
    InvalidCode: () => succeed({ code: "", label: "Enter a code" }),
    ItemMissing: (error) => succeed({ code: error.code, label: "Out of catalog" })
  })
}

effect function withFilter(input: string) {
  return try catchFilter(
    findItem(input),
    Filter.tagged("ItemMissing"),
    (error) => succeed({ code: error.code, label: "Out of catalog" })
  )
}

effect function withPredicate(input: string) {
  return try catchIf(
    findItem(input),
    (error): error is ItemMissing => error._tag === "ItemMissing",
    () => succeed({ code: "", label: "Out of catalog" })
  )
}
```

```output
Enter a code
Out of catalog
Out of catalog
InvalidCode
InvalidCode
```

## Filtering nested reasons

When an outer error wraps a union of causes in a readonly `reason` field, use `catchReason`, `catchReasons`, or `unwrapReason`:

```vibe
// run: try Console.log(try explainBusy()); try Console.log(try explainReasons()); try Console.log((try flip(exposeReasons()))._tag)
error Busy { seconds: number }
error Rejected
error CatalogError {
  reason: Busy | Rejected
}

effect function remoteLabel(): string!CatalogError {
  throw new CatalogError({ reason: new Busy({ seconds: 4 }) })
}

effect function explainBusy() {
  return try catchReason(
    remoteLabel(), "CatalogError", "Busy",
    (reason) => succeed(`Try again in ${reason.seconds} seconds`)
  )
}

effect function explainReasons() {
  return try catchReasons(remoteLabel(), "CatalogError", {
    Busy: (reason) => succeed(`Wait ${reason.seconds} seconds`),
    Rejected: () => succeed("Request rejected")
  })
}

effect function exposeReasons() {
  return try unwrapReason(remoteLabel(), "CatalogError")
}
// Inferred: string!(Busy | Rejected)
```

```output
Try again in 4 seconds
Wait 4 seconds
Busy
```

## Error families and methods

`error` bodies may define getters and methods, and related errors are grouped with ordinary TypeScript union types:

```vibe
// run: try Console.log(try describeFamily(new MissingFile({ code: "E1", path: "/a" }))); try Console.log(try describeFamily(new ExpiredFile({ code: "E2" }))); try Console.log(normalizedError(" pen ").label)
error MissingFile { code: string; path: string }
error ExpiredFile { code: string }
type FileError = MissingFile | ExpiredFile

effect function raiseFile(error: FileError) {
  throw error
}

effect function describeFamily(error: FileError) {
  return raiseFile(error) catch (failure) => match (failure) {
    when MissingFile(let m): `missing ${m.path}`;
    when ExpiredFile(let e): `expired ${e.code}`;
  }
}
// Inferred: string!!

error Normalized {
  code: string

  get label(): string {
    return `${this._tag} ${this.code}`
  }
}

function normalizedError(input: string) {
  return new Normalized({ code: input.trim().toUpperCase() })
}
```

```output
missing /a
expired E2
Normalized PEN
```

## Serializable errors (`schema error`)

When an error must cross RPC, HTTP, or disk, declare a `schema error`. It compiles to `Schema.TaggedError` so every field automatically encodes and decodes:

```vibe
// run: try Console.log(try encodeStoreError()); try Console.log(try decodeStoreError())
schema error NotStored { key: string; attempts: number }

effect function encodeStoreError() {
  const encoded = try Schema.encodeEffect(NotStored)(new NotStored({ key: "a", attempts: 2 }))
  return try Effect.try(() => JSON.stringify(encoded))
}

effect function decodeStoreError() {
  const decoded = try Schema.decodeUnknownEffect(NotStored)({ _tag: "NotStored", key: "b", attempts: 1 })
  return match (decoded) {
    when NotStored: true;
    default: false;
  }
}
```

```output
{"_tag":"NotStored","key":"a","attempts":2}
true
```

See [Failures in the specification](../../../design/src/003-failures.md) for declaration rules, or use the [diagnostic code map](../vibelang-features/diagnostic-code-map.md) to look up a compiler error.

## Coming from Effect

| Effect TypeScript | VibeLang |
| --- | --- |
| `class E extends Data.TaggedError("E")<{ readonly id: string }> {}` | `error E { id: string }` |
| `class E extends Schema.TaggedError<E>()("E", { id: Schema.String }) {}` | `schema error E { id: string }` |
| `Effect.fail(err)` | `throw err` |
| `Effect.catch(e, (err) => ...)` | `e catch effect (err) => ...` |
| `Effect.catchTag(e, "NotFound", ...)` | `e catch effect (err) => match (err) { when NotFound: ...; default: throw err; }` |

[Upstream Effect page](https://effect.website/docs/v4/error-management/expected-errors)
