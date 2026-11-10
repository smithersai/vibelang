# Experimental platform APIs

VibeLang adds the few platform APIs that Effect does not have yet. They are experimental: a release can change or remove them, and each goes when Effect ships the API. Where Effect has the service, the experimental one extends it, so the rest of the service is Effect's own; where Effect has none, the experimental service follows Effect's style. Each addition lives under `Experimental.X` and can be proposed upstream. Native language helpers, including error declarations, keep the experimental namespace out of their bundle graph unless the source uses it.

| Module | Adds | Layers |
| --- | --- | --- |
| `Experimental.Encoding` | pure lenient base64 decode returning a typed result | none |
| `Experimental.NetAddress` | pure `isIPv6` with Node-compatible zones | none (pure) |
| `Experimental.Dns` | Effect Dns extended only with direct authoritative-server TXT queries | Node; Worker TCP, or typed `Unsupported` |
| `Experimental.FileSystem` | `access(path, { executable })`, `open(path, { nonBlocking })`, `File.chmod` | Node, Bun |
| `Experimental.Headers` | `copy(input)` using native mutable Web Headers copies | Node, Bun, browser |
| `Experimental.Crypto` | `hmac`, `sign`, `verify`, beside the members of Effect 4.0's `Crypto` | Node, Bun, browser |
| `Experimental.Stdio` | Effect standard I/O plus `awaitInputClosed` without consuming input | Node, Bun |
| `Experimental.Process` | the process id, platform, host name and other facts; `kill`, `isRunning`, `observeSignals` | Node, Bun |
| `Experimental.Locks` | `hold`, `tryHold`, `query` over Web Locks | browser; Node within one process |
| `Experimental.MediaQuery` | `matches`, `changes` over `window.matchMedia` | browser |
| `Experimental.BrowserInfo` | `crossOriginIsolated`, `userAgent` | browser |
| `Experimental.Window` | `current`, the page's window (`Window & typeof globalThis`), for an API that takes one or a component test | browser |
| `Experimental.Document` | `current`, the page's `Document`, for an API that takes one | browser |
| `Experimental.ResizeObserver` | `observe` of an element, until the Scope closes | browser |
| `Experimental.FileReader` | `readAsText`, `readAsDataUrl`, `readAsArrayBuffer` of a `Blob` or a `File` | browser |
| `Experimental.Animations` | `nextFrame`, `nextFrameUnless`, `frameDeltas`, `settled` over animation frames and the Web Animations API | browser |
| `Experimental.AudioContext` | `acquire`, an `AudioContext` that closes with the Scope | browser |
| `Experimental.Durable` | a journaled engine for Effect's `Workflow` and `Activity`: a crashed run resumes and skips finished steps; `workflow` with VIP-44 run identity, `task` with a result cache, run handles, `plan` and `diff`, `history`, `replay`, `fork`, `rewind` | `memory`, `layerSql` over Effect's `SqlClient`, `layerStore(store)`, in any runtime |
| `Experimental.Memory` | facts, notes and message threads that outlive a run: `remember` writes a fact, `note` appends a note that can supersede older ones, `thread(id)` appends and reads messages, `recall` ranks banks' facts and notes for a query and cuts them to a byte budget | `test`, `layerSql` over Effect's `SqlClient`, `layerStore(store)`, in any runtime |
| `Experimental.Eval`, `Experimental.Scorer` | suites of cases against a target, scorers that grade each answer from 0 to 1, baselines, a regression comparison and a gate with a CI exit code; `Scorer.bind` scores a durable workflow's live runs | none for suites; `Scorer.memory` or `Scorer.layerSql` for live scores |
| `Experimental.Test` | test doubles for agentic programs: `replay`, a `LanguageModel` that answers from a recording and never calls a provider; `decisions`, the same for a `DecisionModel`; `record`, which replays a file and records what it is missing; `modelServer`, the same recording served over HTTP; `durable` and `restartable` engines with `crash`; `host`, a machine of fixed files and scripted commands; `journal` and `divergence` assertions over a durable run; `conformance.engine()`, nine cases that certify a workflow engine | the doubles are layers; `replay`, `host`, the engines and the assertions need nothing and run in any runtime, `record` needs Effect's `FileSystem` and `modelServer` an `HttpServer` |

`Experimental` is in scope in every `.vibe` file without an import, as Effect's modules are. A local value declaration or an import named `Experimental` shadows it in expressions. A local type alias or interface keeps its type meaning without hiding the implicit value namespace. TypeScript imports the same modules from `vibelang-runtime/experimental`, or one module from its subpath, such as `vibelang-runtime/experimental/FileSystem`.

Pure additions, such as `Experimental.NetAddress`, are ordinary functions: no service key, `try` or provider is needed. The following service rules apply to additions that access a platform.

## How they work

Each experimental service has its own key, such as `Experimental.FileSystem.FileSystem`. Look up its implementation with `const fs = try Experimental.FileSystem.FileSystem`, then run a member with `try fs.access(path, { executable: true })`. A contract names the key type in its requirements: `boolean!PlatformError.PlatformError!Experimental.FileSystem.FileSystem`.

The experimental `FileSystem` and `Crypto` keys are class services, as Effect declares them. `Experimental.FileSystem.Service` is Effect's interface plus the new members, and the service itself is not Effect's. Effect 4.1 removed its `Crypto` service for the family services of `effect/crypto`; `Experimental.Crypto.Service` keeps the members Effect 4.0's had, such as `randomBytes`, `digest` and `randomUUIDv4`, beside `hmac`, `sign` and `verify`. A layer of Effect's `FileSystem` therefore never provides the experimental one, in VibeLang and in stock TypeScript alike, because at run time it provides a different key. Type an implementation as `Experimental.FileSystem.Service`. `Process`, `Locks` and the browser services extend nothing, so `Experimental.Process.Process`, `Experimental.Locks.Locks` and `Experimental.MediaQuery.MediaQuery` each name both the service and its implementation type, as Effect's `FileSystem` is. The module's own exports keep their meaning, as `Experimental.FileSystem.layerNoop` does. An import by name from the subpath, `import { FileSystem } from "vibelang-runtime/experimental/FileSystem"`, works too, and shadows the prelude's `FileSystem`.

Provide a platform layer at the application boundary. The layers live beside Effect's platform packages. A layer of a service that extends Effect's provides the experimental service and Effect's service of the same name from one implementation, so code that uses Effect's `FileSystem` and code that uses the additions share it:

| Module | Layers |
| --- | --- |
| `vibelang-runtime/experimental/platform-worker` | `ExperimentalWorkerDns.layer`, requiring Effect `HttpClient`; `layerWith` for an injected TCP adapter |
| `vibelang-runtime/experimental/platform-node` | `ExperimentalNodeServices.layer`: `@effect/platform-node`'s bundle plus `FileSystem`, `Crypto`, `Process` and `Stdio`; `ExperimentalNodeFileSystem.layer`, `ExperimentalNodeCrypto.layer`, `ExperimentalNodeProcess.layer`, `ExperimentalNodeStdio.layer`; `ExperimentalNodeLocks.layer`, within one process; `ExperimentalNodeHttpServer.layer` and `layerConfig`; `ExperimentalNodeDns.layer` and `layerWith` |
| `vibelang-runtime/experimental/platform-bun` | `ExperimentalBunServices.layer`: `@effect/platform-bun`'s bundle plus `FileSystem`, `Crypto`, `Process` and `Stdio`; `ExperimentalBunFileSystem.layer`, `ExperimentalBunCrypto.layer`, `ExperimentalBunProcess.layer`, `ExperimentalBunStdio.layer` |
| `vibelang-runtime/experimental/platform-browser` | `ExperimentalBrowserServices.layer`: `Crypto`, `@effect/platform-browser`'s crypto services and the browser services; `ExperimentalBrowserCrypto.layer`, `ExperimentalBrowserLocks.layer`, `ExperimentalBrowserMediaQuery.layer`, `ExperimentalBrowserInfo.layer`, `ExperimentalBrowserWindow.layer`, `ExperimentalBrowserDocument.layer`, `ExperimentalBrowserResizeObserver.layer`, `ExperimentalBrowserFileReader.layer`, `ExperimentalBrowserAnimations.layer`, `ExperimentalBrowserAudioContext.layer` |

`ExperimentalNodeServices.layer` replaces `@effect/platform-node`'s `NodeServices.layer`: it provides every service Effect's does. Each `Crypto` layer, such as `ExperimentalNodeCrypto.layer`, provides the experimental `Crypto` and the platform's Effect crypto services, such as `SecureRandom` and `Digest`; the bundles for Node and Bun, like Effect's, hold none of Effect's crypto services.

Import the individual layers your program uses from the platform module, such as `ExperimentalBrowserRequest` from `vibelang-runtime/experimental/platform-browser`. Bundlers can drop unrelated experimental layers from these imports. The combined `ExperimentalBrowserServices.layer` deliberately includes every browser service.

The runtime lists `@effect/platform-node`, `@effect/platform-bun` and `@effect/platform-browser` as optional peer dependencies: install the one your program runs on. Failures are Effect's `PlatformError`, as for Effect's services.

## Encoding

`Experimental.Encoding.decodeBase64Lenient(input)` returns a pure `Result<Uint8Array, EncodingError>`, with no service or layer. It matches Node's `Buffer.from(input, "base64")`: standard and URL-safe alphabets may mix, whitespace and other non-alphabet characters are ignored, padding is optional, the first `=` ends the input, and a final lone base64 character is discarded. Errors redact the input, which may contain a private key.

Effect 4.0.6 and 4.1.1 already provide `Base64` and `Base64Url` in `effect/encoding`. Use those for strict decoding; neither accepts all the inputs above. This extension delegates the byte decoding to Effect after normalization. Convert its result to an Effect explicitly:

```vibe
// run: try Console.log((try decodeLenient(" Z g ")).length)
export effect function decodeLenient(input: string) {
  return try Effect.fromResult(Experimental.Encoding.decodeBase64Lenient(input))
}
// Output: 1
```

For Alchemy's `ServiceAccountKey`, decode the bytes this way, then use `TextDecoder` for UTF-8 and `Effect.try` around `JSON.parse`. Map both failures to the existing domain error without attaching the input or the cause. This needs no platform layer.

## Dns

Effect 4.0.6 and 4.1.1 already ship `effect/net/Dns`: `lookup`, `resolve(name, type)`, `reverse`, typed records, static test zones, and a configurable `NodeDns` resolver. Use those directly for ordinary DNS and NS/A discovery. `Experimental.Dns` extends that service with only `resolveTxtAt(server, fqdn)`, the direct-authority operation Alchemy needs. Its `Service` extends `Dns.Dns["Service"]`; its key is distinct, as `Experimental.FileSystem`'s is. A platform layer provides both keys from the same implementation, preserving Effect's existing members.

| Expression | Guarantee |
| --- | --- |
| `try (try Dns.Dns).resolve(candidate, "NS")` | Effect's NS records at a candidate zone apex; recursive discovery, potentially cached |
| `try (try Dns.Dns).resolve(nameserver, "A")` | Effect's IPv4 records; read `NetAddress.formatIp(record.address)` |
| `try (try Experimental.Dns.Dns).resolveTxtAt(server, fqdn)` | TXT queried directly from the supplied nameserver; one string per RR, its chunks joined |

