# Platform globals in VibeLang

Node.js reaches a `.vibe` file only through Effect's services, which a layer provides, or by escaping to TypeScript: a `.ts` file or a native `module` declaration. So Node.js's globals, such as `process`, `Buffer`, `require`, and `__dirname`, and the web's globals that do I/O or read the clock or randomness, such as `fetch`, `setTimeout`, `crypto`, `performance`, and `localStorage`, are not in scope in a `.vibe` file, and a `.vibe` file does not import a Node.js built-in module, such as `node:fs` or `fs`, as a value. Each use is `EK4402`, and the error names what replaces it. Object-rest bindings create new local objects: `const { ...timeout } = AbortSignal` does not select `AbortSignal.timeout`, regardless of the local binding's name. Selecting that method explicitly still reports `EK4402`. Selecting a host method through a nested pattern, such as `const { timeout: { name } } = AbortSignal`, reads that method before its metadata and reports `EK4402`. For eligible leading `const` bindings in an ES module, the quick fix and `vibelang --fix` retain the same eager reads and live bindings in a native `module` declaration. Captured or annotated initializers, other runtime dependencies, documentation or directives, and other module formats need an explicit TypeScript boundary. A type-only import, as in `import type { Server } from "node:http"`, stays allowed, and `.ts` files keep every global. With `verbatimModuleSyntax` enabled, `import { type Server } from "node:http"` and `import {} from "node:http"` keep an empty runtime import and report `EK4402`. The quick fix and `vibelang --fix` rewrite type bindings to a whole `import type` clause, preserving aliases and comments. An explicit empty import has no type bindings to rewrite: move that dependency into TypeScript. With import elision enabled, already-erased imports remain allowed.

The same boundary applies to `import FS = require("node:fs")`, including an unused alias and `export import`. A type-only alias, such as `import type FS = require("node:fs")`, stays allowed. When the alias has only type uses or no uses, `vibelang --fix` writes `import type`; a value use or re-export keeps the diagnostic and its service advice. Internal aliases such as `import Alias = Local` and ordinary package imports keep TypeScript's behavior.

With `verbatimModuleSyntax`, `export { type Stats } from "node:fs"` and `export {} from "fs"` retain runtime loads and report `EK4402`. The quick fix and `vibelang --fix` retain each runtime dependency in a side-effect-imported native `module` declaration and keep type bindings in a whole `export type` clause. Aliases and comments within the export are preserved; exports with attributes, leading JSDoc or tool directives need a manual boundary. With import elision enabled, these inline type and empty re-exports remain allowed.

ECMAScript's built-ins stay: `Array`, `Map`, `Set`, `JSON`, `Math`, `Promise`, `Symbol`, `Date`, `Intl`, and the rest, including `Date.now()`, `Date()`, `new Date()`, and `Math.random()`. `Temporal.Now` reads stay available when the selected ECMAScript library declares `Temporal`. A test can't control those reads, so code under test reads time through `try Clock.currentTimeMillis` and randomness through `try Random.next`. `Intl` is an ECMAScript library declaration and needs no web-utility allowlist entry. A closed list of the web's pure helpers stays too, because they touch nothing outside the program: `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `AbortController`, `AbortSignal`, `Intl`, `atob` and `btoa`. Every other web or Node.js global, such as `Blob`, `FormData`, `EventTarget` and the web streams, is EK4402 as a value. In a value position, bare `Headers`, `Response` and `Event` name Effect's namespaces from its subpaths; as types they keep the DOM's meaning.

The restriction covers the whole file, including plain and `async` functions and the bodies passed to `Effect.try`, `tryPromise`, `sync` and `callback`. Wrapping a host read changes its failure handling, not its platform access. Keep native timer registration and cancellation in a sibling `.ts` adapter when testing a `callback` finalizer. For an Effect wrapper, `vibelang --fix` creates a new TypeScript adapter and keeps the public declaration and deferred execution. It moves a self-contained wrapper whole. When the wrapper reads a binding of the file, it moves only the platform call. See [the platform introduction](105-introduction.md).

The migrate flow can move a zero-argument optional host call, such as `process.getuid?.()`, into a native module helper while keeping the class and its `import.meta.url` in the original module. The helper performs the whole optional call on its original receiver, only when the call is reached. Calls with value or type arguments retain the preservation refusal.

