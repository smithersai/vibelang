# Expected Errors

Expected errors are situations callers can handle: invalid input, a denied operation, an unavailable dependency. VibeLang infers them in `E` and narrows them inside a catch expression.

[Upstream page](https://effect.website/docs/v4/error-management/expected-errors)

## Constructing typed failures

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
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
// string!InvalidCode
```

```output
PEN
InvalidCode
```

`error InvalidCode { input: string }` declares an expected failure class, short for `class InvalidCode extends Data.TaggedError("InvalidCode")<{ readonly input: string }> {}`, which also compiles. The constructor takes the fields, all readonly, and each instance has a readonly `_tag` equal to the class name. `error Timeout` has no fields. In an effect function, `throw` adds the class to `E`. `try fail(error)` also works; `try failSync(() => error)` defers construction to execution, as a function body already does.

VibeLang annotates `JSON.parse` as throwing `SyntaxError`. An effect function must wrap a synchronous call that may throw with `Effect.try` before running it with `try`. Library declarations describe thrown types with `@throws {ErrorType}`; an unannotated callable declared in `.ts`, `.d.ts` or JavaScript may throw `unknown`, even when it has a written function type. Its source and emitted declarations agree. Exported non-effectful VibeLang call signatures carry their written or inferred `@throws` contract, including `@throws {never}`. A `@rethrows callback` adds that callback's thrown type at each invocation; an own `@throws {never}` does not erase it. Effectful callables carry no `@throws`. Wrap every Promise with `tryPromise`, including one that cannot reject. Synchronous functions known not to throw, such as `Option.isNone`, need no wrapper. A function whose return type is wholly an Effect, a Stream or a Layer is never throw-tracked: its failures are its Effect's error channel.

In an effect function, `throw` is a typed failure and a catch expression receives typed failures only. A plain function keeps TypeScript's behavior: its return annotation checks its result, and its `try`/`catch` statement can handle JavaScript exceptions while returning a value:

```vibe
// pending: VIP-13, VIP-14, VIP-5
// run: try Console.log(quantityOr("3", 0)); try Console.log(quantityOr("x", 0))
error InvalidQuantity { text: string }

function quantityOr(text: string, fallback: number): number {
  try {
    const quantity = Number(text)
    if (!Number.isInteger(quantity)) throw new InvalidQuantity({ text })
    return quantity
  } catch {
    return fallback
  }
}
// Output: 3
// Output: 0
```

A plain function may throw, and its thrown type is inferred. A plain return annotation does not make a function effectful:

```vibe
// pending: VIP-4, VIP-13
function quantity(text: string): number {
  const value = Number(text)
  if (!Number.isInteger(value)) throw new InvalidQuantity({ text })
  return value
}
```

A generic call retains its declaration's thrown contract even when a type argument makes its result an Effect. A `@rethrows` parameter's possible default callback also contributes to a synchronous callable's conservative own thrown bound, retained in `@throws` when declaration output erases the default; a safe supplied callback does not erase that bound.

Calling an effect function returns its unrun Effect. A caller runs it with `try` inside an effect function or Effect block. A defect is for a failure no caller should handle: a catch expression never receives one. In a plain or async function, `throw` is JavaScript's, and `orDie(Effect.try(() => call()))` turns such an exception into a defect; `sync` takes only a function that can't throw.

An effect method follows the same rules: its keyword determines its kind, and its return annotation checks the Effect type. A plain method, including a JavaScript protocol member such as `[Equal.symbol]`, keeps TypeScript's behavior. A plain function calls TypeScript code directly and handles JavaScript exceptions with `try`/`catch`. To run an Effect, use `try` inside an effect function or Effect block.

An effect function can stand for a function type returning an Effect. Calling it returns that Effect unrun; a plain caller that ignores the return value does not run its work. Declare a function returning an Effect at a destination that needs one, or provide a plain function for a plain result. This applies to initializers, assignments, returns, property writes, typed literal elements, and members of objects and class instances.

## Wrapping a TypeScript function

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
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try quantity("3")); try Console.log((try flip(quantity("x")))._tag)
import { InvalidQuantity, parseQuantity } from "./quantity.ts"

effect function quantity(text: string) {
  return Effect.try({
    try: () => parseQuantity(text),
    catch: (cause) => cause
  }) catch effect (cause) => {
    if (cause instanceof InvalidQuantity) throw cause
    return try die(cause)
  }
}
```

```output
3
InvalidQuantity
```

`quantity` calls the TypeScript `parseQuantity` through `Effect.try`: an `InvalidQuantity` it throws is an expected failure in `E`, and any other exception is promoted to a defect with `die`. The callbacks are plain TypeScript functions and capture local variables normally; the effect handler fails with the selected error or runs `die` with `try`.

## Failing in an expression

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try port(new Map([["PORT", "3000"]]))); try Console.log((try flip(port(new Map())))._tag)
error MissingPort