Alchemy walks the challenge name's parent labels until the NS query finds a zone, reads each `record.host`, resolves its A records, then queries each returned IP directly. Its polling policy decides when to retry failures. It does not need experimental `resolveNs` or `resolve4` wrappers.

```vibe
// run: provide Experimental.Dns.layerTest({ resolveTxtAt: (_server, _name) => succeed(["challenge-value"]) }) { try Console.log((try authoritativeTxt("192.0.2.53", "_acme-challenge.example.test"))[0]) }
export effect function authoritativeTxt(server: string, fqdn: string) {
  const dns = try Experimental.Dns.Dns
  return try dns.resolveTxtAt(server, fqdn)
}
// Output: challenge-value
```

Provide `ExperimentalNodeDns.layer` from `vibelang-runtime/experimental/platform-node` on Node. The ordinary members come directly from Effect's `NodeDns.make`. The extension reuses `NodeDns.make({ nameServers: [server] })` in a fresh query Scope, so only the supplied server receives that TXT query and closing the query Scope cancels its resolver. Node does not expose the authoritative-answer (AA) bit: the caller must supply a zone's actual authority, and port 53 interception remains possible. `layerWith(options)` takes Effect's own `NodeDns.Options` (`nameServers`, `timeout`, `tries`) for discovery and limits. This layer is provided separately from the platform bundle. Ordinary configured Node DNS needs only Effect's own layer.

On Cloudflare Workers, provide `Layer.provide(ExperimentalWorkerDns.layer, FetchHttpClient.layer)`, importing `ExperimentalWorkerDns` from `vibelang-runtime/experimental/platform-worker` and `FetchHttpClient` from `effect/http`. The Worker platform adapter uses Effect's `Dns.make`, record constructors and IP/name parsers for recursive NS/A discovery through the injected `HttpClient`. Other recursive record types fail Effect's typed `Unsupported`. The experimental TXT operation uses `cloudflare:sockets.connect({ hostname: server, port: 53 })`, sends DNS-over-TCP with recursion disabled, and requires AA. It checks transaction and question identity, frame bounds, TXT lengths and compression pointers. It never substitutes a recursive DoH TXT answer or follows a CNAME through a recursive resolver. Authoritative NODATA returns an empty array.

A Worker without `cloudflare:sockets` fails the authoritative operation with `AuthoritativeDnsError` reason `Unsupported`, explaining why recursive DoH cannot replace it. A refused or blocked socket fails typed `Transport`. [Cloudflare blocks TCP to its IP ranges, private addresses and localhost](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations), so authorities there cannot be queried by that layer. `layerWith({ connect, discoveryUrl, timeout })` accepts another host's TCP adapter. Neither layer authenticates DNS cryptographically.

Ordinary operations keep Effect's `DnsError`. The added operation fails with `AuthoritativeDnsError`: `operation` is `resolveTxtAt`; `reason` is `Unsupported`, `BadArgument`, `InvalidData`, `NotAuthoritative`, `NotFound`, `Timeout` or `Transport`. Its message never includes TXT payloads. The Worker timeout closes its socket. `Experimental.Dns.layerTest({ ... })` uses Effect's static resolver and replaces the members a test chooses; the default authoritative answer is empty. Both keys share that test implementation too.

## FileSystem

| Member | What it does | Node.js |
| --- | --- | --- |
| `access(path, { executable: true })` | Checks that the caller may run the file; on Windows, only that it exists | `fs.access(path, X_OK)` |
| `open(path, { nonBlocking: true })` | Opens a FIFO or a device without waiting for the other end; Windows fails with `BadArgument` | `O_NONBLOCK` |
| `file.chmod(mode)` | Changes the permissions of the file the handle opened, even after its path was renamed or replaced | `FileHandle.chmod` |

```vibe
// run: provide ExperimentalNodeServices.layer { { const jsonValue = try runnable(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } }
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"

effect function canRun(path: string) {
  const fs = try Experimental.FileSystem.FileSystem
  try fs.access(path, { executable: true })
  return true
}

effect function runnable() {
  return try scoped(effect {
    const fs = try FileSystem.FileSystem
    const dir = try fs.makeTempDirectoryScoped()
    try fs.writeFileString(`${dir}/build.sh`, "#!/bin/sh")
    try fs.chmod(`${dir}/build.sh`, 0o755)
    try fs.writeFileString(`${dir}/notes.txt`, "")
    return { script: canRun(`${dir}/build.sh`) catch () => false, notes: canRun(`${dir}/notes.txt`) catch () => false }
  })
}
// Output: {"script":true,"notes":false}
```

`lstat`, which reads a symbolic link itself, is Effect's own since Effect 4.0.6, so it needs no experimental service.

`noFollow` with `nonBlocking` opens a path that another process may replace: the open fails on a symbolic link and returns at once on a FIFO, and `file.chmod` then changes the file that was opened, not whatever the path names later.

```vibe
effect function restrict(path: string) {
  try scoped(effect {
    const fs = try Experimental.FileSystem.FileSystem
    const file = try fs.open(path, { flag: "r+", noFollow: true, nonBlocking: true })
    try file.chmod(0o600)
  })
}
```

In tests, `Experimental.FileSystem.layerNoop({ ... })` provides a stub for both keys: Effect's `FileSystem.layerNoop`, with `open` failing with `NotFound` unless you give it.

## Crypto

| Member | What it does |
| --- | --- |
| `hmac(algorithm, key, data)` | The HMAC of `data` with a `"SHA-1"`, `"SHA-256"`, `"SHA-384"` or `"SHA-512"` digest; `key` is the raw secret, `Redacted.Redacted<Uint8Array>` |
| `sign(algorithm, privateKey, data)` | Signs `data`; `privateKey` is a PKCS#8 DER key, `Redacted.Redacted<Uint8Array>` |
| `verify(algorithm, publicKey, signature, data)` | `true` when `signature` signs `data`; `publicKey` is an SPKI DER key |

Effect 4.1's `Mac` and `Signature` services do the same work with opaque keys, so new code can use them; this service stays for code written against it. The signature algorithms are `"ECDSA-P256-SHA256"`, whose signatures are 64 bytes, r then s, as WebCrypto writes them, and `"Ed25519"`. A key of the wrong kind fails with `BadArgument`, whose message names no key bytes. Secret keys are `Redacted`, so logs and errors print `<redacted>`. One WebCrypto implementation serves every platform.

```vibe
// run: provide ExperimentalNodeServices.layer { try Console.log(try signature(Redacted.make(new TextEncoder().encode("Jefe")), "what do ya want for nothing?")) }
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"

effect function signature(secret: Redacted.Redacted<Uint8Array>, body: string) {
  const crypto = try Experimental.Crypto.Crypto
  return Hex.encode(try crypto.hmac("SHA-256", secret, new TextEncoder().encode(body)))
}
// Output: 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
```

`Experimental.Crypto.layerTest()` provides the service for tests: random bytes are zeros, so UUIDs repeat, and digests, HMACs and signatures are real.


## Stdio

Effect's `Stdio.stdin` is a byte stream: running it consumes input. When another transport already owns stdin, provide `ExperimentalNodeStdio.layer` or `ExperimentalBunStdio.layer` from the experimental platform subpath and wait without taking its bytes:

```vibe
effect function awaitTransportInputClosed() {
  const stdio = try Experimental.Stdio.Stdio
  try stdio.awaitInputClosed
}
```

`awaitInputClosed` waits for stdin's `end` or `close` and returns immediately when stdin has already ended or been destroyed. It reads the host only when run and detaches its two listeners on completion, interruption or setup failure. It never reads, resumes, pauses, drains or destroys input and installs no `data`, `readable` or `error` listener. The transport keeps byte and error ownership; it must consume input itself for native `end` to occur.

`Experimental.Stdio.Service` extends Effect's `Stdio.Stdio` interface; `Experimental.Stdio.Stdio` is a distinct service key. `Experimental.Stdio.make(stdio, { awaitInputClosed })` keeps Effect's argument effects, sinks, terminal facts and input stream unchanged. The Node and Bun experimental bundles also include this extension. There is no browser layer.

`Experimental.Stdio.layerTest()` supplies Effect's test standard I/O and an already-completed closure Effect. Override `awaitInputClosed` and the standard members a test needs. A pending or failing transport can be modeled with an injected Effect without native stdin.


## NetAddress

`Experimental.NetAddress.isIPv6(input)` is a pure `string => boolean` predicate with Node's `net.isIPv6` acceptance, including scoped literals. It delegates bare-address parsing to Effect; its only added rule is a nonempty zone of ASCII letters, digits, `-`, `.` or `:`, without numeric conversion or bounds. It does not normalize the address or resolve interface names.

```vibe
const valid = Experimental.NetAddress.isIPv6("fe80::1%eth0")
const largeScope = Experimental.NetAddress.isIPv6("::1%4294967296")
```

Both are `true`. `"::1%💩"` and `"::1%eth_0"` are `false`, matching Node. Effect's scoped parser deliberately has a different scope contract, including unsigned 32-bit numeric scopes and broader named zones. Use Effect's `NetAddress.ipv6FromString` when decoding a bare address; this addition is for the Node-compatible predicate. No Node import, platform layer or fake service is needed, in a browser, worker or server.

## Process

```vibe
// alive.vibe
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"

export effect function main() {
  provide ExperimentalNodeServices.layer {
    const process = try Experimental.Process.Process
    const pid = try process.pid
    try Console.log(try process.isRunning(pid))
  }
}
await runPromise(main())
// Output: true
```

Look up `const process = try Experimental.Process.Process`. Each fact is an Effect that cannot fail, run with `try`, as `try (try Stdio.Stdio).args` is:

| Expression | Gives | Replaces |
| --- | --- | --- |
| `try process.pid` | `ProcessId`, Effect's child process id type | `process.pid` |
| `try process.platform` | `"darwin"`, `"linux"`, `"win32"`, ... | `process.platform` |
| `try process.arch` | `"x64"`, `"arm64"`, ... | `process.arch` |
| `try process.execPath` | the runtime's executable | `process.execPath` |
| `try process.versions` | `{ node: "26.5.0", ... }` | `process.versions` |
| `try process.hostname` | the host's name | `os.hostname()` |
| `try process.homeDirectory` | the native user home directory, including account fallback | `os.homedir()` |
| `try process.availableParallelism` | at least 1 | `os.availableParallelism()` |
| `try process.timeOrigin` | when the process started, in epoch milliseconds | `performance.timeOrigin` |
| `try process.memoryUsage` | `{ rss, heapTotal, heapUsed, external, arrayBuffers }` in bytes | `process.memoryUsage()` |
| `try process.temporaryDirectory` | the native temporary directory path; creates nothing | `os.tmpdir()` |

`try process.temporaryDirectory` delegates to the native `os.tmpdir()` query each time it runs, including the native environment lookup. It creates no directory or file. Use `FileSystem.makeTempDirectory()` when a program needs to allocate a temporary directory. Tests can provide `Experimental.Process.layerTest({ temporaryDirectory: Effect.succeed("/test/temp") })`; the default is `"/tmp"`.

