## Part I. The language by example

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

Each chapter shows a task in today's Effect and in VibeLang. VibeLang uses Effect's own modules unchanged; you stop writing generators, `yield*`, and most combinators.

Snippet conventions: a snippet without an enclosing function sits inside one, because a module's top level cannot run a program (Chapter 13). Names such as `User`, `guest`, and `MailerTest` are declared nearby; helpers such as `toUser`, `isAdmin`, `isActive`, `toRow`, and `isError` are plain VibeLang functions, declared with their return types, `function toUser(row: Row): User`, so they fit a plain callback and a TypeScript caller receives their values (D500, D518). Imports of Effect modules outside the prelude (`Schedule`, `Stream`, `Fiber`, and so on) are omitted.

### 1. A first look

A complete program: two services, two typed errors, a function that uses them, and a `main` that runs it.

#### The program

```ts effect
import { Context, Data, Effect } from "effect"

class UserNotFound extends Data.TaggedError("UserNotFound")<{
  readonly id: string
}> {}

class MailError extends Data.TaggedError("MailError")<{
  readonly reason: string
}> {}

class Users extends Context.Service<Users, {
  find(id: string): Effect.Effect<User, UserNotFound>
}>()("app/Users") {}

class Mailer extends Context.Service<Mailer, {
  send(to: string, body: string): Effect.Effect<void, MailError>
}>()("app/Mailer") {}

export const welcome = Effect.fn("welcome")(function* (id: string) {
  const users = yield* Users
  const mailer = yield* Mailer
  const user = yield* users.find(id)
  yield* mailer.send(user.email, `Welcome, ${user.name}!`)
  return user.name
})
```

```ts es
error UserNotFound {
  id: string
}

error MailError {
  reason: string
}

service Users {
  find(id: string): User!UserNotFound
}

service Mailer {
  send(to: string, body: string): void!MailError
}

export function welcome(id: string) {
  const user = Users.find(id)
  Mailer.send(user.email, `Welcome, ${user.name}!`)
  return user.name
}
```

Four things changed:

- **`welcome` is an ordinary function declaration.** No `Effect.fn`, no generator, no `yield*`. Calling `Users.find(id)` runs it and returns the `User`; if it fails, `welcome` fails with the same error.
- **A service is a `service` declaration.** `service Users`, an abstract class, replaces the `Context.Service` class, with no key string and no `Context` import. You call `Users.find(id)` without first getting the service with `yield* Users` (Chapter 4).
- **The contract is inferred.** `welcome` is `string!UserNotFound | MailError!Users | Mailer`: it succeeds with a `string`, can fail with either error, and needs both services. Write the contract only when you want the compiler to check it (Chapter 2).
- **Errors are the same classes.** `error UserNotFound { id: string }` declares a class that extends `TaggedError`, Effect's `Data.TaggedError`, in scope without an import.

#### What is in scope

Every `.vibe` file has this prelude in scope, so the program above needs no imports:

| Name | What it is |
| --- | --- |
| `Effect` | Effect's `Effect` module, and the type `Effect<A, E, R>` |
| `Schema`, `Layer` | Effect's modules, unchanged |
| `Scope` | Effect's `Scope` module, and the type `Scope` (Effect's `Scope.Scope`) |
| `TaggedError` | Effect's `Data.TaggedError` |
| `Control` | The base class of control operations (Chapter 9) |
| `pipe`, `wire`, `fork`, `join`, `forkIn`, `detach`, `handle`, `resume`, `resumeWith`, `abandon`, `customMatcher` | VibeLang's built-ins, each introduced at first use; `fork` and `join` are the keywords' own bindings, used only under those names (D432) |
| `sync`, `try`, `callback` | Boundary hatches: their first argument is self-contained TypeScript, and values reach it as inputs (D148, D229) |
| `Resume<A, E>` | The callback hatch's resume parameter type (Chapter 10, D230) |
| `runPromise`, `runFork`, `runSync`, `runCallback` | Effect's runners, the way back in from TypeScript (D150) |
| `sleep`, `log`, `logDebug`, `logInfo`, `logWarning`, `logError`, `retry`, `repeat`, `timeout`, `all`, `forEach`, `race`, `withSpan`, `die`, `exit`, `interrupt`, `yieldNow`, `uninterruptible`, `uninterruptibleMask`, `interruptible`, `interruptibleMask` | The Effect module's functions without the `Effect.` prefix, the masks among them those the mask blocks call (D151, D179, D180) |
| Every other export of `effect`'s root | `Console`, `Option`, `Stream`, `Schedule`, `Duration`, and the rest, plus `flow` and `identity` (D146) |
| Every module of `effect`'s subpath packages | `HttpRouter`, `ChildProcess`, `TestClock`, `Hex`, and the rest, from `effect/http`, `effect/process`, `effect/testing`, `effect/encoding`, and the other subpaths (D310) |

