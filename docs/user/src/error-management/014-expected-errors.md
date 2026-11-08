# Expected Errors

Write `error` and `schema error` without Unicode escapes (`TS1260`).

![Delete the catch and the failure moves into the type](/videos/type-flip.mp4)

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

`error InvalidCode { input: string }` declares an expected failure class, short for `class InvalidCode extends Data.TaggedError("InvalidCode")<{ readonly input: string }> {}`, which also compiles. The constructor takes the fields, all shallowly readonly, and each instance has a readonly `_tag` equal to the class name. Plain `error` fields are erased payload type members, so a computed payload key does not run or read a later binding. Computed schema field keys run when the schema object is built; actual method and getter names retain TypeScript's evaluation. `error Timeout` has no fields. A bodyless `error` or `schema error` ends at a line break unless its next token is a body-opening `{`; a generic arrow such as `<T,>(x: T) => x` on the following line starts a new statement. A `schema error` also matches by `_tag` across package copies: both a bare class pattern and `when NotFound(let error):` accept a same-tag subject, and the extractor binds that original subject. A native subclass must supply its own matcher to be used as an extractor. In an effect function, `throw` adds the class to `E`. `try fail(error)` also works; `try failSync(() => error)` defers construction to execution, as a function body already does.

An `error` or `schema error` declaration constructs a runtime value and cannot occur in a native TypeScript ambient context. An explicit `declare` or an enclosing `declare namespace`, `declare module` or `declare global` reports `EK1307`, including for a bodyless declaration. Write a native ambient class for an erased declaration. Native ambient classes keep their erased form and are not suggested for conversion back to `error` or `schema error`. Their class repair adds no executable static initialization. In ambient code, `EK1307` takes priority over the error declaration's member restrictions; independent field-type errors still appear.

A reserved `_tag` payload in a base declaration and an `extends` clause in a second declaration are independent violations. That file reports `EK2117` at each site. A preserving class conversion must keep the payload, base, constructor and exported declaration API. The generated matcher in that class also keeps tagged narrowing and exhaustive matching. A shadowed matcher helper, a different registered tag or other static initialization does not establish that guarantee.

The ambient class conversion also covers a `schema error` with no body, an empty body or payload fields, including one nested inside ambient namespaces. The resulting native class remains erased; it does not run schema construction or register a matcher in the emitted JavaScript.

An effect function or method whose body can only throw has success type `never`: it has no successful return. With no other returned value, a conditional `throw` followed by fallthrough infers `undefined`. An empty body or a body containing only a bare `return` keeps success type `void`.

Use `export error InvalidCode` or `export schema error InvalidCode` for a named export. For a default export, declare the error first and write `export { InvalidCode as default }`. Placing either declaration after `export default` reports `EK1305`, including when the declaration has no body.

Readonly applies to each payload key. A nested object such as `error E { value: { count: number } }` still allows `e.value.count = 2`; replacing `e.value` is rejected. Nested types in methods keep their written TypeScript modifiers too.

Fields in `error` and `schema error` declarations can use computed literal or `unique symbol` keys, such as `const key = "id" as const` and `error Missing { [key]: string }`. They remain readonly instance fields initialized from the constructor's input object. A computed string key that resolves to `"_tag"` is rejected with `EK2117`. In a `schema error`, a computed field key must also have a type that excludes `"_tag"`: a `string`, an enum or union that can be `"_tag"`, a branded string, `any` or a generic constrained by `string` is `EK2117`. Use a literal, a literal union without `"_tag"`, a number or a symbol.

Array parameter patterns may omit elements, such as `[, value]` or `[,]`. Effect functions and producers perform those bindings at the call, skip each omitted element’s value getter, and turn a binding exception into a defect with the original value. Their bodies remain cold.

A throw expression can fail in an expression position: `value ?? throw new ItemMissing({ code })` or `ready ? result : throw error`. It follows the pinned TC39 proposal (VIP-41): parenthesize a compound operand, `throw (a + b)`, or parenthesize the throw before an operator or comma, `f((throw error), next)`. A forbidden following punctuator reports `EK1010` as an error. The normal rules for automatic semicolon insertion still apply. The same restrictions on where throwing is permitted apply to statements and expressions.

