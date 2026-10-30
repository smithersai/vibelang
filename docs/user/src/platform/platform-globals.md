# Platform globals in VibeLang

Node.js reaches a `.vibe` file only through Effect's services, which a layer provides, or by escaping to TypeScript: a `.ts` file. So Node.js's globals, such as `process`, `Buffer`, `require`, and `__dirname`, and the web's globals that do I/O or read the clock or randomness, such as `fetch`, `setTimeout`, `crypto`, `performance`, and `localStorage`, are not in scope in a `.vibe` file, and a `.vibe` file does not import a Node.js built-in module, such as `node:fs` or `fs`, as a value. Each use is EK4402, and the error names what replaces it. A type-only import, as in `import type { Server } from "node:http"`, stays allowed, and `.ts` files keep every global.

ECMAScript's built-ins stay: `Array`, `Map`, `Set`, `JSON`, `Math`, `Promise`, `Symbol`, `Date`, `Intl`, and the rest, including `Date.now()`, `new Date()`, and `Math.random()`. A test can't control those reads, so code under test reads time through `try Clock.currentTimeMillis` and randomness through `try Random.next`. The web's pure helpers stay too, because they touch nothing outside the program: `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `AbortController`, `AbortSignal`, `Blob`, `FormData`, `EventTarget`, `atob`, `btoa`, and the web streams. In a value position, bare `Headers`, `Response` and `Event` name Effect's namespaces from its subpaths; as types they keep the DOM's meaning.

A host messaging reference such as `postMessage`, `globalThis.postMessage` or `globalThis["postMessage"]` is also `EK4402`, even when held without calling it. Put native host messaging in a `.ts` file; local bindings named `postMessage` keep their ordinary meaning.

## Replacements

Each row says what replaces a global or one of its members: an Effect API first, then VibeLang's experimental service where Effect lacks one, then the escape to TypeScript, with the reason. EK4402 reads the same table. In effect code, `try` runs an Effect value. Get a service first, then call its members.

