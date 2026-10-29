### 11. The standard library

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

```ts es
import { readFile } from "node:fs/promises"

function loadSettings(path: string) {
  return JSON.parse(readFile(path, "utf8"))
}
```

```text
error EK4402: readFile from node:fs/promises is platform code, which a .vibe file does not import as a value.
  settings.vibe:1:10   import { readFile } from "node:fs/promises"
  Use the FileSystem service:   FileSystem.readFileString(path)
  Provide it in main with NodeServices.layer from "@effect/platform-node", or BunServices.layer from "@effect/platform-bun".
```

VibeLang's standard library is Effect's. Node.js reaches a `.vibe` file only through Effect's services, which layers inject, or by escaping to TypeScript: a hatch, a `module` block, or a `.ts` file (D310). Node's globals (`process`, `Buffer`, `require`, `__dirname`) and the web's globals that do I/O or read the clock or randomness (`fetch`, `setTimeout`, `crypto`, `performance`, `localStorage`) are not in scope there, and a `.vibe` file does not import a Node.js built-in module as a value. Each error names the Effect service that replaces the API, which needs no import, and the layer that provides it. VibeLang adds no Node.js clones: the replacement is the module Effect already ships, implemented by the platform package your program runs with. Where Effect has no service for an API yet, the error names the experimental service VibeLang adds for it (D313), such as `Experimental.Process.hostname()` for `os.hostname()`, or, where neither has one, such as `os.uptime()`, shows the escape; it never suggests a wrapper module. The guide's page on platform globals, https://vibelang.sh/platform/platform-globals, answers every global.

EK4402 stands at each use of a platform global, a value held included, and at each value an import declaration brings in from a platform module; a type-only import stays allowed, and so does an import in a `module` block, whose body is TypeScript: `NodeHttpServer.layer(createServer, { port })` takes a `createServer` that a `module` block imports. ECMAScript's built-ins and the web's pure helpers, such as `URL`, `TextEncoder`, and `structuredClone`, are not platform code. The check does not follow platform functions through local aliases, parameters, or objects returned by platform calls.

Three reasons:

- Platform APIs throw and reject in ways their types do not state, which Chapter 10's boundary rules exist to contain.
- An Effect module states its errors in its types and is a service, so a test replaces it with a Layer.
- Effect already ships these modules, with implementations for Node.js, Bun, and browsers, so cloning Node's API surface would duplicate them.

#### What replaces what

| You would use | In VibeLang | Effect's module, which needs no import (D310) |
| --- | --- | --- |
| `fs`, `fs/promises` | `FileSystem` | `effect/FileSystem` |
| `path` | `Path` | `effect/Path` |
| `fetch`, `http.request`, an HTTP client library | `HttpClient`, `HttpClientRequest`, `HttpClientResponse` | `effect/http` |
| `http.createServer`, an HTTP framework | `HttpRouter`, `HttpServer`; schema-first APIs with `HttpApi` | `effect/http`, `effect/http-api` |
| `child_process` | `ChildProcess`, `ChildProcessSpawner` | `effect/process` |
| `setTimeout`, `setInterval` | `Effect.sleep`; `Effect.repeat` with a `Schedule` | `effect` |
| `process.env` | `Config` | `effect` |
| `console.log` | `Effect.log`, `Console` | `effect` |
| `Date.now()`, `new Date()` | `Clock`, `DateTime` | `effect` |
| `Math.random()` | `Random` | `effect` |
| `crypto.randomUUID()`, `crypto.subtle.digest` | `Crypto` | `effect/Crypto` |
| `net`, `dgram`, `WebSocket` | `Socket`, `SocketServer`, `DatagramSocket` | `effect/socket` |
| `dns` | `Dns` | `effect/net` |
| `worker_threads`, Web Workers | `Worker`, `WorkerRunner` | `effect/workers` |
| `process.argv`, `readline`, `process.stdin` | `Command`, `Flag`, `Argument`; `Terminal`, `Stdio` | `effect/cli`, `effect` |
| `localStorage`, `sessionStorage` | `KeyValueStore` | `effect/persistence` |
| a database driver | `SqlClient`, with a driver package such as `@effect/sql-sqlite-node` | `effect/sql` |
| `EventEmitter`, DOM events | `PubSub`, `Stream.fromEventListener` | `effect` |
| `stream.Readable` | `Stream`; `NodeStream.fromReadable` at the edge | `effect`, `@effect/platform-node` |

