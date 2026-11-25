# Platform globals

Use Effect services or a TypeScript boundary for Node.js and browser I/O. Ordinary ECMAScript built-ins and pure web helpers such as `URL` and `TextEncoder` are available in `.vibe`. See [the platform specification](../../../design/src/005-services.md#the-platform-standard-library) for the treatment of type-only imports, aliases, and host methods such as `AbortSignal.timeout`.

## Replacements

The table below matches the compiler's `EK4402` advice: Effect APIs first, then VibeLang's experimental services, then an escape to TypeScript. In effect code, obtain services with `try` before calling members (e.g. `try (try FileSystem.FileSystem).readFileString(path)`), and run returned Effects with an outer `try` (`Console` needs no layer; `Stream`/`Sink` builders like `FileSystem.stream` stay values; `Socket.makeWebSocket(url)` needs `NodeSocket.layerWebSocketConstructor` or `BrowserSocket.layerWebSocketConstructor`).

Key semantic differences to keep in mind:
- **Path & URLs:** Obtain `Path` with `try Path.Path`; `join`/`sep` are pure, while `fromFileUrl`/`toFileUrl` return Effects (run with `try` before `dirname`). Build a URL from `import.meta.url` with `try orDie(Effect.try(() => new URL(import.meta.url)))`.
- **Random integers:** `crypto.randomInt(min, max)` excludes `max`; pass `{ halfOpen: true }` to `SecureRandom.intBetween` to match that half-open range (keep native calls in `.ts` if you need Node's strict argument validation).
- **Hardware concurrency:** Read browser `navigator.hardwareConcurrency` in a `.ts` adapter; `try (try Experimental.Process.Process).availableParallelism` reports Node/Bun cores only.


| Global | Use instead |
| --- | --- |
| `BroadcastChannel` | escape to TypeScript for now: Effect has no service for messages between browser tabs; a Worker carries messages to a worker. |
| `Buffer` | `new TextEncoder().encode(text)` |
| `Buffer.alloc` | `new Uint8Array(size)` |
| `Buffer.byteLength` | `new TextEncoder().encode(text).length` |
| `Buffer.concat` | `new Uint8Array([...a, ...b])` |
| `Buffer.from` | `new TextEncoder().encode(text)` |
| `Bun` | escape to TypeScript for now: A runtime's own API belongs to its platform package's layers, such as @effect/platform-bun's, or to a .ts file. |
| `CSS` | `try (try Experimental.Document.Document).escapeSelector(value)` |
| `Deno` | escape to TypeScript for now: A runtime's own API belongs to its platform package's layers, such as @effect/platform-bun's, or to a .ts file. |
| `EventSource` | `try HttpClient.get(url)` |
| `AudioContext` | `try (try Experimental.AudioContext.AudioContext).acquire` |
| `FileReader` | `try (try Experimental.FileReader.FileReader).readAsText(blob)` |
| `HTMLElement` | `(try Experimental.Document.Document).isHTMLElement(value)` |
| `ResizeObserver` | `try (try Experimental.ResizeObserver.ResizeObserver).observe(element, onResize)` |
| `SharedWorker` | `effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner` |
| `WebSocket` | `try Socket.makeWebSocket(url)` |
| `Worker` | `effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner`. Bare `Worker` is Effect's `effect/workers` namespace, and `globalThis.Worker` is EK4402 |
| `XMLHttpRequest` | `try HttpClient.get(url)` |
| `__dirname` | `(try Path.Path).dirname(try (try Path.Path).fromFileUrl(try orDie(Effect.try(() => new URL(import.meta.url)))))` |
| `__filename` | `try (try Path.Path).fromFileUrl(try orDie(Effect.try(() => new URL(import.meta.url))))` |
| `addEventListener` | `Stream.fromEventListener(target, "message")` |
| `alert` | escape to TypeScript for now: Effect has no service for the browser's dialogs; a terminal program asks with `try (try Terminal.Terminal).readLine`. |
| `caches` | escape to TypeScript for now: Effect has no service for the browser's Cache Storage; KeyValueStore stores strings by key. |
| `cancelAnimationFrame` | `try (try Experimental.Animations.Animations).nextFrame` |
| `cancelIdleCallback` | escape to TypeScript for now: Effect has no service for the browser's idle callbacks; schedule work with Schedule, or call them in a .ts file. |
| `clearImmediate` | `try Fiber.interrupt(fiber)` |
| `clearInterval` | `try Fiber.interrupt(fiber)` |
| `clearTimeout` | `try Fiber.interrupt(fiber)` |
| `confirm` | escape to TypeScript for now: Effect has no service for the browser's dialogs; a terminal program asks with `try (try Terminal.Terminal).readLine`. |
| `console` | `try Console.log(message)` |
| `console.debug` | `try Console.debug(message)` |
| `console.error` | `try Console.error(message)` |
| `console.info` | `try Console.info(message)` |
| `console.log` | `try Console.log(message)` |
| `console.table` | `try Console.table(rows)` |
| `console.trace` | `try Console.trace(message)` |
| `console.warn` | `try Console.warn(message)` |
| `crossOriginIsolated` | `try (try Experimental.BrowserInfo.BrowserInfo).crossOriginIsolated` |
| `crypto` | `try (try SecureRandom.SecureRandom).randomBytes(size)` |
| `crypto.createCipheriv` | `try (try Aead.Aead).encrypt(aeadKey, plaintext, { nonce })` |
| `crypto.createDecipheriv` | `try (try Aead.Aead).decrypt(aeadKey, ciphertext, { nonce })` |
| `crypto.createHash` | `try (try Digest.Digest).digest(Digest.sha256, bytes)` |
| `crypto.createHmac` | `try (try Mac.Mac).sign(macKey, data)` |
| `crypto.createSign` | `try (try Signature.Signature).sign(privateKey, data)` |
| `crypto.createVerify` | `try (try Signature.Signature).verify(publicKey, signature, data)` |
| `crypto.generateKeyPair` | `try (try Signature.Signature).generateKeyPair(Signature.ed25519)` |
| `crypto.getRandomValues` | `try (try SecureRandom.SecureRandom).randomBytes(size)` |
| `crypto.hash` | `try (try Digest.Digest).digestHex(Digest.sha256, bytes)` |
| `crypto.randomBytes` | `try (try SecureRandom.SecureRandom).randomBytes(size)` |
| `crypto.randomInt` | `try (try SecureRandom.SecureRandom).intBetween(min, max, { halfOpen: true })` |
| `crypto.randomUUID` | `try (try SecureRandom.SecureRandom).uuidV4()` |
| `crypto.sign` | `try (try Signature.Signature).sign(privateKey, data)` |
| `crypto.subtle` | `try (try Mac.Mac).sign(macKey, data)` |
| `crypto.subtle.digest` | `try (try Digest.Digest).digest(Digest.sha256, bytes)` |
| `crypto.subtle.sign` | `try (try Signature.Signature).sign(privateKey, data)` |
| `crypto.subtle.verify` | `try (try Signature.Signature).verify(publicKey, signature, data)` |
| `crypto.verify` | `try (try Signature.Signature).verify(publicKey, signature, data)` |
| `crypto.webcrypto` | `try (try Mac.Mac).sign(macKey, data)` |
| `dispatchEvent` | `Stream.fromEventListener(target, "message")` |
| `document` | `try (try Experimental.Document.Document).current` |
| `document.addEventListener` | `BrowserStream.fromEventListenerDocument("visibilitychange")` |
| `exports` | `export const name = value` |
| `fetch` | `try HttpClient.get(url)` |
| `getComputedStyle` | `try (try Experimental.Window.Window).computedStyle(element)` |
| `global` | escape to TypeScript for now: Effect has no global-object service; keep access to the host global object in TypeScript. |
| `history` | escape to TypeScript for now: Effect has no service for the DOM; UI code belongs in a .ts or .tsx file, such as a React component's. |
| `importScripts` | `effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner` |
| `indexedDB` | `try (try KeyValueStore.KeyValueStore).get(key)` |
| `localStorage` | `try (try KeyValueStore.KeyValueStore).get(key)` |
| `location` | escape to TypeScript for now: Effect has no service for the DOM; UI code belongs in a .ts or .tsx file, such as a React component's. |
| `matchMedia` | `try (try Experimental.MediaQuery.MediaQuery).matches(query)` |
| `module` | `export const name = value` |
| `navigator` | escape to TypeScript for now: Effect has no service for the browser's navigator; navigator.clipboard, geolocation, permissions, and locks have services. |
| `navigator.clipboard` | `try (try Clipboard.Clipboard).readString` |
| `navigator.geolocation` | `try (try Geolocation.Geolocation).getCurrentPosition()` |
| `navigator.hardwareConcurrency` | escape to TypeScript for now: Effect has no browser hardware-concurrency service; read `navigator.hardwareConcurrency` in a `.ts` adapter. The `availableParallelism` member of the `Experimental.Process.Process` service reports a Node or Bun process and is not provided by the browser layer. |
| `navigator.locks` | `try (try Experimental.Locks.Locks).hold(name)` |
| `navigator.permissions` | `try (try Permissions.Permissions).query("geolocation")` |
| `navigator.userAgent` | `try (try Experimental.BrowserInfo.BrowserInfo).userAgent` |
| `performance` | `try Clock.currentTimeMillis` |
| `performance.now` | For elapsed intervals, subtract readings from the same clock: `Number((try Clock.monotonicTimeNanos) - startNanos) / 1e6`. The clock has an arbitrary origin; keep reads requiring the native origin in a `.ts` adapter. |
| `performance.timeOrigin` | `try (try Experimental.Process.Process).timeOrigin` |
| `postMessage` | Worker and WorkerRunner |
| `process` | `try Config.String("NAME")` |
| `process.arch` | `try (try Experimental.Process.Process).arch` |
| `process.argv` | `try (try Stdio.Stdio).args` for user arguments, matching `process.argv.slice(2)`; read the full array in a `.ts` adapter. |
| `process.cwd` | `(try Path.Path).resolve()` |
| `process.env` | `try Config.String("NAME")` |
| `process.execPath` | `try (try Experimental.Process.Process).execPath` |
| `process.exit` | return from main for exit 0; fail for exit 1; interruption exits 130 |
| `process.exitCode` | return from main for exit 0; fail for exit 1; interruption exits 130 |
| `process.getuid` | `try (try Experimental.Process.Process).currentUid`; absent is `undefined`, root is `0`, native errors stay typed failures |
| `process.hrtime` | `Duration.toHrTime(try Clock.monotonicTimeNanos)` |
| `process.hrtime.bigint` | `try Clock.monotonicTimeNanos` |
| `process.kill` | `try (try Experimental.Process.Process).kill(pid, { killSignal })` |
| `process.memoryUsage` | `try (try Experimental.Process.Process).memoryUsage` |
| `process.nextTick` | `try yieldNow` |
| `process.off` | escape to TypeScript for now: NodeRuntime.runMain handles SIGINT and SIGTERM, and (try Experimental.Process.Process).observeSignals(signals) tells a finalizer which arrived; Effect has no service for other process events. |
| `process.on` | escape to TypeScript for now: NodeRuntime.runMain handles SIGINT and SIGTERM, and (try Experimental.Process.Process).observeSignals(signals) tells a finalizer which arrived; Effect has no service for other process events. |
| `process.once` | escape to TypeScript for now: NodeRuntime.runMain handles SIGINT and SIGTERM, and (try Experimental.Process.Process).observeSignals(signals) tells a finalizer which arrived; Effect has no service for other process events. |
| `process.pid` | `try (try Experimental.Process.Process).pid` |
| `process.platform` | `try (try Experimental.Process.Process).platform` |
| `process.removeListener` | escape to TypeScript for now: NodeRuntime.runMain handles SIGINT and SIGTERM, and (try Experimental.Process.Process).observeSignals(signals) tells a finalizer which arrived; Effect has no service for other process events. |
| `process.stderr` | `try Console.error(text)` |
| `process.stdin` | `try (try Terminal.Terminal).readLine` |
| `process.stdout` | `try Console.log(text)` |
| `process.uptime` | escape to TypeScript for now: Clock reads the time, not the process's age: keep a `try Clock.monotonicTimeNanos` reading from the start. |
| `process.version` | `"v" + (try (try Experimental.Process.Process).versions).node` on Node; `versions` itself is a map of component versions. |
| `process.versions` | `try (try Experimental.Process.Process).versions` |
| `prompt` | escape to TypeScript for now: Effect has no service for the browser's dialogs; a terminal program asks with `try (try Terminal.Terminal).readLine`. |
| `queueMicrotask` | `try yieldNow` |
| `removeEventListener` | `Stream.fromEventListener(target, "message")` |
| `requestAnimationFrame` | `try (try Experimental.Animations.Animations).nextFrame` |
| `requestIdleCallback` | escape to TypeScript for now: Effect has no service for the browser's idle callbacks; schedule work with Schedule, or call them in a .ts file. |
| `require` | `import { name } from "./module.ts"` |
| `require.resolve` | `import.meta.resolve` with the host's `ImportMeta` declarations; its ordinary call contract still applies |
| `self` | escape to TypeScript for now: Effect has no global-object service; keep access to the host global object in TypeScript. |
| `sessionStorage` | `try (try KeyValueStore.KeyValueStore).get(key)` |
| `setImmediate` | `try yieldNow` |
| `setInterval` | `fork effect { try repeat(program, Schedule.spaced("1 second")) }` |
| `setTimeout` | `try sleep("1 second")` |
| `window` | `try (try Experimental.Window.Window).current` |
| `window.FileReader` | `try (try Experimental.FileReader.FileReader).readAsText(blob)` |
| `window.ResizeObserver` | `try (try Experimental.ResizeObserver.ResizeObserver).observe(element, onResize)` |
| `window.addEventListener` | `BrowserStream.fromEventListenerWindow("resize")` |
| `window.cancelAnimationFrame` | `try (try Experimental.Animations.Animations).nextFrame` |
| `window.crossOriginIsolated` | `try (try Experimental.BrowserInfo.BrowserInfo).crossOriginIsolated` |
| `window.getComputedStyle` | `try (try Experimental.Window.Window).computedStyle(element)` |
| `window.matchMedia` | `try (try Experimental.MediaQuery.MediaQuery).matches(query)` |
| `window.requestAnimationFrame` | `try (try Experimental.Animations.Animations).nextFrame` |

### Key notes on replacements

- **Services vs. namespaces:** Modules like `SecureRandom`, `KeyValueStore`, `Stdio`, `Terminal`, `Digest`, `Mac`, `Signature`, `Aead`, `Clipboard`, `Geolocation`, `Permissions`, `UserDirectories`, and `Experimental.*` are namespaces, not services. Obtain the service first (`try (try Service.Service).member(...)`); Effect-valued properties (`(try Stdio.Stdio).args`, `(try Terminal.Terminal).readLine`, `(try Clipboard.Clipboard).readString`, `Config.String("NAME")`, `(try Experimental.Process.Process).pid`) are run with `try` without extra `()`.
- **Clocks & elapsed time:** `Clock.monotonicTimeNanos` has an arbitrary origin — subtract readings from the same clock before converting (`Number((try Clock.monotonicTimeNanos) - startNanos) / 1e6` or `Duration.toHrTime(...)`). Keep native timestamps paired with `performance.timeOrigin` in a `.ts` adapter.
- **Crypto & bytes:** `SecureRandom.randomBytes` allocates new bytes. `Digest.digestHex` matches Node's default hex output (`digest` returns bytes). Build keys with `try Mac.key(...)`, `try Signature.privateKey(...)` / `publicKey(...)`, and `try Aead.key(...)` before passing them to the service.
- **Process metadata & exit codes:** `(try Stdio.Stdio).args` returns user arguments (`process.argv.slice(2)`); `try (try Experimental.Process.Process).temporaryDirectory` queries `os.tmpdir()` without creating a directory; `try (try Experimental.Process.Process).versions` returns a map of component versions (`"v" + versions.node` on Node). A numeric return value from `main` does not set the exit status: `effect function main(): number!! { return 3 }` succeeds with 3 and still exits 0 under `NodeRuntime.runMain`. Return normally for exit 0, fail for exit 1, or interrupt for exit 130.
- **`globalThis` and `import.meta`:** `globalThis` is allowed only as the receiver of a static member access (`.name`, `?.name`, literal/non-interpolated template key, or repeated `globalThis.globalThis.*`). Copying, destructuring, spreading, `in`, value-level `typeof`, non-literal keys, or `import g = globalThis.globalThis` report `EK0107`; `globalThis.eval` and `globalThis.Function` follow the same `EK0107` rule (keeping `instanceof globalThis.Function` and `globalThis.Function.prototype`). `import.meta` follows TypeScript's `ImportMeta` declarations (`vite/client` or `@types/node`), and `import.source(...)` / `import.defer(...)` retain TypeScript's own checks.


## The replacements at work

Each call above, in an effect function. A function that calls a service needs its layer at the application boundary, such as `NodeServices.layer` from `@effect/platform-node`:

```vibe
effect function replacements(
  path: string, text: string, url: string, key: string, specifier: string, message: string,
  size: number, min: number, max: number, bytes: Uint8Array, a: Uint8Array, b: Uint8Array,
  rows: ReadonlyArray<unknown>, target: EventTarget, program: void!!,
) {
  const name = try Config.String("NAME")
  const args = try (try Stdio.Stdio).args
  const directory = (try Path.Path).resolve()
  const file = try (try Path.Path).fromFileUrl(try orDie(Effect.try(() => new URL(import.meta.url))))
  const here = (try Path.Path).dirname(try (try Path.Path).fromFileUrl(try orDie(Effect.try(() => new URL(import.meta.url)))))
  const resolved = try Effect.try(() => import.meta.resolve(specifier))
  const line = try (try Terminal.Terminal).readLine
  try Console.log(message)
  try Console.log(text)
  try Console.error(message)
  try Console.error(text)
  try Console.warn(message)
  try Console.info(message)
  try Console.debug(message)
  try Console.trace(message)
  try Console.table(rows)
  const random = try (try SecureRandom.SecureRandom).randomBytes(size)
  const id = try (try SecureRandom.SecureRandom).uuidV4()
  const roll = try (try SecureRandom.SecureRandom).intBetween(min, max, { halfOpen: true })
  const digest = try (try Digest.Digest).digest(Digest.sha256, bytes)
  const hex = try (try Digest.Digest).digestHex(Digest.sha256, bytes)
  const encoded = new TextEncoder().encode(text)
  const byteLength = new TextEncoder().encode(text).length
  const empty = new Uint8Array(size)
  const joined = new Uint8Array([...a, ...b])
  const response = try HttpClient.get(url)
  const socket = try Socket.makeWebSocket(url)
  const stored = try (try KeyValueStore.KeyValueStore).get(key)
  const events = Stream.fromEventListener(target, "message")
  const millis = try Clock.currentTimeMillis
  const nanos = try Clock.monotonicTimeNanos
  const hrtime = Duration.toHrTime(try Clock.monotonicTimeNanos)
  try sleep("1 second")
  try yieldNow
  const fiber = fork effect { try repeat(program, Schedule.spaced("1 second")) }
  try Fiber.interrupt(fiber)
  return { name, args, directory, here, file, line, random, id, roll, digest, hex, encoded, byteLength, empty, joined, response, socket, stored, events, millis, nanos, hrtime }
}
```

For `queueMicrotask`, `setImmediate` and `process.nextTick`, the diagnostic recommends importing `Effect` from `"effect"` and writing `try Effect.yieldNow` inside effect code. `yieldNow` is an Effect value, so it has no call parentheses. The qualified spelling also works when implicit Effect globals are disabled. It lets other fibers run; it does not reproduce the host callback queue.

In the browser, `@effect/platform-browser` supplies these services and their layers:

```vibe
import { BrowserStream, Clipboard, Geolocation, Permissions } from "@effect/platform-browser"

effect function browser() {
  const text = try (try Clipboard.Clipboard).readString
  const position = try (try Geolocation.Geolocation).getCurrentPosition()
  const status = try (try Permissions.Permissions).query("geolocation")
  const resizes = BrowserStream.fromEventListenerWindow("resize")
  const visibility = BrowserStream.fromEventListenerDocument("visibilitychange")
  return { text, position, status, resizes, visibility }
}
```

Pure `Experimental.Encoding.decodeBase64Lenient` replaces Node's lenient base64 decoding without a service or layer. `Experimental.Dns` extends Effect's `Dns` service only with direct-authority TXT queries (NS/A discovery stays Effect's) through `ExperimentalNodeDns.layer` or `ExperimentalWorkerDns.layer`; the Worker requires AA or fails typed, without recursive TXT fallback.

VibeLang's experimental services fill what Effect lacks, provided by `ExperimentalNodeServices.layer` from `vibelang-runtime/experimental/platform-node` or `ExperimentalBunServices.layer` from `vibelang-runtime/experimental/platform-bun`, and `Locks` and `MediaQuery` by `ExperimentalBrowserServices.layer` from `vibelang-runtime/experimental/platform-browser`; [Experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md) has the details:

```vibe
effect function experimental(path: string, pid: number, killSignal: ChildProcess.Signal, name: string, query: string, callback: (time: number) => void, blob: Blob, element: Element, onResize: () => void, value: string, macKey: Mac.Key, aeadKey: Aead.Key, privateKey: Signature.PrivateKey, publicKey: Signature.PublicKey, signature: Uint8Array, data: Uint8Array, plaintext: Uint8Array, ciphertext: Uint8Array, nonce: Uint8Array) {
  const fs = try Experimental.FileSystem.FileSystem
  const id = try (try Experimental.Process.Process).pid
  const platform = try (try Experimental.Process.Process).platform
  const arch = try (try Experimental.Process.Process).arch
  const executable = try (try Experimental.Process.Process).execPath
  const versions = try (try Experimental.Process.Process).versions
  const memory = try (try Experimental.Process.Process).memoryUsage
  const host = try (try Experimental.Process.Process).hostname
  const cores = try (try Experimental.Process.Process).availableParallelism
  const origin = try (try Experimental.Process.Process).timeOrigin
  try (try Experimental.Process.Process).kill(pid, { killSignal })
  const running = try (try Experimental.Process.Process).isRunning(pid)
  try fs.access(path, { executable: true })
  const file = try fs.open(path, { nonBlocking: true })
  const mac = try (try Mac.Mac).sign(macKey, data)
  const signed = try (try Signature.Signature).sign(privateKey, data)
  const valid = try (try Signature.Signature).verify(publicKey, signature, data)
  const sealed = try (try Aead.Aead).encrypt(aeadKey, plaintext, { nonce })
  const opened = try (try Aead.Aead).decrypt(aeadKey, ciphertext, { nonce })
  const pair = try (try Signature.Signature).generateKeyPair(Signature.ed25519)
  const lock = try (try Experimental.Locks.Locks).hold(name)
  const reducedMotion = try (try Experimental.MediaQuery.MediaQuery).matches(query)
  const frame = try (try Experimental.Animations.Animations).nextFrame
  try (try Experimental.Animations.Animations).nextFrameUnless(() => undefined)
  const text = try (try Experimental.FileReader.FileReader).readAsText(blob)
  try (try Experimental.ResizeObserver.ResizeObserver).observe(element, onResize)
  const isolated = try (try Experimental.BrowserInfo.BrowserInfo).crossOriginIsolated
  const agent = try (try Experimental.BrowserInfo.BrowserInfo).userAgent
  const style = try (try Experimental.Window.Window).computedStyle(element)
  const isElement = (try Experimental.Document.Document).isHTMLElement(value)
  const selector = try (try Experimental.Document.Document).escapeSelector(value)
  const context = try (try Experimental.AudioContext.AudioContext).acquire
  return { id, platform, arch, executable, versions, memory, host, cores, origin, running, file, mac, signed, valid, sealed, opened, pair, lock, reducedMotion, frame, text, element, isolated, agent, style, isElement, selector, context }
}
```

Modules load with declarations, not at run time. A `.vibe` file imports what `require` loaded:

```ts
// module.ts
export const name = "Ada"
```

```vibe
import { name } from "./module.ts"

function greeting() {
  return `Hello, ${name}`
}
```

and exports what CommonJS's `module.exports` and `exports` held:

```vibe
const value = 42
export const name = value
```

## Escaping to TypeScript

Where a row says to escape, write the TypeScript in a `.ts` file, which keeps every global. Export a function and wrap a call that may throw with `Effect.try` in effect code:

```ts
// dom.ts
export function title(): string {
  return document.title
}
```

```vibe
// page-title.vibe
import { title } from "./dom.ts"

effect function pageTitle() {
  return try Effect.try(() => title())
}
```

Keep Node.js value imports in TypeScript too. For the default HTTP server, `ExperimentalNodeHttpServer.layer({ port })` supplies Node's `createServer` to Effect's existing layer:

```vibe
import { ExperimentalNodeHttpServer } from "vibelang-runtime/experimental/platform-node"

export const Server = ExperimentalNodeHttpServer.layer({ port: 3000 })
```

A server that needs custom `createServer` options belongs in a `.ts` file, which calls `NodeHttpServer.layer` with that constructor.

## Limits of static checks

`EK4402` and `EK0107` are static, lint-strength checks — not a security sandbox. Use process isolation for untrusted code.

Use `Clock.currentTimeMillis` when tests need to control the clock. For the compiler’s alias and global-name checks, see [the platform specification](../../../design/src/005-services.md#the-platform-standard-library).

## Literal module URLs

String-literal or non-interpolated template `data:` / `blob:` imports (case- and whitespace-insensitive) report `EK0107`. Move dynamic module URL imports into a `.ts` helper and call it with `Effect.tryPromise`:

```ts
// load-module.ts
export function loadModule(specifier: string) {
  return import(specifier)
}
```

```vibe
// run: const value = try loadData(); try Console.log(value.default)
import { loadModule } from "./load-module.ts"
effect function loadData() {
  return try Effect.tryPromise(() => loadModule("data:text/javascript,export default 1"))
}
// Output: 1
```

Computed `import(specifier)` stays unchecked by this rule; type-level `import(...)` queries keep TypeScript semantics.

## Additional experimental helpers

| Need | VibeLang replacement | Layer |
| --- | --- | --- |
| Inherited child process (non-blocking cancel) | `try (try Experimental.ChildProcess.ChildProcess).runInherited(command, args, { cwd, shell })` (use Effect's `ChildProcessSpawner` for ordinary commands/pipes) | `ExperimentalNodeChildProcess.layer` / `ExperimentalBunChildProcess.layer` |
| Mutable Web `Headers` copy (preserves duplicate cookies) | `try (try Experimental.Headers.Headers).copy(input)` | `ExperimentalNodeHeaders.layer` / `ExperimentalBunHeaders.layer` / `ExperimentalBrowserHeaders.layer` |
| Web response body → Node readable (eager cancel) | `try (try Experimental.NodeStream.NodeStream).fromWeb(body, { response, signal })` | Node / Bun layer |
| Clone `Request` at a new URL | `try (try Experimental.Request.Request).atUrl(url, request)` | Node / Bun / Browser layer |
| `node:net` `isIPv4(address)` | `Result.isSuccess(NetAddress.ipv4FromString(address))` | None (pure) |
| `node:net` `isIPv6(address)` (with Node zones) | `Experimental.NetAddress.isIPv6(address)` — It needs no layer or `try`. Preserves Node's ASCII zone syntax, including numeric scopes beyond the unsigned 32-bit range (`NetAddress.ipv6FromString` decodes bare addresses). | None (pure) |
| `node:net` `isIP(address)` (`4 \| 6 \| 0`) | `Result.isSuccess(NetAddress.ipv4FromString(address)) ? 4 : Experimental.NetAddress.isIPv6(address) ? 6 : 0` | None (pure) |
