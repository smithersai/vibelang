# vibelang-unplugin

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

Compile `.vibe` modules with the native VibeLang compiler in webpack, Rspack,
Rollup, Rolldown, esbuild, and Bun. The compiler owns type and language
diagnostics. The plugin serves its JavaScript and source maps, reports its
diagnostics as build errors with file, line, and column, and recompiles in
watch mode. For Vite and Vitest, use [vibelang-vite](../vite/README.md).
Unicode file names and diagnostic text are preserved, including in large compiler output.
The shared load hook also compiles explicit `.vibex` JSX sources, including
module IDs with query strings, using the project's `jsx` compiler option.

## Install

```sh
npm install --save-dev vibelang vibelang-unplugin
```

The plugin compiles with the `vibelang` package, a peer dependency, through its
`vibelang/project` backend. It needs Node 22.22.3 (22.x) or Node 24.11.1 or later.

Each build releases its compiler backend, including watch rebuilds.
A compile still running during teardown gets 500 ms to finish, then
`SIGTERM`, and after another 500 ms `SIGKILL` and closed output pipes.
Closing a Rollup or Rolldown bundle or watcher, or a webpack or Rspack
compiler, also awaits teardown. Later builds start a fresh backend.

## Configure

Keep your normal `tsconfig.json` with the `.vibe` sources included; the plugin
uses the same compiler options and diagnostics as `vibelang -p tsconfig.json`.

```js
// webpack.config.js
import vibelang from "vibelang-unplugin/webpack"
export default { plugins: [vibelang()] }

// rspack.config.js
import vibelang from "vibelang-unplugin/rspack"
export default { plugins: [vibelang()] }

// rollup.config.js and rolldown.config.js
import vibelang from "vibelang-unplugin/rollup" // or vibelang-unplugin/rolldown
export default { input: "src/main.ts", plugins: [vibelang()] }

// esbuild
import vibelang from "vibelang-unplugin/esbuild"
await esbuild.build({ entryPoints: ["src/main.ts"], bundle: true, plugins: [vibelang()] })

// Bun
import vibelang from "vibelang-unplugin/bun"
await Bun.build({ entrypoints: ["src/main.ts"], outdir: "out", plugins: [vibelang()] })
```

### Bun builds inside tools and tests

A runtime preload alone does not configure `Bun.build`. To load source
modules in `bun run`, `bun test`, and builds inside those processes,
use `vibelang-unplugin/bun/register` in `bunfig.toml`:

```toml
preload = ["vibelang-unplugin/bun/register"]

[test]
preload = ["vibelang-unplugin/bun/register"]
```

This preload includes `vibelang/bun` and adds the Bun adapter to each
`Bun.build` call, including calls owned by unchanged tests. Existing plugins
keep their order and options; an explicitly configured `vibelang` plugin
takes precedence. Each build gets a fresh compiler backend, so concurrent
builds and builds after source edits remain independent. Set
`VIBELANG_PROJECT` to select a project other than `tsconfig.json`, or
keep an explicit `vibelang({ project, compiler })` plugin for per-build
configuration. `VIBELANG_UNPLUGIN_DEBUG=1` traces registration and compilation.

Register the preload before application modules capture `Bun.build` or
import `build` from `bun`. Child processes need the preload in their own
configuration or command: `bun --preload vibelang-unplugin/bun/register run.ts`.
This does not change Bun's test filename discovery or configure other bundlers.

## Bundlers called by tests

For a Node script or test that calls Rolldown or esbuild itself, preload the
matching adapter before it imports the bundler:

```sh
node --import vibelang-unplugin/rolldown/register scripts/bundle.mjs
node --import vibelang-unplugin/esbuild/register --test test/bundle.test.mjs
```

Under Node, these entries include `vibelang/register` and affect subsequent
bare `rolldown` or `esbuild` imports and `require` calls.

Under Bun 1.4.4 or later, use `--preload` with the same entries, or list them
in both the top-level and `[test]` `preload` arrays in `bunfig.toml`.
They include `vibelang/bun` and route literal ESM imports, including
`await import("rolldown")`, through the native adapter. Computed imports,
CommonJS `require` calls and older Bun releases need the explicit plugin
in the bundler's `plugins` array.

Register both entries if a process uses both bundlers. Each build receives
a fresh native adapter; an explicit plugin named `vibelang` takes precedence.
Caller plugins and options are preserved. Rolldown's `rolldown`, `build`
and `watch` APIs and esbuild's asynchronous `build` and `context` APIs
are supported. esbuild's `buildSync` cannot use plugins and is unchanged.

