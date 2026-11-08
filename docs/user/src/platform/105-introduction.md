# Introduction to Effect Platform

VibeLang reaches files, paths, processes, HTTP, randomness, and terminals through Effect's platform services. Write the application against those services; the entry module provides the platform's implementations to `main()` and passes that Effect to a runner. Node's globals and the web's I/O globals are not in scope in a `.vibe` file, and it imports no `node:*` module as a value (EK4402); it needs no wrapper of its own around one.

Bare internal Node builtins, including `_http_client` and `_tls_wrap`, have the same `EK4402` import rule as `node:fs`. Legacy builtin names from supported Node 22/24 remain reserved across runtimes; move their value imports to a `.ts` module.

The pure helpers `AbortSignal` and `URL` remain available, but `AbortSignal.timeout`, `URL.createObjectURL` and `URL.revokeObjectURL` reach the host and report `EK4402`. Grouping and erased TypeScript assertions on a `globalThis` receiver retain the same rule. Move those operations into a sibling `.ts` module; `Effect.try`, `Effect.tryPromise` and `Effect.sync` arrows inside `.vibe` files keep the same restriction.

The restriction covers the whole file: plain and `async` functions, nested callbacks, and `Effect.try`, `tryPromise`, `sync` and `callback` bodies all report `EK4402` for a host binding such as `window` or `document`. A local binding with the same name keeps its own meaning, and erased type queries remain allowed.

For a self-contained wrapper, `vibelang --fix` moves the wrapper into a new sibling `.ts` factory and imports it. The factory builds the Effect at the original call site, so platform work stays deferred until the Effect runs. It keeps the rewrite only when checking succeeds and the public declaration stays identical. When the wrapper reads another binding of the file or `this`, as `Effect.try({ try: () => decrypt(Buffer.from(value)), catch: ... })` does, the wrapper stays and `--fix` moves only the platform code, `Buffer.from(value)`, into a new sibling `.ts` function that takes its arguments as parameters. `--fix-vip-only` does the same for modules that were already converted. An existing foreign module is never overwritten.

The migrate flow can move a zero-argument optional host call, such as `process.getuid?.()`, into a native module helper while keeping the class and its `import.meta.url` in the original module. The helper performs the whole optional call on its original receiver, only when the call is reached. Calls with value or type arguments retain the preservation refusal.

The migrate flow moves a module's `import.meta` reads into a fresh `<source>.platform.ts` companion before renaming the source. A direct `import.meta.resolve` call with one or two arguments calls a companion function instead. Its arguments stay where they were, inside the original callback and `try`/`catch`, so captured inputs and deferred execution stay unchanged. `import.meta.filename` and `import.meta.dirname` become companion calls that receive the module's own `import.meta.url`, so they still name the module, and they stay `undefined` for a URL other than `file:`, as in Node.js. `import.meta.env` becomes a companion call that returns the build's environment. Code that reads `import.meta.filename` stays in the entry module so the value keeps that file's identity. Code that reads `import.meta.dirname` can move with a declaration, since the sibling shares its directory. An executable script keeps its shebang at the start of the entry module; the generated companion contains no shebang. A source wildcard export map gains an exact `null` entry for the new helper subpath to keep it private; revert removes that entry. Existing companions, `import.meta.main`, writes to `import.meta` members, other unsupported `import.meta` uses and publication layouts the flow cannot prove safe receive a refusal. `import.meta.url` stays in the original module. Code that reaches the platform and reads `import.meta.url` stays in the module too: only its host calls and reads move, so `import.meta.url` still names the module.

Platform repairs from one source share one fresh `<source>.platform.ts` companion. A moved host call becomes a companion helper with the callee's own type: the helper forwards the call and asserts its forwarding arrow to `typeof` the callee, and a `// SAFETY:` comment before the helper states why that assertion is sound, so a repository lint that requires a justification for every type assertion accepts the generated companion. Clock and randomness helpers have signatures of their own and assert nothing. Explicit `sync` inputs stay evaluated at the original call site, in order; the callback still runs only when its Effect runs. A callback that captures other bindings or a lexical receiver keeps the existing preservation checks, and an existing foreign module is never rewritten. During migration, host access inside formerly accepted boundary callbacks reports an `EK4402` warning; `--fix` and `--fix-migration-only` can repair explicit-input writes and deletes such as restoring `process.env`. Unwrapped host access remains an error.

## Using platform services