VibeLang annotates `JSON.parse` as throwing `SyntaxError`. Intrinsic calls with a non-`never` throw contract require the same explicit bridge as foreign calls (`EK0403`). An effect function must wrap a synchronous call that may throw with `Effect.try` before running it with `try`. A foreign callable binding retains its own `@throws` annotation when its function type comes from a builtin. A written `@throws` type uses TypeScript type reduction: an alias or conditional type that resolves to `never` permits a direct call. Extracted methods retain their receiver’s type arguments through inferred `const` references and `const` object bindings, including nested patterns. For callbacks retained through inferred `const` aliases of a written receiver type, rethrowing calls keep that receiver’s type arguments. Generic contracts use the selected call’s and receiver’s type arguments: `@throws {T}` permits a direct call when `T` is `never`, while `T` as `RangeError` still requires a bridge in effect code. Library declarations describe thrown types with `@throws {ErrorType}`; an unannotated callable declared in `.ts`, `.d.ts` or JavaScript may throw `unknown`, even when it has a written function type. Its source and emitted declarations agree. An unwrapped synchronous call with that unknown contract in effect code reports `EK0403`. Calls through `any` or `Function`, including parameters, inferred aliases and optional calls, have the same `unknown` contract and require the bridge. This `EK0403` error is independent of the `EK4409` warning about returning an unrun program through `any`; both may appear at the same call. An unresolved name or missing member retains its TypeScript error without an additional dynamic-call diagnostic. A VibeLang function never throws, so every exported non-effectful VibeLang call signature carries `@throws {never}`. A `.vibe` file can't write `@throws`, its TypeScript alias `@exception`, or `@rethrows`: each such tag is `EK0406`, and its comment has no automatic rewrite. Remove the tag manually while retaining its documentation. For a synchronous `.ts` callable, a `@rethrows callback` adds that callback's thrown type at each invocation; an own `@throws {never}` does not erase it. Effectful callables carry no `@throws`. Wrap every Promise with `tryPromise`, including one that cannot reject. Synchronous functions known not to throw, such as `Option.isNone`, need no wrapper. A function whose return type is wholly an Effect, a Stream or a Layer is never throw-tracked: its failures are its Effect's error channel. On a non-effectful foreign callable, a written non-`never` `@throws` annotation requires an explicit `Effect.try` bridge in effect code (`EK0403`); it does not wrap the call. CommonJS function exports keep an assignment’s JSDoc contract too: `/** @throws {never} */ exports.read = function () { … }` has the same contract as an annotated function declaration. The global `tryPromise` is `Effect.tryPromise`, so a call known to throw inside its thunk, in the function or the options form, belongs to the wrapper in either spelling. An `effect` function or block created inside an `Effect.sync` or `Effect.promise` thunk keeps its own throw checks and needs its own bridge for a foreign call (`EK0403`). A non-null assertion preserves the callable alternatives: a choice between `sync` and `Effect.try`, or between `promise` and `tryPromise`, still requires a thunk valid for either API.

Fixed tuple spreads at a `@rethrows` call retain the callback contracts in each argument position, including spreads before a later callback. An inline callback supplied directly in a tuple literal keeps the invocation boundary too: `invoke(...[() => JSON.parse(text)] as const)` is handled by catching `invoke` or wrapping it with `Effect.try`. Nested literal spreads and fixed prefix spreads retain native argument order. A callback stored in a tuple has its own source scope; storing it does not permit known throwing calls in its body. Handle a throwing callback through `Effect.try`.

Optional callback parameters and `undefined` or `null` alternatives retain a supplied callback’s written `@throws` contract at a rethrowing invocation. `Array.prototype.sort` follows the same rule. Omitting an optional callback contributes no callback throw.

For `EK0401`, the editor offers `effect`, then `die`, then moving a self-contained TypeScript function, constant function value, generator or class to a `.ts` file. For a published package’s exported declaration, the move and re-export comes first, preserving its return type. The move creates a new file without overwriting an existing file and adds no `@throws` tag. Overloads, merged declarations, captured locals, eager class initialization, contextual uses, imports protected by `noUnusedLocals` and VibeLang-only syntax require a manual move.

An `async` function's `throw` rejects its Promise, as in TypeScript, and its declaration carries `@throws {never}`. A `.ts` function that merely returns a Promise can still throw before returning. Without a `@throws {never}` contract, calling it in an effect function's parameter default or in a plain function whose result is wholly an Effect, a Stream or a Layer reports `EK0401`. A local `async` function or a foreign signature annotated `@throws {never}` can supply a Promise as a default value. Calls through `any` or `Function` have thrown type `unknown` and also report `EK0401` in an effect function's or producer's parameter defaults.