| Global | Use instead |
| --- | --- |
| `BroadcastChannel` | escape to TypeScript for now: Effect has no service for messages between browser tabs; a Worker carries messages to a worker. |
| `Buffer` | `new TextEncoder().encode(text)` |
| `Buffer.alloc` | `new Uint8Array(size)` |
| `Buffer.concat` | `new Uint8Array([...a, ...b])` |
| `Buffer.from` | `new TextEncoder().encode(text)` |
| `Bun` | escape to TypeScript for now: A runtime's own API belongs to its platform package's layers, such as @effect/platform-bun's, or to a .ts file. |
| `Deno` | escape to TypeScript for now: A runtime's own API belongs to its platform package's layers, such as @effect/platform-bun's, or to a .ts file. |
| `EventSource` | `try HttpClient.get(url)` |
| `SharedWorker` | `effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner` |
| `WebSocket` | `try Socket.makeWebSocket(url)` |
| `Worker` | `effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner`; bare `Worker` is undecided (pending VIP) |
| `XMLHttpRequest` | `try HttpClient.get(url)` |
| `__dirname` | `(try Path.Path).dirname(try (try Path.Path).fromFileUrl(new URL(import.meta.url)))` |
| `__filename` | `try (try Path.Path).fromFileUrl(new URL(import.meta.url))` |
| `addEventListener` | `Stream.fromEventListener(target, "message")` |
| `alert` | escape to TypeScript for now: Effect has no service for the browser's dialogs; a terminal program asks with `try (try Terminal.Terminal).readLine`. |
| `caches` | escape to TypeScript for now: Effect has no service for the browser's Cache Storage; KeyValueStore stores strings by key. |
| `cancelAnimationFrame` | escape to TypeScript for now: Effect has no service for the browser's animation and idle callbacks; schedule work with Schedule, or call them in a .ts file. |
| `cancelIdleCallback` | escape to TypeScript for now: Effect has no service for the browser's animation and idle callbacks; schedule work with Schedule, or call them in a .ts file. |
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
| `crypto` | `try (try SecureRandom.SecureRandom).randomBytes(size)` |
| `crypto.createCipheriv` | `try (try Aead.Aead).encrypt(key, plaintext, { nonce })` |
| `crypto.createDecipheriv` | `try (try Aead.Aead).decrypt(key, ciphertext, { nonce })` |
| `crypto.createHash` | `try (try Digest.Digest).digest(Digest.sha256, bytes)` |
| `crypto.createHmac` | `try (try Mac.Mac).sign(key, data)` |
| `crypto.createSign` | `try (try Signature.Signature).sign(privateKey, data)` |
| `crypto.createVerify` | `try (try Signature.Signature).verify(publicKey, signature, data)` |
| `crypto.generateKeyPair` | `try (try Signature.Signature).generateKeyPair(Signature.ed25519)` |
| `crypto.getRandomValues` | `try (try SecureRandom.SecureRandom).randomBytes(size)` |
| `crypto.hash` | `try (try Digest.Digest).digest(Digest.sha256, bytes)` |
| `crypto.randomBytes` | `try (try SecureRandom.SecureRandom).randomBytes(size)` |
| `crypto.randomInt` | `try (try SecureRandom.SecureRandom).intBetween(min, max)` |
| `crypto.randomUUID` | `try (try SecureRandom.SecureRandom).uuidV4()` |
| `crypto.sign` | `try (try Signature.Signature).sign(privateKey, data)` |
| `crypto.subtle` | `try (try Mac.Mac).sign(key, data)` |
| `crypto.subtle.digest` | `try (try Digest.Digest).digest(Digest.sha256, bytes)` |
| `crypto.subtle.sign` | `try (try Signature.Signature).sign(privateKey, data)` |
| `crypto.subtle.verify` | `try (try Signature.Signature).verify(publicKey, signature, data)` |
| `crypto.verify` | `try (try Signature.Signature).verify(publicKey, signature, data)` |
| `crypto.webcrypto` | `try (try Mac.Mac).sign(key, data)` |
| `dispatchEvent` | `Stream.fromEventListener(target, "message")` |
| `document` | escape to TypeScript for now: Effect has no service for the DOM; UI code belongs in a .ts or .tsx file, such as a React component's. |
| `document.addEventListener` | `BrowserStream.fromEventListenerDocument("visibilitychange")` |
| `exports` | `export const name = value` |
| `fetch` | `try HttpClient.get(url)` |
| `global` | `globalThis` |
| `history` | escape to TypeScript for now: Effect has no service for the DOM; UI code belongs in a .ts or .tsx file, such as a React component's. |
| `importScripts` | `effect/workers`: `import { Worker as EffectWorker }` and `WorkerRunner` |
| `indexedDB` | `try (try KeyValueStore.KeyValueStore).get(key)` |
| `localStorage` | `try (try KeyValueStore.KeyValueStore).get(key)` |
| `location` | escape to TypeScript for now: Effect has no service for the DOM; UI code belongs in a .ts or .tsx file, such as a React component's. |
| `module` | `export const name = value` |
| `navigator` | escape to TypeScript for now: Effect has no service for the browser's navigator; navigator.clipboard, geolocation, permissions, and locks have services. |
| `navigator.clipboard` | `try (try Clipboard.Clipboard).readString` |
| `navigator.geolocation` | `try (try Geolocation.Geolocation).getCurrentPosition()` |
| `navigator.hardwareConcurrency` | `try (try Experimental.Process).availableParallelism` |
| `navigator.locks` | `try (try Experimental.Locks).hold(name)` |
| `navigator.permissions` | `try (try Permissions.Permissions).query("geolocation")` |
| `performance` | `try Clock.currentTimeMillis` |
| `performance.now` | `try Clock.monotonicTimeNanos` |
| `performance.timeOrigin` | `try (try Experimental.Process).timeOrigin` |
| `postMessage` | Worker and WorkerRunner |
| `process` | `try Config.String("NAME")` |
| `process.arch` | `try (try Experimental.Process).arch` |
| `process.argv` | `try (try Stdio.Stdio).args` |
| `process.cwd` | `(try Path.Path).resolve()` |
| `process.env` | `try Config.String("NAME")` |
| `process.execPath` | `try (try Experimental.Process).execPath` |
| `process.exit` | return from main for exit 0; fail for exit 1; interruption exits 130 |
| `process.exitCode` | return from main for exit 0; fail for exit 1; interruption exits 130 |
| `process.hrtime` | `try Clock.monotonicTimeNanos` |
| `process.kill` | `try (try Experimental.Process).kill(pid, { killSignal })` |
| `process.memoryUsage` | `try (try Experimental.Process).memoryUsage` |
| `process.nextTick` | `try yieldNow` |
| `process.off` | escape to TypeScript for now: NodeRuntime.runMain handles SIGINT and SIGTERM; Effect has no service for other process events. |
| `process.on` | escape to TypeScript for now: NodeRuntime.runMain handles SIGINT and SIGTERM; Effect has no service for other process events. |
| `process.once` | escape to TypeScript for now: NodeRuntime.runMain handles SIGINT and SIGTERM; Effect has no service for other process events. |
| `process.pid` | `try (try Experimental.Process).pid` |
| `process.platform` | `try (try Experimental.Process).platform` |
| `process.removeListener` | escape to TypeScript for now: NodeRuntime.runMain handles SIGINT and SIGTERM; Effect has no service for other process events. |
| `process.stderr` | `try Console.error(text)` |
| `process.stdin` | `try (try Terminal.Terminal).readLine` |
| `process.stdout` | `try Console.log(text)` |
| `process.uptime` | escape to TypeScript for now: Clock reads the time, not the process's age: keep a `try Clock.monotonicTimeNanos` reading from the start. |
| `process.version` | `try (try Experimental.Process).versions` |
| `process.versions` | `try (try Experimental.Process).versions` |
| `prompt` | escape to TypeScript for now: Effect has no service for the browser's dialogs; a terminal program asks with `try (try Terminal.Terminal).readLine`. |
| `queueMicrotask` | `try yieldNow` |
| `removeEventListener` | `Stream.fromEventListener(target, "message")` |
| `requestAnimationFrame` | escape to TypeScript for now: Effect has no service for the browser's animation and idle callbacks; schedule work with Schedule, or call them in a .ts file. |
| `requestIdleCallback` | escape to TypeScript for now: Effect has no service for the browser's animation and idle callbacks; schedule work with Schedule, or call them in a .ts file. |
| `require` | `import { name } from "./module.ts"` |
| `require.resolve` | `try Effect.try(() => import.meta.resolve(specifier))` |
| `self` | `globalThis` |
| `sessionStorage` | `try (try KeyValueStore.KeyValueStore).get(key)` |
| `setImmediate` | `try yieldNow` |
| `setInterval` | `try repeat(program, Schedule.spaced("1 second"))` |
| `setTimeout` | `try sleep("1 second")` |
| `window` | escape to TypeScript for now: Effect has no service for the DOM; UI code belongs in a .ts or .tsx file, such as a React component's. |
| `window.addEventListener` | `BrowserStream.fromEventListenerWindow("resize")` |