The runtime packages supply the implementations and the runner: `@effect/platform-node` (`NodeRuntime`, `NodeServices.layer`), `@effect/platform-bun`, and `@effect/platform-browser`.

A module that exports a service of its own name, such as `FileSystem`, names that service, with no import (D311): `FileSystem.readFileString(path)` calls the service's member, `FileSystem()` is the implementation, and the type `FileSystem` is the service. The key itself is `FileSystem.FileSystem`, and `FileSystem.FileSystem.readFileString(path)` works too. A value member reads from the implementation, as on any key: `Path().sep` is the separator, and `Path.sep` is EK4503, as `Path.Path.sep` is. A member that is itself a program, such as `Terminal`'s `columns`, runs when called: `Terminal.columns()`.

#### Module names and data-type methods

Two conveniences make Effect's modules shorter to use: a module's name stands for its export of the same name, as above (D311), and a value of one of Effect's data types takes its module's data-first functions as methods, `stream.filter(p).take(3)` for `Stream.take(Stream.filter(stream, p), 3)` (D152, Chapter 13). Both are part of the language's API, so they are fixed, not inferred [Rule] (D336, D369):

- **By symbol.** A name has these meanings only where it resolves to an Effect module: through the prelude, through an import under any alias, or through the `Experimental` namespace. A local declaration or import of the same name shadows it completely (Chapter 13, rule H4).
- **Pinned tables.** Which modules stand for an export of their own name (D369), and which module functions are methods of which data types and which parameter receives the value (D336), come from tables generated from the declarations of the pinned `effect` version and shipped with the compiler. The tables are the rule; a parameter's name, such as `self`, and the file that declares a type are only how they are generated. The compiler's test suite regenerates them from the installed declarations and fails when they would change an entry, so an Effect upgrade, which VibeLang follows exactly, changes them only in a VibeLang release, whose notes list each changed entry as a language change.
- **Exports win, fixed per version.** Where a module's export and a member of its same-named service share a name, `M.x` is the module's export: `Console.log` is the module's function, which returns an `Effect`, and `Clock.currentTimeMillis` is the module's program. `M.M.x` reaches the member. The guide lists every such pair for the pinned version.
- **Own members win.** A value's own member wins over a method of the same name from the tables, as an `Effect`'s `pipe` does.

A hover on a method or a module-named member names what it calls.

#### Files

```ts effect
const countLines = Effect.fn("countLines")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(path)
  return text.split("\n").length
})
```

```ts es
function countLines(path: string) {
  return FileSystem.readFileString(path).split("\n").length
}
// number!PlatformError!FileSystem
```

#### Schemas

```ts effect
const Todo = Schema.Struct({
  userId: Schema.Number,
  id: Schema.Number,
  title: Schema.String,
  completed: Schema.Boolean
})
type Todo = typeof Todo.Type
```

```ts es
schema Todo {
  userId: number
  id: number
  title: string
  completed: boolean
}
```

A `schema` declaration declares both: the constant `Todo`, a `Schema.Struct`, and the type `Todo`, `typeof Todo.Type`, its decoded type, as the Effect TypeScript on the left declares them (D133, D501). Each field has a type, and the compiler writes its schema: a primitive, a literal or a union, an array, a tuple, a record, an object type, or the name of another schema, standing for that schema's decoded type. `name?: T` is `Schema.optional`, which accepts an absent key or `undefined`. A field that needs another schema, such as `Schema.DateTimeUtc` or a checked string, names a schema constant: `const Created = Schema.DateTimeUtc`, then `created: Created`. A field type with no schema form is EK2109. The type comes from the struct, so the two cannot drift apart. `schema Name = <type>` declares the schema of any type the same mapping writes, a literal union for one, with `Name` as both the constant and its type (D280): `schema Code = "root_missing" | "read_failed"`.

#### Data types

```ts effect
type Delivery = Data.TaggedEnum<{
  Waiting: {}
  Sent: { readonly tracking: string }
  Rejected: { readonly reason: string }
}>
const Delivery = Data.taggedEnum<Delivery>()

const describe = Delivery.$match({
  Waiting: () => "waiting",
  Sent: ({ tracking }) => `sent ${tracking}`,
  Rejected: ({ reason }) => `rejected: ${reason}`
})
```

