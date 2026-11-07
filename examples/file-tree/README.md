# File tree

A recursive function snapshots regular files, then an `effect function*` producer yields their paths.
`for try` consumes the producer; `Effect.forEach` reads files with concurrency 4.
The recursion accumulates into an array and returns void. Because it is recursive,
it writes out its contract, `void!PlatformError!FileSystem | Path`.
`FileSystem` and `Path` come from Effect. The written runner in `src/entry.vibe` provides `NodeServices.layer` to `main()` and starts the application.
Canonical directory paths prevent revisiting a directory through symbolic links.

Run from this directory so `fixtures` resolves to the bundled sample tree:
```sh
bun install
bun run build
bun run start
```

The ordered output counts lines in the two fixture files.
The concurrent read in Effect TypeScript is:
```ts
const lengths = Effect.forEach(files, (path) => Effect.gen(function* () {
  const fs = yield* FileSystem
  const paths = yield* Path
  const text = yield* fs.readFileString(path)
  return { path: paths.relative(root, path), lines: text.trimEnd().split("\n").length }
}), { concurrency: 4 })
```

The prototype widens an inferred recursive E and R to `unknown`; the written contract states them.
