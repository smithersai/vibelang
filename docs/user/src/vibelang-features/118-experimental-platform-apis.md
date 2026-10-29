# Experimental platform APIs

VibeLang adds the few platform APIs that Effect does not have yet. They are experimental: a release can change or remove them, and each goes when Effect ships the API. Where Effect has the service, the experimental one extends it, so the rest of the service is Effect's own; where Effect has none, the experimental service follows Effect's style. Each addition lives under `Experimental.X` and can be proposed upstream.

| Service | Adds | Layers |
| --- | --- | --- |
| `Experimental.FileSystem` | `access(path, { executable })`, `open(path, { nonBlocking })`, `File.chmod` | Node, Bun |
| `Experimental.Crypto` | `hmac`, `sign`, `verify`, beside the members of Effect 4.0's `Crypto` | Node, Bun, browser |
| `Experimental.Process` | the process id, platform, host name and other facts; `kill`, `isRunning` | Node, Bun |
| `Experimental.Locks` | `hold`, `tryHold`, `query` over Web Locks | browser; Node within one process |

`Experimental` is in scope in every `.vibe` file without an import, as Effect's modules are. A local declaration or an import named `Experimental` shadows it. TypeScript imports the same modules from `vibelang-runtime/experimental`, or one module from its subpath, such as `vibelang-runtime/experimental/FileSystem`.

## How they work

Each experimental service has its own key, such as `Experimental.FileSystem.FileSystem`. Look up its implementation with `const fs = try Experimental.FileSystem.FileSystem`, then run a member with `try fs.access(path, { executable: true })`. A contract names the key type in its requirements: `boolean!PlatformError.PlatformError!Experimental.FileSystem.FileSystem`.

The experimental `FileSystem` and `Crypto` keys are class services, as Effect declares them. `Experimental.FileSystem.Service` is Effect's interface plus the new members, and the service itself is not Effect's. Effect 4.1 removed its `Crypto` service for the family services of `effect/crypto`; `Experimental.Crypto.Service` keeps the members Effect 4.0's had, such as `randomBytes`, `digest` and `randomUUIDv4`, beside `hmac`, `sign` and `verify`. A layer of Effect's `FileSystem` therefore never provides the experimental one, in VibeLang and in stock TypeScript alike, because at run time it provides a different key. Type an implementation as `Experimental.FileSystem.Service`. `Process` and `Locks` extend nothing, so `Experimental.Process.Process` and `Experimental.Locks.Locks` each name both the service and its implementation type, as Effect's `FileSystem` is. The module's own exports keep their meaning, as `Experimental.FileSystem.layerNoop` does. An import by name from the subpath, `import { FileSystem } from "vibelang-runtime/experimental/FileSystem"`, works too, and shadows the prelude's `FileSystem`.

Provide a platform layer at the application boundary. The layers live beside Effect's platform packages. A layer of a service that extends Effect's provides the experimental service and Effect's service of the same name from one implementation, so code that uses Effect's `FileSystem` and code that uses the additions share it:

| Module | Layers |
| --- | --- |
| `vibelang-runtime/experimental/platform-node` | `ExperimentalNodeServices.layer`: `@effect/platform-node`'s bundle plus `FileSystem`, `Crypto` and `Process`; `ExperimentalNodeFileSystem.layer`, `ExperimentalNodeCrypto.layer`, `ExperimentalNodeProcess.layer`; `ExperimentalNodeLocks.layer`, within one process |
| `vibelang-runtime/experimental/platform-bun` | `ExperimentalBunServices.layer`: `@effect/platform-bun`'s bundle plus `FileSystem`, `Crypto` and `Process`; `ExperimentalBunFileSystem.layer`, `ExperimentalBunCrypto.layer`, `ExperimentalBunProcess.layer` |
| `vibelang-runtime/experimental/platform-browser` | `ExperimentalBrowserServices.layer`: `Crypto`, `@effect/platform-browser`'s crypto services and `Locks`; `ExperimentalBrowserCrypto.layer`, `ExperimentalBrowserLocks.layer` |

