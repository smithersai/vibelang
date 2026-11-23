# Welcome to VibeLang

VibeLang is a language for building reliable TypeScript in the AI era, built on [Effect](https://effect.website). It gives Effect a simple, readable syntax. The compiler turns it into ordinary Effect code that your team can read and ship, and `.ts` files, npm packages and the rest of the TypeScript ecosystem stay one import away.

Here is one program twice: a typed error, a service, a fallback and the layer that provides the service. First in Effect TypeScript, then in VibeLang.

```ts effect
import { Console, Context, Data, Effect, Layer } from "effect"

interface User { id: string; name: string }

class UserNotFound extends Data.TaggedError("UserNotFound")<{ readonly id: string }> {}

class Users extends Context.Service<Users, {
  find(id: string): Effect.Effect<User, UserNotFound>
}>()("app/Users") {}

const greet = (id: string) => Effect.gen(function* () {
  const users = yield* Users
  const user = yield* users.find(id).pipe(Effect.orElseSucceed(() => ({ name: "guest" })))
  return `Hello, ${user.name}`
})

const UsersLive = Layer.succeed(Users, {
  find: (id: string) => Effect.succeed({ id, name: "Ada" })
})

const main = Effect.gen(function* () {
  yield* Console.log(yield* greet("ada"))
}).pipe(Effect.provide(UsersLive))

await Effect.runPromise(main)
// Output: Hello, Ada
```

```vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

interface User { id: string; name: string }

error UserNotFound { id: string }

service Users {
  static readonly key = "app/Users"
  find(id: string): User!UserNotFound
}

effect function greet(id: string) {
  const users = try Users
  const user = users.find(id) catch () => ({ name: "guest" })
  return `Hello, ${user.name}`
}

const UsersLive = Layer.succeed(Users, {
  find: effect (id: string) => ({ id, name: "Ada" })
})

effect function main() {
  provide UsersLive {
    try Console.log(try greet("ada"))
  }
}

NodeRuntime.runMain(main())
// Output: Hello, Ada
```

Both programs print `Hello, Ada`, and both run on Effect.

- `error` declares the tagged error class.
- `service` declares the capability (`Users`) that callers can ask for without threading an implementation through every parameter list.
- `effect function` returns an Effect without running it.
- `try` runs an Effect inside another Effect; `catch` handles its declared failure.
- `provide` supplies the layer so `main()` needs nothing left to run.
- `NodeRuntime.runMain(main())` starts execution once, at the edge of the program.

The compiler infers `greet` as `string!!Users` — short for `Effect<string, never, Users>`: it returns a `string`, cannot fail with an expected error (the `catch` handled `UserNotFound`), and requires `Users`. TypeScript code importing `greet` sees that exact Effect type.

![Every Effect carries three compile-time channels: Success (A), Expected Errors (E), and Required Services (R)](/diagrams/effect-three-channels.svg)

> **Alpha notice.** VibeLang is v0. The language will change in major, breaking ways, and it is not ready for production use.

## Why a language

A TypeScript signature names what a function returns. It says nothing about what can fail or what services it needs. Effect puts all three into one compiler-checked type, `Effect<Success, Error, Requirements>`, and builds retries, timeouts, structured concurrency, resource cleanup, and tracing around it.

Because Effect is a library, it constructs those ideas out of TypeScript's existing syntax: generators and `yield*` to sequence steps, `pipe` to compose operators, and verbose class declarations for errors and services.

VibeLang gives each core Effect idea its own statement syntax and compiles directly to the Effect program you would write by hand. [Why VibeLang?](getting-started/002-why-effect.md) makes the full case — including Effect's own argument against a language.

## TypeScript stays one step away

![VibeLang compiles .vibe and .ts together into ordinary Effect JavaScript and .d.vibe.ts declarations](/diagrams/vibe-ts-interop.svg)

Interop rests on two facts:

1. **The output is ordinary Effect code.** The compiler is a fork of the TypeScript 7 compiler. It checks `.vibe` and `.ts` files in one program and emits JavaScript plus a `.d.vibe.ts` declaration beside each `.vibe` file. Any TypeScript caller imports a VibeLang function as an ordinary Effect function ([VibeLang for Effect users](vibelang-features/114-vibelang-for-effect-users.md)).
2. **A `.ts` file can sit beside any `.vibe` file.** Plain and `async` functions keep TypeScript semantics. Code that needs a Node or browser global, or that throws JavaScript exceptions, stays in `.ts` and crosses into Effect code through Effect's own adapters: `Effect.try` for synchronous throws, `tryPromise` for Promises, and `callback` for callback APIs.

Based on [Effect's Creating Effects](https://effect.website/docs/v4/getting-started/creating-effects#trypromise), this adapter wraps an `async` function from a `.ts` file:

```ts
// TypeScript (.ts)
// todos.ts
export async function fetchTodo(id: number, signal: AbortSignal): Promise<string> {
  const response = await fetch("https://jsonplaceholder.typicode.com/todos/" + id, { signal })
  if (!response.ok) throw new Error("Todo request failed: " + response.status)
  return response.text()
}
```

```vibe
// load-todo.vibe
import { fetchTodo } from "./todos.ts"

error TodoFailed { cause: unknown }

effect function getTodo(id: number) {
  return try tryPromise({ try: (signal) => fetchTodo(id, signal), catch: (cause) => new TodoFailed({ cause }) })
}
// (id: number) => string!TodoFailed

effect function todoOrFallback(id: number) {
  return retry(getTodo(id), Schedule.recurs(2)) catch () => "Todo unavailable"
}
```

`tryPromise` forwards Effect's cancellation `AbortSignal` into `fetchTodo`, and `retry` wraps the cold Effect returned by `getTodo(id)`.

## Effect's features, in VibeLang syntax

Effect's functions and modules are in scope without imports. Common constructs have dedicated syntax; everything else keeps its Effect library API:

| Feature | VibeLang |
| --- | --- |
| Effect types | `User!NotFound!Users` (returns `User`, fails with `NotFound`, needs `Users`) |
| Effect functions | `effect function load(id) { const user = try find(id); ... }` |
| Typed errors | `error NotFound { id: string }`, `throw new NotFound({ id })`, `x catch () => fallback` |
| Dependency injection | `service Users { ... }`, `provide UsersLive { ... }` |
| Structured concurrency | `fork work()`, `join f`, `try.all [a(), b()]`, `for concurrent(8) (const id of ids) { ... }` |
| Retries and timeouts | `try (work() \|> retry(%, policy) \|> timeout(%, "1 second"))` |
| Resource safety | `try scoped(effect { const conn = try acquireRelease(connect(), close); ... })`, `try ensuring(work, cleanup)` |
| Tracing | `try withSpan(effect { ... }, "checkout")` |
| Streams | `effect function* rows() { yield row }`, `for try (const row of rows()) { ... }` |
| Schema validation | `schema User { id: string; role: "admin" \| "member" }` |
| Pattern matching | `match (e) { when NotFound: ...; }` |

The [cheat sheet](vibelang-features/115-cheat-sheet.md) puts every VibeLang form beside the Effect code it replaces.

## Try it

You need Node `22.22.3` (`22.x`) or Node `24.11.1` or later. Bun is optional. If you use it, install Bun 1.4.2 or later. See how to [run sources with Bun](setup/vibelang-cli.md#run-sources-with-bun).

```sh
npm create vibelang@latest my-app
cd my-app
npm run start
```

With Bun:

```sh
bun create vibelang@latest my-app
cd my-app
bun run start
```

Open the folder in VS Code or Cursor and install the bundled editor extension:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
```

[Getting Started](013-getting-started.md) walks through the starter project. [Installation](getting-started/004-installation.md) covers platforms, editors, and existing projects.

## Where to go next

- **New to Effect:** start the Learning Path with [The Effect Type](getting-started/003-the-effect-type.md), then [Creating Effects](getting-started/005-creating-effects.md) and [Two Types of Errors](error-management/006-two-error-types.md).
- **Coming from Effect:** skim the [cheat sheet](vibelang-features/115-cheat-sheet.md) and read [VibeLang for Effect users](vibelang-features/114-vibelang-for-effect-users.md).
- **Real production code:** [A real provider, before and after](getting-started/real-provider-before-after.md) compares one Alchemy resource provider in both languages.
- **Full language rules:** the [specification](../../design/src/000-intro.md) defines every rule formally.