A numeric return value from `main` does not set the exit status:
`effect function main(): number!! { return 3 }` succeeds with 3 and still exits 0 when passed to `NodeRuntime.runMain`. Return normally for exit 0,
fail for exit 1, or interrupt for exit 130.

`import.meta` gives a `.vibe` file only `import.meta.url`, its module identity (VIP-33, amended). `import.meta.dirname`, `import.meta.filename` and `import.meta.env` read host state, as `__dirname`, `__filename` and `process.env` do, and take the same replacements. The specification makes every other member, `import.meta.resolve` included, and every use of `import.meta` as a value EK4402. The compiler does not report these yet, and the `require.resolve` row above still shows its current suggestion.

## The replacements at work

Each call above, in an effect function. A function that calls a service needs its layer at the application boundary, such as `NodeServices.layer` from `@effect/platform-node`:

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-14, VIP-17, VIP-33
effect function replacements(
  path: string, text: string, url: string, key: string, specifier: string, message: string,
  size: number, min: number, max: number, bytes: Uint8Array, a: Uint8Array, b: Uint8Array,
  rows: ReadonlyArray<unknown>, target: EventTarget, program: void!!,
) {
  const name = try Config.String("NAME")
  const args = try (try Stdio.Stdio).args
  const directory = (try Path.Path).resolve()
  const file = try (try Path.Path).fromFileUrl(new URL(import.meta.url))
  const here = (try Path.Path).dirname(try (try Path.Path).fromFileUrl(new URL(import.meta.url)))
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
  const roll = try (try SecureRandom.SecureRandom).intBetween(min, max)
  const digest = try (try Digest.Digest).digest(Digest.sha256, bytes)
  const encoded = new TextEncoder().encode(text)
  const empty = new Uint8Array(size)
  const joined = new Uint8Array([...a, ...b])
  const response = try HttpClient.get(url)
  const socket = try Socket.makeWebSocket(url)
  const stored = try (try KeyValueStore.KeyValueStore).get(key)
  const events = Stream.fromEventListener(target, "message")
  const millis = try Clock.currentTimeMillis
  const nanos = try Clock.monotonicTimeNanos
  try sleep("1 second")
  try yieldNow
  const fiber = fork effect { try repeat(program, Schedule.spaced("1 second")) }
  try Fiber.interrupt(fiber)
  const global = globalThis
  return { name, args, directory, here, file, resolved, line, random, id, roll, digest, encoded, empty, joined, response, socket, stored, events, millis, nanos, global }
}
```

In the browser, `@effect/platform-browser` supplies these services and their layers:

```vibe
// pending: VIP-1, VIP-5
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