The migrate flow moves a module's `import.meta` reads into a fresh `<source>.platform.ts` companion before renaming the source. A direct `import.meta.resolve` call with one or two arguments calls a companion function instead. Its arguments stay where they were, inside the original callback and `try`/`catch`, so captured inputs and deferred execution stay unchanged. `import.meta.filename` and `import.meta.dirname` become companion calls that receive the module's own `import.meta.url`, so they still name the module, and they stay `undefined` for a URL other than `file:`, as in Node.js. `import.meta.env` becomes a companion call that returns the build's environment. Code that reads `import.meta.filename` stays in the entry module so the value keeps that file's identity. Code that reads `import.meta.dirname` can move with a declaration, since the sibling shares its directory. An executable script keeps its shebang at the start of the entry module; the generated companion contains no shebang. A source wildcard export map gains an exact `null` entry for the new helper subpath to keep it private; revert removes that entry. Existing companions, `import.meta.main`, writes to `import.meta` members, other unsupported `import.meta` uses and publication layouts the flow cannot prove safe receive a refusal. `import.meta.url` stays in the original module. Code that reaches the platform and reads `import.meta.url` stays in the module too: only its host calls and reads move, so `import.meta.url` still names the module.

Platform repairs from one source share one fresh `<source>.platform.ts` companion. Explicit `sync` inputs stay evaluated at the original call site, in order; the callback still runs only when its Effect runs. A callback that captures other bindings or a lexical receiver keeps the existing preservation checks, and an existing foreign module is never rewritten. During migration, host access inside formerly accepted boundary callbacks reports an `EK4402` warning; `--fix` and `--fix-migration-only` can repair explicit-input writes and deletes such as restoring `process.env`. Unwrapped host access remains an error.

For `fetch`, `XMLHttpRequest` and `EventSource`, the diagnostic shows `try HttpClient.get(url)` in Effect code. `HttpClient.get(url)` constructs the request Effect; `try` runs it using the provided `HttpClient` service.

Path diagnostic examples obtain the implementation with `try Path.Path`. Pure members such as `join` and `sep` return values directly; `fromFileUrl` and `toFileUrl` return Effects, so run a conversion with `try` before passing its result to `dirname`. Construct a URL through `try orDie(Effect.try(() => new URL(import.meta.url)))` when deriving a filename from the module identity.

A host messaging reference such as `postMessage`, `globalThis.postMessage` or `globalThis["postMessage"]` is also `EK4402`, even when held without calling it. Put native host messaging in a `.ts` file; local bindings named `postMessage` keep their ordinary meaning.

The builtin boundary covers the supported Node versions' internal and legacy names too: bare imports such as `_http_agent`, `_stream_readable` and `_tls_wrap` report `EK4402`, just like their `node:` forms. Type-only imports remain allowed and emit no Node import.

Pure platform helpers do not make every member pure: `AbortSignal.timeout`, `URL.createObjectURL` and `URL.revokeObjectURL` report `EK4402`. The check also follows constant constructor/function aliases, named destructuring, and function-local `let` bindings with no source writes to that binding, and applies inside `Effect.try`, `Effect.tryPromise` and `Effect.sync` arrows. Use Effect's timeout operators, or move these host operations into a sibling `.ts` module and expose them through an Effect. A project's type-only augmentation of `AbortSignal` or `URL` leaves these host operations banned; it changes the interface, not the runtime constructor. Static `globalThis` access keeps the same origin through dotted, quoted, template-key and repeated `globalThis` receivers, including optional accesses. Literal keys on these host constructors retain their identity through parentheses and erased type assertions: `AbortSignal[("timeout" as const)]` is the same host operation as `AbortSignal.timeout`. The same rule covers destructured literal keys. Parentheses and erased `as`, `satisfies` and non-null wrappers on the `globalThis` receiver preserve a static access, such as `(globalThis as typeof globalThis).URL`. Pure helpers stay available; host operations retain `EK4402` and copying `globalThis` retains `EK0107`. Changing an asserted property type does not change the original global binding or turn a host operation into a local implementation. The key grammar stays closed: `globalThis[("URL")]` and `globalThis[key]` are `EK0107`, even when `key` has a string-literal type. Local bindings, pure methods and erased type queries remain valid.

