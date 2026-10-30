# vibelang-unplugin

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

Compile `.vibe` modules with the native VibeLang compiler in webpack, Rspack,
Rollup, Rolldown, esbuild, and Bun. The compiler owns type and language
diagnostics. The plugin serves its JavaScript and source maps, reports its
diagnostics as build errors with file, line, and column, and recompiles in
watch mode. For Vite and Vitest, use [vibelang-vite](../vite/README.md).

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

Import local sources as `./welcome.vibe` and `./config.ts`. The compiler
rewrites those imports to `./welcome.js` and `./config.js`; the plugin resolves
them back to `welcome.vibe` and `config.ts`. A `module` declaration of
`welcome.vibe` is a module of its own, `welcome.vibe.text.js`, which the plugin
serves from the same compile. The plugin compiles only `.vibe` modules; `.ts`
files go through your bundler's usual TypeScript support.

A `.vibe` module of another workspace package, such as one that your app
imports by name, compiles with the nearest `tsconfig.json` above it: its own
package's project, with that package's settings. That holds outside `root` and
for a package nested inside it, a directory with its own `package.json` and
`tsconfig.json`. Each project compiles once per build or watch rebuild.

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

## Options

```js
vibelang({
  project: "tsconfig.app.json", // Relative to root; default: tsconfig.json.
  root: "/path/to/app", // Default: the webpack or Rspack context, esbuild's absWorkingDir, or the working directory.
  compiler: "/absolute/path/to/vibelang" // Native binary or Node launcher.
})
```

Without a `compiler` option, the plugin runs `VIBELANG_BINARY`, else the native
compiler that the launcher of the `vibelang` package resolved from the root
would run. Set `VIBELANG_UNPLUGIN_DEBUG=1` to
trace each build start, compile, and module load on stderr.

## How it works

VibeLang's emit is type-directed: a module's JavaScript depends on the contracts of
the modules it imports. So v0 compiles the whole project with one `vibelang`
process per build, on the first `.vibe` module load, and again on every watch
rebuild. The compiler writes to a directory under the system temporary
directory; the plugin reads the JavaScript and source maps into memory and
deletes it. It forces JavaScript and source-map emission,
checks and emits only the files under the root (`--loader-root`),
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
  so under Bun the plugin registers its own hooks: resolve for `.vibe` and
  relative `.js` specifiers, load for `.vibe` modules and their module
  declarations' outputs.
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