VibeLang's experimental services fill what Effect lacks, provided by `ExperimentalNodeServices.layer` from `vibelang-runtime/experimental/platform-node` or Bun's, and `Locks` by `ExperimentalBrowserServices.layer` from `vibelang-runtime/experimental/platform-browser`; [Experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md) has the details:

```vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-33
effect function experimental(path: string, pid: number, killSignal: ChildProcess.Signal, name: string, key: Redacted.Redacted<Uint8Array>, privateKey: Redacted.Redacted<Uint8Array>, publicKey: Uint8Array, signature: Uint8Array, data: Uint8Array) {
  const fs = try Experimental.FileSystem
  const id = try (try Experimental.Process).pid
  const platform = try (try Experimental.Process).platform
  const arch = try (try Experimental.Process).arch
  const executable = try (try Experimental.Process).execPath
  const versions = try (try Experimental.Process).versions
  const memory = try (try Experimental.Process).memoryUsage
  const host = try (try Experimental.Process).hostname
  const cores = try (try Experimental.Process).availableParallelism
  const origin = try (try Experimental.Process).timeOrigin
  try (try Experimental.Process).kill(pid, { killSignal })
  const running = try (try Experimental.Process).isRunning(pid)
  try fs.access(path, { executable: true })
  const file = try fs.open(path, { nonBlocking: true })
  const mac = try (try Mac.Mac).sign(key, data)
  const signed = try (try Signature.Signature).sign(privateKey, data)
  const valid = try (try Signature.Signature).verify(publicKey, signature, data)
  const sealed = try (try Aead.Aead).encrypt(key, plaintext, { nonce })
  const opened = try (try Aead.Aead).decrypt(key, ciphertext, { nonce })
  const pair = try (try Signature.Signature).generateKeyPair(Signature.ed25519)
  const lock = try (try Experimental.Locks).hold(name)
  return { id, platform, arch, executable, versions, memory, host, cores, origin, running, file, mac, signed, valid, sealed, opened, pair, lock }
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
// pending: VIP-1, VIP-4, VIP-5, VIP-14
import { title } from "./dom.ts"

effect function pageTitle() {
  return try Effect.try(() => title())
}
```

Keep Node.js imports in TypeScript too. For example, expose the `createServer` value needed by `NodeHttpServer.layer` from a separate file:

```ts
// fragment
// server.ts
// The snippet checker installs no @types/node, which declares node:http.
import { createServer } from "node:http"
export const server = createServer
```

```vibe
// fragment
// pending: VIP-14, VIP-33
import { server } from "./server.ts"
```

## Limits of static checks

EK4402 is a static, lint-strength check, not a sandbox or a
security boundary. They recognize direct uses and statically named members of `globalThis`.
Whether aliases such as `const g = globalThis; g.process.pid`, casts and
reflection through `Reflect.get` are caught is undecided (pending VIP). Use process isolation when running untrusted
code.

`Date.now()`, `new Date()`, and `Intl.DateTimeFormat().format()` with no
argument read the current clock without a diagnostic. Read time through `try Clock.currentTimeMillis` and pass that
value to the formatter when you need controlled time, including in tests.