Adding a type-only host interface augmentation in a `.ts` or `.d.ts` file does not change the global's origin: references to host constructors such as `XMLHttpRequest` still report `EK4402`. Local declarations and explicit imports continue to shadow those globals.

## Replacements

Console replacement advice includes `try`: `Console.log(message)` builds a logging Effect, and `try Console.log(message)` runs it in effect code. If implicit Effect modules are disabled, import `Console` from `effect` first.

Each row says what replaces a global or one of its members: an Effect API first, then VibeLang's experimental service where Effect lacks one, then the escape to TypeScript, with the reason. The compiler's `EK4402` advice names these APIs; the guide runs Effect values with `try` and explains where native behavior needs a TypeScript adapter. In effect code, `try` runs an Effect value. Get a service first, then call its members. In effect code, `vibelang --fix` writes a `console` call as Effect's `Console`, which needs no layer: `console.error("failed:", name)` becomes `try Console.error("failed:", name)`.

FileSystem advice gets the implementation with `try FileSystem.FileSystem` before calling a member. Run a returned Effect with `try`, as in `try (try FileSystem.FileSystem).readFileString(path)`. The module `FileSystem` supplies the service key; its methods belong to the retrieved implementation. Replacement advice runs methods that return Effects with an outer `try`. The `stream`, `sink` and `watch` methods construct `Stream` or `Sink` values; consume those values with their ordinary APIs.

WebSocket replacement advice runs `Socket.makeWebSocket(url)` with `try`. Provide `NodeSocket.layerWebSocketConstructor` or `BrowserSocket.layerWebSocketConstructor` for its `Socket.WebSocketConstructor` requirement. A `layerWebSocket(url)` provides `Socket.Socket`; retrieve that service with `try Socket.Socket`.

`crypto.randomInt(min, max)` excludes `max`. For valid native integer bounds, set `halfOpen: true` on the `SecureRandom.SecureRandom` service’s `intBetween` method to retain that range. The Effect method includes both bounds by default and rounds fractional bounds; keep a native call in a `.ts` adapter when its argument validation is required.

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
| `crypto.hash` | `try (try Digest.Digest).digest(Digest.sha256, bytes)` |
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
| `document` | escape to TypeScript for now: Effect has no service for the DOM; try (try Experimental.Document.Document).current gives an API that takes it the page's Document, and other UI code belongs in a .ts or .tsx file, such as a React component's. |
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
| `navigator.hardwareConcurrency` | `try (try Experimental.Process.Process).availableParallelism` |
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
| `process.hrtime` | `try Clock.monotonicTimeNanos` |
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
| `require.resolve` | escape to TypeScript: resolve in a `.ts` module and call it with `Effect.try`, because `import.meta` allows only `.url` |
| `self` | escape to TypeScript for now: Effect has no global-object service; keep access to the host global object in TypeScript. |
| `sessionStorage` | `try (try KeyValueStore.KeyValueStore).get(key)` |
| `setImmediate` | `try yieldNow` |
| `setInterval` | `fork effect { try repeat(program, Schedule.spaced("1 second")) }` |
| `setTimeout` | `try sleep("1 second")` |
| `window` | escape to TypeScript for now: Effect has no service for the DOM; try (try Experimental.Window.Window).current gives an API that takes it the page's Window, and other UI code belongs in a .ts or .tsx file, such as a React component's. |
| `window.FileReader` | `try (try Experimental.FileReader.FileReader).readAsText(blob)` |
| `window.ResizeObserver` | `try (try Experimental.ResizeObserver.ResizeObserver).observe(element, onResize)` |
| `window.addEventListener` | `BrowserStream.fromEventListenerWindow("resize")` |
| `window.cancelAnimationFrame` | `try (try Experimental.Animations.Animations).nextFrame` |
| `window.crossOriginIsolated` | `try (try Experimental.BrowserInfo.BrowserInfo).crossOriginIsolated` |
| `window.getComputedStyle` | `try (try Experimental.Window.Window).computedStyle(element)` |
| `window.matchMedia` | `try (try Experimental.MediaQuery.MediaQuery).matches(query)` |
| `window.requestAnimationFrame` | `try (try Experimental.Animations.Animations).nextFrame` |