Load the preload before any bundler import; an already imported namespace
or function is unchanged. Absolute package-file imports and subprocesses
without the preload keep their usual behavior. A missing literal `input.ts`
remains missing: source loading does not rename test-owned entry paths or
change module filenames.

Import local sources as `./welcome.vibe` and `./config.ts`. The compiler
rewrites those imports to `./welcome.js` and `./config.js`; the plugin resolves
them back to `welcome.vibe` and `config.ts`. A `module` declaration of
`welcome.vibe` is a module of its own, `welcome.vibe.text.js`, which the plugin
serves from the same compile. The plugin compiles only `.vibe` modules; `.ts`
files go through your bundler's usual TypeScript support. An extensionless
import resolves as TypeScript resolves it: `./welcome` reaches `welcome.vibe`
when there is no `welcome.ts` or `welcome.tsx`, ahead of a `welcome.js` beside
it, and `./mount` reaches `mount/index.vibe`.

A `.vibe` module of another workspace package, such as one that your app
imports by name, compiles with the nearest `tsconfig.json` above it: its own
package's project, with that package's settings. That holds outside `root` and
for a package nested inside it, a directory with its own `package.json` and
`tsconfig.json`. Each project compiles once per build or watch rebuild.

Inside your package, project selection starts as it does in TypeScript:
the nearest config above the module, then that config's `references`, then
the parent directories' configs. A composite referenced project must list
the source among its roots, as TypeScript requires. The loader also discovers closed sibling
projects: when none of those holds it, a `tsconfig.json`
elsewhere in the package does, such as a `worker/tsconfig.json` that includes
`../db`: the first by path that lists the module, else the first by path that
imports it. A module no tsconfig holds fails the build and names each one asked.

For package exports that provide `vibelang-source`, the Bun, Rolldown,
esbuild, webpack and Rspack adapters select that source condition. A package
that mixes `.ts` and `.vibe` modules then shares one source graph instead of
also bundling the copies under `.vibelang/js`. Existing custom conditions and
the bundler's native defaults remain active. Rollup's separate package
resolver must include `vibelang-source` in its export conditions.

### A config that the bundled program evaluates