A return type counts as a `Stream` only when it is assignable to `Stream.Stream<any, any, any>`. A foreign function returning a partial view that has only `~effect/Stream`, or omits `channel` or `pipe`, keeps its written `@throws` contract, or `unknown` without one. Wrap the call when that contract may throw (`EK0403`). Ordinary plain-code rules apply to a function returning only such a partial view.

Optional reference syntax does not change the selected callable’s own return contract. A foreign function returning `Effect.Effect<A> | undefined` is non-effectful, so `read?.()` keeps its written `@throws` contract, or `unknown` without one, and needs a bridge when it may throw (`EK0403`). An optional reference to a function returning wholly an `Effect`, `Stream` or `Layer` keeps that function’s non-throwing contract.

An inline callback keeps a written admitting throw contract when its parameter also accepts a non-function value, including `undefined` or an options object. Fixed tuple-rest parameters keep that contract too. A function alternative without `@throws`, or with `@throws {never}`, still admits only non-throwing calls.

A foreign function value must fit the function type it is passed or assigned as. A function type without `@throws` admits only a function that throws `never`, `@throws {U}` admits subtypes of `U`, and `@throws {unknown}` admits anything. So a `.ts` function declared `@throws {Error}`, passed where `() => void` is expected, is `EK0402` as an argument, an object member, a spread member, an initializer, an array element, a returned value, or a class member that implements an interface member or overrides a base class member. A parameter named by `@rethrows`, the callback of `Array` iteration methods such as `map`, and the thunk of `Effect.try` and `tryPromise` admit any thrown type. Indexed access such as `handlers["parse"]` or `handlers[key]` keeps the same written contract as `handlers.parse`; literal, constant, numeric and symbol keys receive the same `EK0402` check.

The `Effect.try` and `Effect.tryPromise` callback exemption follows the selected Effect signature. A local object, parameter or unrelated import named `Effect` does not gain it: `Effect.try(() => JSON.parse(text))` reports `EK0401` when that object's callback type admits no throws. Parentheses, computed access and bound references also retain the resolved `Effect.try` or `Effect.tryPromise` thunk contract. Native `Function.prototype.call` and `Function.prototype.apply` retain the contract when they forward an inline thunk or the options object’s `try` callback. Their `catch` mapper is still plain code. A property that refers to `sync` or `promise` keeps its non-throwing thunk contract even when named `try` or `tryPromise`. If a property chooses between APIs, every callable alternative must admit a throwing thunk. Genuine Effect imports and aliases retain their wrapper contract; an unrelated API can admit throwing callbacks through its own written `@throws` signature.

The native `Promise` executor admits calls that may throw: their exceptions reject the Promise. Parenthesized, aliased and property references to the native constructor, and a subclass's `super(...)` call, keep that executor contract. A user-defined constructor named `Promise` does not gain it. Nested source functions and explicit `throw` statements retain the ordinary plain-code checks.

An explicit `super(...)` call also keeps its base constructor's `@rethrows` contract: a callback known to throw makes the call `EK0401`, even when the constructor declares `@throws {never}`. A native `try`/`catch` around the call, or one inside the callback that handles its exception, keeps the usual caught-call exemption.

`try value` delegates like `yield* value`, including in a tail return. An unchecked `any` adds no runtime Effect guard: a noniterable produces a native `TypeError` defect, while an ordinary iterator can delegate Effects or return a value. Typed operands must still pass the Effect operand check.

A local alias such as `const saved = parse`, a chained binding or destructuring keeps the foreign call signature's `@throws` contract. A returned callback with its own explicit `@throws` signature keeps that contract when saved or passed onward; its factory's annotation describes the factory call only. Passing `saved` is checked just as passing `parse` is. Calls through an inferred `const next = parse` chain keep the foreign binding's own annotation even when its callable type is `typeof JSON.parse`.

In an effect function, `throw` is a typed failure and a catch expression receives typed failures only. A plain function can't throw: a `throw` there is `EK0401`, and so is a call known to throw, such as `JSON.parse(text)`, unless the call sits in the `try` block of a `try`/`catch` statement. Make the function `effect`, or move the code to a `.ts` file. A class's `extends` expression runs in the code defining the class, so a surrounding `try`/`catch` handles failures from computing the base. Computed member names and decorators also run in the code defining the class or object: a known throwing call there is `EK0403` in effect code, or `EK0401` in plain code unless a surrounding `try`/`catch` handles it. Member bodies and field initializers keep their own contexts. An `enum` initializer also runs in the enclosing code, so that handler covers calls computing its numeric values. A plain function's `try`/`catch` statement still handles exceptions from the calls it makes while returning a value:

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

