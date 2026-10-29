# Services and the environment

Sources: [VIP-9](../vips/0009-service-declarations.md), [VIP-12](../vips/0012-provide.md), [VIP-6](../vips/0006-effect-globals.md), [VIP-14](../vips/0014-effect-modules-in-scope.md), [VIP-33](../vips/0033-platform-stdlib.md).

## `service` declarations

### Syntax

```text
ServiceDeclaration = "export"? "service" Name "{" (Member | KeyMember | DefaultMember)* "}"
KeyMember          = "static" "readonly" "key" "=" StringLiteral
DefaultMember      = "static" "readonly" "defaultValue" "=" Expression
```

`service Name { members }` is the only way to declare a service. An `abstract class` is not a service. Members are written out with their types, because they have no bodies to infer from.

### Meaning

```vibe es
// compiler-gap: pending VIP-9
// src/users.vibe in the package @acme/app
service Users {
  find(id: string): User!NotFound
}
```

```ts effect
// fragment
class Users extends Context.Service<Users, {
  find(id: string): Effect<User, NotFound>
}>()("@acme/app/src/users#Users") {}
```

- **The key** is Effect's run-time identity for the service. It is derived from the package, the file and the name, as in the example. A service can write it explicitly instead, `static readonly key = "app/Users"`, as a migrated service does to keep its key.
- **A default.** `static readonly defaultValue`, of the type of `Context.Reference`'s `defaultValue` (`() => Shape`), makes the service a `Context.Reference`. Nothing has to provide it, and providing it overrides the default.

  ```vibe es
  // compiler-gap: pending VIP-9
  service Flags {
    static readonly defaultValue = () => ({ newCheckout: false })
    newCheckout: boolean
  }
  ```

  ```ts effect
  // fragment
  const Flags = Context.Reference<{ newCheckout: boolean }>("@acme/app/src/flags#Flags", { defaultValue: () => ({ newCheckout: false }) })
  ```

- **Two types,** as in Effect. `Users` is the identifier, the type that appears in R. `Users.Shape` is the members, the type an implementation has; Effect writes it `Context.Service.Shape<typeof Users>`.

### Using a service

There is no `Users.find(id)` shorthand ([VIP-10](../vips/0010-service-call-shorthand-denied.md), denied). Get the service with `try`, then call it:

```vibe es
// compiler-gap: pending VIP-9
effect function load(id: string) {
  const users = try Users
  return try users.find(id)
}
```

```ts effect
// fragment
function load(id: string) {
  return Effect.gen(function* () {
    const users = yield* Users
    return yield* users.find(id)
  })
}
```

### Static rules

A service is a key, not a class you use.

| Rule | Code | Why |
| --- | --- | --- |
| two services with the same key anywhere in the program | EK3001 | |
| `class X extends Users {}` | EK3002 | `X` would inherit `Users`' key and silently become the same service |
| `new Users()` | EK3003 | |
| `impl instanceof Users` | EK3004 | always false, because implementations are plain objects |
| `service Repo<T> { … }` | EK3005 | `Repo<User>` and `Repo<Order>` would share one key |