`homeDirectory` delegates to the native `os.homedir()` on each execution, including its account lookup when `HOME` (or `USERPROFILE` on Windows) is unset. Effect's `try (try UserDirectories.UserDirectories).home` reads the `ConfigProvider` environment and remains the resolver for application directories, provided by `UserDirectories.layer`. A `ConfigProvider` override does not change the native lookup. Tests can provide `Experimental.Process.layerTest({ homeDirectory: Effect.succeed("/test/home") })`; its default home is `"/test/home"`. A browser has no process to read, so `Process` has no browser layer.

### Current process uid

`try (try Experimental.Process.Process).currentUid` queries native `process.getuid?.()` on Node/Bun each time it runs. It returns `number | undefined`: `undefined` means the host does not expose `getuid`; `0` is a valid uid. It does not infer the caller from environment variables or a file's owner.

Unlike the infallible facts above, this query has an `unknown` failure channel. A thrown method or property-getter value becomes that exact typed failure, without an `UnknownException` or `PlatformError` wrapper, so an ownership probe can classify it. The native lookup stays synchronous inside the cold Effect.

Tests can provide `Experimental.Process.layerTest({ currentUid: Effect.succeed(0) })` for root, `Effect.succeed(undefined)` for absence, or `Effect.fail(error)` for an unverifiable lookup. The default is `undefined`.

### Signalling processes

```vibe
// stop.vibe
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"

effect function stop(pid: number) {
  const process = try Experimental.Process.Process
  if (!(try process.isRunning(pid))) return "already stopped"
  try process.kill(pid, { killSignal: "SIGTERM" })
  return "stopped"
}

export effect function main() {
  provide ExperimentalNodeServices.layer {
    try scoped(effect {
      const spawner = try ChildProcessSpawner.ChildProcessSpawner
      const process = try Experimental.Process.Process
      const child = try spawner.spawn(ChildProcess.make("sleep", ["30"]))
      try Console.log(try stop(child.pid))
      const reason = process.kill(4194000) catch (e) => e.reason._tag
      try Console.log(reason)
    })
  }
}
await runPromise(main())
// Output: stopped
// Output: NotFound
```

`try process.kill(pid, { killSignal, group })` sends `killSignal`, `"SIGTERM"` by default, one of Effect's `ChildProcess.Signal` names. `try process.isRunning(pid, { group })` sends signal 0: a process that belongs to another user still runs, and so does a child that exited before its parent reaped it. `group: true` signals the process group whose id is `pid`, as `ChildProcessSpawner` starts each child in one. A child the program spawned also stops with its handle's `try child.kill()`; `process.kill` reaches any process, such as one named in a pid file. One `ExperimentalNodeServices.layer` provides both `ChildProcessSpawner` and `Process`.

`try process.isRunning(0)` delegates a signal-zero lookup without delivering a signal; on POSIX this probes the current process group. The query remains cold and follows native host error handling. `kill(0)` remains refused before any host call, including with `group: true`. For a negative native group id, pass its positive magnitude with `group: true` as before.

Both fail with a `PlatformError` whose reason says why:

| Reason | When |
| --- | --- |
| `NotFound` | No process has that id. |
| `PermissionDenied` | This process may not signal it. |
| `BadArgument` | `kill` needs a positive safe integer; `isRunning` accepts zero or a positive safe integer. Other causes include an unsupported signal or explicit `group` on Windows. |

### Which signal ended the program

`NodeRuntime.runMain` interrupts the program on `SIGINT` and on `SIGTERM` alike, so its exit is 130 for both. `try process.observeSignals(["SIGINT", "SIGTERM"])` listens for those signals until the current Scope closes and gives an Effect that reads the first one received: `Option.none()` until one arrives. Its listener runs before `runMain`'s and records the signal at once, so a finalizer that runs during the interruption reads it. To exit as a script that handled each signal did, the finalizer dies with Effect's exit-code marker, which `runMain`'s teardown reads:

```vibe
// serve.vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Runtime from "effect/Runtime"
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"

const signalExit = (code: number) => ({ [Runtime.errorExitCode]: code })

effect function serve() {
  const received = try (try Experimental.Process.Process).observeSignals(["SIGINT", "SIGTERM"])
  try Effect.addFinalizer(() => effect {
    const signal = try received
    if (Option.isSome(signal) && signal.value === "SIGTERM") try die(signalExit(143))
  })
  try Console.log("READY")
  try Effect.never
}

NodeRuntime.runMain(Effect.provide(Effect.scoped(serve()), ExperimentalNodeServices.layer), { disableErrorReporting: true })
```

`SIGINT` exits 130, as `runMain` already does, and `SIGTERM` exits 143. While it listens, the host does not end the process on those signals itself; `runMain` interrupts the program. `observeSignals` fails with a `BadArgument` for `SIGKILL` and `SIGSTOP`, which no process can handle. `Experimental.Process.layerTest()` receives no signal: its `observeSignals` reads `Option.none()`.

### Testing with `Experimental.Process.layerTest`

```vibe
// platform-name.vibe
// run: provide Experimental.Process.layerTest({ platform: succeed("win32") }) { try Console.log(try platformName()) }
export effect function platformName() {
  const process = try Experimental.Process.Process
  return (try process.platform) === "win32" ? "Windows" : "POSIX"
}
// Output: Windows
```

`layerTest` takes the members a test sets and fixes the rest: `pid` is 1, `platform` is `"linux"`, `hostname` is `"localhost"`, `isRunning` answers `false`, and `kill` fails with `NotFound`.

## Locks

```vibe
// leader.vibe
// run: provide Experimental.Locks.layerTest({ hold: () => succeed({ lost: Effect.void }) }) { try lead("engine") }
export effect function lead(name: string) {
  try scoped(effect {
    const locks = try Experimental.Locks.Locks
    const held = try locks.hold(name, { steal: true })
    try Console.log(`leading ${name}`)
    try held.lost
    try Console.log("another tab took the lock")
  })
}
// Output: leading engine
// Output: another tab took the lock
```

`Locks` holds exclusive [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), shared by the tabs and workers of one origin:

| Expression | Gives | Replaces |
| --- | --- | --- |
| `try locks.hold(name)` | `Held`, once this context holds the lock | `navigator.locks.request(name, callback)` |
| `try locks.hold(name, { steal: true })` | `Held`, at once, taken from its holder | `request(name, { steal: true }, callback)` |
| `try locks.tryHold(name)` | `Option.Option<Held>`, at once: none when another context holds the lock or waits for it | `request(name, { ifAvailable: true }, callback)` |
| `try locks.query` | `{ held, pending }`, each lock's `name`, `mode`, and `clientId` | `navigator.locks.query()` |

A held lock belongs to the current Effect Scope: `scoped(effect { ... })` releases it when the Effect ends, and a closed or crashed tab releases its locks, which hands each to the next tab waiting. Interrupting a wait withdraws the request. `try held.lost` completes when another context steals the lock. A lock manager that refuses a request fails it with a `PlatformError`: `BadArgument` for a name that starts with `-`, `PermissionDenied` where the page is not a secure context.

`ExperimentalBrowserLocks.layer`, also in `ExperimentalBrowserServices.layer`, uses `navigator.locks`. Node.js has Web Locks too, but they coordinate the main thread and the worker threads of one process, never two processes, so `ExperimentalNodeLocks.layer` is not in the Node.js bundle: provide it only for locks within one process. Bun has no Web Locks and no layer. `Experimental.Locks.layerTest()` grants every request at once and never loses a lock; pass the members a test needs, as above.

## MediaQuery

```vibe
// reduced-motion.vibe
// run: provide Experimental.MediaQuery.layerTest({ matches: effect (query) => query === "(prefers-reduced-motion: reduce)" }) { try Console.log(try reducedMotion()) }
export effect function reducedMotion() {
  const mediaQuery = try Experimental.MediaQuery.MediaQuery
  return try mediaQuery.matches("(prefers-reduced-motion: reduce)")
}
// Output: true
```

| Expression | Gives | Replaces |
| --- | --- | --- |
| `try mediaQuery.matches(query)` | whether `query` matches now | `window.matchMedia(query).matches` |
| `mediaQuery.changes(query)` | a `Stream` of the current answer, then each change | a `change` listener on a `MediaQueryList` |

Neither fails: a browser reads a malformed query as `not all`, which never matches. `changes` reads the query when the Stream starts, so each run sees the answer of that moment, and ending the Stream removes its listener.

`ExperimentalBrowserMediaQuery.layer`, also in `ExperimentalBrowserServices.layer`, uses `window.matchMedia`. It reads the host only when a member runs, so a server can build a `Stream` and a worker can provide the bundle. Running a member on a host without `window.matchMedia` is a defect.

A library whose published type has no requirement provides the layer at the call: `Stream.provide(stream, ExperimentalBrowserMediaQuery.layer)`.

`Experimental.MediaQuery.layerTest()` answers `false`, and `changes` stays open after its first value. Pass `matches`, which `changes` follows, or `changes` for a Stream of your own.

## Animations

```vibe
// settle.vibe
// run: provide Experimental.Animations.layerTest({ nextFrame: Effect.succeed(16) }) { try Console.log(try closeMenu()) }
export effect function closeMenu() {
  const animations = try Experimental.Animations.Animations
  const time = try animations.nextFrame
  try animations.settled("#menu-items")
  return `closed at ${time}`
}
// Output: closed at 16
```

| Expression | Gives | Replaces |
| --- | --- | --- |
| `try animations.nextFrame` | the next frame's timestamp, in the milliseconds of `performance.now` | `requestAnimationFrame(callback)` |
| `try animations.nextFrameUnless(register)` | nothing, after a pending commit or the next frame; interruption cancels the registration | `requestAnimationFrame`, `cancelAnimationFrame` |
| `animations.frameDeltas` | a `Stream` of the milliseconds between frames | a loop of `requestAnimationFrame` |
| `try animations.settled(selector)` | nothing, once the element's animations and transitions end | `element.getAnimations()`, then each `finished` |

Interrupting `nextFrame` cancels its frame, and ending `frameDeltas` cancels the next one. The first delta is the time since the Stream started, and no delta is negative, though a frame's timestamp can precede a Stream that started during that frame. The browser pauses frames in a hidden tab, so a delta can be seconds long.

`settled` waits a frame, so styles set just before it apply, then waits for the first element that matches `selector`, and completes when none does. A cancelled animation counts as ended, and one with infinite iterations never ends. A selector the browser rejects is a defect.

`nextFrameUnless(register)` is a cold Effect. Its synchronous registrar checks whether a commit is pending and returns that registration's cancel function, or returns `undefined` to choose a frame. The check and registration run together without a fiber yield; interruption cancels the chosen registration. A renderer requiring an immediate cancel function keeps its synchronous host integration in a `.ts` file.

```vibe
effect function afterCommit(isPending: () => boolean, onCommit: (listener: () => void) => () => void) {
  const animations = try Experimental.Animations.Animations
  try animations.nextFrameUnless((resume): (() => void) | undefined => {
    if (isPending()) return onCommit(resume)
    return undefined
  })
}
```

`ExperimentalBrowserAnimations.layer`, also in `ExperimentalBrowserServices.layer`, uses `requestAnimationFrame` and `document`. `Experimental.Animations.layerTest()` completes frame waits at time 0; a pending commit follows the registrar. `frameDeltas` stays open and gives nothing. Pass the members a test needs, as above.

## FileReader

