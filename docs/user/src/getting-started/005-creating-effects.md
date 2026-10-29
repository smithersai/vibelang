# Creating Effects

An effect function describes a VibeLang computation: return a value to succeed, throw a typed value for an expected failure, and wrap calls to plain TypeScript functions that may throw.

## Success and failure

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-13, VIP-14
// run: try Console.log((try reserve("notebook", true)).item)
error Unavailable {
  item: string
}

effect reserve(item: string, available: boolean) {
  if (!available) throw new Unavailable({ item })
  return { item, reserved: true }
}
// { item: string; reserved: boolean }!Unavailable!
// Output: notebook
```

The compiler records the returned object in `A` and `Unavailable` in `E`. `succeed(value)` and `fail(error)` build Effects; run them with `try`. To store the work, write `const reservation = reserve("notebook", true)`.

## Track errors as values

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-14
// run: try Console.log(try attemptReservation("notebook", false))
effect attemptReservation(item: string, available: boolean) {
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
// pending: VIP-1, VIP-5, VIP-12, VIP-14, VIP-33
// run: provide NodeServices.layer { try Console.log((try token()).length) }
import * as NodeServices from "@effect/platform-node/NodeServices"

effect token() {
  const crypto = try Crypto
  return try crypto.randomBytes(16)
}
// Output: 16
```

Platform work goes through Effect's services, not through a wrapper of your own. Read the `Crypto` service with `const crypto = try Crypto`, then run `crypto.randomBytes(16)` with `try` instead of calling `crypto.getRandomValues`. Provide the platform layer explicitly at the application boundary, here `NodeServices.layer`. For each Node.js or web call, EK4402 names the service and its layer; [Platform globals](../platform/platform-globals.md) lists them all.

```ts
// platform-fs.ts
// types: node
export { statfsSync } from "node:fs"
```

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-13, VIP-14
// run: try Console.log((try freeBlocks(".")) > 0)
import { statfsSync } from "./platform-fs.js"

error StatFailed {
  cause: unknown
}

effect freeBlocks(path: string) {
  return try Effect.try({
    try: () => statfsSync(path).bavail,
    catch: (cause) => new StatFailed({ cause })
  })
}
// number!StatFailed!
// Output: true
```

A platform API that neither Effect nor VibeLang's [experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md) cover, such as `statfs`, which reports a file system's free space, needs a TypeScript adapter. A `.vibe` file imports no Node.js value directly, so `platform-fs.ts` re-exports `statfsSync`. `try Effect.try(() => statfsSync(path).bavail)` turns an exception into an expected failure, and the `catch` option above gives the failure a domain name.

The wrapper's callback is plain TypeScript, evaluated when the Effect runs. Its arrow captures `path` from the enclosing function. `Effect.try` wraps synchronous code; `tryPromise` wraps a Promise.

The compiler tracks what plain functions may throw. JavaScript's built-ins have `@throws` annotations, so a function known not to throw, such as string trimming, can be called directly. A function that may throw must be wrapped with `Effect.try` before an effect function calls it.

A TypeScript library states its thrown error type with `@throws {ErrorType}` in its declaration. A function with no `@throws` is assumed to throw `unknown`; `@throws {never}` states that it cannot throw. VibeLang infers throws from plain `.vibe` functions and writes the annotations on exported declarations. Wrap an imported function that may throw in `Effect.try`, and use its `catch` option to map the exception to a domain error.

In Effect code, `catch` sees expected failures only. Implicit exceptions, such as reading a property of `undefined`, are defects. For recoverable input, use `Option.getOrElse`, `fromOption`, or `Schema.decodeUnknownEffect`. Plain and `async` functions keep JavaScript's `try`/`catch` semantics. Plain foreign calls at module top level are ordinary JavaScript calls, so their exceptions fail the module's import.

`try sync(() => uptime())`, with `uptime` re-exported from `node:os` by a `.ts` file, wraps synchronous work whose exceptions should be defects. The host name has a service, `Experimental.Process`, among the [experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md): read the service with `try Experimental.Process`, then call its `hostname` method. Keep Node adapters in `.ts`. `.vibe` helpers that calculate or mutate local data and cannot throw need no wrapper. For a platform API that Effect covers, use `Console` for output, `FileSystem` for files, `Crypto` for random bytes and digests, and `HttpClient` for HTTP.

String computation needs no wrapper:

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(slug("Hello VibeLang"))
function slug(title: string) {
  let s = title.trim().toLowerCase()
  s = s.replaceAll(/[^a-z0-9]+/g, "-")
  return s
}
// Output: hello-vibelang
```

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
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log((try sign("secret", "parcel")).byteLength)
import { hmac } from "./signing.ts"