```ts es
data Delivery {
  Waiting
  Sent { tracking: string }
  Rejected { reason: string }
}

function describe(delivery: Delivery) {
  return match (delivery) {
    when Delivery.Waiting: "waiting";
    when Delivery.Sent { let tracking }: `sent ${tracking}`;
    when Delivery.Rejected { let reason }: `rejected: ${reason}`;
  }
}
// string!!
```

A `data` declaration declares both: the type `Delivery`, Effect's `Data.TaggedEnum` of the variants, and the constant `Delivery`, the constructors `Data.taggedEnum` makes, typed `Data.TaggedEnum.Constructor<Delivery>` (D307). A variant without fields is a bare name; a variant's fields are written as an `error`'s are, `name: Type` or `name?: Type`, and are readonly. A line break or `;` separates fields and variants; a comma is EK1013, as in an `error`'s body. `Delivery.Sent({ tracking: "parcel-8" })` and `Delivery.Waiting()` construct values, plain records with a `_tag` that compare and hash by their fields, and `Delivery.$is` and `Delivery.$match` are Effect's. Type parameters pass through the interface `Data.TaggedEnum.WithGenerics` asks for, which the declaration names `NameDefinition`. [Restriction] `WithGenerics` passes at most four, unconstrained (EK2126): a limit of Effect's encoding, not of the language:

```ts es
data LoadState<A, E> {
  Idle
  Loaded { value: A }
  Failed { error: E }
}
// interface LoadStateDefinition extends Data.TaggedEnum.WithGenerics<2> {
//   readonly taggedEnum: LoadState<this["A"], this["B"]>
// }
// const LoadState = Data.taggedEnum<LoadStateDefinition>()
```

A variant is a pattern (Chapter 3): `when Delivery.Sent:` and `delivery is Delivery.Sent` test the tag, and `when Delivery.Sent { let tracking }` also binds the fields its braces list, an optional field the value leaves out as `undefined`. The checker narrows the subject by the tag, and the lowering runs the test as `Delivery.$is("Sent")(delivery)`. `match` is exhaustive: a data type's variants are a finite union of concrete cases, so without `default`, a match over one that leaves out a variant is EK4701 (D346), which names it, `This match does not handle every case of Delivery: Delivery.Rejected is left.` A data type a `.ts` file declares with `Data.taggedEnum` matches the same way, since what makes `Delivery` a data type is its constructors' type.

A variant pattern names its data type by symbol, as every pattern name resolves (D328, D367): `when Delivery.Sent` tests a variant because `Delivery` resolves to a data declaration, under any import alias, and a local `Delivery` that is not one shadows it. A data type's variants are a closed set, so a match over one is exhaustive when every variant is handled; a nested data pattern counts the combinations of its fields' variants. [Restriction] The compiler counts at most 64 combinations, of fields at most 8 levels deep in the subject; past either bound, the match needs `default`, and EK4701 says so (D497). Every arm's test runs, the last arm's included, and a last arm whose test fails is a defect (D405, Chapter 26).

#### HTTP

```ts effect
const getTodo = Effect.fn("getTodo")(function* (id: number) {
  const response = yield* HttpClient.get(`https://jsonplaceholder.typicode.com/todos/${id}`)
  return yield* HttpClientResponse.schemaBodyJson(Todo)(response)
})
```

```ts es
function getTodo(id: number) {
  const response = HttpClient.get(`https://jsonplaceholder.typicode.com/todos/${id}`)
  return HttpClientResponse.schemaBodyJson(Todo)(response)
}
// Todo!HttpClientError | SchemaError!HttpClient
```

`HttpClient.get` returns an `Effect`, so the call runs it. `HttpClientResponse.schemaBodyJson(Todo)` returns a plain function, which `effect` exports with a trusted contract; calling it with the response returns an `Effect`, which runs.

#### Timers

```ts effect
const greetLater = Effect.fn("greetLater")(function* (name: string) {
  yield* Effect.sleep("1 second")
  return `Hello, ${name}`
})

const heartbeat = Effect.log("alive").pipe(Effect.repeat(Schedule.spaced("30 seconds")))
```

```ts es
function greetLater(name: string) {
  sleep("1 second")
  return `Hello, ${name}`
}

