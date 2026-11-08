# Creating Effects

An effect function describes a VibeLang computation: return a value to succeed, throw a typed value for an expected failure, and wrap calls to plain TypeScript functions that may throw.

The `effect` keyword also fixes the kind of a class method. Editor projection keeps that kind for a pure body and for a return type that names a local or imported Effect alias.

Use `effect` on functions, arrows, and class or object methods. Getters, setters, and class constructors cannot have an `effect` prefix (`EK0104`). Move the work into an effect method, or let an ordinary getter return an `effect { … }` value for the caller to run. `effect get()` and `effect set()` remain effect methods named `get` and `set`; `effect()` is a plain method named `effect`. In an object literal, `effect constructor()` is an effect method named `constructor`.

`vibelang --fix` can preserve a parameterless legacy Effect constructor by returning a cold `effect { … }` block from an ordinary constructor. Constructors with parameters, type parameters, a return annotation, `async`, `super`, or `new.target` need a manual migration: the old Effect method lowering deferred parameter initialization until each run, so simply removing `effect` would change when work happens.

An `effect` arrow keeps its arrow form, and a function expression keeps its written or inferred name. This also holds for parameterless, multi-statement bodies that contain no `try`: the body remains cold and runs again each time its Effect runs.

Calling an `effect` function constructs its unrun Effect, including when the body is empty or has a bare `return`. Evaluating an `effect { … }` block does the same. Separate constructions follow the `Effect.gen` counterpart; keeping one Effect in a variable and reusing it keeps that value. Explicit equality comparisons still produce ordinary Boolean results.

An `effect` function keeps this behavior when defined inside an `Effect.try`, `tryPromise` or `sync` callback: running the wrapper creates the function; calling it builds the unrun Effect. An `effect { … }` block in such a callback also builds its own cold Effect, which the caller runs separately with `try`.

Written parameter type aliases remain in its exported declaration, as in TypeScript. An `effect` function binds its parameters and evaluates defaults when you call it. Running the returned Effect executes the body. Repeated runs of that same Effect share the call's parameter bindings, including writes the body makes. If a default or destructuring binding throws, the call returns an Effect that dies with that value. An omitted array slot, as in `[, second]`, advances the iterator without reading that element’s value. A pattern containing only omitted slots still performs its iterator steps when called.

A synchronous call of an unannotated `.ts` function in an effect function's or producer's parameter default reports `EK0401`: compute that value in the body through `Effect.try`. Class field initializers and `static` blocks keep their plain JavaScript context even inside an effect function; an unannotated `.ts` call there stays an ordinary call.

For an existing throwing call in a parameter initializer, `vibelang --fix` can supply a TypeScript adapter that preserves call-time evaluation. Its private result rethrows the original exception at the same point. An `effect` function or producer still returns a program that dies with it; a plain Effect factory still throws at its call. The repair also covers defaults of callbacks that return an Effect, without adding another Effect activation. An explicitly `effect` callback passed to `Effect.try` or an options object's `try` property keeps the same strict parameter checks and preserving repair. Direct `eval`, suspension operands and predicate calls retain their manual boundary.

Effect methods keep their source `this` and `super` bindings. A `super.method(...args)` call or a `super.tag` template invokes the inherited method with its source receiver, without reading that method's own `call`, `apply` or `bind` properties. Computed keys, arguments and template substitutions keep their JavaScript evaluation order; an optional `super.method?.(...args)` skips its arguments when the method is absent.

## Success and failure

```vibe
// run: try Console.log((try reserve("notebook", true)).item)
error Unavailable {
  item: string
}

effect function reserve(item: string, available: boolean) {
  if (!available) throw new Unavailable({ item })
  return { item, reserved: true }
}
// { item: string; reserved: boolean }!Unavailable
// Output: notebook
```

The compiler records the returned object in `A` and `Unavailable` in `E`. `succeed(value)` and `fail(error)` build Effects; run them with `try`. To store the work, write `const reservation = reserve("notebook", true)`.