```vibe
// main.vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"

export effect function main() {
  try scoped(effect {
    const fs = try FileSystem.FileSystem
    const path = try Path.Path
    const spawner = try ChildProcessSpawner.ChildProcessSpawner
    const directory = try fs.makeTempDirectoryScoped()
    const file = path.join(directory, "greeting.txt")
    try fs.writeFileString(file, "Hello, VibeLang!")
    try Console.log(try fs.readFileString(file))
    const output = try spawner.string(ChildProcess.make("echo", ["from a child process"]))
    try Console.log(output.trim())
  })
}

NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))
// Output: Hello, VibeLang!
// Output: from a child process
```

`try FileSystem.FileSystem` gets the implementation from the current environment. `try fs.readFileString(file)` runs its method and returns the text. Its `PlatformError` joins E. The module's own exports keep their meaning, as `FileSystem.layerNoop` does, and the service's type is `FileSystem.FileSystem` ([Effect's modules](../getting-started/008-importing-effect.md#a-modules-own-export)). `scoped` closes the temporary directory's scope when the block completes, fails, or is interrupted.

The child-process `EK4402` examples obtain `ChildProcessSpawner.ChildProcessSpawner` with `try`, then run its `string` or `spawn` method. A spawned handle needs `Scope`; keep it inside `scoped`, as in the example above.

Calling `main()` builds an Effect. `NodeRuntime.runMain` runs it, and `Effect.provide` supplies `NodeServices.layer`. Shared modules declare effect functions and leave platform selection to the entry module or test.

## Replacing Node.js and web calls

An unresolved experimental name such as `Process` keeps its TypeScript missing-name diagnostic. Its hint names the `Experimental` module, shows how to read and run the service, and identifies a layer that provides it. For example, read a process identifier with `try (try Experimental.Process.Process).pid` and provide `ExperimentalNodeServices.layer` from `vibelang-runtime/experimental/platform-node`. Pure helpers such as `Experimental.NetAddress.isIPv6(address)` need no service lookup or layer.

Each Node.js or web call has an Effect replacement, which needs no import. `EK4402` names it and its layer. `Date.now` and `Math.random` are ECMAScript and allowed; their rows give the replacement a test can control:

| Call | Effect | Layer |
| --- | --- | --- |
| `fs.readFile` | `try (try FileSystem.FileSystem).readFile(path)` | `NodeServices.layer` |
| `os.tmpdir` | `try (try Experimental.Process.Process).temporaryDirectory` | `ExperimentalNodeServices.layer` |
| `net.isIPv6` | `Experimental.NetAddress.isIPv6(address)` | none (pure) |
| `child_process.spawn` with inherited stdio | `try (try Experimental.ChildProcess.ChildProcess).runInherited(command, args, options)` | `ExperimentalNodeChildProcess.layer` |
| `new Headers(headers)` | `try (try Experimental.Headers.Headers).copy(headers)` | Node, Bun or browser experimental layer |
| `Readable.fromWeb(response.body)` | `try (try Experimental.NodeStream.NodeStream).fromWeb(body, { response, signal })` | Node or Bun experimental layer |
| `new Request(url, request)` | `try (try Experimental.Request.Request).atUrl(url, request)` | Node, Bun or browser experimental layer |
| `path.join` | `(try Path.Path).join(directory, name)` | `NodeServices.layer` |
| `process.cwd` | `(try Path.Path).resolve()` | `NodeServices.layer` |
| `child_process.execFileSync` | `try (try ChildProcessSpawner.ChildProcessSpawner).string(ChildProcess.make(command, args))` | `NodeServices.layer` |
| `fetch` | `try HttpClient.get(url)` | `FetchHttpClient.layer` |
| `http.createServer` | `try Layer.launch(HttpRouter.serve(app))` | `ExperimentalNodeHttpServer.layer({ port })` |
| `crypto.randomUUID` | `try (try SecureRandom.SecureRandom).uuidV4()` | `NodeCrypto.layer` |
| `crypto.subtle.digest` | `try (try Digest.Digest).digest(Digest.sha256, bytes)` | `NodeCrypto.layer` |
| `process.argv.slice(2)` | `try (try Stdio.Stdio).args` | `NodeServices.layer` |
| `process.getuid?.()` | `try (try Experimental.Process.Process).currentUid` | `ExperimentalNodeServices.layer` |
| `os.hostname` | `try (try Experimental.Process.Process).hostname` | `ExperimentalNodeServices.layer` |
| `os.homedir` | `try (try Experimental.Process.Process).homeDirectory`, including native account fallback | `ExperimentalNodeServices.layer` |
| `process.kill` | `try (try Experimental.Process.Process).kill(pid, { killSignal })` | `ExperimentalNodeServices.layer` |
| `fs.constants.X_OK` | `try (try Experimental.FileSystem.FileSystem).access(path, { executable: true })` | `ExperimentalNodeServices.layer` |
| `crypto.createHmac` | `try (try Mac.Mac).sign(key, data)` | `NodeCrypto.layer` |
| `navigator.locks` | `try (try Experimental.Locks.Locks).hold(name)` | `ExperimentalBrowserLocks.layer` |
| `process.env` | `try Config.String("NAME")` | none |
| `console.log` | `try Console.log(message)` | none |
| `setTimeout` | `try sleep("1 second")` | none |
| `Date.now` | `try Clock.currentTimeMillis` | none |
| `performance.now() - start` | `Number((try Clock.monotonicTimeNanos) - startNanos) / 1e6` | none |
| `Math.random` | `try Random.next` | none |

`try (try FileSystem.FileSystem).readFile(path)` returns bytes, as Node’s default `fs.readFile` does. For UTF-8 text, use `try (try FileSystem.FileSystem).readFileString(path)`, corresponding to `fs.readFile(path, "utf8")`.

`HttpRouter.serve(app)` builds a `Layer`. Run it with `try Layer.launch(HttpRouter.serve(app))` to keep the server alive until interruption, and provide the server layer named in the table.

The old `EK4403` is retired: host `performance` and `crypto` reads report `EK4402`, even when a legacy config tries to lower that code. Run native clock Effect values with `try`, and look up `SecureRandom.SecureRandom` before calling its methods.

`try (try Stdio.Stdio).args` reads user arguments, matching `process.argv.slice(2)` on Node. It omits the executable and script entries. Keep a full `process.argv` read in a `.ts` adapter when those entries are needed.

For elapsed intervals, capture `const startNanos = try Clock.monotonicTimeNanos` before work and subtract it from a later reading of the same clock. This clock has an arbitrary origin, which can differ from `performance.now()` on Node. In the table, `start` is the earlier native reading. Keep native `performance.now()` reads in a `.ts` adapter when their original origin is required, including when adding `performance.timeOrigin`.

Get a service with `try`, as in `const random = try SecureRandom.SecureRandom`, then run `try random.uuidV4()`; `ChildProcess`, `HttpClient`, `HttpRouter`, and `FetchHttpClient` are in scope too. `NodeServices.layer` provides `FileSystem`, `Path`, `Stdio`, `Terminal`, and `ChildProcessSpawner`; `BunServices.layer` from `@effect/platform-bun` is Bun's. Since Effect 4.1 the crypto services, `SecureRandom`, `Digest`, `Mac`, `Signature` and the rest of `effect/crypto`, come from `NodeCrypto.layer`, `BunCrypto.layer` or `BrowserCrypto.layer`. Provide the platform's bundle to the application Effect and every other layer inside `main`. Effect's runtime provides the prelude's services itself.

Where Effect has no service yet, as for `os.hostname()`, `process.pid`, an execute-permission check, or `navigator.locks`, EK4402 names the experimental service VibeLang adds, such as `try (try Experimental.Process.Process).pid` ([Experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md)), whose layers come from `vibelang-runtime/experimental/platform-node`, `-bun`, or `-browser`. There, `ExperimentalNodeServices.layer` is `@effect/platform-node`'s bundle plus the experimental `FileSystem`, `Crypto`, `Process` and `Stdio`, so it replaces Effect's in `main`; like Effect's, it holds none of Effect's crypto services. Where nothing covers the call yet, as for `os.uptime()`, EK4402 says to escape to TypeScript: a `.ts` file that imports the API. Wrap calls that may throw with `Effect.try`, or Promises with `tryPromise`. [Platform globals](platform-globals.md) answers every Node.js and web global.

## Making an HTTP client request

Provide `FetchHttpClient.layer` to make requests through Effect 4's `HttpClient`.
The host service bundle does not supply this client.
All three module names below are in scope without imports.

```vibe
effect function requestJson(url: string) {
  provide FetchHttpClient.layer {
    const response = try HttpClient.get(url)
    return try response.json
  }
}

export effect function main() {
  try Console.log(try requestJson("https://jsonplaceholder.typicode.com/todos/1"))
}

await runPromise(main())
```

`try HttpClient.get(url)` waits for the response; `try response.json` reads and parses its
body. Both operations can fail, and the function infers those failures. The JSON is
data, not a validated application type: decode it with a Schema before relying
on its fields.

## Installing runtime-specific packages

Follow [Install the packages](../setup/existing-project.md#2-install-the-packages)
for the exact npm and Bun commands, including the
`"@effect/platform-node-shared": "4.1.1"` override. Keep `effect` and every
`@effect/platform-*` package at exactly 4.1.1; use npm's `--save-exact` or
Bun's `--exact` when adding them.

The `effect` package holds the interfaces. Use `@effect/platform-node@4.1.1`
for Node.js or Deno, `@effect/platform-bun@4.1.1` for Bun, or
`@effect/platform-browser@4.1.1` for browsers. Deno uses the same exact
versions through `npm:` package specifiers.

`vibelang` ships the `vibelang` binary. `npx vibelang` checks and compiles
the project's `.vibe` and `.ts` sources, then you launch the generated
JavaScript; `npx vibelang --noEmit` only checks. Bun and Deno projects also
need `vibelang-runtime` and the compiler. Never pass `.vibe` files to a
TypeScript runner.

## Writing platform-independent programs

```vibe
// greeting.vibe
// run: provide FileSystem.layerNoop({ readFileString: () => succeed("  Hello, VibeLang!\n") }) { try greet() }
export effect function greet() {
  const fs = try FileSystem.FileSystem
  const greeting = try fs.readFileString("./greeting.txt")
  try Console.log(greeting.trim())
}
// Output: Hello, VibeLang!
```

`greet` requires `FileSystem` and nothing else, so it runs on any platform that provides it, and a test provides a layer of its own, here the module's `FileSystem.layerNoop`. Shared modules name no platform; the entry file does.

## Supplying Node or Deno implementations

```vibe
// main-node.vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { greet } from "./greeting.vibe"

effect function main() {
  const fs = try FileSystem.FileSystem
  try fs.writeFileString("./greeting.txt", "Hello, VibeLang!")
  try greet()
}

NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))
// Output: Hello, VibeLang!
```

`NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))` starts `main` with the Node platform service bundle when this module loads. The services each bundle supplies come from its installed declarations. Tests import the shared program module and supply their own layers. The same package works in Deno's Node compatibility environment, subject to Deno permissions. Run the generated entry module with Node or Deno, granting only the permissions the application needs.

A `provide` inside `main` wins for the code inside it, so `provide NodeFileSystem.layer { ... }` replaces one service. Provide every other service `main` needs, such as `UserDirectories.layer`, inside `main`.

## Supplying Bun implementations

```vibe
// main-bun.vibe
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import { greet } from "./greeting.vibe"

effect function main() {
  const fs = try FileSystem.FileSystem
  try fs.writeFileString("./greeting.txt", "Hello, VibeLang!")
  try greet()
}

BunRuntime.runMain(Effect.provide(main(), BunServices.layer))
// Output: Hello, VibeLang!
```

The entry provides `BunServices.layer` from `@effect/platform-bun`. The same `greet` uses Bun's implementations. A target-specific package can supply a narrower layer than the whole bundle, such as `NodeFileSystem.layer`. The FileSystem, Path, PlatformLogger, Runtime, and Terminal pages cover each integration.

## Starting `main` in a browser

Use `@effect/platform-browser`'s `BrowserRuntime.runMain` to start the browser program; the compiled module imports nothing of Node's. Provide `BrowserCrypto.layer` for Effect's crypto services. A program that also needs `Experimental.Locks` or `Experimental.MediaQuery` provides `ExperimentalBrowserServices.layer` from `vibelang-runtime/experimental/platform-browser`. Keep the browser program separate from the module that starts it:

```vibe
// app.vibe
export effect function main() {
  const mac = try Mac.Mac
  const encoder = new TextEncoder()
  const key = try Mac.key(Mac.hmacSha256, encoder.encode("key"))
  const tag = try mac.sign(key, encoder.encode("hello"))
  try Console.log(tag.length)
}
```

```vibe
// page.vibe
import { BrowserRuntime } from "@effect/platform-browser"
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto"
import { main } from "./app.vibe"

BrowserRuntime.runMain(Effect.provide(main(), BrowserCrypto.layer))
```

The page loads `page.vibe`'s JavaScript as a module script, bundled or not, and the runner call at its top level starts `main`, as a top-level runner call does in any module. `BrowserRuntime.runMain` interrupts `main` when the page is discarded.

## Coming from Effect

An effect function returns an Effect value. `try` replaces `yield*`, including when getting a service. `provide layer { ... }` runs the block with that layer. The entry module passes the application Effect to a platform runner.
