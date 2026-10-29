# FileSystem

`FileSystem` exposes Effect's portable file operations, in place of `node:fs`. Get the service with `try FileSystem`, then run its operations with `try`. Provide a runtime implementation or test layer around the application.

## Requesting the file-system service

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
// run: provide FileSystem.layerNoop({ readFileString: () => succeed('{"theme":"dark"}') }) { try Console.log(try readSettings()) }
effect function readSettings() {
  const fs = try FileSystem
  return try fs.readFileString("./settings.json")
}
// Output: {"theme":"dark"}
```

Getting the service adds `FileSystem` to the Effect's requirements. `readFileString` returns an Effect that succeeds with text or fails with `PlatformError`. The module's own exports, such as `FileSystem.layerNoop`, keep their meaning, and the key itself is `FileSystem.FileSystem`.

## Performing file operations

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14, VIP-33
// run: provide NodeFileSystem.layer { try Console.log(JSON.stringify(try saveSummary("ready"))) }
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"

effect function saveSummary(text: string) {
  const fs = try FileSystem
  try fs.makeDirectory("./output", { recursive: true })
  try fs.writeFileString("./output/summary.txt", text)
  const content = try fs.readFileString("./output/summary.txt", "utf8")
  return { content, entries: try fs.readDirectory("./output") }
}
// Output: {"content":"ready","entries":["summary.txt"]}
```

The `try` expressions run in order: the write completes before the read starts. Expected I/O failures enter E, and a `catch` expression handles them. `readFile` and `writeFile` take byte arrays where text encoding doesn't fit.

| Operations | Purpose |
| --- | --- |
| `access`, `exists` | Check accessibility or presence |
| `copy`, `copyFile` | Copy a tree or a single file |
| `chmod`, `chown` | Change permissions or ownership |
| `link`, `symlink`, `readLink` | Work with hard and symbolic links |
| `makeDirectory`, `readDirectory` | Create and list directories |
| `makeTempDirectory`, `makeTempFile` | Create temporary paths owned by the caller |
| `makeTempDirectoryScoped`, `makeTempFileScoped` | Create temporary paths with scope-managed removal |
| `open` | Open a scope-managed file handle |
| `readFile`, `readFileString` | Read bytes or text |
| `writeFile`, `writeFileString` | Write bytes or text |
| `stat`, `realPath` | Inspect metadata or resolve a canonical path |
| `remove`, `rename`, `truncate`, `utimes` | Remove, move, resize, or change timestamps |
| `stream`, `sink`, `watch` | Stream bytes, write through a sink, or observe changes |

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
// run: provide NodeFileSystem.layer { try scoped(effect { const fs = try FileSystem; const path = try fs.makeTempFileScoped(); try fs.writeFileString(path, "hello"); try Console.log(String(try fileSize(path))) }) }
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"

effect function fileSize(path: string) {
  return try scoped(effect {
    const fs = try FileSystem
    const file = try fs.open(path)
    return (try file.stat).size
  })
}
// Output: 5
```

`open` requires a Scope and registers the close itself. `scoped` supplies a Scope and closes it after its Effect completes, including on failure or interruption. Without `scoped`, the acquisition keeps Scope in R and belongs to the caller's scope.

## Supplying platform implementations

```vibe
// main.vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-26, VIP-33
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

effect function main() {
  provide NodeFileSystem.layer {
    try scoped(effect {
      const fs = try FileSystem
      const path = try fs.makeTempFileScoped()
      try fs.writeFileString(path, "Project notes")
      try Console.log(try fs.readFileString(path))
    })
  }
}

NodeRuntime.runMain(main())
// Output: Project notes
```

`NodeFileSystem.layer` supplies only the file system; providing `NodeServices.layer` instead supplies the whole Node platform bundle, and `BunServices.layer` Bun's. Application functions need only `FileSystem`, not an adapter package.

## Replacing behavior in tests

```vibe
// files.vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
// run: provide FilesTest { try Console.log(try readFixture()) }
export effect function readFixture() {
  const fs = try FileSystem
  if (!(try fs.exists("/fixtures/title.txt"))) return "Untitled"
  return try fs.readFileString("/fixtures/title.txt")
}

export const FilesTest = FileSystem.layerNoop({
  exists: (path) => succeed(path === "/fixtures/title.txt"),
  readFileString: () => succeed("Release notes")
})
// Output: Release notes
```

```vibe
// files.test.vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14
import { assert, it } from "@effect/vitest"
import { FilesTest, readFixture } from "./files.vibe"

it.effect("reads the configured title", () => effect {
  const title = try Effect.provide(readFixture(), FilesTest)
  try sync(() => assert.strictEqual(title, "Release notes"))
})
// Output:
```

`FileSystem.layerNoop` supplies a complete service with the methods you override. Its other methods fail or die; it is not an in-memory file system. Override every operation the test exercises, so unexpected access exposes a missing test behavior.

## Coming from Effect

Test overrides return Effect values explicitly. Use `() => succeed("Release notes")` for a fixed result, or an effect arrow when the implementation needs several operations.