function heartbeat() {
  repeat(() => log("alive"), Schedule.spaced("30 seconds"))
}
```

Time comes from the `Clock` service, so a test moves it forward with `TestClock.adjust` instead of waiting (Chapter 12).

#### Environment

```ts effect
const serverConfig = Effect.gen(function* () {
  const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000))
  const databaseUrl = yield* Config.Redacted("DATABASE_URL")
  return { port, databaseUrl }
})
```

```ts es
const Port = Config.withDefault(Config.Port("PORT"), 3000)
const DatabaseUrl = Config.Redacted("DATABASE_URL")

function serverConfig() {
  return { port: Port(), databaseUrl: DatabaseUrl() }
}
// { port: number; databaseUrl: Redacted<string> }!ConfigError!
```

A `Config` is data until you call it (Chapter 13). The module's top level builds `Port` and `DatabaseUrl`; `Port()` reads the variable and fails with `ConfigError` if it is set but invalid. A test supplies values with a `ConfigProvider` instead of touching the process environment.

#### Child processes

```ts effect
const currentBranch = Effect.fn("currentBranch")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const output = yield* spawner.string(ChildProcess.make("git", ["branch", "--show-current"]))
  return output.trim()
})
```

```ts es
function currentBranch() {
  return ChildProcessSpawner.string(ChildProcess.make("git", ["branch", "--show-current"])).trim()
}
// string!PlatformError!ChildProcessSpawner
```

`ChildProcessSpawner.spawn` gives a handle whose output is a `Stream` and whose process belongs to a scope (its type requires `Scope`), so `using child = ChildProcessSpawner.spawn(command)` ties a long-running process to a block: the handle has no disposal method, so `using` adds none, and the release the spawn registers in the block's Scope runs once (D342, D401).

#### Providing the platform

```ts es
// main.vibe
import "vibelang/platform/node"