A return annotation on an `effect` function describes the whole Effect: write `unknown!!` for an Effect that succeeds with an unknown value, or leave the annotation out to infer its success, error and requirement channels. Bare `any` and `unknown`, including aliases and unions that resolve to them, report `EK0106`; they do not name an Effect container. A union of different Effect types, such as `(number!!) | (string!Refused)`, is not one Effect either, as a union of Promises is not an `async` function's return type: it reports `EK0106`, and its quick fix writes the one Effect of the joined channels, `(string | number)!Refused`. `vibelang --fix` can remove a broad annotation from a function with a body and infer its contract, preserving the body and its cold execution. The fix gate refuses a repair that introduces another error, such as recursive inference that still needs a written contract.

## Track errors as values

```vibe
// run: try Console.log(try attemptReservation("notebook", false))
effect function attemptReservation(item: string, available: boolean) {
  const outcome = try result(reserve(item, available))
  if (Result.isFailure(outcome)) return outcome.failure.item
  return outcome.success.item
}
// string!!
// Output: notebook
```

`Effect.result` captures an expected failure as a `Result` value so the function can continue; defects and interruption still propagate. In an Effect function, `throw` adds to the inferred contract, and `Effect.fail` gives the same expected failure channel.

## Wrap synchronous operations

```vibe
// run: provide NodeCrypto.layer { try Console.log((try token()).length) }
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"

effect function token() {
  const random = try SecureRandom.SecureRandom
  return try random.randomBytes(16)
}
// Output: 16
```

Platform work goes through Effect's services, not through a wrapper of your own. Read the `SecureRandom` service with `const random = try SecureRandom.SecureRandom`, then run `random.randomBytes(16)` with `try` instead of calling `crypto.getRandomValues`. Provide the platform layer explicitly at the application boundary, here `NodeCrypto.layer`. For each Node.js or web call, EK4402 names the service and its layer; [Platform globals](../platform/platform-globals.md) lists them all.

```ts
// platform-fs.ts
// types: node
export { statfsSync } from "node:fs"
```

```vibe
// run: try Console.log((try freeBlocks(".")) > 0)
import { statfsSync } from "./platform-fs.js"

error StatFailed {
  cause: unknown
}

effect function freeBlocks(path: string) {
  return try Effect.try({
    try: () => statfsSync(path).bavail,
    catch: (cause) => new StatFailed({ cause })
  })
}
// number!StatFailed
// Output: true
```

A platform API that neither Effect nor VibeLang's [experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md) cover, such as `statfs`, which reports a file system's free space, needs a TypeScript adapter. A `.vibe` file imports no Node.js value directly, so `platform-fs.ts` re-exports `statfsSync`. `try Effect.try(() => statfsSync(path).bavail)` turns an exception into an expected failure, and the `catch` option above gives the failure a domain name.

The wrapper's callback uses plain TypeScript execution semantics and is evaluated when the Effect runs. Platform restrictions still cover its body: direct host globals such as `window` and `document` belong in a `.ts` adapter. Its arrow captures `path` from the enclosing function. `Effect.try` wraps synchronous code; `tryPromise` wraps a Promise.

A plain VibeLang function never throws: a `throw` outside effect code and `async` functions is `EK0401`. The compiler tracks what TypeScript and JavaScript functions may throw. JavaScript's built-ins have `@throws` annotations, so a function known not to throw, such as `Math.max`, can be called directly. A function that may throw must be wrapped with `Effect.try` before an effect function calls it. On a non-effectful callable, a written non-`never` `@throws` contract requires the same bridge; an unwrapped call in effect code is `EK0403`.

