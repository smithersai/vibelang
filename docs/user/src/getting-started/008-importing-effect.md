# Effect's Modules

In `.vibe` files, Effect's modules are already in scope: the prelude, every module `effect` exports from its root, such as `Console`, `Option`, `Stream`, `Schedule`, `Clock`, and `Duration`, and every module of its subpath packages, such as `HttpRouter` from `effect/http`, `ChildProcess` from `effect/process`, and `TestClock` from `effect/testing`. Platform packages such as `@effect/platform-node` still need imports.

## Install the core package

```sh
npm install effect@4.1.0
```

The core package supplies Effect's data types, schedules, concurrency tools, and other modules. See [Installation](004-installation.md) for platform packages, `vibelang`, and `vibelang-runtime`.

## Module and namespace imports

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(Number.isFinite(try pauseBeforeRetry()))
effect function pauseBeforeRetry() {
  const started = try Clock.currentTimeMillis
  try sleep(Duration.millis(25))
  return started
}

const backoff = Schedule.exponential("50 millis")
// Output: true
```

`Effect` and every root module of `effect` need no import. Type exports are not global, so the type is `Effect.Effect<A, E, R>`, or `A!E!R`. Every export of the `Effect` module is global unless its name clashes with a keyword or JavaScript global. This includes `sleep`, `log`, `retry`, `repeat`, `timeout`, `all`, `forEach`, `race`, `withSpan`, `die`, `sync`, `tryPromise`, `callback`, `result`, and the runners. Names that clash stay qualified, such as `Effect.try`, `Effect.catch`, `Effect.match`, and `Effect.provide`. `pipe`, `flow`, and `identity` need no import either. `fork` and `join` use their language forms.

JavaScript's own globals keep their names: `Array`, `String`, `Number`, `Boolean`, `Symbol`, `BigInt`, `Function`, and `RegExp` mean JavaScript's, so import Effect's modules of those names under another name:

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify(firstTwo([1, 2, 3]))))
import { Array as Arr } from "effect"

function firstTwo(values: ReadonlyArray<number>) {
  return Arr.take(values, 2)
}
// Output: [1,2]
```

`vibelang --fix` writes this form where code imports one of these modules under its own name (EK4842).

JavaScript globals that are not platform-specific and TypeScript's own globals keep their meaning. Effect modules with those names are available as `Effect.Array`, `Effect.String`, `Effect.Record`, or through an aliased import. Platform-specific names use Effect's module: `Request`, `Option`, `Cache`, `FileSystem`, `Scheduler`, and `Console`. `Crypto` is the DOM's, because Effect has no root `Crypto` module; import `effect/crypto` to use Effect's. An import or local declaration named like a module shadows it, as `import * as Duration from "effect/Duration"` would. Value constructors such as `Duration.millis` build data; `try Clock.currentTimeMillis` and `try sleep(...)` run computations. A plain function known not to throw can be called directly; wrap a call that may throw with `Effect.try`.

## Modules of subpath packages

A subpath package's modules need no import either. The emitted JavaScript imports each module you use from its own file, such as `effect/encoding/Hex`, so a program loads only what it uses:

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(hexOf("hi"))
function hexOf(text: string) {
  return Hex.encode(new TextEncoder().encode(text))
}
// Output: 6869
```

Four rules settle a name that two globals share, in order: a JavaScript global that is not platform-specific wins in its meaning; a root module wins over a subpath module; when two subpath packages have a module of the same name, neither is in scope, so import the one you mean; and an import or local declaration shadows any of them. Ambient types keep their names independently. In value and namespace positions, `Headers` is `effect/http/Headers`, `Response` is `effect/ai/Response`, `Event` is `effect/eventlog/Event` and `Worker` is `effect/workers/Worker`. These are the names they settle for `effect@4.1.0`:

<!-- D310 collisions: TestEffectNameCollisionsDocumented checks this table -->
| Name | Modules | Without an import |
| --- | --- | --- |
| `Event` | `effect/eventlog` | Effect's module; the DOM type keeps its name |
| `Headers` | `effect/http` | Effect's module; the DOM type keeps its name |
| `KeyFormat` | `effect/crypto` | Effect's module; the DOM type keeps its name |
| `Model` | `effect/ai`, `effect/schema` | nothing: import the one you mean (rule 3) |
| `Prompt` | `effect/ai`, `effect/cli` | nothing: import the one you mean (rule 3) |
| `Response` | `effect/ai` | Effect's module; the DOM type keeps its name |
| `Transferable` | `effect/workers` | Effect's module; the DOM type keeps its name |
| `Utils` | `effect`, `effect/rpc` | `effect`'s root module (rule 2) |
| `Worker` | `effect/workers` | Effect's module; the DOM type keeps its name |
<!-- end D310 collisions -->

## A module's own export

Many of Effect's modules export something of their own name: the module `Option` exports the type `Option.Option`, and the module `FileSystem` the service `FileSystem.FileSystem`. Name the export explicitly when writing a type or passing a service key:

| You write | It means |
| --- | --- |
| `Option.Option<number>` | Effect's optional number type |
| `const fs = try FileSystem.FileSystem` | Reads the provided file-system implementation |
| `try fs.readFileString(path)` | Runs a method of that implementation |
| `(try Path.Path).sep` | Reads the provided path implementation's separator |
| `const terminal = try Terminal.Terminal; try terminal.columns` | Runs the implementation's `columns` Effect |
| `FileSystem.FileSystem.of(implementation)` | Checks a file-system implementation's shape |

The module's exports stay namespace members: `Option.some`, `FileSystem.layerNoop`, and `Path.layer`. A service key as an argument stays explicit: `Layer.succeed(FileSystem.FileSystem, implementation)`.

Assigning a module stores its namespace: `const fs = FileSystem`. To call implementation methods, read the service first: `const fs = try FileSystem.FileSystem`. The same rule applies to `Experimental.Process` and the other modules that name a service.

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14, VIP-33
// run: provide Path.layer, FileSystem.layerNoop({ readFileString: effect (path) => `read ${path}` }) { try Console.log(try readConfig("/srv")); try Console.log(firstOr(Chunk.empty(), 7)) }
effect function readConfig(dir: string) {
  const fs = try FileSystem.FileSystem
  const path = try Path.Path
  return try fs.readFileString(path.join(dir, "config.json"))
}

effect function hasConfig(fs: FileSystem.FileSystem, dir: string) {
  const path = try Path.Path
  return try fs.exists(path.join(dir, "config.json"))
}

function firstOr(values: Chunk.Chunk<number>, fallback: number): number {
  const first: Option.Option<number> = Chunk.head(values)
  return Option.getOrElse(first, () => fallback)
}
// Output: read /srv/config.json
// Output: 7
```