effect function port(env: Map<string, string>) {
  return try effect {
    const value = env.get("PORT")
    if (value === undefined) throw new MissingPort()
    return value
  }
}
// string!MissingPort
```

```output
3000
MissingPort
```

An `effect { … }` expression builds an Effect from statements. Here it validates the optional value and fails with `MissingPort` when the key is absent. `try` runs the block and returns its successful string. The right side of `??`, `||`, `&&`, and `?:` runs only when chosen. The statement `throw cond ? a : b;` still throws the selected value.

## Tracking several error cases

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log((try findItem("pen")).label); try Console.log((try flip(findItem("book")))._tag); try Console.log((try flip(findItem("")))._tag)
effect function findItem(input: string) {
  const code = try normalizeCode(input)
  if (code !== "PEN") throw new ItemMissing({ code })
  return { code, label: "Fountain pen" }
}
// { code: string; label: string }!(InvalidCode | ItemMissing)
```

```output
Fountain pen
ItemMissing
InvalidCode
```

An effect function collects the failures it throws and those of the Effects it runs. Sequential statements stop at the first failure: no lookup follows a failed normalization. An explicit full contract checks this inferred union; it doesn't replace it.

## Turning failures into values

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
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

`result` moves `E` into the success channel as `Result<A, E>`. `option` gives `Some` on success and discards a typed error as `None`; use it only when every domain failure means absence. Causes with no expected failure still propagate, and so do causes with a defect, their expected failures as defects; both consume an expected failure beside an interruption, as ordinary catch does. Match on `exit(...)` when interruption must always propagate intact.

## Recovering all failures

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-14
// run: try Console.log(try itemLabel("pen")); try Console.log(try itemLabel("")); try Console.log(try itemLabel("book"))
effect function itemLabel(input: string) {
  return effect {
    return (try findItem(input)).label
  } catch (error) => `Unavailable (${error._tag})`
}
// string!!
```

```output
Fountain pen
Unavailable (InvalidCode)
Unavailable (ItemMissing)
```

The catch expression receives `InvalidCode | ItemMissing` and handles both, but only in causes with no defect; given several expected failures together, it receives the first and handles their whole cause.

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try itemLabelInline("pen")); try Console.log(try itemLabelInline("")); try Console.log(try itemLabelInline("book"))
effect function itemLabelInline(input: string) {
  const item = findItem(input) catch (error) => ({
    code: "",
    label: `Unavailable (${error._tag})`
  })
  return item.label
}
// string!!
```

```output
Fountain pen
Unavailable (InvalidCode)
Unavailable (ItemMissing)
```

After an Effect, `x catch (error) => handler` runs `x` and passes an expected failure to the handler, as `Effect.catch` does. Causes with a defect or only interruption pass through; an expected failure beside an interruption is recovered. `x catch () => fallback` ignores the error and gives the fallback instead; see [Fallback](016-fallback.md).

`try Effect.catch(findItem(input), handler)` also recovers expected failures, with the same rule as source catch. `Effect.catchEager` has the same policy and can recover immediately when given an already computed `Exit`.

## Recovering selected failures

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-7, VIP-13, VIP-14
// run: try Console.log(try labelOrMissing("book")); try Console.log((try flip(labelOrMissing("")))._tag); try Console.log((try labelByTag("book")).label); try Console.log((try flip(labelByTag("")))._tag)
effect function labelOrMissing(input: string) {
  return effect {
    return (try findItem(input)).label
  } catch effect (error) => match (error) {
    when ItemMissing: "Out of catalog";
    default: throw error;
  }
}
// string!InvalidCode

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