A plain or `async` function's catch binding follows TypeScript, including `any` and `unknown` annotations. Destructured bindings keep TypeScript's property checks; their annotations do not turn the statement into an Effect catch.

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

An operand may be a grouped comma expression. `try (prepare(), program)` evaluates `prepare()` and `program` from left to right, then runs the Effect value of `program`. An earlier Effect value stays unrun.

Parentheses keep an `effect { ... }` block as an Effect value: `try (effect { return 7 })` runs the block and gives `7`. Its failures propagate through `try` as usual.

An effect method follows the same rules: its keyword determines its kind, and its return annotation checks the Effect type. A plain method, including a JavaScript protocol member such as `[Equal.symbol]`, keeps TypeScript's behavior, except that it can't throw. A plain function calls TypeScript code directly and handles its exceptions with `try`/`catch`. To run an Effect, use `try` inside an effect function or Effect block.

Effect-returning functions are ordinary values at typed destinations. TypeScript permits assigning one to a callback returning `void`, `any` or `unknown`, including through unions, arrays and object members. Calling it still returns its Effect unrun; ignoring that result does not run its work. A destination requiring a number still rejects a function returning an Effect with TypeScript's `TS2322`. A function's return type never adds or removes its written `effect` modifier.

Saving a union of foreign callbacks preserves every alternative's written throws contract. For example, `const read = flag ? risky : safe` still requires a destination that admits `risky`'s errors. An optional callback keeps its function alternative's contract too. A destination union admits the value when every source alternative fits a matching destination signature.

