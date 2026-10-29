# VibeLang app

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

```sh
bun run start
bun run dev
bun run test
```

This project was created from the VibeLang starter. If its dependencies are not
installed yet, for example after `--no-install`, run `bun install` first.

`start` builds the project and prints `Hello, VibeLang!` and
`Recovered from EmptyName`. `dev` builds once, then runs `vibelang --watch` and
Node's output watcher together; press Ctrl+C to stop both. Vitest runs
`src/**/*.test.vibe` through `vibelang-vite` and `@effect/vitest`. The plugin
checks the project with `vibelang`, serves compiled JavaScript from
`node_modules/.vibelang/`, and maps assertion stacks to the original `.vibe`
lines. `test` needs no prior build.

Edit `src/main.vibe` for the service and layer, and `src/greeting.vibe` for
a typed failure. Import local `.vibe` source files; the compiler emits `.js`
imports. Source maps connect Node debugging to those sources.

## Debugging failures

During development, set `vibelang.tracing` to `"all"` at the top level of
`tsconfig.json`:

```json
{ "vibelang": { "tracing": "all" } }
```

Merge this setting into your existing config, then rebuild or restart
`bun run dev`. It adds source-located spans for local and exported function
calls, making the caller chain visible when a defect occurs. Tracing adds
runtime work; the default is `"none"`. See
[Debug stack traces](https://vibelang.sh/getting-started/012-devtools#debug-stack-traces).

## Editor

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
# Or, for Cursor:
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix
```

Then open this directory. The extension starts this project's compiler as the
language server.

## Versions

`vibelang`, `vibelang-runtime`, and `vibelang-vite` share one version. Update them
together:

```sh
bun add vibelang-runtime@latest
bun add -d vibelang@latest vibelang-vite@latest
```

Keep `effect`, `@effect/platform-node`, and `@effect/vitest` at 4.1.0: the
runtime requires that exact Effect version.

