# Vite and Vitest

`vibelang-vite` compiles `.vibe` modules for Vite (7 and 8) and Vitest with the project's `vibelang` compiler. It serves JavaScript and source maps, and reports compiler errors in the terminal and in Vite's overlay. The plugin adds `.vibe` to `resolve.extensions`, so an extensionless import or a directory's index (`./mount` for `mount/index.vibe`) reaches a `.vibe` module as it reaches a `.ts` one. As in TypeScript, `x.vibe` comes after `x.ts` and `x.tsx` but ahead of an `x.js` beside it. Install the packages with [Add VibeLang to an existing project](existing-project.md) first.

Closing the Vite build, dev server, or watcher waits for the plugin's compiler
and closes its output pipes. A short compile can finish; after 500 ms teardown
sends `SIGTERM`, then after another 500 ms sends `SIGKILL` if needed.
A later build with the same plugin starts a fresh backend.

The plugin selects `vibelang-source` package exports for application and SSR
bundles, preserving the existing resolution conditions. Under Vitest, which
passes its conditions to the Node processes that run tests, the defaults are
Vitest's own, which leave out `module`: Node then loads a dependency through
its `default` export, as it does without the plugin. A workspace package
that mixes `.ts` and `.vibe` modules therefore uses one source graph, even
when its default export points at emitted JavaScript under `.vibelang/js`.


## 1. Add the plugin to Vite

Add `vibelang()` to the `plugins` array in `vite.config.ts`, beside the existing plugins:

```ts
// TypeScript (.ts)
// vite.config.ts
import { defineConfig } from "vite"
import vibelang from "vibelang-vite"

export default defineConfig({ plugins: [vibelang()] })
```

### Workers in the app or its workspace dependencies

Vite builds workers with `worker.plugins`. Add a factory there when a worker
imports `.vibe`, including workers started inside a workspace dependency:

```ts
// TypeScript (.ts)
import { defineConfig } from "vite"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang()],
  worker: { plugins: () => [vibelang()] }
})
```

The factory creates a fresh plugin for each worker build. Migration setup
follows local workspace dependencies to detect these workers and adds the
factory to the consuming app's config. Test and fixture sources do not trigger
this edit.

### When the Vite config imports a VibeLang module

Vite loads `vite.config.ts` before creating its plugins. If that config, or a
helper it imports, imports a `.vibe` module, start Vite with the Node source
hook and select Vite's native config loader:

```sh
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" npx vite build --configLoader native
```