A `.vibe` file does not construct a `Blob` or a `File`, which VIP-33 bans; the browser hands one to the page, and a test makes one in a `.ts` file:

```ts
// note.ts
export const note = (): Blob => new Blob(["hi"], { type: "text/plain" })
```

```vibe
// preview.vibe
// run: provide Experimental.FileReader.layerTest() { try Console.log(try preview(try Effect.try(() => note()))) }
import { note } from "./note.ts"

export effect function preview(file: Blob) {
  const reader = try Experimental.FileReader.FileReader
  return try reader.readAsDataUrl(file)
}
// Output: data:text/plain;base64,aGk=
```

| Expression | Gives | Replaces |
| --- | --- | --- |
| `try reader.readAsText(file)` | the contents as UTF-8 text | `readAsText` |
| `try reader.readAsDataUrl(file)` | the contents as a base64 `data:` URL | `readAsDataURL` |
| `try reader.readAsArrayBuffer(file)` | the contents as an `ArrayBuffer` | `readAsArrayBuffer` |

Each takes a `Blob` or a `File`. For a file on disk, a path, use Effect's `FileSystem`. Interrupting a read aborts it. A failed read fails with a `PlatformError` whose `description` is the browser's message and whose `cause` is the browser's own value:

| Reason | When |
| --- | --- |
| `BadArgument` | The browser refused to start the read: the call threw, as for a value that is not a `Blob`. |
| `NotFound` | The file went away while it was read. |
| `PermissionDenied` | The browser refused the read. |
| `BadResource` | The file could not be read. |
| `Unknown` | Any other error while reading. |
| `InvalidData` | A `load` event gave a result of the wrong type. |

Match `error.reason._tag`: `BadArgument` identifies a refused call, `InvalidData` identifies an unexpected result type, and the other tags identify the reader's `error` event. This remains distinct when a host error reuses the invalid result's exact cause and message.

`ExperimentalBrowserFileReader.layer`, also in `ExperimentalBrowserServices.layer`, uses the host's `FileReader`. `Experimental.FileReader.layerTest()` needs no host: each member reads the `Blob` itself. Pass the members a test needs, such as one that fails.

## ResizeObserver

```vibe
// chart.vibe
// run: provide Experimental.ResizeObserver.layerTest({ observe: effect (_element, onResize) => onResize([]) }) { try Console.log(try Effect.scoped(follow({} as Element))) }
export effect function follow(element: Element) {
  const observer = try Experimental.ResizeObserver.ResizeObserver
  let resizes = 0
  try observer.observe(element, () => {
    resizes += 1
  })
  return resizes
}
// Output: 1
```

`try observer.observe(element, onResize)` runs `onResize` when `element` changes size, and once when it starts, until the Scope closes. `onResize` runs synchronously, before the browser paints, so a layout it changes shows in the same frame; a `Stream` would run after the paint. For the window's size, use `BrowserStream.fromEventListenerWindow("resize")`.

The observer is acquired before its first `observe` call, so closing the scope also disconnects it when the host rejects that target. Constructor and setup exceptions remain defects.

`ExperimentalBrowserResizeObserver.layer`, also in `ExperimentalBrowserServices.layer`, uses the host's `ResizeObserver`. `Experimental.ResizeObserver.layerTest()` never fires. Pass `observe` to fire it, as above.

## Document

```vibe
// keys.vibe
effect function keys() {
  const document = try (try Experimental.Document.Document).current
  return Stream.fromEventListener<KeyboardEvent>(document, "keydown")
}
```

`try (try Experimental.Document.Document).current` gives the page's `Document` to an API that takes one, such as `Stream.fromEventListener`, or a library's helper that cancels an event while it is dispatched. Its type is the real `Document`, so event types carry through. For events you only read, `BrowserStream.fromEventListenerDocument` needs no service.

Calling a member of the document in a `.vibe` file is `EK0403`, because nothing says what it throws: UI code that reads or changes the page belongs in a `.ts` or `.tsx` file.

Two members read the host's other document-level APIs:

| Expression | Gives | Replaces |
| --- | --- | --- |
| `document.isHTMLElement(value)` | whether `value` is an `HTMLElement`, narrowing it as `instanceof` does; throws on a host without one, as `instanceof` does | `value instanceof HTMLElement` |
| `try document.escapeSelector(value)` | `value` escaped for a CSS selector | `CSS.escape(value)` |

`isHTMLElement` is a plain predicate, so that it can narrow. It throws where `value instanceof HTMLElement` throws: on a host without `HTMLElement`, or with one that is not a constructor. Inside `Effect.sync`, that throw is a defect.

`ExperimentalBrowserDocument.layer`, also in `ExperimentalBrowserServices.layer`, reads the host when a member runs. `Experimental.Document.layerTest(document)` gives a fake: `isHTMLElement` answers `false`, and `escapeSelector` gives its input. Pass the members a test needs as a second argument.

## Window

```vibe
// origin.vibe
effect function origin() {
  const window = try (try Experimental.Window.Window).current
  return window.location.origin
}
```

`try (try Experimental.Window.Window).current` gives the page's `Window`, for an API that takes one, such as a helper that filters an event while it is dispatched, or for a read such as `location.origin`. For events you only read, `BrowserStream.fromEventListenerWindow` needs no service.

`try window.computedStyle(element)` gives the element's live `CSSStyleDeclaration`, as `getComputedStyle` does. It is the host's object, not a snapshot, so a later read of it sees a later change.

`ExperimentalBrowserWindow.layer`, also in `ExperimentalBrowserServices.layer`, reads the host when a member runs. `Experimental.Window.layerTest(window)` gives a fake; pass `computedStyle` as a second argument when a test reads one.

### Drive the page in a component test

`current` is typed `Experimental.Window.Page`, which is `Window & typeof globalThis`, the type the DOM library gives `window`. So the page it injects carries the page's own event constructors, element classes and frame functions, and a happy-dom or jsdom test builds native events and replaces native methods through it:

```vibe
// keys.vibe
export function pressHome(page: Experimental.Window.Page) {
  const key = new page.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })
  page.document.dispatchEvent(key)
  return key.defaultPrevented
}

export function countScrolls(page: Experimental.Window.Page, run: () => void) {
  const prototype = page.Element.prototype
  const native = prototype.scrollIntoView
  let scrolls = 0
  prototype.scrollIntoView = () => {
    scrolls += 1
  }
  try {
    run()
  } finally {
    prototype.scrollIntoView = native
  }
  return scrolls
}
```

In the test, provide `ExperimentalBrowserWindow.layer` and read `const page = try (try Experimental.Window.Window).current`; under happy-dom or jsdom that is the environment's window. Spies work on it too: `vi.spyOn(page.Element.prototype, "scrollIntoView")`, `vi.spyOn(page, "scrollY", "get")` and `vi.spyOn(page, "requestAnimationFrame")`, restored by `vi.restoreAllMocks()`. A bare `KeyboardEvent`, `Element`, `requestAnimationFrame` or `window.scrollY` still reads the host and is `EK4402`; a member of the injected page is the page's. DOM calls can throw, so call these helpers through `Effect.try` in effect code.

## BrowserInfo

```vibe
// support.vibe
// run: provide Experimental.BrowserInfo.layerTest({ crossOriginIsolated: Effect.succeed(true) }) { try Console.log(try canShareMemory()) }
export effect function canShareMemory() {
  const browser = try Experimental.BrowserInfo.BrowserInfo
  return (try browser.crossOriginIsolated) && !(try browser.userAgent).includes("Firefox/")
}
// Output: true
```

Each fact is an Effect that cannot fail, as `Experimental.Process`'s are:

| Expression | Gives | Replaces |
| --- | --- | --- |
| `try browser.crossOriginIsolated` | whether the page can share memory with workers | `window.crossOriginIsolated` |
| `try browser.userAgent` | the `User-Agent` string | `navigator.userAgent` |

`ExperimentalBrowserInfo.layer`, also in `ExperimentalBrowserServices.layer`, reads the host when a member runs. A host without a field, such as a server, is not isolated and has an empty user agent. `Experimental.BrowserInfo.layerTest()` is a plain page whose user agent is `"vibelang-test"`; pass the members a test sets.

## ExperimentalNodeHttpServer

`NodeHttpServer.layer` from `@effect/platform-node` takes Node's `createServer`, and a `.vibe` file does not import `node:http` as a value. `ExperimentalNodeHttpServer.layer({ port })` is Effect's layer with that argument supplied, and `layerConfig({ port: Config.Port("PORT") })` reads the options from `Config`. It adds no service: it provides Effect's `HttpServer`. A server that needs its own `createServer` options belongs in a `.ts` file. Bun's `BunHttpServer.layer({ port })` takes no constructor, so it has no such layer.


## ChildProcess

Use Effect's `ChildProcessSpawner` for ordinary commands, pipes and stdio
streams. Its scoped cleanup waits for exit. When inherited stdio must preserve
synchronous, non-waiting cancellation, use `Experimental.ChildProcess`:

```vibe
// inherited.vibe
// run: provide Experimental.ChildProcess.layerTest() { try Console.log(try install()) }
effect function install() {
  const child = try Experimental.ChildProcess.ChildProcess
  return try child.runInherited("package-manager", ["install"], { cwd: "/test/work", shell: false })
}
// Output: 0
```

`runInherited` starts only when executed. It inherits stdio and leaves the native
non-detached default. `cwd` is required; `shell` defaults to `false`. The
result is the native `exit` event's code, including `null` for signal termination;
the caller decides how to report nonzero or nullable status. Native asynchronous
errors retain their `Error` identity; synchronous construction exceptions are
defects.

Interrupting the pending Effect calls the native argument-free `kill()` once
only when `exitCode === null && !killed`. It does not wait for exit, escalate,
unreference the child, or signal its process group. Native event listeners
continue to handle late errors as in the callback contract. No new `Scope`
requirement is added.

Provide `ExperimentalNodeChildProcess.layer` or
`ExperimentalBunChildProcess.layer` at the boundary; their experimental service
bundles include it. `Experimental.ChildProcess.layerTest()` returns exit code
zero without starting a process. Override `runInherited` for status or error
tests. This capability adds the cancellation contract, not another command
parser or stream implementation.


## Headers

`try (try Experimental.Headers.Headers).copy(input)` constructs a native mutable `Headers` object when the Effect runs. It preserves the native constructor's handling of duplicate `Set-Cookie` values and returns an independent copy. Provide `ExperimentalNodeHeaders.layer`, `ExperimentalBunHeaders.layer` or `ExperimentalBrowserHeaders.layer`; their service bundles include the corresponding layer.

```vibe
effect function copyHeaders(input: Headers) {
  const headers = try Experimental.Headers.Headers
  return try headers.copy(input)
}
```

## NodeStream

`try (try Experimental.NodeStream.NodeStream).fromWeb(body, { response, signal })` eagerly takes ownership of a Web response body when the Effect runs and returns a Node-compatible readable. A response `close` destroys that readable, which cancels the underlying reader even if no Node consumer has started reading. Its close listener is removed when the readable closes. Provide `ExperimentalNodeStream.layer` or `ExperimentalBunNodeStream.layer`; both service bundles include it.

## Request

