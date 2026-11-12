# VibeLang app

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

```sh
bun run start
bun run dev
bun run test
bun run format
bun run check
```

This project was created from the VibeLang starter. If its dependencies are not
installed yet, for example after `--no-install`, run `bun install` first.

`start` builds the project and prints `Hello, VibeLang!` and
`Recovered from EmptyName`. `dev` builds once, starts `vibelang --watch`, then starts Node's output watcher
only after the compiler is watching; press Ctrl+C to stop both. Vitest runs
`src/**/*.test.vibe` and `src/**/*.test.vibex` through `vibelang-vite` and `@effect/vitest`. The plugin
checks the project with `vibelang`, serves compiled JavaScript from
`node_modules/.vibelang/`, and maps assertion stacks to the original `.vibe`
lines. `test` needs no prior build.

`format` formats the `.vibe` files with `vibelang format --write`. `lint` runs `vibelang lint`, the type checker with VibeLang's and Effect's lint rules, over sources and tests; `check` runs `vibelang format --check`, then `lint`, and fails on either, for CI.

Each build also writes a declaration pair per module for stock TypeScript tools,
`greeting.d.vibe.ts` and the forwarding `greeting.d.ts`, with hidden
`.vibelang-sidecar-*.owner` receipts. `vibe.sidecarDir` in `tsconfig.json` keeps
them in `.vibe/declarations/`, which `.gitignore` lists with `dist/`, so `src/`
holds only your sources.

Edit `src/main.vibe` for the service and layer, and `src/greeting.vibe` for
a typed failure. Look up the service with `try Greeter`, then call its methods;
recover failures with a `catch effect` handler. `NodeRuntime.runMain(main())`
starts the program explicitly. Import local `.vibe` source files; the compiler emits `.js`
imports. Source maps connect Node debugging to those sources.

## Debugging failures

Run emitted JavaScript with `node --enable-source-maps` to map failures back
to `.vibe` lines. Add operation spans explicitly with
`try withSpan(program, "checkout")`. See
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

Keep `effect`, `@effect/platform-node`, and `@effect/vitest` at 4.1.1: the
runtime requires that exact Effect version. The project keeps the transitive
`@effect/platform-node-shared` helper at that version through npm/Bun
`overrides` and Yarn `resolutions`.