Some tools declare a bundle's options in the module they bundle. An
[Alchemy](https://alchemy.run) Worker's `build` props sit in the Worker's own
module, so the Worker runs that code too, and a static import of
`vibelang-unplugin/rolldown` there would bundle the compiler backend into the
Worker. Import `vibelang-unplugin/deferred` instead. It imports nothing, and
`deferred(bundler, options)` returns a promise-like plugin that loads
`vibelang-unplugin/<bundler>` only when the bundler awaits its plugin list:

```ts
// worker/Api.ts, an Alchemy Worker
import { deferred } from "vibelang-unplugin/deferred"

export default class Api extends Cloudflare.Worker<Api>()("Api", {
  main: "worker/Api.ts",
  build: { input: { plugins: [deferred("rolldown")] } }
}, program) {}
```

The bundlers that await plugins are Rolldown, Rollup, and Vite;
`deferred` refuses the others.

### An entry module's main

A module that exports a parameterless `main` runs it when the host starts the
module (D135). A bundle runs the `main` of its entry module and no other, as
an ES module or as CommonJS, with this plugin or from the compiler's output:
the runtime asks the file the host started which `main` it exports.

Rolldown input arrays and named entry maps exclude generated `.d.vibe.ts`
sidecars, including those selected by `tsdown` entry globs. This includes
`.d.vibex.ts` sidecars beside JSX sources; the source entries and their public
aliases remain in the bundle. Source order
and entry aliases are preserved. Choose the `.vibe` source for a single
entry.

## Options

```js
vibelang({
  project: "tsconfig.app.json", // Relative to root; default: tsconfig.json.
  root: "/path/to/app", // Default: the Vite root, webpack or Rspack context, Rolldown's cwd, esbuild's absWorkingDir, or the working directory.
  compiler: "/absolute/path/to/vibelang" // Native binary or Node launcher.
})
```

Rolldown's `cwd` selects the default compiler root as well as the directory
for relative bundle entries. A custom `project` resolves from that root.
An explicit plugin `root` selects the compiler project without changing where
Rolldown resolves its entries, so builds can run from another directory:

```js
import { rolldown } from "rolldown"
import vibelang from "vibelang-unplugin/rolldown"

const bundle = await rolldown({
  cwd: appDirectory,
  input: "src/main.vibe",
  plugins: [vibelang({ project: "tsconfig.app.json" })]
})
try {
  await bundle.write({ dir: "dist", format: "es" })
} finally {
  await bundle.close()
}
```

Without a `compiler` option, the plugin runs `VIBELANG_BINARY`, else the native
compiler that the launcher of the `vibelang` package resolved from the root
would run, else the one of the `vibelang` package beside the plugin, so a build
that starts from a directory without its own install, such as a test run from a
monorepo's root, still compiles. Set `VIBELANG_UNPLUGIN_DEBUG=1` to
trace each build start, compile, and module load on stderr.

## How it works

VibeLang's emit is type-directed: a module's JavaScript depends on the contracts of
the modules it imports. So v0 compiles the whole project with one `vibelang`
process per build, on the first `.vibe` module load, and again on every watch
rebuild. The compiler writes to a directory under the system temporary
directory; the plugin reads the JavaScript and source maps into memory and
deletes it. It forces JavaScript and source-map emission,
checks and emits only the `.vibe` files under the root (`--loader-root`),
embeds source content, overrides `rootDir` to the root, and disables
declarations and incremental output. A source saved
during a compile starts another compile before any module is served.

Each `.vibe` module declares every project source and the tsconfig as watch
files, so an edit to any of them rebuilds the `.vibe` modules. Errors in a loaded source and project-wide errors are reported once for that module,
as a build error whose message lists each diagnostic
as `file:line:column - error TS2322: text`.

## Limitations

- **Bun:** `Bun.build` ignores plugin source maps, so a Bun bundle's map points
  into the compiled JavaScript of each `.vibe` module, not its source. Bun has
  no watch API for plugins. Bun 1.4.2 stops resolving `Bun.build`'s in-memory
  `files` once a plugin's resolve hook matches their names, and crashes on a
  `with { type: "file" }` import once a plugin's load hook matches every file,
  so under Bun the plugin registers its own hooks: resolve for `.vibe` names,
  extensionless relative names, and a relative `./x.js` only where an `x.vibe`
  exists in the repository, in a package it links, or in an installed package
  with its own `tsconfig.json`; load for `.vibe` modules and their module
  declarations' outputs. Bun 1.4.4 miscompiles a CommonJS dependency, such as
  `ws` under `@effect/platform-node`, once a resolve hook matches the `.js`
  imports inside the packages a build bundles. Bun maps a compiled module's
  `./x.js` to `x.ts` or `x.tsx` itself, even when another directory has
  an `x.vibe` with the same basename; the plugin leaves that import to Bun.
  A filter sees only the specifier, so matching it is a precondition:
  the resolve callback claims a path only when it serves the resolved module.
  A `.vibe` file added during a build
  is reached by its `.vibe` or extensionless name until the next build.
- **webpack and Rspack:** the error carries its position in the message only;
  unplugin doesn't pass a location to webpack. webpack before 5.112.0 can miss
  a save made as a watch build finishes
  ([webpack#22646](https://github.com/webpack/webpack/pull/22646)).
- **esbuild:** `.vibe` modules load in the `vibelang` namespace.
- **All:** a build compiles the whole project, so its time grows with the
  project, not with the change. New source files are watched after the next
  build that includes them.
- **Vite:** `vibelang-unplugin/vite` exists for parity tests. It lacks
  vibelang-vite's dev-server middleware and hot-update invalidation.

## Acceptance checks

For contributors, from the VibeLang repository root:

```sh
sh packages/unplugin/test/run.sh
```

The script builds the compiler and `vibelang-runtime` from the checkout, then
bundles `test/fixture` with webpack, Rspack, Rollup, Rolldown, esbuild, Bun, and
Vite. For each bundler it runs the bundle and compares its output with
`test/expected.txt`, and checks that the source map maps a token back to its
`.vibe` line and column and that a type error fails the build with its `.vibe`
position. In watch mode it edits the `.vibe` source, a `.ts` file the
`.vibe` module imports only for types, and the tsconfig, and waits for each
rebuild.

The source loaders compile the whole project for type-directed emit, but report
only diagnostics for the source being loaded and project-wide errors, including
configuration diagnostics.
An unrelated file's type errors do not prevent loading a clean module. Run
`vibelang -p tsconfig.json` to check every project file.