Catch, then `match` on the failure: an arm such as `when ItemMissing:` handles that error class, and `default: throw error` passes the others on with their types (`string!InvalidCode`). The expression form takes the same `match`: `effect { return (try findItem(input)).label } catch effect (error) => match (error) { when ItemMissing: "Out of catalog"; default: throw error; }`. A `match` without `default` must handle every failure the Effect can raise (compile error EK4701), so a complete match needs no rethrow. `error is ItemMissing` tests one class in an `if`. `catchTag` removes the selected tagged case, and accepts a nonempty array of tags for one handler; `catchTags` takes a table of separate handlers.

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log((try withTagTable("")).label); try Console.log((try withFilter("book")).label); try Console.log((try withPredicate("book")).label); try Console.log((try flip(withFilter("")))._tag); try Console.log((try flip(withPredicate("")))._tag)
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

`catchIf` selects errors with a predicate or type guard; `catchFilter`, with reusable selection logic from `Filter`. A narrowing filter removes the handled subtype; a boolean condition that handles only some values can't promise the whole subtype is gone.

## Filtering nested reasons

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
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
// string!(Busy | Rejected)
```

```output
Try again in 4 seconds
Wait 4 seconds
Busy
```

These operators inspect the tagged error's readonly `reason` field. `catchReason` keeps the parent wrapper for unhandled reasons; `catchReasons` selects several at once; `unwrapReason` replaces the wrapper in `E` with its nested reason, without recovering.

## Errors are classes

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-7, VIP-13, VIP-14
// run: try Console.log(try describeFailure(new Missing({ code: "E1", path: "/a" }))); try Console.log(try describeFailure(new Expired({ code: "E2" }))); try Console.log(match (new Missing({ code: "E1", path: "/a" })) { when Missing: true; default: false; }); try Console.log(normalizedError(" pen ").label)
error Missing { code: string; path: string }
error Expired { code: string }

effect function raise(error: Missing | Expired) {
  throw error
}

effect function describeFailure(error: Missing | Expired) {
  return raise(error) catch (failure) => match (failure) {
    when Missing(let m): `missing ${m.path}`;
    when Expired(let e): `expired ${e.code}`;
  }
}
// string!!

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
true
Normalized PEN
```

An `error` declaration is a named class. The keyword supplies its `Data.TaggedError` base and its tag. Methods and getters are allowed; a constructor or `_tag` override is not. A field is a property written with a type and no initializer, and as between interface members, a `;`, a comma or a new line ends it. A field is readonly, and the constructor takes the fields as one object.

Use a union of error classes to describe several cases. Each class has its own bare name as its tag, so `catchTag("Missing")` and `catchTags` route the corresponding case. The generated matcher tests `_tag`, so `is` and `match` also match instances from another copy of the package.

### Error families

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-7, VIP-13
// run: try Console.log(try describeFamily(new MissingFile({ code: "E1", path: "/a" }))); try Console.log(try describeFamily(new ExpiredFile({ code: "E2" })))
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
```

```output
missing /a
expired E2
```

An `error` declaration always extends `Data.TaggedError`, so `error MissingFile extends FileError` is a compile error. Group related errors with a union type, `type FileError = MissingFile | ExpiredFile`, and choose among them with `match`. Each error keeps its own bare name as its tag, so `catchTag("MissingFile")` routes it.

## Errors that encode

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-7, VIP-14, VIP-29
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

`schema error` declares an error whose fields are schemas, so it encodes and decodes. It is short for `class NotStored extends Schema.TaggedError<NotStored>()("NotStored", { key: Schema.String, attempts: Schema.Number }) {}`: each field's type maps to a schema as a `schema` declaration's fields do, and a field whose type has no schema, such as a function, is EK2109, which names the field. Methods and getters are allowed, but a constructor or `_tag` override is not. Use `error` for a failure nothing encodes.

## Coming from Effect

Effect functions replace `Effect.gen`; calls return Effects that the caller runs with `try` or a catch expression. `Effect.fail(error)` draws EK4834, whose quick fix writes `throw error`, and `Effect.catchTag(program, "Tag", handler)` draws EK4835 with a quick fix for catch-and-match recovery ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)). Pass an Effect such as `findItem(input)` when a recovery operator needs work it can control. Support for the new forms arrives with the compiler's VIP implementation.