export function main() {
  log(`on ${currentBranch()}`)
}
// runtime.$entry(import.meta.main, import.meta.url, main,
//   () => NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer)))
```

The file that exports `main` names its platform once (D312). `import "vibelang/platform/node"` loads nothing; it names `@effect/platform-node`'s bundle, `NodeServices.layer`, and `main` needs `ChildProcessSpawner`, which that layer provides, so the module's entry statement runs `main` with it: Effect's canonical entry, written by the compiler. `"vibelang/platform/bun"` names `BunServices.layer` and `"vibelang/platform/browser"` the browser's bundle. A bundle's services are the `Out` of its layer's declared type, and a `main` that needs one of VibeLang's experimental services (D313) gets the platform's experimental bundle instead, which holds Effect's, so the platform's services are built once. `main` provides every other service itself, `provide FetchHttpClient.layer { … }`, and a provide inside `main` wins over the bundle for the code inside it. EK3205 names what neither provides, and, in a file without a platform import, the import that would. Tests import `main` and never run the entry statement.

Tests provide fakes instead: a `Layer.succeed(FileSystem, { … })` with the methods a test needs, or an in-memory implementation where Effect ships one, such as `KeyValueStore.layerMemory`.

#### Experimental services

Where Effect has no API for a platform call that programs need, VibeLang adds one (D313): it extends the Effect module the call belongs to, or, where Effect has no such module, adds a service in Effect's style. Each is `vibelang-runtime/experimental/<Module>`, and the prelude's `Experimental` namespace holds every one, so `Experimental.FileSystem` is the module that extends `effect/FileSystem`:

| You would use | In VibeLang |
| --- | --- |
| `fs.access(path, X_OK)` | `Experimental.FileSystem.access(path, { executable: true })` |
| `O_NONBLOCK` | `Experimental.FileSystem.open(path, { nonBlocking: true })` |
| `FileHandle.chmod` | `file.chmod(mode)` on an open `File` |
| `crypto.createHmac`, HMAC with `crypto.subtle` | `Experimental.Crypto.hmac("SHA-256", key, data)` |
| `crypto.sign`, `crypto.subtle.sign` with ECDSA P-256 or Ed25519 | `Experimental.Crypto.sign("Ed25519", privateKey, data)` |
| `crypto.verify`, `crypto.subtle.verify` | `Experimental.Crypto.verify("Ed25519", publicKey, signature, data)` |
| `process.pid`, `os.hostname()` | `Experimental.Process.pid()`, `Experimental.Process.hostname()` |
| `process.kill(pid, signal)` | `Experimental.Process.kill(pid, { killSignal })`, `Experimental.Process.isRunning(pid)` |
| `navigator.locks.request` | `using held = Experimental.Locks.hold(name)` |

As for Effect's modules (D311), the module's name names its service: `Experimental.Process.pid()` calls the `Process` service, whose key is `Experimental.Process.Process`, with no import. The experimental `FileSystem` and `Crypto` keys are class services, as Effect declares them: the type `Experimental.FileSystem` is the requirement, and `Experimental.FileSystem.Service`, a superset of Effect's interface, its implementation. The requirement is not Effect's `FileSystem`, so Effect's layer, whose key differs at run time, does not provide it.

```ts es
function canRun(path: string) {
  Experimental.FileSystem.access(path, { executable: true })
  return true
}
// boolean!PlatformError!FileSystem
```

```ts es
function claimOwner(previous: number) {
  if (Experimental.Process.isRunning(previous)) Experimental.Process.kill(previous)
  return `${Experimental.Process.hostname()}-${Experimental.Process.pid()}`
}
// string!PlatformError!Process
```

An experimental service keeps its Effect module's name and Effect's style: a superset of Effect's interface where Effect has the module, under its own `Context.Service` key (`vibelang/experimental/FileSystem`), `PlatformError` failures, and a test layer (`FileSystem.layerNoop`, `Crypto.layerTest`, `Process.layerTest`, `Locks.layerTest`). An import of the service by name from its subpath shadows the prelude's Effect module, and Effect's members keep working on it. Its layers are in `vibelang-runtime/experimental/platform-node`, `-bun`, and `-browser`: a layer of a service that extends Effect's provides the experimental service and Effect's service of the same name from one implementation, Effect's own with the additions, and `ExperimentalNodeServices.layer` and `ExperimentalBunServices.layer` there are the platform bundles plus `FileSystem`, `Crypto` and `Process`. Secret keys are `Redacted<Uint8Array>`: raw bytes for HMAC, PKCS#8 DER for signing; public keys are SPKI DER, and ECDSA signatures are r‖s, as WebCrypto writes them. `Process` reads the process id, platform, architecture, executable, versions, host name, available parallelism, time origin and memory use as Effects that cannot fail, and `kill` and `isRunning` signal any process by id; browsers have no `Process` layer, and the home directory is Effect's `UserDirectories.home`. `Locks` holds exclusive Web Locks in the caller's scope: `ExperimentalBrowserLocks.layer`, also in `ExperimentalBrowserServices.layer`, provides it over `navigator.locks`; Bun has no `Locks` layer, and Node.js's `ExperimentalNodeLocks.layer` locks only within one process, so its bundle leaves it out. When Effect releases a member, its experimental module re-exports Effect's, and a later VibeLang release removes the module; Effect 4.0.6 released `FileSystem.lstat`, so it is Effect's own.

#### Module declarations: TypeScript inside a `.vibe` file

A `module` declaration holds TypeScript in a `.vibe` file (D283), for code that must keep JavaScript's meaning: a coroutine that a caller drives with `next()`, a function that must throw a JavaScript exception, or a Node.js API that Effect does not wrap.

```ts es
module counter {
  export let count = 0
  export function bump(): void { count++ }
}

import { count, bump } from counter

export function main() {
  sync(() => bump())
  log(`count is ${count}`)       // count is 1: the import reads the module's binding
}
```

The body is checked and compiled as a `.ts` file would be (Chapter 10 states how): JavaScript's `throw` and `catch`, `async`/`await`, generators and platform APIs mean there what they mean in TypeScript, and it cannot read the `.vibe` file's own bindings. Its exports are reached only through an import, `import { bump } from counter`, and are foreign code to the `.vibe` file: a call of a plain export needs a boundary or a trusted contract (Chapter 10), as the hatch above gives it.

A module declaration is an ECMAScript module [Rule] (D364; Chapter 26 states the rule in full): an import of its export is a live binding, so `count` above reads 1 after `bump()`; the module runs where its first import stands among the file's imports; and its name is case-sensitive. [Restriction] A module declaration is named, unexported, and at the file's top level, and its name is not a value: `export module`, a nested or nameless declaration, and `import(counter)` are EK4408 or syntax errors, though TC39's proposal allows them.