Read a service before calling its implementation methods. These modules name a service:

<!-- D311 services: TestModuleServicesDocumented checks this list -->
`AddressResolver`, `Aead`, `AtomRegistry`, `Chat`, `ChildProcessSpawner`, `Cipher`, `CircuitBreaker`, `CliConfig`, `Clock`, `ConfigProvider`, `Console`, `DatagramSocket`, `DecisionModel`, `DevToolsClient`, `Digest`, `Dns`, `EmbeddingModel`, `EventJournal`, `EventLog`, `EventLogEncryption`, `EventLogRemote`, `EventLogServerUnencrypted`, `FileSystem`, `GraphQLProtocol`, `HttpClient`, `HttpPlatform`, `HttpRouter`, `HttpServer`, `HttpServerRequest`, `IdGenerator`, `K8sHttpClient`, `Kdf`, `KeyAgreement`, `KeyValueStore`, `KeyWrap`, `LanguageModel`, `Mac`, `McpClient`, `McpServer`, `MessageStorage`, `OtlpSerialization`, `Path`, `Persistence`, `Random`, `RateLimiter`, `Reactivity`, `Redis`, `ResponseIdTracker`, `RpcSerialization`, `RunnerHealth`, `RunnerStorage`, `Runners`, `Scheduler`, `SecureRandom`, `Sharding`, `ShardingConfig`, `Signature`, `Socket`, `SocketServer`, `SqlClient`, `Stdio`, `Terminal`, `TerminalCapabilities`, `Tokenizer`, `Tracer`, `UserDirectories`, `WorkflowEngine`.
<!-- end D311 services -->

These names have both an Effect namespace and an ambient global type. Value and namespace positions use Effect; bare type positions keep the ambient type:

<!-- D311 DOM types: TestModuleServicesDocumented checks this list -->
`Cache`, `Console`, `Event`, `FileSystem`, `Headers`, `Iterable`, `KeyFormat`, `Record`, `Request`, `Response`, `Scheduler`, `Transferable`, `Worker`.
<!-- end D311 DOM types -->

These meanings apply in value and namespace positions. In a type position, a name the DOM declares as a type keeps the DOM's meaning, as in `type HostConsole = Console`. Use a qualified member such as `FileSystem.FileSystem` for Effect's type.



## Compose standalone functions

```vibe
// pending: VIP-5, VIP-14
// run: try Console.log(expirationWindow())
function expirationWindow() {
  const short = Duration.seconds(15)
  return Duration.toMillis(short)
}
// number
// Output: 15000
```

Effect exposes operations as module functions: call them with their data argument, or use their curried form in `pipe` where one exists. `pipe(x, f)` passes `x` as the value it is, so a function literal first stays a function: call the operation with the Effect instead, as in `timeout(work(), "1 second")`. `pipe` suits data-last functions with no data-first form, such as `Match.when`.

## Bundling unused code

Named module imports and direct namespace imports both expose the library without adding methods to your objects. Bundlers can drop unused exports when their module analysis supports it. The import spelling alone guarantees no particular size; check the generated bundle when size matters.

VibeLang's global names are source conveniences: they refer to Effect and language support code, which still participates in the emitted module graph.

## Reusable operators

```vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-5, VIP-6, VIP-14
// run: try Console.log(try example())
effect function withinSecond<A, E, R>(program: A!E!R) {
  return try timeout(program, "1 second")
}

effect function example() {
  return try withinSecond(effect {
    try sleep("10 millis")
    return "ready"
  })
}
// Output: ready
```

A helper can take an Effect value and apply library operators to it. Its contract keeps the program's errors and services and here adds `TimeoutError`. This extends your application without changing Effect's prototypes.

## Coming from Effect

Skip imports from `effect`'s root in `.vibe`. In `.ts` integration files, import `Effect`, `Layer`, and the other names you use as usual.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/importing-effect)