The `EK4402` replacement examples obtain `SecureRandom.SecureRandom` with `try` before calling its methods. The `randomBytes` method returns new bytes; it does not fill an existing array.

For storage diagnostics, `KeyValueStore` names a namespace. Obtain `KeyValueStore.KeyValueStore` with `try`, then run the Effect returned by its `get(key)` method.

For byte I/O, first obtain `Stdio.Stdio` with `try`. Its `stdout()` and `stderr()` methods return sinks, and its `stdin` property is a stream. Its `args` property is an Effect: use `try (try Stdio.Stdio).args`, without calling `args`. `args` omits the executable and script entries; on Node it matches `process.argv.slice(2)`. Read the full array in a `.ts` adapter when needed. The platform diagnostic's replacement examples use these service members.

`Clock.monotonicTimeNanos` is for elapsed intervals: record `startNanos` from that clock before work and subtract it afterward. Its arbitrary origin can differ from `performance.now()` on Node. A native timestamp, including one combined with `performance.timeOrigin`, belongs in a `.ts` adapter.

The terminal diagnostic examples obtain `Terminal.Terminal` with `try` and run its `readLine` Effect property to read a line.

Digest diagnostic examples obtain `Digest.Digest` with `try`, then run its `digest(Digest.sha256, bytes)` method. This hashes the bytes in one operation.

For `os.tmpdir()`, use `try (try Experimental.Process.Process).temporaryDirectory`. It queries the native temporary directory without creating a directory or file.

MAC diagnostic examples obtain `Mac.Mac` with `try`, then run its `sign(key, data)` method. Build an HMAC key with `try Mac.key(Mac.hmacSha256, bytes)` before signing the data.

Signature diagnostic examples obtain `Signature.Signature` with `try` before signing, verifying or generating a key pair. Building keys from bytes also runs an Effect: use `try Signature.privateKey(Signature.ed25519, bytes)` or `try Signature.publicKey(Signature.ed25519, bytes)`.

Authenticated-encryption diagnostic examples obtain `Aead.Aead` with `try` before running `encrypt` or `decrypt`. Build a key with `try Aead.key(Aead.aes256Gcm, bytes)`, then pass that key, the bytes and `{ nonce }` to the service method.

Environment diagnostic examples run `Config.String("NAME")` directly with `try`. A config value is an Effect; it is not called again as a function.

Every service example in platform advice obtains the injected service first, then reads or calls its member: `try (try Geolocation.Geolocation).getCurrentPosition()`, `try (try Permissions.Permissions).query("geolocation")`, `try (try UserDirectories.UserDirectories).home`, and for the experimental services `try (try Experimental.Process.Process).pid`, `try (try Experimental.FileSystem.FileSystem).access(path, { executable: true })` and `try (try Experimental.Locks.Locks).hold(name)`. A module is a namespace, not a service, so `Experimental.Process.pid()` names no function.

Timer-cancellation advice uses `try Fiber.interrupt(fiber)`. The public `Fiber` module function returns an Effect; `try` runs it.

Timer advice runs a delay with `try sleep("1 second")`. Repetition runs in the background with `fork effect { try repeat(program, Schedule.spaced("1 second")) }`; keep its fiber when it needs interruption. Constructing either Effect alone starts no timer.

Clipboard advice first obtains the injected `Clipboard.Clipboard` service. Its `readString` member is an Effect value: `try (try Clipboard.Clipboard).readString` reads the text.

The `versions` member of the `Experimental.Process.Process` service supplies a map of component versions, matching `process.versions`. On Node, `process.version` is the `node` entry with a leading `v`; selecting that entry alone omits the prefix. Keep a runtime-specific version read in a `.ts` adapter when it does not follow Node’s spelling.

A numeric return value from `main` does not set the exit status:
`effect function main(): number!! { return 3 }` succeeds with 3 and still exits 0 when passed to `NodeRuntime.runMain`. Return normally for exit 0,
fail for exit 1, or interrupt for exit 130.