error SigningFailed {
  cause: unknown
}

effect sign(secret: string, text: string) {
  return try tryPromise({ try: () => hmac(secret, text), catch: (cause) => new SigningFailed({ cause }) })
}
// ArrayBuffer!SigningFailed!
// Output: 32
```

Effect's `Crypto` has random values and digests but no keys or signatures, so HMAC signing calls the platform from a `.ts` module, and `tryPromise` wraps its Promise. A `.vibe` file reaches the platform only through Effect's services, inside a `tryPromise` callback too.

`tryPromise` waits for the callback's Promise and maps a rejection into `E`. The `catch` option gives the failure a domain type. The callback receives an `AbortSignal`; pass it to an API that supports cancellation. Otherwise interruption stops the wait but not necessarily the foreign operation.

An API returning `number | Promise<number>` can be normalized in the callback: `try tryPromise(async () => readNumber())` gives the number in either case. `promise` wraps a Promise whose rejection should be a defect. Plain `async` functions use `await` for Promises; effect functions use `try` for wrapped Effects, and `join` waits for a fiber. For HTTP, use Effect's `HttpClient`; for a digest, use its `Crypto` service.

## Adapt callbacks and cancellation

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// A one-shot read ends its registration when either callback fires.
// run: try Console.log(try readAndReport({ read: (onValue: (n: number) => void) => { onValue(7); return () => {} } }))
type Source = {
  read: (onValue: (n: number) => void, onError: (e: Error) => void) => () => void
}

effect nextReading(source: Source) {
  return try callback<number, Error>((resume) => {
    const cancel = source.read((n) => resume(succeed(n)), (error) => resume(fail(error)))
    return sync(cancel)
  })
}

effect readAndReport(source: Source) {
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
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try linked("."))
import { isSymbolicLink } from "./links.js"

effect linked(path: string) {
  return try sync(() => isSymbolicLink(path))
}
// Output: false
```

`links.ts` is ordinary TypeScript: `throw`, `try`/`catch`, `async`, and `await` keep their TypeScript meaning, and it can import Node APIs. The `.vibe` file imports its exports through an ordinary relative specifier. The callback passed to `sync` captures `path` from the effect function. The `@throws {never}` annotation also lets an effect function call `isSymbolicLink(path)` directly.

Keep shared adapters in `.ts` files and import them wherever needed. Relative specifiers resolve from each file's directory, and the compiler emits the `.ts` module's JavaScript and declarations alongside the rest of the project.

## Suspend work

```vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-5, VIP-14
// run: try Console.log(JSON.stringify(try counters()))
effect nextCounter() {
  let count = 0
  return effect {
    count += 1
    return count
  }
}

effect counters() {
  const next = try nextCounter()
  return [try next, try next]
}
// number[]!!; returns [1, 2]
// Output: [1,2]
```

The returned Effect delays its body until each run. For retry to create new state each time, wrap the whole computation, mutable setup included, in `effect { … }`. `suspend` delays building an Effect when its construction must repeat.

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(try countdown(3))
effect countdown(n: number): number!! {
  if (n <= 0) return 0
  try sleep("1 millis")
  return 1 + (try countdown(n - 1))
}

effect checkedQuantity(n: number) {
  if (n < 0) throw new Unavailable({ item: "quantity" })
  return n
}
// number!Unavailable!
// Output: 3
```

Effect functions use Effect's execution semantics. Plain functions and recursion through synchronous JavaScript callbacks retain JavaScript's stack limit. Returns and throws unify success and failure channels across branches.

## Coming from Effect

Use effect functions, `try`, returns, and throws for local work. Use `sync`, `Effect.try`, `tryPromise`, and `callback` to adapt foreign code.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/creating-effects)