**Undecided (pending VIP):** the exact format of a derived key. VIP-9 gives one example, `"@acme/app/src/users#Users"` (package name, the file's path in the package without its extension, `#`, the name); it doesn't say what a file outside any package, or a nested declaration, gets.

## `provide` blocks

### Syntax

```text
ProvideStatement = "provide" Provider ("," Provider)* Block
Provider         = Expression                 (a Layer)
                 | Expression "=" Expression  (Key = value)
```

`provide` is a contextual keyword. Its providers and the block's `{` are on one line, as with `async`. Trailing blocks don't exist ([VIP-11](../vips/0011-trailing-blocks-denied.md)), so `provide(x) { … }` can't be read as a call.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `provide` outside effect code | code pending |

VibeLang adds no typing rules of its own: Effect's `provide` types everything.

### Meaning

`provide providers { … }` is exact sugar for `Effect.provide`. It is a statement that runs where it stands, and every Effect inside it is still run with `try`. A provider is a Layer, or `Key = value`, which means `Layer.succeed(Key, value)`.

```vibe es
// compiler-gap: pending VIP-12
effect function test() {
  provide AppLive, Users = testUsers {
    try a()
    try b()
  }
}
```

```ts effect
// fragment
function test() {
  return Effect.gen(function* () {
    yield* Effect.provide(
      Effect.gen(function* () { yield* a(); yield* b() }),
      [AppLive, Layer.succeed(Users, testUsers)]
    )
  })
}
```

The keyword removes the global of the same name, so Effect's function is written `Effect.provide`.

Layers are composed with Effect's own Layer API; there is no `wire` ([VIP-24](../vips/0024-wire-denied.md), denied):

```vibe es
// compiler-gap: pending VIP-12
const AppLive = UsersLive.pipe(Layer.provide(DbLive), Layer.provideMerge(ConfigLive))
```

A `provide` block is an ordinary block: `return`, `break` and `continue` inside it reach the enclosing function or loop, as in any TypeScript block. [Leaving a block](002-running.md#leaving-a-block) gives the Effect TypeScript.

## Effect's functions are globals

Every export of Effect's `Effect` module is a global variable in a `.vibe` file: `retry`, `sleep`, `log`, `all`, `race`, `tryPromise`, `sync`, `callback`, `map`, `scoped`, `ensuring`, `runPromise`, and so on. A local declaration or import shadows one, as with any global.

A name that clashes is not a global, and is written `Effect.x` instead. A name clashes if it is:

- a reserved word: `try`, `catch`, `void`, `let`;
- a JavaScript global: `undefined`;
- a VibeLang keyword. In effect 4.0.6 these are `match`, `when`, `service`, `provide`, `uninterruptible` and `interruptible`, so `Effect.match` keeps its prefix.

When a later VIP adds a keyword with the name of an Effect export, that global is removed.

No language feature wraps TypeScript into an Effect. Effect's own functions do (`tryPromise`, `sync`, `callback`, `Effect.try`), and their arrows capture locals as in Effect TypeScript.

```vibe es
// compiler-gap: pending VIP-6
effect function lookup(q: string, s: string) {
  const r = try tryPromise((signal) => queryDb(q, { signal }))   // queryDb is from a .ts module
  const n = try sync(() => Date.now())
  try sleep("1 second")
  const d = try Effect.try(() => JSON.parse(s))
  return [r, n, d]
}
```

```ts effect
// fragment
function lookup(q: string, s: string) {
  return Effect.gen(function* () {
    const r = yield* Effect.tryPromise((signal) => queryDb(q, { signal }))
    const n = yield* Effect.sync(() => Date.now())
    yield* Effect.sleep("1 second")
    const d = yield* Effect.try(() => JSON.parse(s))
    return [r, n, d]
  })
}
```

An option in the config's `"vibe"` section turns the globals off ([Configuration](007-tooling.md#config-files)).

## Effect's modules are in scope

Every root export of the core `effect` package (149 in effect 4.0.6, such as `Schema`, `Layer`, `Stream`, `Option`, `Data`, `Context`, `Schedule`, `Duration`) is in scope in a `.vibe` file without an import. Emitted code imports each module it uses from `effect/<Module>`. An option in the config's `"vibe"` section turns this off.

**Precedence.** JavaScript globals that aren't platform-specific, and TypeScript's own global types, keep their meaning. Effect's module of the same name is then written `Effect.X`, or imported.

| Name | Bare name means | Effect's module |
| --- | --- | --- |
| `Array`, `String`, `Number`, `Boolean`, `BigInt`, `Symbol`, `Function`, `RegExp` | JavaScript's | `Effect.Array`, `Effect.String`, … |
| `Record`, `Iterable` | TypeScript's types | `Effect.Record`, `Effect.Iterable` |
| `Request`, `Crypto`, `Option`, `Cache`, `FileSystem`, `Scheduler`, `Console` (platform-specific) | Effect's module | the bare name |

```vibe es
// compiler-gap: pending VIP-14
const Port = Schema.Number
const first = Effect.Array.head([1, 2])        // JavaScript's Array keeps the bare name
const o = Option.some(1)                       // Effect's Option: the DOM's Option is platform-specific
```

```ts effect
// fragment
import * as Schema from "effect/Schema"
import * as Array$ from "effect/Array"
import * as Option from "effect/Option"
const Port = Schema.Number
const first = Array$.head([1, 2])
const o = Option.some(1)
```

`Effect.M`, where `M` is a module in the table's first two rows, is that module: the emitted code imports it under a fresh name, as `Array$` above. Every other `Effect.x` is the export `x` of `effect/Effect`.

## The platform standard library

1. **Platform access is only through injected Effect services** (`FileSystem`, `Path`, `ChildProcess`, `HttpClient`, …), each provided by a per-platform layer. A `.vibe` file has no `node:*` value imports, no Node globals (`process`, `Buffer`) and no platform calls such as `fetch`, anywhere: in plain and `async` functions, and inside `Effect.try` and `tryPromise` arrows too (VIP-33, amended). A wrapper changes how a failure is represented, not whether the platform may be called. Code that needs the platform lives in a `.ts` file, which is the escape ([VIP-25](../vips/0025-inline-modules-denied.md) removed inline modules).
2. **What Effect lacks goes under `Experimental.X`,** named after the Effect module it extends, and is written so it can be proposed upstream. Nothing that Effect already provides is reimplemented.
3. **Subpath namespaces are in scope** (`HttpClient`, `FileSystem`, `Path`, `ChildProcess`, … from Effect's subpath packages), with the precedence above.

```vibe es
// compiler-gap: pending VIP-33
effect function readConfig(path: string) {
  const fs = try FileSystem.FileSystem               // the module FileSystem exports the service key FileSystem
  return try fs.readFileString(path)
}
effect function main() {
  provide NodeServices.layer { try readConfig("app.json") }
}
effect function page(url: string) {
  return try tryPromise(() => fetch(url))            // error: a platform call, even inside tryPromise
}
```

```ts effect
// fragment
import * as FileSystem from "effect/FileSystem"
function readConfig(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(path)
  })
}
```

A module is a namespace, not a service key. `try FileSystem` runs the namespace, which is not an Effect, so it is the error for `try` on a value that is not an Effect; in effect 4.1.0, `yield*` of the namespace is a defect. There is no `Path.join(…)` shorthand for a service member; write `(try Path.Path).join(…)`. The entry point provides nothing automatically ([Functions](001-functions.md#modules-and-the-top-level)).

| Rule | Diagnostic |
| --- | --- |
| a `node:*` value import in a `.vibe` file | EK4402 |
| a Node global (`process`, `Buffer`) in a `.vibe` file | EK4402 |
| a platform call such as `fetch` anywhere in a `.vibe` file, including inside `Effect.try` and `tryPromise` arrows. The quick fix and the codemod move the call into a sibling `.ts` module, or point to the Effect service (`HttpClient` for `fetch`) | EK4402 |

**Undecided (pending VIP):** whether a bare module name at a `try` site, `try FileSystem`, means the module's service key, as VIP-33's first example wrote it; the full list of Node globals and web platform globals the rule covers; and whether `import type` from `node:*` is allowed.