`try (try Experimental.Request.Request).atUrl(url, existingRequest)` constructs a native `Request` at a replacement URL while preserving the existing request's native initialization, including its body, headers and signal. Construction happens when the Effect runs, so native constructor errors remain defects. Provide `ExperimentalNodeRequest.layer`, `ExperimentalBunRequest.layer` or `ExperimentalBrowserRequest.layer`; the service bundles include them.

## When Effect ships them

Each addition has a matching change prepared for Effect. When an Effect release has the member, the experimental module re-exports Effect's, and a later VibeLang release removes the module (D313).

## AudioContext

```vibe
// sound.vibe
effect function sampleRate() {
  const audio = try Experimental.AudioContext.AudioContext
  const context = try audio.acquire
  return context.sampleRate
}
```

`try audio.acquire` opens an `AudioContext` that closes when the Scope closes, unless the program closed it first. A close that rejects does not fail the scope. It fails with a `PlatformError` whose `description` is the browser's message, including on a host with no `AudioContext`. The context is the host's own object: build its graph of nodes in a `.ts` file or a named top-level `module` body.

`ExperimentalBrowserAudioContext.layer`, also in `ExperimentalBrowserServices.layer`, uses the host's `AudioContext`. `Experimental.AudioContext.layerTest(context)` gives a fake, which still closes with the Scope.

## Durable execution

Effect defines durable workflows: `Workflow.make` declares a workflow and its payload, `Activity.make` a recorded step, and both run on Effect's `WorkflowEngine` service. Effect's one local engine, `WorkflowEngine.layerMemory`, forgets every run when the process exits. `Experimental.Durable` adds the engine that remembers. Each step's start and result go to an append-only journal, one per run. A run that stopped part way, because its process crashed or was killed, resumes the next time anything executes it with the same input: the body runs again, and each step the journal finished returns its recorded result instead of running.

`Experimental.Durable.task(key, options)` declares a step with a payload. Its implementation is a layer, `Task.toLayer(handler)`, so a test swaps it by providing another. Inside a workflow, calling the task runs one step; two calls of one task are two steps. `key` names the step in the journal, so keep it while runs that used it are stored. Options keep Smithers' names: `payload`, `success`, `error`, `tier` (`"sealed"`, `"compensable"` or `"irreversible"`, recorded with the step), `retryPolicy` and `attemptTimeoutMs`.

```vibe
// run: try Console.log(try placeOrder("A-1"))
const Charge = Experimental.Durable.task("shop#Charge", { payload: { order: Schema.String }, success: Schema.Number })

const Order = Experimental.Durable.workflow("shop#Order", { payload: { order: Schema.String }, success: Schema.Number })

const OrderLive = Order.toLayer(effect ({ order }) => {
  const total = try Charge({ order })
  return total * 2
}).pipe(
  Layer.provide(Charge.toLayer(({ order }) => Effect.succeed(order.length))),
  Layer.provideMerge(Experimental.Durable.memory)
)

export effect function placeOrder(order: string) {
  provide OrderLive {
    return try Order.execute({ order })
  }
}
// Output: 6
```

`Experimental.Durable.workflow(tag, options)` is Effect's `Workflow.make` with run identity from VIP-44: equal payloads name one run, so executing the workflow again with an equal payload joins that run, and a program that crashed and starts again resumes it with no saved id. Equality is `Experimental.Durable.identity(schema)`: sets and maps are sorted, the value is encoded with the schema's JSON codec, and the text is RFC 8785 canonical JSON. `new Set(["a", "b"])` and `new Set(["b", "a"])` are one input; `["a", "b"]` and `["b", "a"]` are two, because array order is meaningful. The body receives the payload as it was hashed, its sets and maps in sorted order. Pass `idempotencyKey` to say what "equal" means for one workflow instead.

A workflow may declare its plan: `plan: (payload) => data`, JSON that lists the steps it will take, for a person or a budget to read before anything runs. `Experimental.Durable.plan(W, payload)` returns the plan for a payload and its SHA-256 digest without running anything, and `Experimental.Durable.diff(a, b)` names the nodes, by `key`, that plan `b` adds, removes or changes. A run journals `PlanRecorded` with the digest when it starts. A resume under a workflow that now builds a different plan, or a plan where the run recorded none, dies with `Experimental.Durable.PlanChanged` (`plan_changed`): nothing repairs a divergence by running under a new key. Start a new run, or rewind or fork the old one under the code that recorded it.

Pick the store with one layer. `Experimental.Durable.memory` journals into this process's memory. `Experimental.Durable.layerSql` journals into a SQL database through Effect's `SqlClient`: provide one of Effect's clients, such as `SqliteClient.layer({ filename })` from `@effect/sql-sqlite-node` or `@effect/sql-sqlite-bun`, or `PgClient.layer` from `@effect/sql-pg`, and a program killed mid-run resumes the run on its next start. It creates the tables `durable_runs`, `durable_journal` and `durable_cache` if they are missing, and a SQL failure is a defect. `Experimental.Durable.layerStore(store)` runs over any `Experimental.Durable.Store`; engines built over one store share its runs, which is how a test crashes one engine and resumes the run on another. There is no default engine: a workflow with no engine provided has a missing `WorkflowEngine` requirement.

The engine keeps these guarantees:

| Guarantee | How |
| --- | --- |
| A finished step never runs twice in one run | A step journals `StepStarted` before its body and `StepCompleted` with its encoded result after. A replay serves the recorded result, failures included. |
| A step that did not finish can run again | A crash after an outside effect and before `StepCompleted` repeats the step. Delivery is at-least-once, so give an irreversible step an idempotency key that its destination deduplicates. |
| One owner per run | An engine that loads a run claims it and raises its fence. Each write of the run's state is fenced, so an engine that lost the run dies with `Experimental.Durable.FenceLost` at its next write. |
| No holes in history | A step's event and its state commit in one store operation. `seq` counts from 1 in each run. |
| Credentials never reach the journal | Effect's JSON codec writes a `Redacted` value's secret as plain text, so a workflow payload, step result or step failure that holds one is refused with a defect naming its path, before anything is written. Pass the secret's name or a placeholder, and read the secret inside the task that uses it. |
| Equal input joins the run | `Order.execute` with the payload of a finished run returns its recorded result, runs nothing and journals nothing. |

A `retryPolicy` is data, `{ initialMs, factor, maxMs, maxAttempts?, expirationMs?, jitterRatio? }`. With one, a typed failure is retried, and each attempt is its own journaled step. The delay before attempt `n` is `initialMs * factor ** (n - 2)`, at most `maxMs`, so it depends only on the attempt number the journal keeps, and a restart neither loses nor repeats a retry. `expirationMs` bounds the sum of those delays. With no policy, a typed failure is recorded and returned, not retried.

A task may cache its successful result: `cache: { ttlMs?, scope? }`, Smithers' `Action.withCache`. An equal call within the scope returns the stored result without running the handler. Calls are equal when their payloads have the same identity, or their `idempotencyKey` values when the task sets one, under the same `implementationVersion`.

| `scope` | Reuses a result |
| --- | --- |
| `"run"`, the default | within one run |
| `"flow"` | across runs of the same workflow |
| `"shared"` | across every workflow on the store |

Reuse across runs is opt-in: `"flow"` and `"shared"` need an `implementationVersion`, so a result is never served to different code, and declaring one without it throws. Only a `"sealed"` task may cache, because a cache hit skips the handler and its outside effects. An entry may expire after `ttlMs`. A run's committed result never depends on an entry: the hit is journaled as the step's result, and a finished run answers from its journal.

Effect's `DurableClock.sleep` and `DurableDeferred` work inside these workflows. A sleep longer than its `inMemoryThreshold`, a minute by default, journals `ClockScheduled` with the time it is due, so a run killed while it sleeps and executed again waits only for what is left. A shorter sleep is an ordinary step, and a crash repeats it whole. A run waiting on a clock or a deferred resumes only when something executes or resumes it.

`Experimental.Durable.history(run)` is the run's journal as a `Stream` of `{ run, seq, eventType, payload, at }`, read through the `Experimental.Durable.Durable` service the engine layers provide. A run's id is Effect's execution id, `Order.executionId(payload)`.

### Runs and time travel

A run's handle is a value over its id: `Experimental.Durable.run(W, id)` gives `result`, which waits for the run and resumes it if it stopped, `poll`, `cancel` and `resume`. `Experimental.Durable.spawn(W, payload)` starts or joins the run equal input names and returns its handle at once. `Experimental.Durable.start(W, payload)` always starts a new run, for work that must happen again. `Experimental.Durable.runs({ status?, workflow? })` streams the stored runs, oldest first, in the same order from every store.

A position is `{ run, seq }`: a run and a sequence number in its journal.

| Call | Meaning |
| --- | --- |
| `Experimental.Durable.replay(at, { initial, reduce })` | Folds the journal through `at`. Runs nothing and needs no workflow registered. |
| `Experimental.Durable.fork(at)` | A new run that reuses every step finished before `at`; run it with `Experimental.Durable.run(W, copy.run).result`. The original is unchanged. |
| `Experimental.Durable.rewind(at)` | Truncates the run to the entries before `at` and leaves it suspended; the next execution runs the removed steps again. |
| `Experimental.Durable.sweep({ olderThan })` | Deletes finished runs older than `olderThan`, and expired cache entries. Nothing is deleted on a schedule the program did not set. |

The std-durable VIP's example reads a run's events and forks it:

```vibe
export effect function forkAt(run: string, seq: number) {
  const events = try Stream.runCollect(Stream.map(Experimental.Durable.history(run), (entry) => entry.eventType))
  const copy = try Experimental.Durable.fork({ run, seq })
  return { events, copy }
}
```

`fork`, `rewind` and `replay` fail with `Experimental.Durable.TimeTravelError`, whose `code` is one of Smithers' twelve. This engine raises `not_found` for an unknown run, `invalid` for a position outside the journal, `busy` when this engine is running the run, `irreversible` when a rewind would remove an irreversible task's step, because no engine can unsend an email, and `compensation_failed` when it would remove a compensable one, because undoing a step is not built yet. A rewind claims the run, so another engine still driving it dies with `FenceLost` at its next write. Note that `fork` is a reserved word in Effect code: name the result `copy`, as above.

## Evals and scorers

A test asserts that an answer equals something. A model's answer rarely equals anything; it is better or worse than the last one. `Experimental.Eval` runs a fixed set of cases against a target, `Experimental.Scorer` grades each answer from 0 to 1, and a gate compares the scores with a committed baseline and returns an exit code. Both modules are pure: no layer, no platform. They port Smithers' `@smthrs/evals` and `@smthrs/scorers`, and a baseline is the same versioned JSON (VIP-69).

```text
 cases ──► target ──► output ──► scorers ──► scores in [0, 1] ──► compare with baseline ──► gate
                                  │ exact, contains, checks                │ regressed?       │ 0  pass
                                  │ yours: Scorer.make                     │ moved? missing?  │ 1  failed
                                                                                              │ 5  could not decide
```

```vibe
// run: try Console.log(try nightly())
effect function greet(name: string) {
  return `Hello, ${name}`
}

const polite = Experimental.Scorer.make({
  name: "polite",
  version: "1",
  score: (run: { output: string; expected: string }) => run.output === run.expected ? 1 : 0
})

export const greeting = Experimental.Eval.suite("greet", {
  target: greet,
  cases: [{ name: "ada", input: ["Ada"], expected: "Hello, Ada" }],
  scorers: [polite],
  gate: { min: 1, tolerance: 0 }
})

export effect function nightly() {
  const run = try Experimental.Eval.run(greeting)
  const committed = Experimental.Eval.write(try Experimental.Eval.baseline(run))
  const report = try Experimental.Eval.compare(try Experimental.Eval.load(committed), run)
  return Experimental.Eval.gate(report, greeting.gate).summary
}
// Output: passed
```