Shorthand object members keep the value's throws contract: `{ risky }` is checked like `{ risky: risky }` in an argument, typed initializer, spread or written return. Destructuring targets remain ordinary assignments, and an incompatible property type keeps TypeScript's native diagnostic.

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
  return env.get("PORT") ?? throw new MissingPort()
}
// string!MissingPort
```

```output
3000
MissingPort
```

A throw expression fails only when selected. Here `??` returns the stored string when present and fails with `MissingPort` when the key is absent. The right side of `??`, `||`, `&&`, and `?:` runs only when chosen. In a `.vibex` file, a JSX value may be the operand of `throw`; its factory runs only when that operand is chosen. Recover the Effect with a catch expression and a function-literal handler. The statement `throw cond ? a : b;` still throws the selected value.

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

A catch expression gives its recovered value directly. If the handler returns a `string`, `try (program catch effect (error) => error.message)` tries to run that string and reports `EK0502`; write `program catch effect (error) => error.message`. An outer `try` is valid only when the recovered value is itself an unrun Effect.

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

Catch, then `match` on the failure: an arm such as `when ItemMissing:` handles that error class, and `default: throw error` passes the others on with their types (`string!InvalidCode`). The expression form takes the same `match`: `effect { return (try findItem(input)).label } catch effect (error) => match (error) { when ItemMissing: "Out of catalog"; default: throw error; }`. When an Effect's failure type is a finite union of checked cases, a `match` without `default` must handle every failure (`EK4701`), so a complete match needs no rethrow. An open failure type such as `unknown` skips that check; an unmatched value throws a `TypeError`. `error is ItemMissing` tests one class in an `if`. `catchTag` removes the selected tagged case, and accepts a nonempty array of tags for one handler; `catchTags` takes a table of separate handlers.

The handler's failure type is the error channel, which an effect function or block infers as `Effect.gen` does. A `throw` adds its class unless an Effect the body runs already fails with a supertype of it. Beside `try read()`, where `read()` fails with `Error | ApiError`, `throw new NotReady()` of a class that extends `Error` adds nothing: the channel stays `Error | ApiError`. A tag arm `when { _tag: "NotReady" }:` then finds no member with that tag, and TypeScript reports `TS2367`, as it rejects `catchTag("NotReady", …)` on the same Effect. Match the class instead: `when NotReady:` tests `instanceof`, so it handles the failure whatever the channel says.

Calls to unannotated Vibe helpers participate in the same inference as foreign Effects and helpers with written contracts. Even an infallible helper contributes its success type and `never` error channel. For example, running a helper returning `number!!` beside an Effect returning `(string | undefined)!(Error | ApiError)!` infers `Error`, as the equivalent `Effect.fn` does. A helper whose success type is already covered by the other Effect can be absorbed instead, leaving its channel as written. If an existing `catchTag` relied on a subclass that native inference absorbs, preserve the local program's former error channel with an explicit return contract.

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

After assignment from `try catchIf(...)`, ordinary control-flow narrowing applies. If every success branch produces `Item`, a local declared as `Item | undefined` becomes `Item` after the assignment. Omitting an optional recovery branch keeps its generic default. A supplied recovery that can succeed with `undefined` still requires a check before reading the value.

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

An `error` declaration is a named class. The keyword supplies its `Data.TaggedError` base and its tag. Methods and getters are allowed; a constructor or `_tag` override is not. The name `_tag` is reserved for every member kind, including typed payload fields, methods, accessors and static members (`EK2117`). A field such as `_tag: string` or `_tag: "NotFound"` is rejected even when its type admits the generated tag, including in a legacy abstract declaration. Rename the field or member. For a previously valid payload field, initialized field, accessor or static member, preserve its implementation in an explicit Effect class. Duplicate payload fields, a tag type that does not fit `string`, or a fieldless plain base whose subclasses need the declaration-only constructor adaptation require a manual repair; no class action is offered for those contracts. A field is a property written with a type and no initializer, and as between interface members, a `;`, a comma or a new line ends it; two members on one line with nothing between them are `EK1306`, whose quick fix inserts `;`. A field is readonly, and the constructor takes the fields as one object. Commas may follow payload fields, including an optional field or the last field. Methods and other class elements keep TypeScript's punctuation.

For a reserved `_tag` member, `EK2117` takes precedence over the generic body-member diagnostic `EK1304`. Unrelated errors in member expressions remain visible.

An `effect` modifier on an error getter, setter or constructor reports `EK0104`. The modifier diagnostic takes priority over error-member checks, including the reserved `_tag` name; combining `async` and `effect` also reports `EK0105`. Independent TypeScript errors in the member remain visible.

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

An `error` declaration always extends `Data.TaggedError`, so `error MissingFile extends FileError` is `EK2117`. The same rule applies to `schema error` and to native parents whose tag is `string` or a union. A rejected `extends` reports `EK2117` without extra errors from its generated base; authored member types and method bodies retain their independent TypeScript diagnostics. To retain existing inheritance, write the equivalent TypeScript class, keeping its base, tag, fields, constructor and methods. `is` and `match` still accept the subclass's errors for the base, because an error's matcher also accepts instances of its class. Group related errors with a union type, `type FileError = MissingFile | ExpiredFile`, and choose among them with `match`. Each error keeps its own bare name as its tag, so `catchTag("MissingFile")` routes it.

A computed method or getter whose key is known to be `"_tag"` is reserved in either error form, even when its singleton type is branded, wrapped in a template or mapped with `Lowercase`. Broad keys in a plain `error` keep the native computed-name checks. Fieldless errors retain their constructor declarations.

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

`schema error` declares an error whose fields are schemas, so it encodes and decodes. It is short for `class NotStored extends Schema.TaggedError<NotStored>()("NotStored", { key: Schema.String, attempts: Schema.Number }) {}`: each field's type maps to a schema as a `schema` declaration's fields do, and a field whose type has no schema, such as a function, is `EK2109`, which names the field. Methods and getters are allowed, but a constructor or `_tag` override is not. A typed payload field named `_tag` is also `EK2117`, even when written as `readonly`, optional, quoted, or with a type matching the error name. Repeating `readonly` on a field reports `TS1030`. A required field must reference a required decoded key, and every payload field, including one without a written `readonly`, must keep the readonly decoded-key flag (`EK2109`); use an unmodified value schema instead of `Schema.mutableKey` for a payload field. A computed `schema error` field key must have a runtime domain that provably excludes `"_tag"`; broad string constraints, enums containing that value and opaque brands do not bypass the reserved-tag diagnostic. A brand inside a template type or a string mapping such as `Lowercase<T>` must pass the same proof. Fixed prefixes and suffixes that exclude `"_tag"` remain allowed. Use a safe literal key or a symbol. For conflicting referenced key flags, write the equivalent Effect TypeScript class, preserving its codecs and decoding. Choose field codecs whose encoded representation fits the transport: raw `Schema.BigInt` remains a bigint, while `Schema.BigIntFromString` produces a JSON-compatible string. No automatic JSON conversion is added. Use `error` for a failure nothing encodes.

Computed keys inside a `schema error` payload, including keys nested in object types, arrays and tuples, evaluate when the declaration runs. Inside effect code, `try` in such a key runs on the enclosing Effect; its failures and service requirements belong to that Effect. Class methods and field initializers keep their own execution context. A plain fallible call in a key or class base contributes its declared failures too. If that newly reports `EK9201` against an existing contract, wrap the call with `Effect.try` and `Effect.orDie` to keep the original thrown value as a defect; an Effect run with `try` keeps its typed failures.

A `schema error` field named `__proto__` is an own data field. Its generated schema uses `["__proto__"]`, so declaring the class succeeds and decoding and encoding validate and preserve the field. Quoted and escaped spellings have the same behavior. For example, `schema error ProtoError { __proto__: string }` takes `new ProtoError({ ["__proto__"]: "value" })`.

In a native `Schema.TaggedError` fields object, `__proto__: codec` is a prototype setter, not an own field. Write `["__proto__"]: codec` in native TypeScript when you intend an own field.

## Coming from Effect

Effect functions replace `Effect.gen`; calls return Effects that the caller runs with `try` or a catch expression. `try Effect.fail(error)` draws `EK4834`, whose quick fix writes `throw error`, and `try Effect.catchTag(program, "Tag", handler)` draws `EK4835` with a quick fix for catch-and-match recovery ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)). These warnings apply only to the direct operand of bare `try`, including parentheses and erased TypeScript wrappers. A stored Effect or a `fork` operand keeps its recovery in that Effect and draws neither warning. Pass an Effect such as `findItem(input)` when a recovery operator needs work it can control.

A written constructor in `error` or `schema error` is `EK1301`: the declaration's constructor takes its fields as one object. A `private` or `protected` constructor gets that restriction once, without an argument error from generated matcher registration. Authored member errors stay visible. The quick fix keeps the constructor by rewriting the declaration as an Effect TypeScript class. An `implements` clause on `error` or `schema error` is `EK1304`. So is any other member that is not a field, a method, a getter or an empty `;` element: an initialized property such as `id = 1`, a `private`, `protected`, `public` or `declare` property, a private name such as `#id = 1`, an `accessor` property or an index signature. The member gets that one diagnostic, and its quick fix keeps the member by rewriting the declaration as an Effect TypeScript class. Rewritten error classes retain constructor visibility and their own tag matcher, including when the registration receiver has erased TypeScript wrappers.
Remove the clause and use the error's instance type structurally.

