# Effect's Modules

In `.vibe` files, Effect's entire standard library is already in scope — no boilerplate imports required. Every export of `Effect` (`sleep`, `retry`, `timeout`, `all`, `forEach`, `race`, `log`, `withSpan`, `sync`, `tryPromise`, `callback`, `scoped`, `acquireRelease`, `runPromise`, …), every root module (`Console`, `Option`, `Stream`, `Schedule`, `Clock`, `Duration`, `Layer`, `Schema`, …), and every subpath module (`HttpRouter`, `ChildProcess`, `TestClock`, `Hex`, …) resolves automatically and emits tree-shakeable imports in the compiled JavaScript.

Only platform-specific packages such as `@effect/platform-node` require explicit imports.

## Core package

```sh
npm install effect@4.1.1
```

See [Installation](004-installation.md) for `vibelang`, `vibelang-runtime`, and platform packages. Root functions (`pipe`, `flow`, `identity`) and core modules (`Effect`, `Layer`, `Schema`, `Scope`) compile directly to `effect/*` imports; VibeLang syntax constructs (`error`, `service`, `match`, `for concurrent`) also use `vibelang-runtime`.

## Using globals and handling name collisions

```vibe
// run: try Console.log(Number.isFinite(try pauseBeforeRetry()))
effect function pauseBeforeRetry() {
  const started = try Clock.currentTimeMillis
  try sleep(Duration.millis(25))
  return started
}

const backoff = Schedule.exponential("50 millis")
// Output: true
```

Any local variable or explicit `import` shadows an implicit global. When an Effect export would clash with a keyword or JavaScript global, qualify it with `Effect.`:

| Clashes with | Write |
| --- | --- |
| JavaScript keyword | `Effect.try`, `Effect.catch`, `Effect.void`, `Effect.let` |
| JavaScript global | `Effect.undefined` |
| VibeLang keyword | `Effect.match`, `Effect.when`, `Effect.service`, `Effect.provide`, `Effect.interruptible`, `Effect.uninterruptible` |

JavaScript's core globals (`Array`, `String`, `Number`, `Boolean`, `Symbol`, `BigInt`, `Function`, `RegExp`, `Record`) keep their JavaScript meanings. Access Effect's modules of those names via `Effect.Array`, `Effect.String`, `Effect.Record`, or an aliased import:

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(firstTwo([1, 2, 3]))))
import { Array as Arr } from "effect"

function firstTwo(values: ReadonlyArray<number>) {
  return Arr.take(values, 2)
}
// Output: [1,2]
```

> **Note:** `Effect.Array` and `Effect.String` require the unshadowed implicit `Effect`. If you write `import { Effect } from "effect"` or disable implicit globals in `tsconfig.json` (`"vibe": { "effectGlobals": false, "effectModules": false }`), import collision modules separately as `import { Array as Arr } from "effect"`.

## Subpath modules and collision resolution

Subpath modules are in scope too — the compiler emits direct per-file imports (such as `effect/encoding/Hex`) so your bundle includes only what you touch:

```vibe
// run: try Console.log(hexOf("hi"))
function hexOf(text: string) {
  return Hex.encode(new TextEncoder().encode(text))
}
// Output: 6869
```

When two modules share a name, four rules decide:

1. Non-platform JavaScript globals keep their JavaScript meaning.
2. A name exported by both root `effect` and a subpath requires an explicit import (`EK1401`).
3. A name exported by two different subpaths requires an explicit import (`EK1401`).
4. Any explicit import or local declaration shadows the implicit global.

These are the exact resolutions for `effect@4.1.1`:

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
| `Utils` | `effect`, `effect/rpc` | nothing: import the one you mean (rule 2) |
| `Worker` | `effect/workers` | Effect's module; the DOM type keeps its name |
<!-- end D310 collisions -->

## A module's own export

Many Effect modules export a type or service carrying the same name as the module: `Option.Option<T>`, `Chunk.Chunk<T>`, `FileSystem.FileSystem`, `Path.Path`. Always qualify the member when writing a type or reading a service with `try`:

| Write | Meaning |
| --- | --- |
| `Option.Option<number>` | The Option type |
| `const fs = try FileSystem.FileSystem` | Look up the `FileSystem` service |
| `try fs.readFileString(path)` | Run a method on that implementation |
| `(try Path.Path).sep` | Read a property on the `Path` implementation |
| `FileSystem.FileSystem.of(impl)` | Type-check an implementation |

```vibe
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

Modules that export a same-named service:

<!-- D311 services: TestModuleServicesDocumented checks this list -->
`AddressResolver`, `Aead`, `AtomRegistry`, `Chat`, `ChildProcessSpawner`, `Cipher`, `CircuitBreaker`, `CliConfig`, `Clock`, `ConfigProvider`, `Console`, `DatagramSocket`, `DecisionModel`, `DevToolsClient`, `Digest`, `Dns`, `EmbeddingModel`, `EventJournal`, `EventLog`, `EventLogEncryption`, `EventLogRemote`, `EventLogServerUnencrypted`, `FileSystem`, `GraphQLProtocol`, `HttpClient`, `HttpPlatform`, `HttpRouter`, `HttpServer`, `HttpServerRequest`, `IdGenerator`, `Jwks`, `K8sHttpClient`, `Kdf`, `KeyAgreement`, `KeyValueStore`, `KeyWrap`, `LanguageModel`, `Mac`, `McpClient`, `McpServer`, `MessageStorage`, `OtlpSerialization`, `Path`, `Persistence`, `Random`, `RateLimiter`, `Reactivity`, `Redis`, `ResponseIdTracker`, `RpcSerialization`, `RunnerHealth`, `RunnerStorage`, `Runners`, `Scheduler`, `SecureRandom`, `Sharding`, `ShardingConfig`, `Signature`, `Socket`, `SocketServer`, `SqlClient`, `Stdio`, `Terminal`, `TerminalCapabilities`, `Tokenizer`, `Tracer`, `UserDirectories`, `WorkflowEngine`.
<!-- end D311 services -->

Names with both an Effect namespace (value position) and an ambient DOM type (bare type position — use `FileSystem.FileSystem` for Effect's type):

<!-- D311 DOM types: TestModuleServicesDocumented checks this list -->
`Cache`, `Console`, `Event`, `FileSystem`, `Headers`, `Iterable`, `KeyFormat`, `Record`, `Request`, `Response`, `Scheduler`, `Transferable`, `Worker`.
<!-- end D311 DOM types -->

## Writing reusable operators

Because Effects are first-class values, write generic helpers that accept `A!E!R` and wrap it with Effect combinators:

```vibe
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

`withinSecond` preserves the caller's `A`, `E`, and `R` while adding `TimeoutError` to `E`.

## Coming from Effect

Drop boilerplate `import { Effect, Layer, Schema, ... } from "effect"` lines in `.vibe` files; keep normal imports in `.ts` files. `interrupt` and `yieldNow` are bare Effect values (`try interrupt`, `try yieldNow`).

[Upstream Effect page](https://effect.website/docs/v4/getting-started/importing-effect)
