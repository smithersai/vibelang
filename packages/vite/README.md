# vibelang-vite

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

Compile `.vibe` modules with the native VibeLang compiler in Vite and Vitest.
The compiler owns type and language diagnostics. The plugin serves its JavaScript
and source maps, reports errors in the terminal and Vite overlay, and invalidates
source modules and their importers after edits.

## Install

```sh
npm install --save-dev vibelang vibelang-vite vite
# For tests:
npm install --save-dev vitest@5.0.5 @effect/vitest@4.1.0
```

The plugin compiles with the `vibelang` package, a peer dependency, through its
`vibelang/project` backend. It supports Vite 7 and 8 on Node 22.22.3 (22.x) or Node 24.11.1 or later; the
acceptance tests use Vite 8 and Vitest 5. `create-vibelang` apps already include
the plugin and a Vitest configuration.

The plugin awaits compiler teardown when a build, dev server, or watcher
closes. A short compile may finish; after 500 ms it receives `SIGTERM`, and
after another 500 ms it receives `SIGKILL` and its output pipes close.
A reused plugin starts a fresh backend for its next build.

## Configure Vite

```ts
// vite.config.ts
import { defineConfig } from "vite"
import vibelang from "vibelang-vite"

export default defineConfig({ plugins: [vibelang()] })
```

Keep your normal `tsconfig.json` with the `.vibe` sources included; the plugin
uses the same compiler options and diagnostics as `vibelang -p tsconfig.json`.
Import local sources as `./welcome.vibe`; imports `vibelang` rewrites to
`./welcome.js` resolve back to `welcome.vibe` in Vite's module graph. A
`module` declaration of `welcome.vibe` is a module of its own,
`welcome.vibe.text.js`, which the plugin serves from the same compile.

A `.vibe` module of another workspace package, such as one that your app or
test imports by name, compiles with the nearest `tsconfig.json` above it: its
own package's project, with that package's settings. That holds outside Vite's
root and for a package nested inside it, a directory with its own
`package.json` and `tsconfig.json`. Each project compiles once, and again after
an edit.

Set `"rewriteRelativeImportExtensions": true` in `compilerOptions`. Without it,
a `.ts` file that imports `./welcome.vibe` fails with TS5097, and
`"allowImportingTsExtensions": true` alone fails with TS5096, because the
plugin emits JavaScript. If `tsconfig.json` has `"files": []` and only lists
`references`, as Vite's templates do, pass the referenced configuration that
includes your sources: `vibelang({ project: "tsconfig.app.json" })`.

## Configure Vitest

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang()],
  test: { include: ["src/**/*.test.vibe"] }
})
```

```ts
// src/answer.test.vibe
import { assert, it } from "@effect/vitest"
function answer() {
  return Effect.succeed(42)
}

it.effect("answers") {
  assert.strictEqual(answer(), 42)
}
```

Run `bunx vitest run`, or `bunx vitest` for watch mode; no prior emission to
`dist/` is needed. `assert` and `expect` from `@effect/vitest` are trusted
exports of an Effect package, so a test calls them directly. A failed
assertion's stack points to its `.vibe` source line. Coverage with
`@vitest/coverage-v8` counts the code you wrote: one function for each
function in a `.vibe` module, and none for the thunks and generators the
compiler makes, which map to no source position (D36).

## Options

```ts
vibelang({
  project: "tsconfig.test.json", // Relative to Vite's root; default: tsconfig.json.
  compiler: "/absolute/path/to/vibelang", // Native binary or Node launcher.
  register: true // Vitest: processes a test starts load vibelang/register; default: false.
})
```

`register: true` is for suites that start Node on source, such as a test that
runs a command-line program from `src/bin.ts`. The plugin adds `--import` of
`vibelang/register`, by absolute URL, to the tests' `NODE_OPTIONS`, keeping any
value the configuration or the environment already sets, so a child process
imports `.vibe` modules from any working directory. A child given an
environment of its own, without `NODE_OPTIONS`, does not inherit it.

By default, the plugin resolves `vibelang` from the application's root and runs
the native compiler its Node launcher would run. Without a `compiler` option,
`VIBELANG_BINARY` selects a native binary.

## How it works

v0 runs one `vibelang` subprocess for the whole project on the first module request
and after each source change; requests share that compilation. Each plugin
instance owns an output directory under `node_modules/.vibelang/vite-*`, removed
when Vite closes. It forces JavaScript and source-map emission, embeds source
content, checks and emits only the files under the root (`--loader-root`), and
disables declarations and incremental output.
Source paths in compiler maps resolve to the original files before Vite composes
the maps for its transformations. Each hook returns an independent map, so
Vite's path rewriting leaves the compiler's cached source paths and embedded
source text intact for later requests, including inline module outputs.

The Vite root must contain the project's source files; the plugin overrides
`rootDir` to that root so emitted paths are predictable. Normal application
`dist/` output stays separate. Each change invalidates all loaded `.vibe`
modules and their transitive importers, a conservative rule
that covers exported contract and control changes without duplicating compiler
logic. Direct HTTP requests for `.vibe` files enter Vite's module transform pipeline.
Vitest keeps transforms between runs (`fsModuleCache`), keyed by a module's own
text; the plugin keeps `.vibe` modules out of that cache, since their JavaScript
also depends on the compiler and on the modules they import.

The plugin never implements language syntax or lowering; prelude, service,
program, and cross-file import support comes from the installed compiler.
A compiler error in the loaded source, or a project-wide error, blocks JavaScript serving, shows its original diagnostic text
and source location in the overlay, and clears on the next successful edit.

## Acceptance checks

For contributors, from the VibeLang repository root:

```sh
sh scripts/build-vibelang.sh
cd packages/vite
bun install
bun run test
```

The harness runs a passing `.vibe` suite through Vitest, then checks an expected
failure at `failure.test.vibe:6:28`. A real HTTP server check covers JavaScript,
source maps, importer invalidation, terminal and overlay diagnostics, and recovery.
A production build checks `.vibe` entry support. A coverage check runs
`test/coverage`, `.vibe` modules beside the Effect TypeScript an author would
write, under `@vitest/coverage-v8`: each `.vibe` module reports one function for
each function in its source, and no more uncovered functions, statements, or
branches than its TypeScript. Each check removes its temporary projects and
compiler output.

The template and the users, http-api, and resilience examples also use this
plugin for their source tests. Their advanced language features require the
corresponding compiler lanes; the acceptance fixtures above use explicit Effect
imports and plain and Effect functions supported by the initial compiler.

The source loaders compile the whole project for type-directed emit, but report
only diagnostics for the source being loaded and project-wide errors, including
configuration diagnostics.
An unrelated file's type errors do not prevent loading a clean module. Run
`vibelang -p tsconfig.json` to check every project file.