User-written `static` members are forbidden in both `error` and `schema error` bodies (`EK1302`). Move helpers outside the declaration, or write the equivalent Effect TypeScript class to keep its `static` members. `EK1302` takes precedence over native errors about a forbidden `static` member's inheritance, `override` modifier or built-in constructor property name. Independent type errors inside method bodies and computed keys remain visible. Compiler-generated matchers remain available. The class migration keeps leading reference directives and class documentation when it adds an import. For a plain error, the migration imports `TaggedError` from `vibelang-runtime` to retain the existing class matcher, including cross-copy tags and extractor patterns.

Setters are forbidden in both error forms (`EK1302`). Use a method instead, or keep the setter in the equivalent Effect TypeScript class. Getters remain allowed.

Neither error form accepts type parameters (`EK1303`). Keep a plain generic error as an Effect TypeScript class. A generic `schema error` needs concrete fields or a TypeScript schema factory; its quick fix is withheld because a class whose base refers to its type parameters would introduce `TS2562`. Generic tagged-error classes no longer receive the `EK4830` suggestion to write an unsupported declaration.

A nested object schema follows the schema field mapping: its keys are writable unless marked `readonly`, even when the schema-error payload field containing that object is readonly. To keep the readonly keys an older compiler produced, write `readonly` on the unmarked keys of such nested schemas; the payload fields themselves are already readonly and stay unchanged.

A fieldless `error Timeout` or `error Timeout {}` declares the same base as `class Timeout extends Data.TaggedError("Timeout") {}`: `extends Timeout_base`. A TypeScript class that explicitly writes `Data.TaggedError("Timeout")<{}>` instead declares `extends Timeout_base<{}>`.

For a single-parameter arrow such as `x => …`, the effect fix writes `effect (x) => …`, preserving the parameter name and adjacent comments.

The operand of `try` can start on the next line, including after a comment. Member calls and parenthesized expressions keep ordinary expression precedence: `try obj.run() + 4` runs `obj.run()` before adding `4`.

For an old typed statement catch such as `try { ... } catch (e: Missing) { ... }` in effect code, write an explicit Effect and a `catch effect` handler, preserving structural `_tag` matching.

Replace an old untyped `try` statement in effect code with Effect handlers.

A foreign type-predicate repair keeps the narrowed value inside the defect bridge and captures it in a local such as `resolved`. The following branch and property reads use that captured value, so the repair preserves both the predicate’s narrowing and the original defect behavior.