For existing synchronous code, `vibelang --fix` can move a `throw` instruction into a TypeScript `module` helper. It evaluates the operand once in its original scope and throws the same value at the same point; native `try`/`catch` still catches it. The function keeps its synchronous return type and declaration. In a plain `catch` handler, the fix uses `catch effect` and `die` so the exception remains a defect. A refused site is reported with its original span and reason. For tracked synchronous calls, the fix moves the call into a TypeScript helper while retaining the receiver, method getter order, argument order, and return type. Overloaded calls can use this helper when every signature accepts the supplied argument count and agrees on those argument types and the result type. Generic and type predicate calls, optional and spread calls, and operands containing suspension or direct `eval` remain refused. Overloads with rest or an explicit `this` parameter also remain refused. An unannotated foreign call returning a Promise still has synchronous thrown type `unknown`: the Promise return does not prove it cannot throw. Such a call is `EK0401` in an effect function's parameter default or a plain function returning wholly an Effect, a Stream or a Layer. A local `async` callable or a foreign `@throws {never}` contract can supply a Promise default. Calling a value typed `any` or `Function` in an effect function's or producer's default is `EK0401`: erasing its signature leaves its thrown type `unknown`.

A return type counts as a `Stream` only when it is assignable to `Stream.Stream<any, any, any>`. A foreign function returning a partial view that has only `~effect/Stream`, or omits `channel` or `pipe`, keeps its written `@throws` contract, or `unknown` without one. Wrap the call when that contract may throw (`EK0403`). Ordinary plain-code rules apply to a function returning only such a partial view. `vibelang --fix` keeps formerly untracked calls as defects, including calls with a written throwing contract, without widening the inferred failure channel.

Optional reference syntax does not change the selected callable’s own return contract. A foreign function returning `Effect.Effect<A> | undefined` is non-effectful, so `read?.()` keeps its written `@throws` contract, or `unknown` without one, and needs a bridge when it may throw (`EK0403`). An optional reference to a function returning wholly an `Effect`, `Stream` or `Layer` keeps that function’s non-throwing contract.

A plain function that returns an Effect has a stricter no-throw contract: an internal factory whose result every caller immediately runs can use `die` for a native exception. An escaping native exception in an exported factory, or a factory whose result escapes or is stored, remains refused because changing a call-time exception into a later defect would change behavior. Converting a throw to an Effect return refuses native iterator or resource cleanup, preserving JavaScript's abrupt completion and cleanup-error precedence.

For an inline `Effect.suspend` callback, `--fix` can keep the callback plain and return `die(value)` at a native `throw`. A throw expression is eligible when it directly supplies the returned Effect, such as a conditional branch. This keeps the original run phase and defect value. Throwing parameter defaults, non-tail throw expressions, named callbacks, shadowed `die` bindings and native cleanup remain refused.

If a plain Effect-returning factory's own native `try`/`catch` intercepts a `throw`, `--fix` can use the TypeScript helper inside that `try`. The existing `catch` still receives the same value and keeps its error mapping, evaluation order and native cleanup. This also applies to exported factories. A throw in the catch body or a nested function does not qualify.

A TypeScript library states its thrown error type with `@throws {ErrorType}` in its declaration. A callable declared in `.ts`, `.d.ts` or JavaScript with no `@throws` is assumed to throw `unknown`, with a written type or without one; `@throws {never}` states that it cannot throw. VibeLang functions throw nothing, so their exported declarations carry `@throws {never}`; a `.vibe` file can't write `@throws`, its alias `@exception`, or `@rethrows` (`EK0406`). Shipped annotations apply before foreign defaults. For synchronous invocation of a `.ts` function, `@rethrows f` adds `f`'s thrown type to the callee's own throws, including when the own contract is `@throws {never}`. A conditional or logical expression can select an inline callback; calls known to throw inside that callback belong to the rethrowing invocation, so catch or wrap that invocation. An `async` function's `throw` rejects its Promise. Wrap an imported function that may throw in `Effect.try`, and use its `catch` option to map the exception to a domain error.

