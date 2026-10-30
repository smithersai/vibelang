# Services and the environment

Sources: [VIP-9](../vips/0009-service-declarations.md), [VIP-12](../vips/0012-provide.md), [VIP-6](../vips/0006-effect-globals.md), [VIP-14](../vips/0014-effect-modules-in-scope.md), [VIP-33](../vips/0033-platform-stdlib.md).

## `service` declarations

### Syntax

[ServiceDeclaration](900-appendices.md#servicedeclaration), whose members are TypeScript [Member](900-appendices.md#member) signatures, a [KeyMember](900-appendices.md#keymember) and a [DefaultMember](900-appendices.md#defaultmember). The parse is wider than the language: it accepts type parameters and any TypeScript class member, so that the static rules below reject them with their codes. Each member has one parse: a member that parses as a [KeyMember](900-appendices.md#keymember), a [DefaultMember](900-appendices.md#defaultmember), a `PropertySignature` or a `MethodSignature` is that member; any other member is a rejected `ClassElement` or TypeScript type member. Members are separated as in an `interface`: `a: number, b: string` and `a: number; b: string` are two property signatures, and `a: number b: string` on one line is a syntax error. A member with a body ends at its `}`, as in a class, so `m() { } n(): void` on one line is two members and gets the body rule below. A member's type is parsed greedily, as in TypeScript, so a line break ends a member only after its type is complete. The optional `R` after `!!` starts on the same line and never with `{` (write `A!!({ … })`), so `now(): number!!` ends its member at the line break:

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

`service Name { members }` is the only way to declare a service. `export default service S { }` is `EK0905`; write `export { S as default }`. An `abstract class` is not a service. Members are written out with their types, because they have no bodies to infer from. A member may have any type, Effect or not, as `Context.Service` allows. For throw tracking a member is an interface member (decided detail 3): a non-Effect member with no `@throws` is non-throwing, and `/** @throws {E} */` opts in; an Effect-typed member cannot throw.

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

- **The key** is Effect's run-time identity for the service. It is derived from the package, the file and the name: the `name` in the package's `package.json`, `/`, the file's package-relative path without its extension, `#`, the service name. The package is the file's Node package scope, the nearest ancestor directory with a `package.json`; if that file has no string `name`, the service has no derived key (`EK0903` below). The path's segments are joined with `/` on every OS, as in an import specifier, and only the final extension is removed: `src\users.vibe` on Windows gives `src/users`. A service can write it explicitly instead, as a migrated service does to keep its key:

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

- **Two types,** as in Effect. `Users` is the identifier, the type that appears in R. `Users.Shape` is the members, the type an implementation has; Effect writes it `Context.Service.Shape<typeof Users>`, and the compiler declares `Users.Shape` as the namespace above. A `Context.Reference` is a value, not a class, and never appears in R, so a service with a `defaultValue` has `Flags.Shape` and no identifier type. `EK3001` to `EK3004` apply to it unchanged: `when Flags:` is `EK3004`, as for any `service`. `EK0702` covers only a reference built with `Context.Reference(…)` directly ([chapter 004](004-match.md)). A member's throw contract is an interface member's: without `@throws` it admits only `never` ([Assignability](003-failures.md#assignability); decided detail 3).
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
| `impl instanceof Users`, and a class pattern `when Users:` or `when Users(…):` | `EK3004` | always false, because implementations are plain objects |
| `service Repo<T> { … }` | `EK3005` | `Repo<User>` and `Repo<Order>` would share one key |
| `static key = "a"` without `readonly`, or a `key` whose initializer is not a string literal (`static readonly key = prefix + "S"`, `` static readonly key = `S` ``). A type annotation is allowed, as in TypeScript: `static readonly key: string = "S"` | `EK0901` | `EK3001` needs every key at compile time |
| any member that is not a `PropertySignature`, a `MethodSignature`, a [KeyMember](900-appendices.md#keymember) or a [DefaultMember](900-appendices.md#defaultmember): a body, an initializer, a modifier (`private`, `protected`, `#x`, `declare`, `accessor`, `override`), a `get` or `set` accessor, a `constructor`, an index signature, a call signature `(x: number): string`, a construct signature `new (): X`, or another `static`. A bodyless `effect find(id: string): User!NotFound` or `async find(): Promise<User>` is `EK0902`; the quick fix removes the modifier: `find(id: string): User!NotFound` | `EK0902` | as in a TypeScript `interface`, members declare a shape and implement nothing |
| `service S extends Base { }`, `service S implements I { }` | `EK0904` | a service's identity is its key; compose shapes with types (`find: Base.Shape["find"]`) |
| `export default service S { }` | `EK0905` | `export default` takes a function, class or expression, as in ECMAScript; write `export { S as default }` |

```vibe es
// compiler-gap: pending VIP-9
class FakeUsers extends Users { }        // EK3002
const u = new Users()                    // EK3003
if (impl instanceof Users) { }           // EK3004
match (impl) { when Users: 1; }          // EK3004: always false
service Admins extends Users { }         // EK0904
```

A service in a file outside any package (or in one whose `package.json` has no string `name`), or declared inside a function or block, has no derived key: omitting `static readonly key` there is a compile error (`EK0903`) with a quick fix that inserts one.

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

`provide` is a contextual keyword, and its providers and block are on one line, as with `async` (VIP-12): [ProvideStatement](900-appendices.md#providestatement) puts `[no LineTerminator here]` after `provide`, on both sides of each comma and before the block's `{`. `provide` is a keyword only when the tokens from `provide` through that `{` parse as the head of a [ProvideStatement](900-appendices.md#providestatement) (everything before its Block's `StatementList`), as an arrow needs its whole head; otherwise it is an identifier, in any code. When both readings parse, the provide statement wins, as an arrow head does: `provide / a / { }` provides the regex `/a/`, not TypeScript's `(provide / a) / {}`. Inside a provider, line breaks are free, as in any expression:

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

`provide AppLive,` with `Users = testUsers {` on the next line is a syntax error (`EK1202`): the break follows a comma.

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
| `provide L { }` outside effect code. The parser reads it as a `provide` statement to report this, so the statement `provide / a / { }` in `function f(provide: number, a: number) { provide / a / { } }` is `EK1201`, not TypeScript's division: the provide reading wins in any code (decided detail 34). After `return`, a statement cannot start, so `return provide / a / { }` is a division. `provide(x)` without a same-line `{` stays a call | `EK1201` |

VibeLang adds no typing rules of its own: Effect's `provide` types everything.

### Meaning

`provide providers { … }` is exact sugar for `Effect.provide`. It is a statement that runs where it stands, and every Effect inside it is still run with `try`. A provider is a Layer (or, alone, a `Context`), or `Key = value`, which means `Layer.succeed(Key, value)`. One provider lowers to `Effect.provide(gen, p)`; two or more lower to `Effect.provide(gen, [p1, …, pn])`. Effect's overloads then decide what a provider may be: a sole provider may be a `Layer` or a `Context`; in a list each is a `Layer`. Where two providers supply one service, the later wins. As `Effect.provide` documents in effect 4.1.0, a layer an enclosing `provide` already built is reused, and a sibling `provide` builds its own copy. A fiber forked inside the block keeps the block's services after the layer is released, as in `Effect.provide`; use `fork.scoped` inside `scoped(effect { … })` to tie it to a scope.

```vibe es
// compiler-gap: pending VIP-12
effect function test() {
  provide AppLive { try a() }
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
    yield* Effect.provide(Effect.gen(function* () { yield* a() }), AppLive)
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

Every value export of Effect's `Effect` module is a global variable in a `.vibe` file: `retry`, `sleep`, `log`, `all`, `race`, `tryPromise`, `sync`, `callback`, `map`, `scoped`, `ensuring`, `runPromise`, and so on. The non-function value exports are globals too; in effect 4.1.0, after the clash rule below, they are `Do`, `TypeId`, `abortSignal`, `currentParentSpan`, `currentSpan`, `fiber`, `fiberId`, `interrupt`, `never`, `succeedNone`, `tracer`, `txRetry` and `yieldNow`. A local declaration or import shadows one, as with any global, so a local `fiber` or `TypeId` silently replaces Effect's. These Effect functions do not inherit the `@rethrows` contracts of `Array.prototype.map`, `Array.prototype.forEach`, `Array.prototype.filter` or `Array.prototype.reduce`; a throwing callback needs the explicit wrapper required by [Failures](003-failures.md). Type exports are not global types: write `Effect.Effect<A, E, R>`, or `A!E!R`.

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

Every root export of the core `effect` package is in scope in a `.vibe` file without an import. In effect 4.1.0 these are 143 namespaces (`Schema`, `Layer`, `Stream`, `Option`, `Data`, `Context`, `Schedule`, `Duration`, …) and six functions (`pipe`, `flow`, `identity`, `absurd`, `cast`, `hole`). Emitted code imports each namespace from `effect/<Module>` and each function from `effect/Function`, under a fresh name. A local declaration or import shadows one, as with any global. `"vibe": { "effectModules": false }` in the config turns this off.

**Precedence applies per meaning, as in TypeScript.** In a type position, a bare name declared as a type by an ambient global declaration (a TypeScript `lib` file or `@types`) keeps that meaning (including the DOM's `Console`, `FileSystem`, `Headers`, `Response` and `Event`). In a value or namespace position the table below decides. JavaScript globals that aren't platform-specific keep their meaning; Effect's module of the same name is then written `Effect.X`, or imported. Emitted namespace imports use fresh names so they do not shadow those global types.

| Name | Bare name means | Effect's module |
| --- | --- | --- |
| `Array`, `String`, `Number`, `Boolean`, `BigInt`, `Symbol`, `Function`, `RegExp` | JavaScript's | `Effect.Array`, `Effect.String`, … |
| `Record`, `Iterable` | TypeScript's types | `Effect.Record`, `Effect.Iterable` |
| `Request`, `Option`, `Cache`, `FileSystem`, `Scheduler`, `Console` (platform-specific) | Effect's module | the bare name |

```vibe es
// compiler-gap: pending VIP-14
type HostConsole = Console                    // DOM type
const output = Console.log("hi")             // Effect namespace; unrun Effect
```

```ts effect
// fragment
import * as Console$ from "effect/Console"
type HostConsole = Console
const output = Console$.log("hi")
```

`Crypto` is the DOM's: effect 4.1.0 has no root module `Crypto` (VIP-14, amended). Effect's cryptography is the `effect/crypto` namespaces (`Digest`, `Mac`, `SecureRandom`, …), in scope by rule 3 below.

```vibe es
// compiler-gap: pending VIP-14
const Port = Schema.Number
const two = pipe(1, (n: number) => n + 1)     // a root function, from effect/Function
const first = Effect.Array.head([1, 2])        // JavaScript's Array keeps the bare name
const o = Option.some(1)                       // Effect's Option: the DOM's Option is platform-specific
```

```ts effect
// fragment
import * as Schema from "effect/Schema"
import * as Array$ from "effect/Array"
import * as Option from "effect/Option"
import { pipe as pipe$ } from "effect/Function"
const Port = Schema.Number
const two = pipe$(1, (n: number) => n + 1)
const first = Array$.head([1, 2])
const o = Option.some(1)
```

`Effect.M`, where `M` is a module in the table's first two rows, is that module: the emitted code imports it under a fresh name, as `Array$` above. Every other `Effect.x` is the export `x` of `effect/Effect`.

## The platform standard library

1. **Platform access is only through injected Effect services** (`FileSystem`, `Path`, `ChildProcess`, `HttpClient`, …), each provided by a per-platform layer. A `.vibe` file has no `node:*` value imports, no Node globals (`process`, `Buffer`) and no platform calls such as `fetch`, anywhere: in plain and `async` functions, and inside `Effect.try` and `tryPromise` arrows too (VIP-33, amended). A wrapper changes how a failure is represented, not whether the platform may be called. Code that needs the platform lives in a `.ts` file, which is the escape ([VIP-25](../vips/0025-inline-modules-denied.md) removed inline modules).
2. **What Effect lacks goes under `Experimental.X`,** named after the Effect module it extends, and is written so it can be proposed upstream. Nothing that Effect already provides is reimplemented.
3. **Subpath namespaces are in scope:** the namespaces exported by the 22 lowercase subpaths in effect 4.1.0's package `exports`: `effect/ai`, `effect/cli`, `effect/cluster`, `effect/crypto`, `effect/devtools`, `effect/encoding`, `effect/eventlog`, `effect/graphql`, `effect/http`, `effect/http-api`, `effect/net`, `effect/observability`, `effect/persistence`, `effect/process`, `effect/reactivity`, `effect/rpc`, `effect/schema`, `effect/socket`, `effect/sql`, `effect/testing`, `effect/workers` and `effect/workflow` (`HttpClient` comes from `effect/http`, `ChildProcess` from `effect/process`). The capitalized `effect/<Module>` subpaths are the root modules above. These namespaces come in scope with the precedence above, so a subpath namespace whose name is a web platform global names Effect's. In effect 4.1.0 these are `Headers` (`effect/http`), `Response` (`effect/ai`, not an HTTP response), `Event` (`effect/eventlog`) and `Worker` (`effect/workers`). `FileSystem` and `Path` are root modules. Emitted code imports each namespace from its subpath.

   A name that two subpaths export, or a subpath and the root, is not in scope bare: using it is a compile error (`EK1401`) that names every exporter and offers one import per exporter. In effect 4.1.0 this covers `Model` (`effect/ai`, `effect/schema`), `Prompt` (`effect/ai`, `effect/cli`) and `Utils` (`effect`, `effect/rpc`). `Model.make(…)` is that error; `import { Model } from "effect/ai"` fixes it.

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
| in a `.vibe` file, an `import` or `export … from` declaration, or an `import(…)` call with a string-literal specifier, whose specifier names a Node builtin with or without `node:` (`node:fs`, `fs`, `child_process`: Node's `module.builtinModules`), except an `import type` or `export type … from` declaration | `EK4402` |
| a statically named value that reaches the platform (rule below) anywhere in a `.vibe` file, including inside `Effect.try` and `tryPromise` arrows. The quick fix and the codemod move the code into a sibling `.ts` module, or point to the Effect service (`HttpClient` for `fetch`) | `EK4402` |

<a id="reaches-the-platform"></a>`EK4402` asks one question of a statically named value: does the symbol it resolves to reach the platform, by doing I/O, starting a timer, or reading or changing host state? Statically named means an identifier, `.name`, `?.name`, `["name"]`, a template with no substitutions, or a destructured property with such a key, and an alias keeps the symbol it copies. Two kinds of symbol reach the platform:

- a global binding declared only by a host library and not on the allowlist (below);
- a member of an allowlisted global that reaches the host: `AbortSignal.timeout`, `URL.createObjectURL` and `URL.revokeObjectURL`.

So a statically named member of the standard `globalThis` whose name is banned is `EK4402`, including `globalThis.fetch`, `globalThis["fetch"]`, `globalThis.process` and `globalThis["setTimeout"]`. A property on an unrelated object, such as `client.fetch` or `client.timeout`, is a different symbol. `window.fetch` is already rejected because `window` itself is banned. Only value positions are `EK4402`: a type query such as `type Timer = ReturnType<typeof setTimeout>` is erased and allowed, as `import type` is. A key that is not statically known stays unchecked; this is not a sandbox.

```vibe es
// compiler-gap: pending VIP-33
globalThis.fetch(url)                         // EK4402: use HttpClient
globalThis["setTimeout"](f, 10)               // EK4402: use sleep
AbortSignal.timeout(100)                      // EK4402: it starts a timer; use Effect.timeout
AbortSignal["timeout"](100)                   // EK4402: the same symbol
const { timeout } = AbortSignal               // EK4402: the same symbol
const Signals = AbortSignal
Signals.timeout(100)                          // EK4402: an alias keeps the symbol
URL.createObjectURL(blob)                     // EK4402: it stores the Blob in the host
AbortSignal.any([a, b])                       // ok: pure
AbortSignal[key]                              // unchecked: not statically named
new URL(s).searchParams.get("q")              // ok: pure
client.timeout(100)                           // ok: a different symbol
```

`globalThis` may appear only as the object of a statically named member access; any other use, such as a computed key (`globalThis[k]`), an alias (`const g = globalThis`) or destructuring (`const { fetch } = globalThis`), is `EK0107` ([Legacy JavaScript](001-functions.md#direct-eval); decided detail 73). A computed specifier (`import(name)`, `import("node:" + m)`) compiles unchecked; a `data:` or `blob:` specifier is `EK0107` (decided detail 74).

`import type { Stats } from "node:fs"` is allowed because it is erased. `import { type Stats } from "node:fs"` is `EK4402`, because `verbatimModuleSyntax` keeps it as `import {} from "node:fs"`; the quick fix rewrites it to `import type`.

The banned globals ("All web apis and all node.js apis should be wrapped and effectful", VIP-33) are derived by resolved binding, not listed (VIP-33, amended). A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below. A local binding, an import or an Effect module in scope (`Option`, `FileSystem`, `Headers`, `Worker`) shadows the global first, and a project's own `declare var fetch` is not a host declaration. A name that resolves to nothing is TypeScript's `TS2304`: with a `lib` that omits `dom`, `fetch` is `TS2304`, not `EK4402`. The compiler reads the declarations themselves. [`platform-globals.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/platform-globals.json) records the result for the pinned TypeScript libs and `@types/node`: the banned globals, the allowlist, and every member of an allowlisted global, classified. `node docs/tools/platform-globals.mjs --write` generates it, and a test fails when the file is stale, when a member is unclassified, or when this page and the file disagree. The banned set includes these names, which keep their quick fixes:

- Node: `process`, `Buffer`, `global`, `__dirname`, `__filename`, `require`, `module`, `exports`, `setImmediate`, `clearImmediate`;
- web I/O and host state: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `navigator`, `location`, `document`, `window`, `self`, `Worker`, `SharedWorker`, `BroadcastChannel`, `postMessage`, `alert`, `confirm`, `prompt`, `crypto`, `performance`;
- console and timers: `console`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask`.

It also includes every other host global, such as `history`, `requestAnimationFrame`, `FileReader`, `WebAssembly`, and window properties such as `name`, `status` and `open`, so a stray `name` that would read `window.name` is an error.

```vibe es
// compiler-gap: pending VIP-33
history.pushState({}, "", "/x")       // EK4402: move to a .ts file or wrap it in a service
requestAnimationFrame(draw)           // EK4402
const r = new FileReader()            // EK4402: use FileSystem
signal instanceof AbortSignal         // ok: allowlisted
const name = "Ada"; name.length       // ok: the local shadows window.name
```

```ts effect
// fragment
const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString("data.txt")                // instead of FileReader
  yield* Effect.sleep("16 millis")                                 // instead of a timer
  return yield* Effect.tryPromise((signal) => fetchThing(signal))  // the AbortSignal Effect passes
})
```

`import.meta` may appear only as the object of `.url` (decided detail 90). Every other member (`dirname`, `filename`, `env`, `main`, `resolve`, host additions such as Vite's `hot`) and every other use of `import.meta` (an alias, destructuring, a computed key, an argument, a spread) is `EK4402`. A type position (`typeof import.meta`) is TypeScript's.

```vibe es
// compiler-gap: pending VIP-33
const u = new URL("./data.json", import.meta.url)   // ok: module identity (ECMA-262)
const d = import.meta.dirname                        // EK4402: use Path.fromFileUrl
const k = import.meta.env.API_KEY                    // EK4402: use Config.String("API_KEY")
const m = import.meta                                // EK4402: alias
```

```ts effect
// fragment
const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const d = path.dirname(yield* path.fromFileUrl(new URL(import.meta.url)))
  const k = yield* Config.String("API_KEY")
})
```

Bare `Worker` is Effect's `effect/workers` namespace, by the precedence above, as `Headers`, `Response` and `Event` are (decided detail 76). The ban on `Worker` covers the host binding only: `globalThis.Worker`, `globalThis["Worker"]` and `self.Worker` are `EK4402`. A local or imported `Worker` shadows as usual, and `new Worker(url)` on the namespace gets TypeScript's own "not constructable" error. An explicit import names the same namespace:

```vibe es
// compiler-gap: pending VIP-33
import { Worker as EffectWorker } from "effect/workers"
const workerSpawner = EffectWorker.Spawner
```

```ts effect
import { Worker as EffectWorker } from "effect/workers"
const workerSpawner = EffectWorker.Spawner
```

ECMA-262 globals (`Date.now`, `Math.random`, `JSON`) and web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`, `AbortSignal`, `Intl`) stay allowed, apart from the [three members](#reaches-the-platform) that reach the host. This allowlist is closed: a name can be added later, never removed.

```vibe es
// compiler-gap: pending VIP-33
console.log("hi")            // EK4402: write try Console.log("hi")
setTimeout(f, 10)            // EK4402: write try sleep("10 millis"), then f()
const u = new URL(s)         // ok
```

```vibe es
// compiler-gap: pending VIP-33
import { readFileSync } from "fs"         // EK4402: same builtin as node:fs
import "node:fs/promises"                 // EK4402: loads the module
export { statSync } from "node:fs"        // EK4402
const cp = import("node:child_process")   // EK4402
import type { Stats } from "node:fs"      // ok: erased
const m = import(name)                    // ok: a computed specifier is not checked (decided detail 74)
```

```ts effect
// fragment
yield* Console.log("hi")
yield* Effect.sleep("10 millis")
```