Use the same prefix and `--configLoader native` for the dev server and preview.
The config file itself can be VibeLang too: name it, `vite build --configLoader
native --config vite.config.vibe`, since Vite discovers no `.vibe` config by name.
Keep `vibelang()` in the config to compile application modules. The default
`bundle` config loader parses native syntax before the plugin exists, and
`runner` does not install the Node source hook. Setting `configLoader` inside
the config is too late; the CLI flag (or an inline `configLoader: "native"`
option passed to Vite's JavaScript API) selects how Vite first loads it.

Native loading uses Node's ESM resolution and TypeScript support. Keep explicit
source extensions in config helpers' relative imports and use package exports
instead of `tsconfig.json` path aliases. The hook compiles each native module
with its nearest `tsconfig.json`; if a config helper needs another project,
set `VIBELANG_PROJECT=tsconfig.node.json` and include the helper there.
On Vite versions without native dependency watching, restart the dev server
after editing a config dependency. `VIBELANG_REGISTER_DEBUG=1` reports loader
compiles and cache hits when diagnosing config startup.

Migration setup detects runtime imports and re-exports into existing native
modules or the selected source directories, including transitive config
helpers, and wires the affected `vite` package scripts. Type-only imports
do not need this path. Setup reports a config without a matching script so
its caller can supply the same preload and flag.

## 2. Configure tsconfig.json

Support for the new forms and configuration files arrives with the compiler's VIP implementation.

The plugin compiles the project `tsconfig.json` describes, with its options and diagnostics. Its compile backend automatically enables `rewriteRelativeImportExtensions` when emitting JavaScript, so source imports such as `./greet.vibe` work with Vite's `allowImportingTsExtensions` configuration. Check two things:

1. `include` selects the app's `.vibe` files under Vite's root. A `.vibe` file of another workspace package, such as one the app imports by name, compiles with the nearest `tsconfig.json` above it instead: that package's own project. This holds outside the root and for a package nested inside it, one with its own `package.json` and `tsconfig.json`.
2. If `tsconfig.json` has `"files": []` and only lists `references`, as Vite's templates do, pass the referenced configuration that includes `src` to the plugin, for example `vibelang({ project: "tsconfig.app.json" })`.

When emitting JavaScript directly with the `vibelang` CLI, set `"rewriteRelativeImportExtensions": true` in that project's `compilerOptions`. It permits source-extension imports and rewrites them for the emitted JavaScript; `allowImportingTsExtensions` alone produces TS5096 during CLI emission ([CLI setup](vibelang-cli.md#1-configure-tsconfigjson)).

## 3. Add a first module

Create `src/greet.vibe`:

```vibe
// src/greet.vibe
// run: try Console.log(try greet("Vite"))
export effect function greet(name: string) {
  return `Hello, ${name}!`
}
// Output: Hello, Vite!
```

With Vite or Vitest, import it from `.ts` or `.vibe` modules by its source name, `./greet.vibe`, so the plugin loads and compiles the source. For a CLI build that emits JavaScript to run with Node, a `.ts` importer can instead use `./greet.js`; VibeLang resolves it to `greet.vibe` while checking, and Node loads the emitted `greet.js` ([CLI setup](vibelang-cli.md#3-compile-a-first-module)). TypeScript sees `greet` as a function that returns an Effect, so a `.ts` module can run it with one of Effect's runners:

```ts
// TypeScript (.ts)
// src/use-greet.ts
// run: console.log(message)
import { Effect } from "effect"
import { greet } from "./greet.vibe"

export const message = Effect.runSync(greet("Vite"))
// Output: Hello, Vite!
```

### Queries on a `.vibe` import

Vite's own module queries name the module itself: `?import`, `?v=` and `?t=`, which Vite adds, and the worker entry's `?worker_file&type=`. The plugin compiles those ids. Any other query, such as `./x.vibe?raw`, `./x.vibe?url` or a plugin's own `./x.vibe?highlighted`, names a resource that Vite or another plugin loads from the same source. The plugin leaves such an id alone, so a plugin that serves `x.ts?highlighted` as rendered HTML serves `x.vibe?highlighted` the same way, and `?raw` gives the `.vibe` source text.

## 4. Test with Vitest

The starter's app project excludes test sources. Create `tsconfig.test.json` so Vitest checks and compiles them too:

```json
{
  "extends": "./tsconfig.json",
  "exclude": []
}
```

If the app uses `tsconfig.app.json`, extend that file instead. Keep the test project's `include` broad enough to select both the app and its tests.

Create `vitest.config.ts`, or add the plugin and the `include` pattern to the project's existing Vitest configuration. Pass the test project to the plugin:

```ts
// TypeScript (.ts)
// vitest.config.ts
import { defineConfig } from "vitest/config"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang({ project: "tsconfig.test.json" })],
  test: { include: ["src/**/*.test.vibe"] }
})
```

Create `src/greet.test.vibe`:

```vibe
// src/greet.test.vibe
import { assert, it } from "@effect/vitest"
import { greet } from "./greet.vibe"

it.effect("greets", () => effect {
  const message = try greet("Vite")
  try Effect.try(() => assert.strictEqual(message, "Hello, Vite!"))
})
```

Run `npx vitest run`. Tests need no prior build. The output includes:

```out
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

If a test starts a Node process that runs the project's source, such as a command-line program, pass `vibelang({ project: "tsconfig.test.json", register: true })`. The plugin adds `vibelang/register` to the tests' `NODE_OPTIONS`, so that process imports `.vibe` modules too, whatever its working directory. Any `NODE_OPTIONS` the configuration or the environment already sets is kept. A Bun process a test starts, such as `process.execPath` under `bun x --bun vitest`, reads `BUN_OPTIONS` instead, so the plugin also adds `--preload` of `vibelang/bun` there, unless that file's path contains a space, which `BUN_OPTIONS` cannot carry.

When using Vitest's `test.projects`, add `vibelang()` to each project's own `plugins` when its tests import `.vibe` sources. Keep the project's other plugins and test options. A plugin on the outer configuration alone does not configure an independent project. Use `register: true` on a project's plugin when its tests launch source-running child processes. The migrate flow wires inline projects with statically readable roots and test selectors, and reports unsupported shapes for manual setup.

### Node's test runner and Jest

For `node --test`, write a `.test.ts` suite that imports `.vibe` modules and runs their programs with `Effect.runSync` or `Effect.runPromise`. Include the suite in `tsconfig.test.json`, install `@types/node`, and add `"node"` to that project's `compilerOptions.types` (keeping any existing entries). Load the source hook and select that project:

```sh
VIBELANG_PROJECT=tsconfig.test.json node --import vibelang/register --test src/greet.test.ts
```

The repository does not provide a Jest transformer for `.vibe` sources. Use Vitest for `.test.vibe` suites.

## 5. Build

In `package.json`, replace `tsc` in the build script with `vibelang` so it checks both `.ts` and `.vibe` files, and add the test script:

```json
{
  "scripts": {
    "build": "vibelang && vite build",
    "test": "vitest run"
  }
}
```

Run `npm run build`, or `bun run build`; then run `npm run test`, or `bun run test`. The build exits with status 0, and its last line starts with `✓ built in`. Review the files you added before committing them.

## Dependency pre-bundling

A cold dev server scans the application for the packages it imports and
pre-bundles them before the first request. A `.vibe` module's JavaScript
imports packages its source does not name, such as `effect/Schema` for a
`schema` declaration, `effect/Option` for `Option`, or `vibelang-runtime`. The
plugin adds `.vibe` to `optimizeDeps.extensions` and lets the scan read each
`.vibe` module's compiled JavaScript, so these imports are pre-bundled with the
rest. Without that, Vite found them on the first request, optimized again, and
reloaded the page, which could fail a browser test already running on it. The
scan compiles each `.vibe` module it reaches once; the requests reuse that
compile. A module that does not compile scans as empty and reports its errors
when requested.

## Generated declarations

While serving a `.vibe` module, the compiler can write its `.d.vibe.ts`
declaration beside it. The plugin ignores watcher events for that generated
file while its owning `.vibe` source exists, keeping the served module and its
importers cached. Changes to the source still trigger hot updates. An authored
TypeScript declaration without a companion `.vibe` source remains an input.
Set `VIBELANG_VITE_DEBUG=1` to trace ignored generated declaration events along
with project compiles and invalidations.

## Next

Set up the editor: [VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md). Then verify with step 4 of [Set up VibeLang](../setup.md).

The source loaders compile the whole project for type-directed emit, but report
only diagnostics for the source being loaded and project-wide errors, including
configuration diagnostics.
An unrelated file's type errors do not prevent loading a clean module. Run
`vibelang -p tsconfig.json` to check every project file.


Source maps keep the original `.vibe` positions and source text through repeated
development requests and hot updates, including modules declared inside a
`.vibe` file.