A native callback keeps its `@throws {never}` contract when imported through emitted declarations, including function-type aliases, conditional branches and returned callbacks. The compiler places each generated JSDoc contract on its own line so it attaches to the callable when the declaration is loaded.

This also applies to a callback supplied directly in a fixed tuple literal spread: catch or wrap the rethrowing invocation to handle the callback’s known throws.

In Effect code, `catch` sees expected failures only. Implicit exceptions, such as reading a property of `undefined`, are defects. For recoverable input, use `Option.getOrElse`, `fromOption`, or `Schema.decodeUnknownEffect`. Plain and `async` functions keep JavaScript's `try`/`catch` semantics. Plain foreign calls at module top level are ordinary JavaScript calls, so their exceptions fail the module's import.

`try Effect.try(() => uptime())`, with `uptime` re-exported from `node:os` by a `.ts` file, wraps synchronous work that may throw: `uptime` has no `@throws` annotation, so it may throw `unknown`, and `sync` takes only a function that can't throw. The host name has a service, `Experimental.Process.Process`, among the [experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md): read it with `try Experimental.Process.Process`, then call its `hostname` method. Keep Node adapters in `.ts`. `.vibe` helpers that calculate or mutate local data and cannot throw need no wrapper. For a platform API that Effect covers, use `Console` for output, `FileSystem.FileSystem` for files, `SecureRandom.SecureRandom` and `Digest.Digest` from `effect/crypto` for random bytes and digests, and `HttpClient` for HTTP.

String computation needs no wrapper:

```vibe
// run: try Console.log(slug("Hello VibeLang"))
function slug(title: string) {
  let s = title.trim().toLowerCase()
  s = s.replaceAll(/[^a-z0-9]+/g, "-")
  return s
}
// Output: hello-vibelang
```

Calls whose callee or receiver is a type parameter, indexed type, conditional type, union or intersection remain refused. A generic TypeScript boundary can otherwise change an inferred return type, such as `number`, into a deferred `ReturnType<…>`. The refusal keeps the original site and declaration API.

## Create effects from promises

```ts
// types: node
// signing.ts
export async function hmac(secret: string, text: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return await crypto.subtle.sign("HMAC", key, encoder.encode(text))
}
```

```vibe
// run: try Console.log((try sign("secret", "parcel")).byteLength)
import { hmac } from "./signing.ts"

error SigningFailed {
  cause: unknown
}

effect function sign(secret: string, text: string) {
  return try tryPromise({ try: () => hmac(secret, text), catch: (cause) => new SigningFailed({ cause }) })
}
// ArrayBuffer!SigningFailed
// Output: 32
```

This HMAC signing calls the platform from a `.ts` module to show `tryPromise` wrapping its Promise; Effect's `Mac` service signs without one. A `.vibe` file reaches the platform only through Effect's services, inside a `tryPromise` callback too.

`tryPromise` waits for the callback's Promise and maps a rejection into `E`. The `catch` option gives the failure a domain type. The callback receives an `AbortSignal`; pass it to an API that supports cancellation. Otherwise interruption stops the wait but not necessarily the foreign operation.

An API returning `number | Promise<number>` can be normalized in the callback: `try tryPromise(async () => readNumber())` gives the number in either case. `promise` wraps a Promise whose rejection should be a defect. Plain `async` functions use `await` for Promises; effect functions use `try` for wrapped Effects, and `join` waits for a fiber. For HTTP, use Effect's `HttpClient`; for a digest, use `Digest.Digest` from `effect/crypto`.

## Adapt callbacks and cancellation

```vibe
// A one-shot read ends its registration when either callback fires.
// run: try Console.log(try readAndReport({ read: (onValue: (n: number) => void) => { onValue(7); return () => {} } }))
type Source = {
  read: (onValue: (n: number) => void, onError: (e: Error) => void) => () => void
}

effect function nextReading(source: Source) {
  return try callback<number, Error>((resume) => {
    const cancel = source.read((n) => resume(succeed(n)), (error) => resume(fail(error)))
    return sync(cancel)
  })
}

effect function readAndReport(source: Source) {
  const reading = try nextReading(source)
  try Console.log(`reading=${reading}`)
  return reading
}
// Output: reading=7
// Output: 7
```