A case's `input` is the array of the target's arguments, typed from the target, and `expected` is what a scorer compares with. A scorer grades `{ input, output, expected }`; a case with no `expected` passes `undefined`.

| Call | Meaning |
| --- | --- |
| `Experimental.Eval.suite(name, { target, cases, scorers, trials?, concurrency?, gate? })` | Declares a suite. Runs nothing and never throws. |
| `Experimental.Eval.run(suite, { runId?, trials?, k? })` | Runs every case `trials` times and grades every answer with every scorer. Fails with `invalid_suite`, naming the field, before running anything if the suite is malformed. |
| `Experimental.Eval.baseline(run)` | A baseline from the run's successful scores. |
| `Experimental.Eval.write(baseline)`, `Experimental.Eval.load(text)` | A baseline as text to commit, one record per line, and back. `load` also reads Smithers' baselines. |
| `Experimental.Eval.compare(baseline, run, { absolute?, relative? }?)` | Regressions, nondeterminism and missing scores, as a value. |
| `Experimental.Eval.gate(report, { mean?, min?, perCase?, tolerance? })` | A pure function from a report to `{ verdict, exitCode, summary }`. |
| `Experimental.Eval.fromJsonLines(text, { name, target, scorers, … })` | A suite whose cases are JSON Lines, one `{ "name", "input", "expected"? }` per line. |
| `Experimental.Eval.passAtK(n, c, k)` | The chance at least one of `k` trials passes, from `c` passes in `n`; `NaN` for impossible counts. |

A suite holds at most 10,000 cases and runs at most 1,024 at once (`Experimental.Eval.limits`). Trials run one after another, and a case's scorers run one after another, so at most `concurrency` targets or scorers run at once; a trial passes when its target succeeded and every scorer gave 1, and each case reports `passAt1`, `passAtK` and `passHatK`.

The outcomes stay distinct all the way to the exit code:

| Outcome | What it is | Exit |
| --- | --- | --- |
| Regression | A score dropped and the target gave a different answer: the output's hash, its step key, changed | `1` |
| Nondeterminism | A score moved and the answer did not: the same output graded differently twice | `1` |
| Missing | A score on one side only, such as a new case, or a scorer whose version changed. A scorer that could not decide is inconclusive, not missing | `1` |
| Failed target | The target failed or died; the case has no scores, and the run continues | `1` |
| Inconclusive | A scorer failed or returned something other than a finite number in `[0, 1]`; it records a code and a reason, never a score of zero | `5` |

A gate exits `0` only when every case cleared it, `1` when anything above failed or a score fell below `min`, `mean` or a `perCase` threshold, and `5` when it could not decide: an inconclusive scorer, no scores at all, or an invalid threshold. A `5` is a broken harness, not a result. `tolerance` ignores a move no larger than it, which a model-graded score needs.

A baseline never updates itself. `Experimental.Eval.baseline` records scores only, and writing the file is a separate act with a diff to review.

### Scorers

| Scorer | Grades |
| --- | --- |
| `Experimental.Scorer.exact` | Equality with `expected`: text after trimming and collapsing whitespace, any other value by its canonical JSON |
| `Experimental.Scorer.contains(text?)` | Whether the output text contains `text`, or the case's `expected` text |
| `Experimental.Scorer.checks([...])` | The fraction of text checks that pass |
| `Experimental.Scorer.rubric(criteria, { model, layer })` | A model judge scores written criteria from 1 to 5 |
| `Experimental.Scorer.make({ name, version, config?, score })` | Your function from the run record to a number, `{ score, reason?, meta? }`, or an Effect of either |

A scorer has an identity. Its name, version and `config` hash into a `scorerKey`, SHA-256 of their canonical JSON, which every observation carries, so a score recorded a month ago still names the exact grader. Change what a scorer does, bump its `version`. Declaring a scorer never throws: a blank name or version, or a `config` that is not plain JSON, such as one holding a function or a `Date`, is kept as `scorer.problem`, and `run` refuses a suite that uses it. Two scorers with one identity in a suite are refused too.

A scorer's Effect may need services, such as a model it asks. The suite's requirements are its target's and its scorers', and a scorer whose service fails is inconclusive.

Each check of `Experimental.Scorer.checks` is plain data, so the list is the scorer's configuration and part of its identity:

| Check | Passes when |
| --- | --- |
| `{ includes: [...] }` | every entry appears. An entry is a case-insensitive whole word or phrase, a stem such as `"refund*"`, or a regular expression written `"/source/flags"`; an array entry passes when any member appears |
| `{ excludes: [...] }` | no entry appears, matched the same way |
| `{ words: { min?, max? } }` | the word count is within the bounds; a link counts as its label's words |
| `{ excludesOpener: [...] }` | the text does not open with one of the phrases |
| `{ complete: true }` | no unclosed code fence and no ellipsis cuts the text off |

### Model judges

`Experimental.Scorer.rubric(criteria, { model, layer, examples?, rule?, instructions? })` asks a model, the judge, to score an answer against written criteria. Each criterion is a question the judge answers with an integer from 1 (`low`) to 5 (`high`). The score is the mean mapped onto `[0, 1]`, and `meta` holds each criterion's score, `pass` under the rule (default: every criterion at least 3 and their mean at least 3.8), and the judge's seat.

`model` is the judge's seat, such as `"anthropic:claude-sonnet-5-5"`, and is part of the scorer's identity, so a different judge is a different scorer. `layer` is the Effect `LanguageModel` that answers for that seat: a provider's layer in production, a scripted model in a test. Nothing defaults to the model under test, which would grade itself.

```vibe
// run: try Console.log(try judged())
import * as LanguageModel from "effect/ai/LanguageModel"

// A scripted judge stands in for a provider in this example.
const judge = Layer.effect(LanguageModel.LanguageModel, LanguageModel.make({
  generateText: () => Effect.succeed([{ type: "text", text: "{\"scores\": {\"polite\": 5}, \"reason\": \"Kind.\"}" }] as any),
  streamText: () => Stream.empty,
}))

const polite = Experimental.Scorer.rubric(
  [{ id: "polite", question: "Is the reply polite?", low: "rude", high: "courteous" }],
  { model: "anthropic:claude-sonnet-5-5", layer: judge }
)

export effect function judged() {
  const result = try polite.score({ input: "Greet Ada", output: "Hello, Ada" })
  return result.score
}
// Output: 1
```

The judge reads the case input as context: a suite's single argument, or the arguments as JSON, or `{ context, focus }` when the input is one, and everything it reads is fenced as data it must not follow. A judge that cannot be reached, or whose reply holds no integer score for every criterion, is inconclusive: the observation records why, and the gate exits `5`. Model scores move, so give a suite with a rubric a gate `tolerance`.