A foreign callback returning `Effect`, `Stream` or `Layer` has synchronous thrown type `never`, even if its declaration writes `@throws`. Generic signatures use their constraints before substitution. A `Promise` return alone does not provide this contract; neither do `any`, `unknown`, `never`, an unconstrained type parameter or a union containing a non-effectful member. This holds for a `try` operand too: `try get<Effect.Effect<number>>()` keeps `get`'s written `@throws` contract, or `unknown` without one, and is `EK0403` until the call is wrapped, because `get<T>` is classified by its unconstrained `T`, not by the Effect it is instantiated to. Bridge the operand under the same `try`, `try (try Effect.orDie(Effect.try({ try: () => get<number!!>("key"), catch: (e) => e })))`, so the bridged Effect still runs where the call stood.

Explicit `@throws {any}` follows TypeScript assignability: it fits a typed thrown contract such as `@throws {string}`, but not `@throws {never}`. In contrast, `@throws {unknown}` fits only a contract admitting `unknown`, such as `@throws {unknown}` or `@throws {any}`. Neither annotation fits an untagged callback type.

Aliases in written `@throws` contracts have the meaning of their resolved TypeScript types. An alias of `never` throws nothing, and an alias of `unknown` admits every thrown type, just as their direct spellings do.

A foreign constructor's own `@throws` contract also applies when its value is passed, assigned or returned as a construct signature. A construct signature without `@throws` admits only `never`, and an unannotated foreign constructor declaration throws `unknown`, so passing or assigning its class as such a signature is `EK0402`, as for an unannotated function; a class that declares no constructor stays untracked; a signature with `@throws {E}` admits subtypes of `E`, and `@throws {unknown}` admits any thrown type. Overloads match their native parameter types. Constructors returning an effectful value keep their intrinsic synchronous thrown type `never`.

A constructor value fits a destination carrying its own signatures, such as `const C: typeof Plain = Plain`, `identity(Plain)` with `identity<T>(value: T): T`, or `Object.assign({}, { make: Plain })`. Its thrown contract is retained. A different constructor or a written construct signature still needs a compatible contract. A class used by `is` or `match` is tested without constructing it.

Written `@throws` types retain their TypeScript structure. An inline type such as `@throws { { readonly code: string } }` requires a compatible `code` property, just as the same type named by an alias does. Nested properties, index signatures, function types and tuples follow the same assignability rules. For an incompatible foreign contract, choose a callback with an admitted thrown type or update the owning API explicitly.

The ES2026 `JSON.parse` overload, whose reviver receives a context object, also throws `SyntaxError`. Wrap a synchronous call in native `try/catch`, or use a callback whose contract admits throws; effect code can use `try Effect.try(() => JSON.parse(text, reviver))`.

A foreign tag's `@throws` contract also applies to a tagged-template invocation. A literal callback interpolation passed to a `@rethrows` parameter is checked at the tag, as for a call. In effect code, wrap a tag that may throw with `try Effect.try(() => …)`. The template object is the first parameter, followed by the substitutions; later and rest callback parameters keep their declared positions. Synchronous code must catch a known throwing tag with native `try/catch`, or call it in an admitting wrapper thunk such as `Effect.try`.

A class's `implements` clause also checks the thrown contracts of callable members. Storing a foreign throwing function in a field, returning it from a getter, or inheriting it does not turn it into a pure callback. Give the interface an admitting `@throws` signature, or supply a callback that catches the throw. Generic interface arguments and compatible overloads retain their own contracts.

A foreign callback passed to a signature marked `@rethrows cb` keeps its known thrown contract at the enclosing call, constructor or tagged template. A function literal passed to a `@rethrows` parameter may call a function known to throw: in `invoke(() => JSON.parse(text))`, those throws belong to `invoke`. The invocation needs an `Effect.try` bridge in effect code (`EK0403`) or a native `try/catch` in plain code (`EK0401`). A nested function keeps its own check, and a literal that catches the exception does not propagate it. Effect-returning callbacks retain their non-throwing contract; a known throwing call in their parameter defaults or in an ordinary factory body remains `EK0401`. The enclosing signature’s `@throws {never}` does not erase that callback contract. Synchronous code must catch the invocation or put it in an admitting wrapper such as `Effect.try`. Callbacks that return an Effect keep their `never` thrown contract.