`ExperimentalNodeServices.layer` replaces `@effect/platform-node`'s `NodeServices.layer`: it provides every service Effect's does. Each `Crypto` layer, such as `ExperimentalNodeCrypto.layer`, provides the experimental `Crypto` and the platform's Effect crypto services, such as `SecureRandom` and `Digest`; the bundles for Node and Bun, like Effect's, hold none of Effect's crypto services. The runtime lists `@effect/platform-node`, `@effect/platform-bun` and `@effect/platform-browser` as optional peer dependencies: install the one your program runs on. Failures are Effect's `PlatformError`, as for Effect's services.

## FileSystem

| Member | What it does | Node.js |
| --- | --- | --- |
| `access(path, { executable: true })` | Checks that the caller may run the file; on Windows, only that it exists | `fs.access(path, X_OK)` |
| `open(path, { nonBlocking: true })` | Opens a FIFO or a device without waiting for the other end; Windows fails with `BadArgument` | `O_NONBLOCK` |
| `file.chmod(mode)` | Changes the permissions of the file the handle opened, even after its path was renamed or replaced | `FileHandle.chmod` |

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
// run: provide ExperimentalNodeServices.layer { try Console.log(JSON.stringify(try runnable())) }
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"

effect function canRun(path: string) {
  const fs = try Experimental.FileSystem.FileSystem
  try fs.access(path, { executable: true })
  return true
}

effect function runnable() {
  return try scoped(effect {
    const fs = try FileSystem
    const dir = try fs.makeTempDirectoryScoped()
    try fs.writeFileString(`${dir}/build.sh`, "#!/bin/sh")
    try fs.chmod(`${dir}/build.sh`, 0o755)
    try fs.writeFileString(`${dir}/notes.txt`, "")
    return { script: canRun(`${dir}/build.sh`) catch false, notes: canRun(`${dir}/notes.txt`) catch false }
  })
}
// Output: {"script":true,"notes":false}
```

`lstat`, which reads a symbolic link itself, is Effect's own since Effect 4.0.6, so it needs no experimental service.

`noFollow` with `nonBlocking` opens a path that another process may replace: the open fails on a symbolic link and returns at once on a FIFO, and `file.chmod` then changes the file that was opened, not whatever the path names later.

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-33
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
// pending: VIP-1, VIP-5, VIP-12, VIP-14, VIP-33
// run: provide ExperimentalNodeServices.layer { try Console.log(try signature(Redacted.make(new TextEncoder().encode("Jefe")), "what do ya want for nothing?")) }
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"

effect function signature(secret: Redacted.Redacted<Uint8Array>, body: string) {
  const crypto = try Experimental.Crypto.Crypto
  return Hex.encode(try crypto.hmac("SHA-256", secret, new TextEncoder().encode(body)))
}
// Output: 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
```

`Experimental.Crypto.layerTest()` provides the service for tests: random bytes are zeros, so UUIDs repeat, and digests, HMACs and signatures are real.

## Process

```vibe
// alive.vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-26, VIP-33
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
| `try process.availableParallelism` | at least 1 | `os.availableParallelism()` |
| `try process.timeOrigin` | when the process started, in epoch milliseconds | `performance.timeOrigin` |
| `try process.memoryUsage` | `{ rss, heapTotal, heapUsed, external, arrayBuffers }` in bytes | `process.memoryUsage()` |

The user's home directory is Effect's own, `try (try UserDirectories.UserDirectories).home`, which needs no import (D310), provided by `UserDirectories.layer`. A browser has no process to read, so `Process` has no browser layer.

### Signalling processes

```vibe
// stop.vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-26, VIP-33
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

Both fail with a `PlatformError` whose reason says why:

| Reason | When |
| --- | --- |
| `NotFound` | No process has that id. |
| `PermissionDenied` | This process may not signal it. |
| `BadArgument` | `pid` is not a positive integer, the platform has no such signal, or `group` on Windows. |

### Testing with `Experimental.Process.layerTest`

```vibe
// platform-name.vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
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
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
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

## When Effect ships them

Each addition has a matching change prepared for Effect. When an Effect release has the member, the experimental module re-exports Effect's, and a later VibeLang release removes the module (D313).