In a test, the judge is `Experimental.Test.replay(recorded)` from [Testing agentic programs](#testing-agentic-programs): it answers from a recording and never calls a provider. A recorded rubric call holds both of the judge's messages, the instructions and the fenced answer, so make the recording with `Experimental.Test.record` rather than by hand. Pass the replay as `layer` and also provide it around the runs. The enclosing `provide` builds it once, so each recorded verdict is claimed once and `Experimental.Test.unconsumed` sees what is left. Without it, each score builds its own copy of the layer, as Effect's `provide` does for sibling calls, and every score replays from the first recording.

```vibe
const criteria = [{ id: "polite", question: "Is the reply polite?", low: "rude", high: "courteous" }]

effect function greet(name: string) {
  return `Hello, ${name}`
}

export effect function gradeWith(recorded: Experimental.Test.Fixture) {
  const judge = Experimental.Test.replay(recorded)
  const suite = Experimental.Eval.suite("politeness", {
    target: greet,
    cases: [{ name: "ada", input: ["Ada"] }],
    scorers: [Experimental.Scorer.rubric(criteria, { model: "anthropic:claude-sonnet-5-5", layer: judge })],
  })
  provide judge {
    const run = try Experimental.Eval.run(suite)
    const unused = try Experimental.Test.unconsumed
    return { scores: run.observations, unused: unused.length }
  }
}
```

A recorded `failure`, such as a rate limit, makes that score inconclusive, so a test can check that a judge outage makes the gate exit `5`.


`Experimental.Scorer.calibrate(scorer, labelled)` measures a judge before you trust it: it grades answers whose verdict is known, `{ input?, output, verdict: "pass" | "fail" }`, and returns how often the judge agreed, with true and false passes and fails and the inconclusive count.

### Decision-model judges

`Experimental.Scorer.decide(decision, { model, layer, pass? })` grades with one typed decision on Effect's `DecisionModel` instead of a prompt and a parsed reply. The decision is Effect's own `Decision.probability`, `Decision.rate` or `Decision.classify`, and Effect validates the judge's answer against it.

| Decision | Score | `meta` |
| --- | --- | --- |
| `Decision.probability` | the probability | `probability` |
| `Decision.rate` | the rating, from 0 at the lowest level to 1 at the highest | `label`, `rating`, `probabilities` |
| `Decision.classify` with `pass` | the probability of the labels in `pass` | `label`, `probabilities`, and `pass`, whether the chosen label is in `pass` |

Every `meta` also holds `judge`, the seat. A classify decision needs `pass`, the labels that pass, and at least one label must fail; the other decisions refuse `pass`. As with `rubric`, `model` names the judge's seat, `layer` is the Effect `DecisionModel` that answers for it, and the seat, the decision and `pass` are the scorer's identity.

```vibe
// run: try Console.log(try decided())
// A scripted judge stands in for a provider in this example.
const judge = Layer.effect(DecisionModel.DecisionModel, DecisionModel.make({
  decide: () => Effect.succeed({
    answers: { verdict: { _tag: "Probability", probability: 0.75 } },
    usage: { inputTokens: undefined, outputTokens: undefined },
  } as any),
}))

const greets = Experimental.Scorer.decide(
  Decision.probability({ instructions: "Does the output greet the person named in the context?" }),
  { model: "openai:gpt-6", layer: judge }
)

export effect function decided() {
  const result = try greets.score({ input: "Ada", output: "Hello, Ada" })
  return result.score
}
// Output: 0.75
```

The judge reads `{ context, focus?, output }`: the case input as context, read as `rubric` reads it, and the output as text. The decision is named `verdict`. A judge that cannot be reached, refuses, or gives an answer Effect does not accept, such as a probability outside `[0, 1]` or probabilities that do not sum to 1, is inconclusive, and the gate exits `5`. A locate decision has no score and is refused.

In a test, the judge is `Experimental.Test.decisions(recorded)` from [Testing agentic programs](#testing-agentic-programs). Each recorded call's `request.state` is what the judge reads, such as `{ "context": "Ada", "output": "Hello, Ada" }`, and its `response.answers.verdict` is the answer. As with `rubric`, pass it as `layer` and also provide it around the runs.

### Scoring live runs

`Experimental.Scorer.bind(scorer, W, { sampling })` scores the live runs of a durable workflow `W`. It is a layer over the `WorkflowEngine`: when a run of `W` finishes with a result, the scorer grades `{ input: payload, output: result }`, and the score store keeps the observation under the run's execution id. A run executed again, joined or resumed records its score once. A run that fails is not scored.

```vibe
// run: try Console.log(try scoredRuns())
const Double = Experimental.Durable.workflow("docs#Double", { payload: { n: Schema.Number }, success: Schema.Number })

const doubled = Experimental.Scorer.make({
  name: "doubled",
  version: "1",
  score: (run: { input: { readonly n: number }; output: number }) => run.output === run.input.n * 2 ? 1 : 0
})

const DoubleLive = Double.toLayer(({ n }) => Effect.succeed(n * 2)).pipe(
  Layer.provide(Experimental.Scorer.bind(doubled, Double, { sampling: "all" })),
  Layer.provideMerge(Experimental.Durable.memory),
  Layer.provideMerge(Experimental.Scorer.memory)
)

export effect function scoredRuns() {
  provide DoubleLive {
    try Double.execute({ n: 2 })
    try Double.execute({ n: 2 })
    const store = try Experimental.Scorer.ScoreStore
    return (try store.aggregate()).count
  }
}
// Output: 1
```

| `sampling` | Scores |
| --- | --- |
| `"all"`, the default | every run |
| `"none"` | no run |
| `{ ratio, seed }`, `0 < ratio < 1` | the runs whose hash of run id, `scorerKey` and `seed` falls below `ratio`. The choice depends on nothing else, so a replay samples the same runs; `Experimental.Scorer.sampled(sampling, run, scorerKey)` answers it |

Scoring never changes a run's result. A scorer that fails, interrupts itself or runs past `timeout` (default one minute) records an inconclusive observation, and a store that fails logs a warning. The score is taken when the run finishes, so the scorer's time adds to the run's, at most `timeout`. A scorer with no stable identity, or an invalid sampling policy, fails the layer with a `ScorerError` when it is built.

Pick the store with one layer: `Experimental.Scorer.memory` keeps scores in this process; `Experimental.Scorer.layerSql` keeps them in a SQL database through the `SqlClient` the program provides, as `Experimental.Durable.layerSql` does, and creates the table `score_observations` if it is missing. The `Experimental.Scorer.ScoreStore` service reads them: `observations({ workflow?, run?, scorer? })`, oldest first, `aggregate(filter)` for the count, mean, minimum and inconclusive count, and `prune({ olderThan })`, which deletes older observations and answers how many. Nothing else deletes them.

## Testing agentic programs

A test of an agentic program needs a model that holds still. `Experimental.Test` (VIP-71) adds doubles for what Effect has none of, each a layer the test provides in place of the production one. Tests stay `@effect/vitest` tests, and Effect's `TestClock` and `TestConsole` stay as they are.

`Experimental.Test.replay(fixture)` is a `LanguageModel` that answers from a recording and never calls a provider, so a test runs with no key and no network. A program asks through whatever `LanguageModel` is in scope, so the test changes no line of it:

```vibe
// run: try Console.log(try labelCrash())
schema Label { type: "bug" | "feature" | "question" | "chore" }

const recorded = {
  calls: [{
    request: { prompt: "Label this issue: Crash on start" },
    response: [{ type: "text", text: `{"type":"bug"}` }]
  }]
}

effect function label(title: string) {
  const reply = try LanguageModel.generateObject({ prompt: `Label this issue: ${title}`, schema: Label })
  return reply.value
}

export effect function labelCrash() {
  provide Experimental.Test.replay(recorded) {
    const result = try label("Crash on start")
    return result.type
  }
}
// Output: bug
```

A fixture is JSON, usually a file beside the test imported with `import recorded from "./fixtures/label.json" with { type: "json" }`. Each entry of `calls` is one model call:

| Field | Holds |
| --- | --- |
| `request.prompt` | the prompt, as `Prompt.make` accepts it: a string, or messages in their encoded form |
| `request.tools`, `request.responseFormat`, `request.toolChoice` | compared only when present: the tools' names, descriptions and JSON Schema parameters, the response format with its JSON Schema, and the tool choice |
| `response` | the encoded response parts `generateText` and `generateObject` decode, such as `{ "type": "text", "text": "..." }` or a `tool-call` |
| `stream` | the encoded stream parts `streamText` decodes, such as `text-delta` |
| `failure` | an encoded `AiError` the call fails with, such as a recorded rate limit |

Replay keeps these rules:

| Rule | Consequence |
| --- | --- |
| Each recorded call is claimed once | Two equal requests need two recordings. Concurrent requests never share one. |
| A request no unclaimed recording matches is a defect | The fiber dies with `Experimental.Test.UnrecordedCall`, which names the method, the message count, the tools and the end of the last message. A missing recording is a failed test, never a network call. |
| Matching never reads a model id | A recording made with one model replays under another, so a test does not break when the model changes. |
| A malformed fixture is a defect | Building the layer dies with `Experimental.Test.InvalidFixture`. |

The layer also provides `Experimental.Test.Recording`. `try Experimental.Test.unconsumed` is the list of recorded calls the run has not used, for a test that must use its whole recording.

`Experimental.Test.record(path, { live })` makes a recording. It replays the file at `path` as `replay` does, claiming each recorded call once; a request the file does not answer goes to the `live` model, such as a provider's layer, and the answer is appended to the file before the caller sees it. Recording and replaying are two calls, so a deleted fixture never turns a free test run into a paid one: switch a test to `record` to refresh its fixture, then back to `replay`.

```vibe
import { NodeFileSystem } from "@effect/platform-node"

export effect function labelLive(seat: Layer.Layer<LanguageModel.LanguageModel>) {
  provide Experimental.Test.record("fixtures/label.json", { live: seat }).pipe(Layer.provide(NodeFileSystem.layer)) {
    return try LanguageModel.generateText({ prompt: "Label this issue: Crash on start" })
  }
}
```

| What `record` writes | Why |
| --- | --- |
| A finished call: the request as the provider received it, and its encoded `response` or `stream` parts | the file replays under `replay` with no live model |
| A typed `AiError` the provider answered with, as `failure` | it replays as the same failure |
| Nothing for an interrupted call or a defect | a truncated stream would replay as an aborted turn |
| Nothing for a call that holds a credential | the call dies with `Experimental.Test.CredentialInRecording`, naming the rule that matched, such as `api-key` or `jwt` |

`record` builds the `live` layer at the first miss, so a test whose recording answers every request runs with no key. Each append rewrites the file through a temporary file and a rename, so a crash leaves the old recording or the new one. A relative `path` resolves from the working directory, as Effect's `FileSystem` resolves it, and `record` needs a `FileSystem` layer such as `NodeFileSystem.layer`.

`Experimental.Test.decisions(fixture)` is the same double for Effect's `DecisionModel`. Each recorded call holds the `request` a provider received, its encoded input as `state`, and the provider's `response`, its `answers` by decision name; `request.decisions` is compared only when present. Effect validates each recorded answer against the program's decision definition as it would a provider's, so a `Classify` answer carries its `probabilities`, a label the definition does not have is `Invalid`, and a `Refusal` is refused. Each recording is claimed once, and a request none matches dies with `Experimental.Test.UnrecordedDecision`.

```vibe
const recorded = {
  calls: [{
    request: { state: { title: "Crash on start" } },
    response: { answers: { kind: { _tag: "Classify", label: "bug", probabilities: { bug: 0.9, feature: 0.1 } } } }
  }]
}

const Triage = Decision.make({
  input: Schema.Struct({ title: Schema.String }),
  decisions: { kind: Decision.classify({ instructions: "What kind of issue is this?", criteria: { bug: null, feature: null } }) }
})

export effect function triageCrash() {
  provide Experimental.Test.decisions(recorded) {
    const response = try DecisionModel.decide(Triage, { input: { title: "Crash on start" } })
    return response.answers.kind.label
  }
}
```

### A model in another process

A layer replaces a model only inside one process. A program under test that reaches its model over HTTP, such as a coding agent run as a child process, needs a server. `Experimental.Test.modelServer({ fixture })` answers Chat Completions requests, `POST /v1/chat/completions`, from a recording: point the program's OpenAI-compatible base URL at it.

```vibe
import { ExperimentalNodeHttpServer } from "vibelang-runtime/experimental/platform-node"

const recorded = { calls: [{ request: { prompt: "hello" }, response: [{ type: "text", text: "hi there" }] }] }

export effect function withModelServer() {
  provide Experimental.Test.modelServer({ fixture: recorded }).pipe(Layer.provideMerge(ExperimentalNodeHttpServer.layer({ port: 0 }))) {
    const server = try HttpServer.HttpServer
    return "port" in server.address ? `http://127.0.0.1:${server.address.port}/v1` : ""
  }
}
```

The server reads a request's messages as the prompt Effect's `LanguageModel` sends a provider, so a recording made in-process with `Experimental.Test.record` replays over HTTP, and a hand-written one names its prompt as text. It matches tools, the response format and the tool choice as `replay` does, never the model, and claims each recording once. It answers a `chat.completion`, or `chat.completion.chunk` server-sent events when the request streams. A request it does not hold is answered `501` with an error of type `unrecorded`; a recorded `AiError` is answered with its status, such as `429` for a rate limit.

### A machine of fixed files and commands

`Experimental.Test.host({ files, commands })` provides Effect's `FileSystem`, `Path` and `ChildProcessSpawner` for a machine described in the test: the files that exist, by path, and what each command prints. Nothing reaches the operating system, so the test runs the same on every machine.

```vibe
// run: try Console.log(try changedFiles())
const machine = Experimental.Test.host({
  files: { "/repo/package.json": `{"name":"demo"}` },
  commands: { "git status --short": { stdout: " M src/a.ts\n M src/b.ts\n" } }
})

export effect function changedFiles() {
  provide machine {
    const fs = try FileSystem.FileSystem
    const spawner = try ChildProcessSpawner.ChildProcessSpawner
    const manifest = try fs.readFileString("/repo/package.json")
    const status = try spawner.lines(ChildProcess.make("git", ["status", "--short"]))
    return `${manifest}: ${status.length} changed`
  }
}
// Output: {"name":"demo"}: 2 changed
```

| Part | Behavior |
| --- | --- |
| `files` | Each file exists with its text, and so do its parent directories. Paths are POSIX; a relative path starts at `/`. |
| File system members | Reading, writing, appending, `makeDirectory`, `readDirectory`, `stat`, `remove`, `rename` and `copyFile` behave as on Node, failures included: a path below a file fails with `BadResource`, as `ENOTDIR` does. Other members fail with `NotFound`, as Effect's `FileSystem.makeNoop` does. File times are fixed. |
| `commands` | Keyed by command line, the command and its arguments joined by spaces. Each gives `stdout`, `stderr` and `exitCode`, all optional. |
| An unscripted command | Fails to spawn with a `NotFound` `PlatformError`, as a missing binary does. A piped command fails with `BadArgument`; script each command on its own. |

Each build of the layer starts from its options again.

### Crash tests for durable workflows

`Experimental.Test.durable` is a journaled engine over a fresh in-memory store, `Experimental.Durable.memory` under a test's name. Under `it.effect` its clock is Effect's `TestClock`. It proves what a workflow runs and journals, never that a run recovers: an engine that is never restarted never replays.

`Experimental.Test.restartable` is the engine a crash test uses. Provide it where the program provides its engine. `try Experimental.Test.crash` kills the engine the way a killed process stops: every run it was driving stops at once, and a fresh engine starts over the same store with the program's workflows registered again. The next execution of a stopped run resumes it. A step that finished before the crash returns its recorded result, and a step that had not finished runs again.

```vibe
// run: try Console.log(try crashMidStep())
const done: Array<string> = []
const reached = Deferred.makeUnsafe<void>()
const blocked = { step: 2 }

