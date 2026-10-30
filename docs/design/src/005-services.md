# Services and the environment

Sources: [VIP-9](../vips/0009-service-declarations.md), [VIP-12](../vips/0012-provide.md), [VIP-6](../vips/0006-effect-globals.md), [VIP-14](../vips/0014-effect-modules-in-scope.md), [VIP-33](../vips/0033-platform-stdlib.md).

## `service` declarations

### Syntax

[ServiceDeclaration](900-appendices.md#servicedeclaration), whose members are TypeScript [Member](900-appendices.md#member) signatures, a [KeyMember](900-appendices.md#keymember) and a [DefaultMember](900-appendices.md#defaultmember). The parse is wider than the language: it accepts type parameters and any TypeScript class member, so that the static rules below reject them with their codes. Each member has one parse: a member that parses as a `KeyMember`, a `DefaultMember`, a `PropertySignature` or a `MethodSignature` is that member; any other member is a rejected `ClassElement` or TypeScript type member. Members are separated as in an `interface`: `a: number, b: string` and `a: number; b: string` are two property signatures, and `a: number b: string` on one line is a syntax error. A member with a body ends at its `}`, as in a class, so `m() { } n(): void` on one line is two members and gets the body rule below. A member's type is parsed greedily, as in TypeScript, so a line break ends a member only after its type is complete. The optional `R` after `!!` starts on the same line and never with `{` (write `A!!({ … })`), so `now(): number!!` ends its member at the line break:

```vibe es
// compiler-gap: pending VIP-9
service Auth {
  role:
    | "admin"
    | "member"
  check(token: string): boolean!never
  now(): number!!
  later(): number!!
}
```

`service` is a declaration keyword under the one rule of [Declaration keywords](900-appendices.md#declaration-keywords), as `type` is in TypeScript: `service` and the name on one line begin a service; the body's `{` may follow line breaks, as a class body's may.

`service Name { members }` is the only way to declare a service. `export default service S { }` is a syntax error, because `export default` takes only a function, class or expression, as in ECMAScript. Write `export { S as default }`. An `abstract class` is not a service. Members are written out with their types, because they have no bodies to infer from. A member may have any type, Effect or not, as `Context.Service` allows.

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
  find(id: string): Effect.Effect<User, NotFound>
}>()("@acme/app/src/users#Users") {}
declare namespace Users { type Shape = Context.Service.Shape<typeof Users> }
```

- **The key** is Effect's run-time identity for the service. It is derived from the package, the file and the name: the `name` in the package's `package.json`, `/`, the file's package-relative path without its extension, `#`, the service name. A service can write it explicitly instead, as a migrated service does to keep its key:

  ```vibe es
  // compiler-gap: pending VIP-9
  service Clock {
    static readonly key = "app/Clock"
    now(): number!never
  }
  ```

  ```ts effect
  // fragment
  class Clock extends Context.Service<Clock, { now(): Effect.Effect<number> }>()("app/Clock") {}
  declare namespace Clock { type Shape = Context.Service.Shape<typeof Clock> }
  ```
- **A default.** `static readonly defaultValue`, of the type of `Context.Reference`'s `defaultValue` (`() => Shape`), makes the service a `Context.Reference`. Nothing has to provide it, and providing it overrides the default. It may carry a type annotation, as `key` may: `static readonly defaultValue: () => Flags.Shape = …`.

  ```vibe es
  // compiler-gap: pending VIP-9
  service Flags {
    static readonly defaultValue = () => ({ newCheckout: false })
    newCheckout: boolean
  }
  ```

  ```ts effect
  // fragment
  const Flags = Context.Reference<Flags.Shape>("@acme/app/src/flags#Flags", { defaultValue: () => ({ newCheckout: false }) })
  declare namespace Flags { type Shape = { newCheckout: boolean } }
  ```

- **Two types,** as in Effect. `Users` is the identifier, the type that appears in R. `Users.Shape` is the members, the type an implementation has; Effect writes it `Context.Service.Shape<typeof Users>`, and the compiler declares `Users.Shape` as the namespace above. A `Context.Reference` is a value, not a class, and never appears in R, so a service with a `defaultValue` has `Flags.Shape` and no identifier type. `EK3001` to `EK3004` apply to it unchanged.
- **Inside a function or block** the counterpart is the class (or `const`) alone, because TypeScript allows a `namespace` only at the top level of a module or namespace (TS1235). There `Users.Shape` is not declared; write `Context.Service.Shape<typeof Users>`:

  ```vibe es
  // compiler-gap: pending VIP-9
  effect function test() {
    service Users { static readonly key = "test/Users"; find(id: string): User!NotFound }
    const fake: Context.Service.Shape<typeof Users> = { find: (id) => succeed(user) }
  }
  ```

  ```ts effect
  // fragment
  function test() {
    return Effect.gen(function* () {
      class Users extends Context.Service<Users, {
        find(id: string): Effect.Effect<User, NotFound>
      }>()("test/Users") {}
      const fake: Context.Service.Shape<typeof Users> = { find: (id) => Effect.succeed(user) }
    })
  }
  ```

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

A member gets one diagnostic: the first row below that names it. The last row applies only when no other row applies.

| Rule | Code | Why |
| --- | --- | --- |
| two services with the same key anywhere in the program | `EK3001` | |
| `class X extends Users {}` | `EK3002` | `X` would inherit `Users`' key and silently become the same service |
| `new Users()` | `EK3003` | |
| `impl instanceof Users` | `EK3004` | always false, because implementations are plain objects |
| `service Repo<T> { … }` | `EK3005` | `Repo<User>` and `Repo<Order>` would share one key |
| `static key = "a"` without `readonly`, or a `key` whose initializer is not a string literal (`static readonly key = prefix + "S"`, `` static readonly key = `S` ``). A type annotation is allowed, as in TypeScript: `static readonly key: string = "S"` | `EK0901` | `EK3001` needs every key at compile time |
| any member that is not a `PropertySignature`, a `MethodSignature`, a `KeyMember` or a `DefaultMember`: a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`), a `get` or `set` accessor, a `constructor`, an index signature, a call signature `(x: number): string`, a construct signature `new (): X`, or another `static` | `EK0902` | as in a TypeScript `interface`, members declare a shape and implement nothing |

A service in a file outside any package, or declared inside a function or block, has no derived key: omitting `static readonly key` there is a compile error (`EK0903`) with a quick fix that inserts one.

```vibe es
// compiler-gap: pending VIP-9
// /repo/tools/x.vibe, no package.json
service Users { }                                      // error: write static readonly key
service Users { static readonly key = "tools/Users" }  // ok
```

```ts effect
// fragment
class Users extends Context.Service<Users, {}>()("tools/Users") {}
```

## `provide` blocks

### Syntax

[ProvideStatement](900-appendices.md#providestatement), a list of [Provider](900-appendices.md#provider)s. A top-level comma separates providers. A top-level `=` whose left side is a `LeftHandSideExpression` makes `Key = value`; any other `=` belongs to the expression, so `provide flag ? A : B = x { }` provides `flag ? A : (B = x)`. Parentheses make anything else a Layer expression: `provide (a, b) { }` provides the comma expression's value. The parse never depends on types. Providers are evaluated once, left to right, when the statement runs.

`provide` is a contextual keyword, and its providers and block are on one line, as with `async` (VIP-12): [ProvideStatement](900-appendices.md#providestatement) puts `[no LineTerminator here]` after `provide`, on both sides of each comma and before the block's `{`. `provide` is a keyword only when the tokens from `provide` through that `{` parse as the head of a `ProvideStatement` (everything before its Block's `StatementList`), as an arrow needs its whole head; otherwise it is an identifier, in any code. When both readings parse, the provide statement wins, as an arrow head does: `provide / a / { }` provides the regex `/a/`, not TypeScript's `(provide / a) / {}`. Inside a provider, line breaks are free, as in any expression:

```vibe es
// compiler-gap: pending VIP-12
effect function test() {
  provide AppLive, Users = {
    find: (id: string) => fetchUser(id) } {
    try a()
  }
  provide Layer.mergeAll(
    UsersLive,
    DbLive) {
    try a()
  }
}
```

`provide AppLive,` with `Users = testUsers {` on the next line is a syntax error: the break follows a comma.

```vibe es
// compiler-gap: pending VIP-12
effect function local() {
  const provide = makeProvider()   // a local named provide
  provide(x)                       // a call: no same-line {
  provide[0] = 1                   // an element assignment
  provide - 1                      // a subtraction
}
```

Trailing blocks don't exist ([VIP-11](../vips/0011-trailing-blocks-denied.md)), so `provide(x) { … }` can't be read as a call.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `provide L { }` outside effect code. The parser reads it as a `provide` statement to report this. In any code, `provide(x)` without a same-line `{` stays a call | `EK1201` |

VibeLang adds no typing rules of its own: Effect's `provide` types everything.

### Meaning

`provide providers { … }` is exact sugar for `Effect.provide`. It is a statement that runs where it stands, and every Effect inside it is still run with `try`. A provider is a Layer, or `Key = value`, which means `Layer.succeed(Key, value)`. As `Effect.provide` documents in effect 4.1.0, a layer an enclosing `provide` already built is reused, and a sibling `provide` builds its own copy.

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

A `provide` block is an ordinary block, as in TypeScript: its `return`, `break`, `continue` and declarations mean what they mean in any block, and the lowering keeps them with [region bodies](002-running.md#region-bodies). In a producer, `yield x` inside it is the producer's `yield` ([Producers](002-running.md#producers)).

## Effect's functions are globals

Every value export of Effect's `Effect` module is a global variable in a `.vibe` file: `retry`, `sleep`, `log`, `all`, `race`, `tryPromise`, `sync`, `callback`, `map`, `scoped`, `ensuring`, `runPromise`, and so on. A local declaration or import shadows one, as with any global. Type exports are not global types: write `Effect.Effect<A, E, R>`, or `A!E!R`.

A name that clashes is not a global, and is written `Effect.x` instead. A name clashes if it is:

- a reserved word: `try`, `catch`, `void`, `let`;
- a JavaScript global: `undefined`;
- a VibeLang keyword. In effect 4.1.0 these are `match`, `when`, `service`, `provide`, `uninterruptible` and `interruptible`, so `Effect.match` keeps its prefix.

When a later VIP adds a keyword with the name of an Effect export, that global is removed.

No language feature wraps TypeScript into an Effect. Effect's own functions do (`tryPromise`, `sync`, `callback`, `Effect.try`), and their arrows capture locals as in Effect TypeScript.

```vibe es
// compiler-gap: pending VIP-6
effect function lookup(q: string, s: string) {
  const r = try tryPromise((signal) => queryDb(q, { signal }))   // queryDb is from a .ts module
  const n = try sync(() => Date.now())                  // Date.now throws never (Appendix E)
  try sleep("1 second")
  const d = try Effect.try(() => JSON.parse(s))     // allowed: Effect.try turns the throw into a failure
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

`"vibe": { "effectGlobals": false }` in the config turns the globals off ([Configuration](007-tooling.md#config-files)).

## Effect's modules are in scope

Every root export of the core `effect` package (149 in effect 4.1.0, such as `Schema`, `Layer`, `Stream`, `Option`, `Data`, `Context`, `Schedule`, `Duration`) is in scope in a `.vibe` file without an import. Emitted code imports each module it uses from `effect/<Module>`. `"vibe": { "effectModules": false }` in the config turns this off.

**Precedence.** JavaScript globals that aren't platform-specific, and TypeScript's own global types, keep their meaning. Effect's module of the same name is then written `Effect.X`, or imported.

| Name | Bare name means | Effect's module |
| --- | --- | --- |
| `Array`, `String`, `Number`, `Boolean`, `BigInt`, `Symbol`, `Function`, `RegExp` | JavaScript's | `Effect.Array`, `Effect.String`, … |
| `Record`, `Iterable` | TypeScript's types | `Effect.Record`, `Effect.Iterable` |
| `Request`, `Option`, `Cache`, `FileSystem`, `Scheduler`, `Console` (platform-specific) | Effect's module | the bare name |

`Crypto` is the DOM's: effect 4.1.0 has no root module `Crypto` (VIP-14, amended). Import `effect/crypto` to use Effect's.

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
3. **Subpath namespaces are in scope:** the namespaces exported by the 22 lowercase subpaths in effect 4.1.0's package `exports`: `effect/ai`, `effect/cli`, `effect/cluster`, `effect/crypto`, `effect/devtools`, `effect/encoding`, `effect/eventlog`, `effect/graphql`, `effect/http`, `effect/http-api`, `effect/net`, `effect/observability`, `effect/persistence`, `effect/process`, `effect/reactivity`, `effect/rpc`, `effect/schema`, `effect/socket`, `effect/sql`, `effect/testing`, `effect/workers` and `effect/workflow` (`HttpClient` comes from `effect/http`, `ChildProcess` from `effect/process`). The capitalized `effect/<Module>` subpaths are the root modules above. These namespaces come in scope with the precedence above, so a subpath namespace whose name is a web platform global names Effect's. In effect 4.1.0 these are `Headers`, `Response`, `Event` and `Worker`. `FileSystem` and `Path` are root modules. Emitted code imports each namespace from its subpath.

   A name that two subpaths export, or a subpath and the root, is not in scope bare: using it is a compile error (`EK1401`) that names every exporter and offers one import per exporter. In effect 4.1.0 this covers `Model` (`effect/ai`, `effect/schema`), `Prompt` (`effect/ai`, `effect/cli`) and `Utils`. `Model.make(…)` is that error; `import { Model } from "effect/ai"` fixes it.

```vibe es
// compiler-gap: pending VIP-33
effect function readConfig(path: string) {
  const fs = try FileSystem.FileSystem               // the module FileSystem exports the service key FileSystem
  return try fs.readFileString(path)
}
import { NodeServices } from "@effect/platform-node"   // a platform package: imported, not in scope
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

A module is a namespace, not a service key (VIP-33, corrected). `try FileSystem` runs the namespace, which is not an Effect, so it is the error for `try` on a value that is not an Effect, as `yield* FileSystem` is wrong in Effect TypeScript. There is no `Path.join(…)` shorthand for a service member; write `(try Path.Path).join(…)`. The entry point provides nothing automatically ([Functions](001-functions.md#modules-and-the-top-level)).

| Rule | Diagnostic |
| --- | --- |
| a value import whose specifier is a Node builtin, with or without `node:` (`node:fs`, `fs`, `child_process`: Node's `module.builtinModules`), in a `.vibe` file | `EK4402` |
| a reference to a banned global (list below) anywhere in a `.vibe` file, including inside `Effect.try` and `tryPromise` arrows. The quick fix and the codemod move the code into a sibling `.ts` module, or point to the Effect service (`HttpClient` for `fetch`) | `EK4402` |

`import type` from a Node builtin is allowed: VIP-33 bans value imports, and a type import is erased.

The banned globals ("All web apis and all node.js apis should be wrapped and effectful", VIP-33):

- Node: `process`, `Buffer`, `global`, `__dirname`, `__filename`, `require`, `module`, `exports`, `setImmediate`, `clearImmediate`;
- web I/O and host state: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `navigator`, `location`, `document`, `window`, `self`, `Worker`, `SharedWorker`, `BroadcastChannel`, `postMessage`, `alert`, `confirm`, `prompt`, `crypto`, `performance`;
- console and timers: `console`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask`.

**Undecided (pending VIP):** bare `Worker`, which the precedence above makes Effect's `effect/workers` namespace and this list bans as a web global. Either bare `Worker` is Effect's namespace and only `globalThis.Worker` is banned, as for `Headers`, `Response` and `Event`, or bare `Worker` is `EK4402`.

ECMA-262 globals (`Date.now`, `Math.random`, `JSON`) and web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`, `Intl`) stay allowed.

```vibe es
// compiler-gap: pending VIP-33
console.log("hi")            // EK4402: write try Console.log("hi")
setTimeout(f, 10)            // EK4402: write try sleep("10 millis"), then f()
const u = new URL(s)         // ok
```

```vibe es
// compiler-gap: pending VIP-33
import { readFileSync } from "fs"         // EK4402: same builtin as node:fs
import type { Stats } from "node:fs"      // ok: erased
```

```ts effect
// fragment
yield* Console.log("hi")
yield* Effect.sleep("10 millis")
```
