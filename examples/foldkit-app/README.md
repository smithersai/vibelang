# Foldkit app

A [Foldkit](https://github.com/foldkit/foldkit) 0.169.0 application in the Elm architecture:
a counter, a todo list, and one HTTP command that loads a quote.
`src/main.vibe` is the VibeLang version; `ts/main.ts` is the same app in
Effect TypeScript. `src/entry.ts` mounts the VibeLang version.

From this directory, with `vibelang` on `PATH`:

```sh
bun install
bun run dev    # serves the app with Vite
bun run test   # type check, Vitest, production build
```

`test/app.test.ts` runs one suite against both versions: Foldkit `story`
tests of `update`, and the HTTP command with an in-memory `HttpClient`, so no
request leaves the process.

Foldkit calls in Effect code use `Effect.try` and `Effect.orDie`, keeping
JavaScript exceptions as defects. `update` and `view` declare plain return
types, which Foldkit's runtime needs: `update` returns `{ model, commands }`.
The retired `trustedPackages` setting is ignored; it cannot replace these
call boundaries.

[pairs/](pairs/) holds real before-and-after code from the Foldkit migration.