A conditional callback, such as `flag ? risky : safe`, retains each branch’s written thrown contract when passed to `@rethrows`. The enclosing call handles those throws even when the branches have the same TypeScript function type. Catch the call in plain code, or use `Effect.try` in effect code. Inline literals follow the same rule: `invoke(flag ? () => JSON.parse(text) : () => 0)` assigns the selected callback’s known throws to `invoke`. Logical selections with `??`, `||` or `&&`, and the result of a comma expression, retain that boundary. Catch the enclosing invocation; nested functions and explicit `throw` statements keep their own checks.

A foreign function can throw synchronously before returning a `Promise` or `PromiseLike`. Its written `@throws` contract therefore applies at the call, including in parameter defaults and field initializers. Catch the call with native `try/catch` or put it in an admitting wrapper. An `async` function declared in VibeLang uses Promise rejection semantics for its body and parameter defaults.

An `error` or `schema error` constructor gets `EK1301` once, including when it has a `static` modifier. A computed method named `["constructor"]` is an ordinary method, so its `static` modifier gets `EK1302`. Payload fields named `constructor` keep ordinary field behavior.

An unannotated foreign function declaration has thrown type `unknown` when used as a callback value. An unannotated callback type admits only `never`, so assignments, arguments, written callable returns, object members and class fields must use a compatible contract. Retained aliases keep the foreign function’s default; a VibeLang function still has thrown type `never`, and an Effect-returning foreign function follows the effectful-callable rule.

Foreign callable variables follow the same callback rule as foreign function declarations: an unannotated `const read: () => string` in a `.ts` or `.d.ts` file has thrown type `unknown`. An untyped alias such as `const next = read` keeps that contract. Handle the throw with `Effect.try`, or use a callback signature with a compatible `@throws` bound. Callable fields supplied by foreign base classes follow this rule when checked against an implemented interface. Intrinsic pattern names such as `Option.None` are pattern syntax; using them in a pattern does not pass a foreign callback.

A returned callable carries its own throw contract. A foreign factory’s `@throws {never}` annotation describes the factory call; it does not make an unannotated callback returned by that factory nonthrowing. Handle that callback’s throw with `Effect.try`, or give its own signature a compatible written contract.

Direct instantiation values such as `read<Program>` keep the foreign generic signature’s throw contract, just like an alias of that value. An unconstrained signature stays `unknown` even when its chosen type argument is an `Effect`. A signature constrained to `Effect`, `Stream` or `Layer` remains effectful and nonthrowing.

An overloaded callback is checked signature by signature. Generic overloads use TypeScript's overload assignability rules before their throw contracts are compared. Specializing a compatible generic overload that throws `never` keeps it admissible to a callback without `@throws`. Passing a callback that throws `Error` for argument `0` but throws `never` for argument `1` to `(value: 1) => number` is allowed. Every signature of an overloaded destination must have a type-compatible source signature with an admitted `@throws` contract. A union of function types admits a value when one alternative fits.

A foreign function type alias cannot admit throws through a tag on the alias itself. Put the tag on its call signature, on a separate line:

```ts
type Reader = {
  /** @throws {Error} */
  (): string
}
```

A tag on `type Reader = () => string` does not attach; passing a throwing callback to that unannotated signature reports `EK0402`.

Legacy abstract plain and schema error roots report the migration warning `EK1308`. Write an explicit `abstract class` to keep the existing abstract constructor, widened tag contract, members and runtime matcher. A native abstract class keeps its TypeScript meaning. An abstract plain root retains its inherited matcher, including boolean and extractor calls through `customMatcher`.

For `abstract schema error` roots, the native-class migration retains the original family registration before written static members. A schema built from the base therefore keeps encoding and decoding its registered descendants; public declarations are unchanged.

Inside an `Effect.try` thunk, a callback supplied to a rethrowing array method may call a function known to throw. A function returned from that callback is a separate plain function and still needs its own boundary.

In the options overload, a computed key that resolves to `"try"`, such as `["try"]` or `[key]` with `const key = "try" as const`, keeps the same thunk contract. Evaluating the key stays in the surrounding code. Native `call` and `apply` forward that computed-key callback contract too.

An optional call returning `any` still follows its callee's thrown contract. A callable declared in `.vibe` outside a `module` body throws `never`, including when its result is `any`; calling a value itself typed `any` needs an explicit failure boundary in effect code.

An `effect` callback's parameter defaults keep their strict no-throw contract inside `Effect.try`, including an options object's `try` callback. A tracked throwing default is `EK0401`; the wrapper does not relax initialization before the callback's Effect or Stream exists.

A generic helper that forwards arguments into a callback checks each argument against that callback's written parameter type. An inferred rest tuple does not remove the parameter's throws restriction.