`globalThis` is available only as the object of a statically named member access: `.name`, `?.name`, a string-literal key or a template key without substitutions. Copying the object, destructuring it, passing or spreading it, using it with `in` or value-level `typeof`, or reading a nonliteral key reports `EK0107`; move that code to a `.ts` file. A repeated `globalThis.globalThis` also has to be a static member's object. Type queries and local bindings with the name `globalThis` keep their TypeScript meaning. Static access still follows the platform and dynamic-code rules.

`globalThis.eval` and `globalThis.Function` follow the same `EK0107` rule as the bare names. The `Function` exemptions also apply: `x instanceof globalThis.Function` and `globalThis.Function.prototype` are allowed.

`import.meta` gives a `.vibe` file only `import.meta.url`, its module identity (VIP-33, amended). `import.meta.dirname`, `import.meta.filename` and `import.meta.env` read host state, as `__dirname`, `__filename` and `process.env` do, and take the same replacements. In the specification's explicit module spelling, first read `try Path.Path`, then call `fromFileUrl` and `dirname` on that service. Every other member, `import.meta.resolve` included, and every other use of `import.meta` as a value reports `EK4402`. Aliases, destructuring, computed keys, arguments and spreads are rejected, including inside `Effect.try`, `tryPromise` or `sync` callbacks. Direct `import.meta.url` reads keep working. Parentheses and erased TypeScript wrappers such as `as`, `satisfies` and non-null assertions preserve this URL read, as in `(import.meta as ImportMeta).url`. Put module resolution in a TypeScript helper:

```ts
// resolve-module.ts
export function resolveModule(specifier: string): string {
  return import.meta.resolve(specifier)
}
```


## The replacements at work

Each call above, in an effect function. A function that calls a service needs its layer at the application boundary, such as `NodeServices.layer` from `@effect/platform-node`:

```vibe
import { resolveModule } from "./resolve-module.ts"

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
  const resolved = try Effect.try(() => resolveModule(specifier))
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
  try sleep("1 second")
  try yieldNow
  const fiber = fork effect { try repeat(program, Schedule.spaced("1 second")) }
  try Fiber.interrupt(fiber)
  return { name, args, directory, here, file, line, random, id, roll, digest, encoded, byteLength, empty, joined, response, socket, stored, events, millis, nanos }
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

The platform check also recognizes optional accesses, string-literal and template-literal keys without substitutions, and repeated `globalThis.globalThis` objects. For example, ``globalThis[`fetch`]`` and `globalThis.globalThis.fetch` report the same `EK4402` as `globalThis.fetch`. Local shadows and erased type queries keep their TypeScript meaning.

Host globals outside the replacement table are checked by their resolved declarations too. For example, value reads of `FileReader`, `WebAssembly`, window properties such as `name`, and `globalThis.Headers` report `EK4402`. Local properties and erased type queries remain allowed; Effect's in-scope namespaces retain precedence over host names.

An unresolved name or property keeps TypeScript's normal diagnostic. Without DOM declarations, for example, `fetch` reports `TS2304`; missing Node.js declarations can produce `TS2591`. Platform diagnostics apply to values that resolve to host declarations.

EK4402 is a static, lint-strength check, not a sandbox or a
security boundary. They recognize direct uses, statically named members of `globalThis`, and
aliases, which keep the symbol they copy. Any other use of `globalThis`, such as
`const g = globalThis`, a computed key, a cast or an argument to `Reflect.get`, is EK0107. Use process isolation when running untrusted
code.

The same code covers the other legacy JavaScript the language removes anywhere in a `.vibe` file, plain functions included: `eval`, direct or indirect; the `Function` constructor, except `x instanceof Function` and `Function.prototype`; `arguments`, replaced by a rest parameter; `with`; reading `constructor` from a function value; and a string-literal `data:` or `blob:` import specifier. Grouping and erased type assertions keep the `instanceof Function` and `Function.prototype` exemptions: `x instanceof (Function)` and `(Function as FunctionConstructor).prototype` are allowed. Property names such as `o.eval` and the type `Function` keep their TypeScript meaning. The qualified exemptions also survive erased wrappers: `x instanceof (globalThis.Function as FunctionConstructor)` and `(globalThis.Function as FunctionConstructor).prototype` are allowed, as are their `satisfies` and non-null forms. Code that needs one of these lives in a `.ts` or `.js` file.

Optional access keeps the function-constructor rule: `f?.constructor` and `f?.["constructor"]` report `EK0107` when the non-nullish receiver is a function or `Function`. Optional access on an ordinary object or `any`, and deleting a property without reading it, retain their TypeScript rules. Destructuring reads the same property, so `const { constructor: C } = f` and `({ constructor: C } = f)` report it too.

An object shorthand such as `{ Function }` reads its value binding, so a reference to the global constructor is `EK0107`; a local binding named `Function` stays allowed.

The qualified `Function.prototype` exemption recognizes literal keys through parentheses and erased assertions, for example `globalThis.Function[("prototype" as const)]`. A key read through a variable remains a computed key, even when its value is `"prototype"`.

`Date.now()`, `Date()`, `new Date()`, and `Intl.DateTimeFormat().format()` with no
argument read the current clock without a diagnostic. Read time through `try Clock.currentTimeMillis` and pass that
value to the formatter when you need controlled time, including in tests.


## Namespace aliases

A qualified namespace alias such as `import NativeModule = WebAssembly.Module` also reads the host global and reports `EK4402`, even when the alias is unused. Only an alias target with a value meaning reads the host: namespaces containing only types and direct interface aliases retain their TypeScript rules, as do local or imported namespaces, `globalThis.Intl`, and erased type queries. `vibelang --fix` removes an unused alias only when TypeScript already erases it from runtime and declaration output. It preserves aliases with references or exports, script aliases, `verbatimModuleSyntax` aliases, and commented or escaped source; move a needed host alias into a `.ts` adapter.

A grouped string key keeps its static member name: `f[("constructor")]` reports `EK0107` for a function value, while `Function[("prototype" as const)]` keeps the prototype exemption. Erased assertions do not change the key.

## Literal module URLs

A string-literal `data:` or `blob:` specifier in an import or re-export reports `EK0107`: these module URLs supply code in a string. URL-equivalent scheme spellings, including uppercase letters and ASCII whitespace, get the same diagnostic. Move the import into a `.ts` helper and call it through `Effect.tryPromise`:

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

A computed `import(specifier)` stays unchecked by this rule. Type-level `import(…)` queries keep their TypeScript meaning.

For an inherited child whose cancellation must return without waiting for exit,
`Experimental.ChildProcess.ChildProcess` provides `runInherited(command, args,
{ cwd, shell })`. Provide `ExperimentalNodeChildProcess.layer` or
`ExperimentalBunChildProcess.layer`. Ordinary commands, pipes and stdio streams
use Effect's `ChildProcessSpawner`.

For a native mutable copy of Web headers, `try (try Experimental.Headers.Headers).copy(input)` preserves duplicate-cookie behavior; provide `ExperimentalNodeHeaders.layer`, `ExperimentalBunHeaders.layer` or `ExperimentalBrowserHeaders.layer`.

For a Web response body that must become a Node readable, `try (try Experimental.NodeStream.NodeStream).fromWeb(body, { response, signal })` takes ownership eagerly and cancels the reader when the response closes. Provide the Node or Bun layer.

To construct a native `Request` at a different URL while retaining its body, headers and signal, use `try (try Experimental.Request.Request).atUrl(url, request)` with the Node, Bun or browser layer.

### Scoped IPv6 predicates

Replace `node:net`'s `isIPv6` with the pure `Experimental.NetAddress.isIPv6(address)` when Node's scoped-host syntax must be retained. It needs no layer or `try`. It delegates bare IPv6 parsing to Effect and preserves Node's ASCII zone syntax, including numeric scope strings beyond the unsigned 32-bit range. Effect's own `NetAddress.ipv6FromString` remains the bare-address decoder.

Object shorthand keeps a host alias's identity: reading `{ timeout }` after `const timeout = AbortSignal.timeout` has the same platform restriction as reading `timeout` directly. A local parameter or another shadowing binding keeps its own meaning.

A type query such as `typeof timeout` is erased and does not read the host, even when `timeout` aliases `AbortSignal.timeout`. Value uses of the same alias still follow the platform rule.