`callback` registers a plain callback and waits for its first completion. `resume(succeed(value))` succeeds, `resume(fail(error))` fails with an expected failure, and `resume(exit)` adopts an `Exit`; later completions are ignored. The registration returns a cleanup Effect, here `sync(cancel)`, that runs if the wait is interrupted. The callback captures `source` and receives `resume` followed by an `AbortSignal`. The type arguments `callback<number, Error>` state its success and failure types.

For resource acquisition, cancellation must also release a resource that arrives after the waiter is gone; ignoring a late callback is not enough. Prefer an existing Effect resource API.

## Write TypeScript in a separate file

A file that imports `node:*` needs Node's declarations. Install them with `npm install --save-dev @types/node` (or `bun add --dev @types/node`). The starter sets `"types": []`; change it to `"types": ["node"]` in `compilerOptions` in `tsconfig.json`. Otherwise an import such as `node:fs` reports TS2591. Keep the Node import in the `.ts` file; enabling its types does not permit platform calls in VibeLang code.

```ts
// links.ts
// types: node
import { lstatSync } from "node:fs"

/** @throws {never} */
export function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
```

```vibe
// run: try Console.log(try linked("."))
import { isSymbolicLink } from "./links.js"

effect function linked(path: string) {
  return try sync(() => isSymbolicLink(path))
}
// Output: false
```

`links.ts` is ordinary TypeScript: `throw`, `try`/`catch`, `async`, and `await` keep their TypeScript meaning, and it can import Node APIs. The `.vibe` file imports its exports through an ordinary relative specifier. The callback passed to `sync` captures `path` from the effect function. The `@throws {never}` annotation also lets an effect function call `isSymbolicLink(path)` directly.

Keep shared adapters in `.ts` files and import them wherever needed. Relative specifiers resolve from each file's directory, and the compiler emits the `.ts` module's JavaScript and declarations alongside the rest of the project.

## Suspend work

```vibe
// run: { const jsonValue = try counters(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function nextCounter() {
  let count = 0
  return effect {
    count += 1
    return count
  }
}

effect function counters() {
  const next = try nextCounter()
  return [try next, try next]
}
// number[]!!; returns [1, 2]
// Output: [1,2]
```

The returned Effect delays its body until each run. For retry to create new state each time, wrap the whole computation, mutable setup included, in `effect { … }`. `suspend` delays building an Effect when its construction must repeat.

```vibe
// run: try Console.log(try countdown(3))
effect function countdown(n: number): number!! {
  if (n <= 0) return 0
  try sleep("1 millis")
  return 1 + (try countdown(n - 1))
}

effect function checkedQuantity(n: number) {
  if (n < 0) throw new Unavailable({ item: "quantity" })
  return n
}
// number!Unavailable
// Output: 3
```

Effect functions use Effect's execution semantics. Plain functions and recursion through synchronous JavaScript callbacks retain JavaScript's stack limit; a stack overflow is an implicit throw, a defect in effect code. For deep recursion, write an `effect` function and run each recursive call with `try`. Returns and throws unify success and failure channels across branches.

## Coming from Effect

Use effect functions, `try`, returns, and throws for local work. Use `sync`, `Effect.try`, `tryPromise`, and `callback` to adapt foreign code.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/creating-effects)

When `vibelang --fix` refuses a constructor call in an `Effect.gen` or `Effect.fn` body, its message identifies direct `eval` or `yield*` in the operands. These need a manual migration to keep evaluation in its original scope and execution phase. Grouped, computed and saved constructor references keep their complete native construction when a preserving bridge is available.