const Step = Experimental.Durable.task("docs#Step", { payload: { n: Schema.Number }, success: Schema.Number })
const Steps = Experimental.Durable.workflow("docs#Steps", { payload: { count: Schema.Number }, success: Schema.Number })

const perform = (n: number) => {
  if (blocked.step !== n) {
    return Effect.sync(() => void done.push(`step ${n}`))
  }
  blocked.step = 0
  return Effect.andThen(Deferred.succeed(reached, undefined), Effect.never)
}

const StepsLive = Steps.toLayer(effect ({ count }) => {
  let total = 0
  for (let n = 1; n <= count; n++) {
    total += try Step({ n })
  }
  return total
}).pipe(
  Layer.provide(Step.toLayer(({ n }) => Effect.as(perform(n), n))),
  Layer.provideMerge(Experimental.Test.restartable)
)

export effect function crashMidStep() {
  provide StepsLive {
    const first = try Effect.forkChild(Steps.execute({ count: 3 }))
    try Deferred.await(reached)
    try Experimental.Test.crash
    const total = try Steps.execute({ count: 3 })
    try Fiber.interrupt(first)
    return `${total}: ${done.join(", ")}`
  }
}
// Output: 6: step 1, step 2, step 3
```

Step 2 blocks before its effect, so the crash interrupts it unfinished. Step 1 is not repeated after the crash; step 2 runs again on the fresh engine.

### Assertions over a run's journal

`try Experimental.Test.journal(run)` reads a run's journal through the engine and returns it as a value: `steps`, each with its journal name (`step`, such as `"shop#Charge/1"`), its task key (`task`), `attempts`, `starts` and `outcome`, in the order they first started, and the run's `status`. Its assertions are Effects that fail with `Experimental.Test.JournalMismatch`, so they run under any runner:

| Assertion | Holds when |
| --- | --- |
| `journal.executed(step)` | a step named `step` finished successfully |
| `journal.executedInOrder(steps)` | the named steps started in this relative order; other steps may come between |
| `journal.attempts(step, n)` | the named steps were started with `n` retry attempts in all |
| `journal.terminal(status)` | the run's status is `status`: `"running"`, `"suspended"`, `"succeeded"`, `"failed"` or `"interrupted"` |

A step name matches by its journal name or by its task key, which matches every occurrence. `attempts` counts retries; `starts` counts every time the step started, so a step that ran again after `Experimental.Test.crash` has two starts and one attempt.

```vibe
export effect function checkOrder(run: string) {
  const journal = try Experimental.Test.journal(run)
  try journal.executedInOrder(["shop#Reserve", "shop#Charge"])
  try journal.attempts("shop#Charge", 1)
  try journal.terminal("succeeded")
}
```

`try Experimental.Test.divergence(runA, runB)` is the first difference between two runs' journals, `Option.none()` when they record the same events: the position `seq`, counted from 1, the `field` that differs (`"entry"` when one journal is shorter, `"eventType"` or `"payload"`), and the two values. Entry times and run ids are not compared.

### Certifying an engine

`Experimental.Test.conformance.engine()` is nine black-box cases a fork runs to show its workflow engine behaves like the standard one. A case is a value, `{ name, run }`, and `run(subject)` is an Effect that fails with `Experimental.Test.ConformanceViolation`, so the cases run under any runner. The subject is an Effect that allocates fresh storage and returns the engine's `WorkflowEngine` layer over it; each build of that layer is one engine process, which a case kills by closing its scope before it starts another over the same storage. The cases observe only Effect's `WorkflowEngine` API, how often each activity ran, and each run's result.

| Case | The engine must |
| --- | --- |
| `identity/distinct` | run different payloads as different runs |
| `identity/idempotent` | join an equal payload to its run instead of starting another |
| `identity/activity-name` | identify an activity by its name within a run, so a second activity of that name returns the recorded result |
| `interrupt/in-flight` | end a run aborted in flight as interrupted, interrupt the activity running, and start nothing after it |
| `replay/completed-prefix` | after a restart, serve finished activities and run the unfinished one again |
| `replay/suspended-frontier` | after a restart, resume a run suspended on a durable deferred at that deferred |
| `race/loser-interrupted` | interrupt a race's losing activity once the winner finishes |
| `race/recorded-winner` | after a restart, take the race's recorded winner rather than race again |
| `race/recorded-loser` | after a restart, leave the recorded loser lost |

```vibe
const subject = Effect.sync(() => Experimental.Durable.layerStore(Experimental.Durable.makeMemoryStore()))

export effect function certify() {
  for (const conformanceCase of Experimental.Test.conformance.engine()) {
    try conformanceCase.run(subject)
  }
}
```

`Experimental.Durable` passes all nine over a memory store and over SQLite. Effect's `WorkflowEngine.layerMemory` keeps runs in one process's memory, so it passes the five cases that run in one process and fails the four that restart it. A promise these cases do not test, such as signal delivery, needs its own case before a fork may claim it.

## Memory

A model's context is gone when its process exits, and a durable run's journal records only what that run did. `Experimental.Memory` keeps what a later run should still know: facts a program writes now and recalls in a later run, ranked by a query and cut to a byte budget so the answer fits in a prompt. It ports `@smthrs/memory`.

```vibe
export effect function notes() {
  provide Experimental.Memory.test {
    try Experimental.Memory.remember({ bank: "global-notes", key: "release", text: "cut 0.1.0" })
    return try Experimental.Memory.recall({ banks: ["global-notes"], query: "release" })
  }
}
```

A fact lives in a bank, the public spelling of a namespace: `kind-id`, where the kind is `flow`, `agent`, `user` or `global`, as in `global-notes` or `agent-reviewer`. A bank with no kind prefix is a `flow` bank, so `notes` and `flow-notes` are one bank. `Experimental.Memory.namespaceOf(bank)` and `bankOf(namespace)` convert between the two spellings.

| Call | Does |
| --- | --- |
| `Experimental.Memory.remember({ bank, key, text })` | Writes `text` under `key` in `bank`, replacing what that key held. Returns `{ key }`. |
| `Experimental.Memory.recall({ banks, query, maxBytes? })` | Returns the rows of `banks` that match `query` as `{ bank, key, text, score, updatedAtMs }`, best first, cut to `maxBytes`. A bank named twice is read once. |

A note is never edited. `Experimental.Memory.note(bank, text, { id?, supersedes? })` appends one and returns `{ id }`; a correction is a new note that names the notes it replaces in `supersedes`, an id or an array of ids, and a superseded note drops out of recall. Recall returns a note as a row whose key is its id. Writing a note again with the same `id`, bank, text and `supersedes` does nothing, so a retried write is safe; without an `id`, each call appends a new note.

```vibe
export effect function correct() {
  try Experimental.Memory.note("agent-ci", "tests take 4 minutes", { id: "n1" })
  try Experimental.Memory.note("agent-ci", "tests take 9 minutes", { id: "n2", supersedes: "n1" })
  return try Experimental.Memory.recall({ banks: ["agent-ci"], query: "minutes" })
}
```

`Experimental.Memory.thread(id)` is one conversation: `append({ id, role, text })` adds a message stamped with the current time, and `history({ limit? })` returns the newest `limit` messages, or all of them, oldest first, ordered by time and then by id. Appending a message with the same id, role and text again does nothing.

| Conflict | Code | Path |
| --- | --- | --- |
| A note id written again with another bank or text | `idempotency_conflict` | `["id"]` |
| A note id written again with other `supersedes` | `supersede_conflict` | `["supersedes"]` |
| A note that supersedes itself, or a note not in its bank | `supersede_conflict` | `["supersedes"]` |
| A message id appended again with another role or text | `idempotency_conflict` | `["role"]` or `["text"]` |

Recall ranks by keyword unless the layer says otherwise: a row scores one for each query word its key or text contains, and a row that matches no word is left out. Ties go to the newest update, then the key, then the bank, so the order never depends on the order the banks were named in.

Every recall has a byte budget, because recalled rows become part of a prompt. The answer is empty or, serialized as JSON, at most `maxBytes` UTF-8 bytes, 2,048 unless given. Rows are taken whole, best first, while they fit; the first row that does not fit is cut to the longest prefix of its text that does, and nothing after it is taken.

Recalled text is data. It grants no capability, and a fact a model wrote is an assertion, not an instruction.

Pick the store with one layer. `Experimental.Memory.test` keeps facts in a fresh store in this process. `Experimental.Memory.layerSql({ recall? })` keeps them in a SQL database through Effect's `SqlClient`: provide one of Effect's clients, such as `SqliteClient.layer({ filename })` from `@effect/sql-sqlite-node` or `@effect/sql-sqlite-bun`, or `PgClient.layer` from `@effect/sql-pg`, and a later run recalls what an earlier one remembered. Its tables are `@smthrs/memory`'s (`memory_facts`, `memory_notes`, `memory_note_supersedes`, `memory_threads` and `memory_messages`), created if missing, so a Smithers store and a VibeLang store read each other's rows. `Experimental.Memory.layerStore(store, { recall? })` runs over any `Experimental.Memory.Store`, which is how a host keeps memory in its own database; layers built over one store share its facts. `Experimental.Memory.makeMemoryStore()` makes a store in this process's memory, so a test can run one program, start another over the same store, and recall what the first remembered. `recall` replaces the ranking with any `Experimental.Memory.Recall`; `Experimental.Memory.keyword` is the default, and the byte budget applies to every ranking. There is no default store: a program that calls `remember` with none provided has a missing `Experimental.Memory.Memory` requirement.

Every failure is an `Experimental.Memory.MemoryError` with a stable `code` and, when an input field is at fault, its `path`. Input is checked before any read or write:

| Input | Code | Path |
| --- | --- | --- |
| An empty bank | `invalid_namespace` | `["bank"]`, or `["banks", "<index>"]` |
| A bank longer than 128 characters | `invalid_argument` | the bank's |
| An empty key, or one over 1,024 UTF-8 bytes | `invalid_argument` | `["key"]` |
| An empty note id, superseded id, thread id, message id or role, or one over 1,024 UTF-8 bytes | `invalid_argument` | `["id"]`, `["supersedes", "<index>"]`, `["thread"]` or `["role"]` |
| A history `limit` that is not a non-negative integer | `invalid_argument` | `["limit"]` |
| A fact's or a note's text, or a query, over 16,384 UTF-8 bytes | `invalid_argument` | `["text"]` or `["query"]` |
| More than 16 banks in one recall | `invalid_argument` | `["banks"]` |
| A `maxBytes` that is not an integer from 0 to 65,536 | `invalid_argument` | `["maxBytes"]` |

A store reports its own failures, such as a SQL error, with the code `store`. Nothing is deleted unless the program asks.
