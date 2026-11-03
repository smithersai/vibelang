# Expected Errors

Expected errors are situations callers can handle: invalid input, a denied operation, an unavailable dependency. VibeLang infers them in `E` and narrows them inside a catch expression.

[Upstream page](https://effect.website/docs/v4/error-management/expected-errors)

## Constructing typed failures

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
// string!InvalidCode
```

```output
PEN
InvalidCode
```

`error InvalidCode { input: string }` declares an expected failure class, short for `class InvalidCode extends Data.TaggedError("InvalidCode")<{ readonly input: string }> {}`, which also compiles. The constructor takes the fields, all shallowly readonly, and each instance has a readonly `_tag` equal to the class name. Plain `error` fields are erased payload type members, so a computed payload key does not run or read a later binding. Computed schema field keys run when the schema object is built; actual method and getter names retain TypeScript's evaluation. `error Timeout` has no fields. A bodyless `error` or `schema error` ends at a line break unless its next token is a body-opening `{`; a generic arrow such as `<T,>(x: T) => x` on the following line starts a new statement. A `schema error` also matches by `_tag` across package copies: both a bare class pattern and `when NotFound(let error):` accept a same-tag subject, and the extractor binds that original subject. A class upgrade offered by `vibelang --fix` retains that matcher, including while static initializers run. In an effect function, `throw` adds the class to `E`. `try fail(error)` also works; `try failSync(() => error)` defers construction to execution, as a function body already does.

An `error` or `schema error` declaration constructs a runtime value and cannot occur in a native TypeScript ambient context. An explicit `declare` or an enclosing `declare namespace`, `declare module` or `declare global` reports `EK1307`, including for a bodyless declaration. Write a native ambient class for an erased declaration; `vibelang --fix` offers that conversion when it preserves the declaration. Native ambient classes keep their erased form and are not suggested for conversion back to `error` or `schema error`.

An effect function or method whose body can only throw has success type `never`: it has no successful return. With no other returned value, a conditional `throw` followed by fallthrough infers `undefined`. An empty body or a body containing only a bare `return` keeps success type `void`.

Use `export error InvalidCode` or `export schema error InvalidCode` for a named export. For a default export, declare the error first and write `export { InvalidCode as default }`. Placing either declaration after `export default` reports `EK1305`, including when the declaration has no body.

Readonly applies to each payload key. A nested object such as `error E { value: { count: number } }` still allows `e.value.count = 2`; replacing `e.value` is rejected. Nested types in methods keep their written TypeScript modifiers too. To preserve the compiler's former implicit nested readonly modifiers, run `vibelang --fix --fix-migration-only`; ordinary `--fix` keeps writable nested types.

Fields in `error` and `schema error` declarations can use computed literal or `unique symbol` keys, such as `const key = "id" as const` and `error Missing { [key]: string }`. They remain readonly instance fields initialized from the constructor's input object. A computed string key that resolves to `"_tag"` is rejected with `EK2117`.

A throw expression can fail in an expression position: `value ?? throw new ItemMissing({ code })` or `ready ? result : throw error`. It follows the pinned TC39 proposal (VIP-41): parenthesize a compound operand, `throw (a + b)`, or parenthesize the throw before an operator or comma, `f((throw error), next)`. Otherwise a forbidden following punctuator is `EK1010`. The normal rules for automatic semicolon insertion still apply. The same restrictions on where throwing is permitted apply to statements and expressions.

VibeLang annotates `JSON.parse` as throwing `SyntaxError`. An effect function must wrap a synchronous call that may throw with `Effect.try` before running it with `try`. Library declarations describe thrown types with `@throws {ErrorType}`; an unannotated callable declared in `.ts`, `.d.ts` or JavaScript may throw `unknown`, even when it has a written function type. Its source and emitted declarations agree. An unwrapped synchronous call with that unknown contract in effect code reports `EK0403`. The preserving `--fix` rewrite wraps it with `Effect.orDie(Effect.try(...))`, keeping an exception a defect. A VibeLang function never throws, so every exported non-effectful VibeLang call signature carries `@throws {never}`. A `.vibe` file can't write `@throws` or `@rethrows`: each such tag is `EK0406`, and its quick fix removes it. For a synchronous `.ts` callable, a `@rethrows callback` adds that callback's thrown type at each invocation; an own `@throws {never}` does not erase it. Effectful callables carry no `@throws`. Wrap every Promise with `tryPromise`, including one that cannot reject. Synchronous functions known not to throw, such as `Option.isNone`, need no wrapper. A function whose return type is wholly an Effect, a Stream or a Layer is never throw-tracked: its failures are its Effect's error channel.

For `EK0401`, the editor offers `effect`, then `die`, then moving a self-contained TypeScript function, constant function value, generator or class to a `.ts` file. For a published package’s exported declaration, the move and re-export comes first, preserving its return type. The move creates a new file without overwriting an existing file and adds no `@throws` tag. Overloads, merged declarations, captured locals, eager class initialization, contextual uses, imports protected by `noUnusedLocals` and VibeLang-only syntax require a manual move. `vibelang --fix` applies the preferred effect edit to plain handlers and unused local functions; called or exported functions require an explicit choice, and automatic fixes never create files.

An `async` function's `throw` rejects its Promise, as in TypeScript, and its declaration carries `@throws {never}`. A `.ts` function that merely returns a Promise can still throw before returning.

A foreign function value must fit the function type it is passed or assigned as. A function type without `@throws` admits only a function that throws `never`, `@throws {U}` admits subtypes of `U`, and `@throws {unknown}` admits anything. So a `.ts` function declared `@throws {Error}`, passed where `() => void` is expected, is `EK0402` as an argument, an object member, a spread member, an initializer, an array element or a returned value. A parameter named by `@rethrows`, the callback of `Array` iteration methods such as `map`, and the thunk of `Effect.try` and `tryPromise` admit any thrown type.

In an effect function, `throw` is a typed failure and a catch expression receives typed failures only. A plain function can't throw: a `throw` there is `EK0401`, and so is a call known to throw, such as `JSON.parse(text)`, unless the call sits in the `try` block of a `try`/`catch` statement. Make the function `effect`, or move the code to a `.ts` file. A plain function's `try`/`catch` statement still handles exceptions from the calls it makes while returning a value:

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

To fail with a typed error, make the function `effect`: its `throw` is `Effect.fail`. A plain return annotation does not make a function effectful, so the same body in `function wholeQuantity(text: string): number` is `EK0401`:

```vibe
error InvalidQuantity { text: string }

effect function wholeQuantity(text: string) {
  const value = Number(text)
  if (!Number.isInteger(value)) throw new InvalidQuantity({ text })
  return value
}
```

A generic call retains its declaration's thrown contract even when a type argument makes its result an Effect.

Calling an effect function returns its unrun Effect. A caller runs it with `try` inside an effect function or Effect block. A defect is for a failure no caller should handle: a catch expression never receives one. In an `async` function, `throw` is JavaScript's and rejects the Promise; a plain function can't throw. `orDie(Effect.try(() => call()))` turns an exception from a `.ts` call into a defect; `sync` takes only a function that can't throw.

An effect method follows the same rules: its keyword determines its kind, and its return annotation checks the Effect type. A plain method, including a JavaScript protocol member such as `[Equal.symbol]`, keeps TypeScript's behavior, except that it can't throw. A plain function calls TypeScript code directly and handles its exceptions with `try`/`catch`. To run an Effect, use `try` inside an effect function or Effect block.

Effect-returning functions are ordinary values at typed destinations. TypeScript permits assigning one to a callback returning `void`, `any` or `unknown`, including through unions, arrays and object members. Calling it still returns its Effect unrun; ignoring that result does not run its work. A destination requiring a number still rejects a function returning an Effect with TypeScript's `TS2322`. A function's return type never adds or removes its written `effect` modifier.

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

The handler's failure type is the error channel, which an effect function or block infers as `Effect.gen` does. A `throw` adds its class unless an Effect the body runs already fails with a supertype of it. Beside `try read()`, where `read()` fails with `Error | ApiError`, `throw new NotReady()` of a class that extends `Error` adds nothing: the channel stays `Error | ApiError`. A tag arm `when { _tag: "NotReady" }:` then finds no member with that tag, and TypeScript reports `TS2367`, as it rejects `catchTag("NotReady", …)` on the same Effect. Match the class instead: `when NotReady:` tests `instanceof`, so it handles the failure whatever the channel says.

```vibe
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

An `error` declaration is a named class. The keyword supplies its `Data.TaggedError` base and its tag. Methods and getters are allowed; a constructor or `_tag` override is not. The name `_tag` is reserved for every member kind, including typed payload fields, methods, accessors and static members (`EK2117`). A field such as `_tag: string` or `_tag: "NotFound"` is rejected even when its type admits the generated tag, including in a legacy abstract declaration. Rename the field or member. For a previously valid payload field, initialized field, accessor or static member, `vibelang --fix` preserves its implementation in an explicit Effect class when the class is equivalent. It keeps schema-family registration and the runtime matcher. Duplicate payload fields, a tag type that does not fit `string`, or a fieldless plain base whose subclasses need the declaration-only constructor adaptation require a manual repair; no class action is offered for those contracts. A field is a property written with a type and no initializer, and as between interface members, a `;`, a comma or a new line ends it; two members on one line with nothing between them are `EK1306`, whose quick fix inserts `;`. A field is readonly, and the constructor takes the fields as one object. Commas may follow payload fields, including an optional field or the last field. Methods and other class elements keep TypeScript's punctuation.

For a reserved `_tag` member, `EK2117` takes precedence over the generic body-member diagnostic `EK1304`. Unrelated errors in member expressions remain visible.

Empty `;` members are ignored in `error` and `schema error` bodies. The formatter can remove a member without JSDoc. A `;` with JSDoc stays, so the comment does not become the next member's contract.

A typed field named `constructor` in `error` or `schema error`, such as `constructor: string` or `constructor?: string`, is ordinary payload. The constructor restriction applies to a `constructor(...) { ... }` method.

Use a union of error classes to describe several cases. Each class has its own bare name as its tag, so `catchTag("Missing")` and `catchTags` route the corresponding case. The generated matcher tests `_tag`, so `is` and `match` also match instances from another copy of the package.

### Error families

```vibe
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

A computed method or getter whose key is known to be `"_tag"` is reserved in either error form, even when its singleton type is branded, wrapped in a template or mapped with `Lowercase`. Broad keys in a plain `error` keep the native computed-name checks. `vibelang --fix` retains the member in an explicit class when native TypeScript accepts it; no class repair is offered for an instance accessor or method whose resolved name overrides the base `_tag` property. Fieldless errors retain their constructor declarations.

## Errors that encode

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

`schema error` declares an error whose fields are schemas, so it encodes and decodes. It is short for `class NotStored extends Schema.TaggedError<NotStored>()("NotStored", { key: Schema.String, attempts: Schema.Number }) {}`: each field's type maps to a schema as a `schema` declaration's fields do, and a field whose type has no schema, such as a function, is `EK2109`, which names the field. Methods and getters are allowed, but a constructor or `_tag` override is not. A typed payload field named `_tag` is also `EK2117`, even when written as `readonly`, optional, quoted, or with a type matching the error name. Repeating `readonly` on a field reports `TS1030`; `vibelang --fix` removes the duplicate token and preserves the codec. A required field must reference a required decoded key, and every payload field, including one without a written `readonly`, must keep the readonly decoded-key flag (`EK2109`); use an unmodified value schema instead of `Schema.mutableKey` for a payload field. A computed `schema error` field key must have a runtime domain that provably excludes `"_tag"`; broad string constraints, enums containing that value and opaque brands do not bypass the reserved-tag diagnostic. A brand inside a template type or a string mapping such as `Lowercase<T>` must pass the same proof. Fixed prefixes and suffixes that exclude `"_tag"` remain allowed. Use a safe literal key or a symbol. For conflicting referenced key flags, `vibelang --fix` writes the equivalent Effect TypeScript class, preserving its codecs and decoding. Choose field codecs whose encoded representation fits the transport: raw `Schema.BigInt` remains a bigint, while `Schema.BigIntFromString` produces a JSON-compatible string. No automatic JSON conversion is added. Use `error` for a failure nothing encodes.

A `schema error` field named `__proto__` is an own data field. Its generated schema uses `["__proto__"]`, so declaring the class succeeds and decoding and encoding validate and preserve the field. Quoted and escaped spellings have the same behavior. For example, `schema error ProtoError { __proto__: string }` takes `new ProtoError({ ["__proto__"]: "value" })`.

`vibelang --fix` does not turn a native `Schema.TaggedError` fields object's `__proto__: codec` prototype setter into an own field. Write `["__proto__"]: codec` in native TypeScript when you intend an own field.

## Coming from Effect

Effect functions replace `Effect.gen`; calls return Effects that the caller runs with `try` or a catch expression. `try Effect.fail(error)` draws `EK4834`, whose quick fix writes `throw error`, and `try Effect.catchTag(program, "Tag", handler)` draws `EK4835` with a quick fix for catch-and-match recovery ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)). These warnings apply only to the direct operand of bare `try`, including parentheses and erased TypeScript wrappers. A stored Effect or a `fork` operand keeps its recovery in that Effect and draws neither warning. Pass an Effect such as `findItem(input)` when a recovery operator needs work it can control. Support for the new forms arrives with the compiler's VIP implementation.

A written constructor in `error` or `schema error` is `EK1301`: the declaration's constructor takes its fields as one object. The quick fix (also `vibelang --fix`) keeps the constructor by rewriting the declaration as an Effect TypeScript class. An `implements` clause on `error` or `schema error` is `EK1304`. So is any other member that is not a field, a method, a getter or an empty `;` element: an initialized property such as `id = 1`, a `private`, `protected`, `public` or `declare` property, a private name such as `#id = 1`, an `accessor` property or an index signature. The member gets that one diagnostic, and its quick fix (also `vibelang --fix`) keeps the member by rewriting the declaration as an Effect TypeScript class.
Remove the clause and use the error's instance type structurally; `vibelang --fix` removes it without changing the runtime class.

User-written `static` members are forbidden in both `error` and `schema error` bodies (`EK1302`). Move helpers outside the declaration, or use `vibelang --fix` to write the equivalent Effect TypeScript class and keep its `static` members. Compiler-generated matchers remain available. The class migration keeps leading reference directives and class documentation when it adds an import.

Setters are forbidden in both error forms (`EK1302`). Use a method instead, or keep the setter in the equivalent Effect TypeScript class with `vibelang --fix`. Getters remain allowed.

Neither error form accepts type parameters (`EK1303`). Keep a plain generic error as an Effect TypeScript class; `vibelang --fix` rewrites a generic `error` declaration to that class without changing its fields or type parameters. A generic `schema error` needs concrete fields or a TypeScript schema factory; its quick fix is withheld because a class whose base refers to its type parameters would introduce `TS2562`. Generic tagged-error classes no longer receive the `EK4830` suggestion to write an unsupported declaration.

A nested object schema follows the schema field mapping: its keys are writable unless marked `readonly`, even when the schema-error payload field containing that object is readonly. The legacy-key upgrade, `vibelang -p tsconfig.json --fix --fix-migration-only`, preserves older nested readonly defaults.

A fieldless `error Timeout` or `error Timeout {}` declares the same base as `class Timeout extends Data.TaggedError("Timeout") {}`: `extends Timeout_base`. A TypeScript class that explicitly writes `Data.TaggedError("Timeout")<{}>` instead declares `extends Timeout_base<{}>`. In a project that emits declarations, `vibelang --fix` keeps that class and explains why `EK4830` has no automatic fix, preserving the written empty payload type argument. Without declaration output, the conversion remains available.

For a single-parameter arrow such as `x => …`, the effect fix writes `effect (x) => …`, preserving the parameter name and adjacent comments.

The operand of `try` can start on the next line, including after a comment. Member calls and parenthesized expressions keep ordinary expression precedence: `try obj.run() + 4` runs `obj.run()` before adding `4`.