`Experimental` is also in scope. It holds the platform services Effect lacks (D313, Chapter 11). The keyword forms, `fork x`, `join x`, `provide L { … }`, the mask blocks `uninterruptible`, `restore`, and `interruptible` (D180), and the await operations, are syntax, not names: no import or local declaration changes them. Only the parenthesized `fork(x)` and `join(x)` follow a binding: a `fork` or `join` the program declares or imports, other than the prelude's own, makes them ordinary calls (Chapter 13, rule H5, D391).

A module's name also names its export of the same name, where the module has no meaning of its own (D311): the type `Option<number>` is `Option.Option<number>`, `FileSystem.readFileString(path)` calls the `FileSystem.FileSystem` service, and `FileSystem()` is its implementation. The module's own exports, such as `Option.some` and `FileSystem.layerNoop`, win.

Import platform packages, such as `@effect/platform-node`, as usual. A root module wins over a subpath module of the same name, and a name that two subpath packages share, such as `Model`, needs an import (D310). An import or local declaration with the same name shadows a prelude name, as it shadows any global. The prelude is what most Effect files import anyway: `Effect` appears in 77-81% of the Effect files in two large codebases (Smithers, 2,149 files; opencode, 1,031), `Schema` in 39-44%, `Layer` in 34-44%, and no other module in more than 22%. `Scope` is included because contracts name it whenever a resource outlives a function (Chapter 6). JavaScript's globals keep their names: `Array`, `String`, `Number`, `Boolean`, `Symbol`, `BigInt`, `Function`, and `RegExp` mean JavaScript's, so import Effect's modules of those names under another name, as in `import { Array as Arr } from "effect"`. Shared web-standard globals such as `Request`, `Headers`, and `Event` also keep their names (D264, D310); Effect's `Request` needs `import { Request } from "effect"`. DOM-only globals lose: in a project whose `lib` includes the DOM, `Option` is still Effect's.

#### Running it

```ts es
// main.vibe
import { AppLive } from "./app.vibe"
import { welcome } from "./welcome.vibe"

export function main() {
  const name = Effect.provide(() => welcome("42"), AppLive)
  log(`sent a welcome email to ${name}`)
}
```

`Effect.provide` supplies the services `welcome` needs from an application Layer (Chapter 4 builds `AppLive`). The `() =>` in `() => welcome("42")` hands Effect a program without running it (Chapter 5). The module exports a parameterless `main`, so its JavaScript ends with an entry statement, a `runtime.$entry(…)` check: when the host starts the file, as `node main.js` does, the statement hands `main` to a runner, the only place a program starts, and importing the module starts nothing (D135). A top-level runner call replaces the entry statement. A file that also names its platform, `import "vibelang/platform/node"`, has the entry provide that platform's services to `main` (D312, Chapter 11). Chapter 13 states the entry rule.

#### What the compiler produces

VibeLang compiles to TypeScript. The output for `welcome`:

```ts gen
export const welcome = Effect.fnUntraced(function* (id: string) {
  const users = yield* Users
  const user = yield* users.find(id)
  const mailer = yield* Mailer
  yield* mailer.send(user.email, `Welcome, ${user.name}!`)
  return user.name
})
```

```ts dts
import { Effect } from "effect"
export declare const welcome: (id: string) =>
  Effect.Effect<string, UserNotFound | MailError, Users | Mailer>
```

TypeScript that imports `welcome` sees an ordinary function returning an `Effect`. Each service compiles to the `Context.Service` class Effect TypeScript writes (Chapter 4, D501), so TypeScript can provide `Users` with an ordinary Layer, and VibeLang can use services written in TypeScript.
