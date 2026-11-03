# vibelang

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

The VibeLang compiler and language server. VibeLang is a readable syntax for
Effect that compiles to JavaScript with TypeScript declarations: `vibelang` checks `.vibe` and `.ts` files
together and emits JavaScript that runs on Effect 4. Enable `declaration`
to emit `.d.ts` files. Documentation:
[vibelang.sh](https://vibelang.sh).

## Start a project

```sh
bun create vibelang@latest my-app
# or
npm create vibelang@latest my-app
```

## Add VibeLang to an existing project

```sh
npm install --save-exact effect@4.1.1 vibelang-runtime
npm install --save-dev vibelang
```

The compiler and runtime declare the same exact `effect` peer dependency, so package
managers can report an incompatible version during installation. Install exactly `effect@4.1.1`. The version is exact because the runtime reads
fiber internals and rejects other versions at load. Keep `@effect/platform-node`
and `@effect/vitest` at that same version when you use them. Existing projects
also need the `@effect/platform-node-shared` override. Follow
[the complete installation steps](https://vibelang.sh/setup/existing-project)
before adding those packages.

Generated JavaScript imports `effect` and `vibelang-runtime`, so both are runtime
dependencies. Point `vibe.config.json`, `tsconfig.json`, or `jsconfig.json` at your `.vibe` sources. Automatic discovery checks those names in that order in each directory before searching its parent; `-p path/to/config.json` selects an explicit file:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "rootDir": "src",
    "outDir": "dist",
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src/**/*.vibe"]
}
```

| Command | What it does |
| --- | --- |
| `npx vibelang` | Check and compile the project in `tsconfig.json`, like `tsc` |
| `npx vibelang --watch` | Recompile on every save |
| `npx vibelang --lsp --stdio` | Run the language server for an editor |
| `npx vibelang agents init` | Set up Claude Code, Codex, opencode, Cursor and VS Code for `.vibe` files ([coding agents](https://vibelang.sh/setup/coding-agents)) |
| `npx vibelang --version` | Print the VibeLang and TypeScript versions |

For tests with Vitest, add [`vibelang-vite`](https://www.npmjs.com/package/vibelang-vite).

## Run .vibe modules in Node

```sh
node --import vibelang/register src/main.ts
```

`vibelang/register` lets Node import `.vibe` modules from source, so a
TypeScript entry point, a script, or a test that spawns `node` needs no `dist/`.
A committed loader record from `writeLoaderRecord` in `vibelang/project` can move with the checkout. It relocates recorded file paths and source-map sources while preserving emitted JavaScript bytes, including strings containing the old checkout path. Records from the older format are ignored and compiled again.

The first `.vibe` import compiles the project's `.vibe` files in the nearest
`tsconfig.json` above the module, once per process; every `.vibe` module of that
project comes from that compile. It checks and emits only `.vibe` sources
under the project's directory. Native TypeScript files supply types to those
modules, but their independent errors are not checked. A workspace package the project imports as
source only supplies types to it; that package's own compile checks it when
one of its `.vibe` modules loads. A project the tsconfig lists in `references`
supplies its types from its sources too, as in the editor, so no `vibelang -b`
has to build it first. Set `VIBELANG_PROJECT` to a tsconfig path to
choose another project, such as `tsconfig.test.json` for an example beside a
library; it compiles the modules in its directory, and a module of another
workspace package, such as a dependency linked to its source, still compiles
with that package's own `tsconfig.json`. A module keeps its source URL, so a `.ts` file imported
by both a TypeScript and a `.vibe` module loads once. A `module` declaration in
`main.vibe` is a module of its own, `main.vibe.text.js` beside it, which is not
on disk; the hook serves it from the same compile. Errors in the loaded source and project-wide errors are thrown at the import;
unrelated source diagnostics do not block a clean module. The hook turns on Node's source-map support,
so a stack trace names `.vibe` lines. It uses `module.registerHooks` (added in Node 22.15).
Use Node 22.22.3 (22.x) or Node 24.11.1 or later for the synchronous loader fixes
needed by the runtime bridge. `VIBELANG_REGISTER_DEBUG=1` prints each project's
compile time with the time of each stage (the cache lookup, the snapshot of its
inputs, the compiler, reading its output, and the cache write), or that it came
from the cache, and at exit the time the hook took in all.

A long-running process compiles a project again when it imports a `.vibe`
module that changed after the project compiled, or that did not exist yet, so
a watcher that re-imports an edited file under a new URL gets its new code. The
errors carry a `code`, as Node's module errors do: `ERR_VIBELANG_COMPILE` when
the loaded source has errors or a project-wide error prevents compilation, and
`ERR_VIBELANG_PROJECT` when the module is outside the project.

### The compile cache

A project's compile is cached on disk, so the next process that imports the same
project reuses it instead of compiling again. Cache lookup takes milliseconds;
it does not include loading Effect or the rest of process startup. One Linux x64
review run measured about 0.5 s for a warm Node start, including loading Effect,
with 38 ms spent reading the cache, versus 1.3 s with the cache disabled. These
are single-machine observations. `vibelang/register`,
`vibelang/bun`, `vibelang-vite`, and `vibelang-unplugin` share the cache. A
cached compile is reused only while all of these are unchanged:

| Input | What counts as a change |
| --- | --- |
| Sources | A file the compile read, by content; a dependency's file by size, modification time, and inode |
| Project files | A file added to or removed from a directory the tsconfig's `include` scans |
| Configuration | The tsconfig, every config it `extends`, and the configs its `references` name; for another workspace package's `.vibe` source in the program, that package's `tsconfig.json`, whose settings it is checked with |
| Packages | The `package.json` nearest each source, and the lockfiles and package-manager state (`node_modules/.modules.yaml`, `.package-lock.json`, and so on) in the project's directory and above |
| Compiler | The compiler file, and the native binary the `vibelang` launcher runs |

A failed compile is never cached, and neither is one whose sources changed
while it ran. Entries are written to a temporary file and renamed into place,
so any number of processes can share a cache directory.

| Setting | Effect |
| --- | --- |
| `VIBELANG_CACHE_DIR=<dir>` | Keep the cache in `<dir>` |
| `VIBELANG_DISABLE_CACHE=1` | Compile in every process; read and write no cache |
| Default | `vibelang-cache-<uid>` in the system's temporary directory, readable only by you |

If the directory named by `TMPDIR` does not exist or names a file, compiler scratch output and the default cache use its nearest existing parent directory. Importing a module leaves the application temporary path untouched. Explicit cache-directory options still name the exact directory to create.

The cache keeps one entry per project. It does not see a file that changes
module resolution from outside the project's `include` and outside
`node_modules`, or a `node_modules` link changed by hand rather than by a
package manager; edit the importing file, or delete the cache directory.

### Loader records

A cache starts empty in every CI run and every fresh checkout, so each such
process compiled every workspace package whose `.vibe` modules it reached,
even when the package's current JavaScript was committed under
`.vibelang/js/`: nothing proved that JavaScript current, and emit is
type-directed. A loader record is that proof. It is the loader's own compile
of a project, committed at `<project dir>/.vibelang/js/.loader/<tsconfig
name>.json`, with every input named by content rather than by timestamp:

| Input | What the record holds |
| --- | --- |
| Sources | The digest of each file the compile read, dependencies included |
| Project files | Each `include` directory's file names |
| Configuration | The digests of the configs the cache tracks |
| Packages | The digests of the nearest `package.json` files and of the lockfiles from the project's directory up to the workspace's |
| Compiler | The digest of the native binary |

Paths are relative to the workspace, the nearest directory at or above the
project that holds a lockfile, so a record holds in any checkout. On a cache
miss, a loader checks the record input by input, about 150 ms for opencode's
five packages and 3,000 files; when all hold it uses the recorded result and
caches it, and when any differs it compiles as before. A record only ever
saves a compile: a stale one costs nothing but the compile.
`VIBELANG_DISABLE_CACHE=1` turns records off too.

The migrate flow writes a record for each project a migrated package's
`.vibe` modules compile with, with the package's installed `vibelang/project`,
each time it writes the packages' emitted JavaScript. It writes the records
after it has emitted and routed every package, because a record names each
`package.json` its compile read and routing rewrites them, then checks each
record against the final tree with `checkLoaderRecord`, which returns
`{ modules }` or the `{ miss }` a cold loader would see. To write one
yourself, after changing a package:

```sh
node -e 'import("vibelang/project").then(p => console.log(p.writeLoaderRecord({ project: process.argv[1] })))' packages/protocol/tsconfig.json
```

A project with a type error gets no record.

## Run .vibe modules in Bun

```sh
bun --preload vibelang/bun src/main.ts
```

`vibelang/bun` is the same loader for Bun, through a runtime plugin: `bun run`,
`bun test`, and a `preload` in `bunfig.toml` (top level for `bun run`, under
`[test]` for `bun test`). It compiles each project once per process, or loads it
from the compile cache, honors `VIBELANG_PROJECT`, and throws the loaded source's errors and project-wide errors at the import. Bun 1.4.2 ignores a plugin's source maps, so a stack
frame names the `.vibe` file with the line of its compiled JavaScript. `bun
test` discovers only its own test file names, so a Bun suite is a `.test.ts`
file that imports `.vibe` modules. The preload reads a module's imports when
Bun first resolves it by path (the entry, a relative or absolute import), and
leaves a bare specifier to Bun; `VIBELANG_BUN_DEBUG=1` prints how many
resolutions reached it.

A package that the migrate flow migrated may name its emitted JavaScript,
committed under `.vibelang/js/`, as its `default` export, for consumers that
load no plugin, such as the `bun build` CLI and plain `node`. Both loaders run
the source instead: `vibelang/register` follows the output’s source map or
migration-generated source header, and `vibelang/bun` loads a re-export of that
source, so it has one instance whichever way it is imported. A mapless mirrored
path redirects only when one source matches the project’s inherited `jsx` mode;
ambiguous siblings leave the emitted module in place. The Bun re-export preserves
live named and `default` bindings, and adds no `default` to a source that lacks one. With the
package's [loader record](#loader-records), a process with a cold cache runs
that source from the recorded compile instead of compiling the package.

## Bundle .vibe modules with Metro

```js
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config") // or @react-native/metro-config
const { withVibeLang } = require("vibelang/metro")

module.exports = withVibeLang(getDefaultConfig(__dirname))
```

`withVibeLang` takes a Metro config, a promise of one, or a function that
returns either. It adds `vibe` to `resolver.sourceExts`, after TypeScript's
extensions, and sets `vibelang/metro` as `transformer.babelTransformerPath`. The
app's own Babel transformer, the one the config named or Metro's default, still
transforms every module: for a `.vibe` module it receives the module's
JavaScript from the project's compile, and the syntax tree it returns is moved
back to `.vibe` positions, so the bundle's source maps name `.vibe` lines.
Metro's transform cache keys a module by its own text, but a `.vibe` module's
JavaScript also depends on the modules it imports: after a change that alters
how an importer compiles, restart Metro with `--reset-cache`.

## Read .vibe modules from Babel and other one-file tools

A tool that parses one file at a time cannot read a `.vibe` module's source.
Babel reads it through the `vibelang/babel` preset:

```js
// babel.config.js
module.exports = { presets: ["babel-preset-expo", "vibelang/babel"] }
```

The preset parses a `.vibe` module from its project's JavaScript and moves the
syntax tree back to `.vibe` positions, so the React Compiler checks and
memoizes the module, and its diagnostics name `.vibe` lines. A tool called as
`transform(filename, text, options)`, such as oxc-transform-react, takes
`toolArguments(filename, text, options)` from `vibelang/emit`, which replaces a
`.vibe` module's source with its JavaScript. Both read the module's source from
disk: text that differs, such as JavaScript a bundler plugin already compiled,
passes through unchanged.

## Compile projects from a tool

`vibelang/project` is the whole-project compile that `vibelang-vite`,
`vibelang-unplugin`, `vibelang/register`, and `vibelang/bun` share. `projects({
root, project, compiler })` serves each `.vibe` module from one compile per
tsconfig: a module inside `root` belongs to `project`; one of another workspace
package, such as a package another package imports, belongs to the nearest
`tsconfig.json` above it. Another package is one outside `root`, or one nested
inside it with its own `package.json` and `tsconfig.json`. `load(file)` returns
the module's JavaScript, its source map, and its source diagnostics and project-wide diagnostics, for a
`.vibe` file or for the output of one of its `module` declarations,
`main.vibe.text.js` beside `main.vibe`, which `moduleDeclarationSource(path)`
recognizes;
`invalidate()` makes every project compile again on its next load, or load from
the cache when nothing changed. A compile runs `vibelang -p <tsconfig>
--loader-root <root>`, which type-checks and emits only the `.vibe` files under
`root`, the modules it serves; the project's `.ts` files only supply types. When the compiler is the `vibelang` launcher, the compile
runs the native compiler the launcher would run, without starting Node for it. `compileProjectSync`, `projectBackend`, and
`projects` take `cache: false` to turn the cache off, or `cache: { directory }`
to move it.

Await `close()` on the object returned by `projectBackend` or `projects` when
the tool stops using it. It gives an active compile 500 ms to finish, sends
`SIGTERM`, and after another 500 ms sends `SIGKILL` and closes its output
pipes. It waits for the child and releases its handles before resolving.
Repeated `close()` calls are safe; later `compile()` or `load()` calls on
that object reject. Create a new backend for a later build.

`projectImports({ project })` lists a project's module graph without
type-checking it: `files` is every file of the program, and `imports` is every
import its `.ts` and `.vibe` files write, as `{ importer, specifier, file }`
with the file the compiler resolved the specifier to, `.vibe` files included.
Type-only imports are listed too; a tool that needs only run-time edges reads
the importer's syntax. `errors` holds the diagnostics that stopped the compiler
from reading the project, such as an unknown compiler option. A dependency
checker or a circular-import guard reads this graph instead of resolving
`.vibe` specifiers itself.

```js
import { formatDiagnostic, projectImports } from "vibelang/project"

const { imports, errors } = projectImports({ project: "packages/app/tsconfig.json" })
if (errors.length) throw new Error(errors.map(formatDiagnostic).join("\n"))
for (const { importer, specifier, file } of imports) console.log(importer, specifier, file)
```

## Editor support

This package ships the VS Code extension. In a project with `vibelang` installed:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix
```

The extension starts the project's own `vibelang` as the language server.

## Agent skill

The package ships an agent skill for writing VibeLang, `node_modules/vibelang/skills/vibelang/SKILL.md`: every form, rule and idiom of this version, with [measured token counts](https://vibelang.sh/vibelang-features/117-token-counts). Point an agent's instructions at it (D292). `npx vibelang agents init` copies it into a repository for Claude Code, Codex, opencode, Cursor and VS Code, with the language server and a check after each edit.

## Format .vibe files with dprint

The package ships a [dprint](https://dprint.dev) plugin for `.vibe` files. Use
dprint 0.64.3 or later for `npm:` plugin resolution. Add
it beside dprint's TypeScript plugin, and add `vibe` to `includes`:

```json
{
  "includes": ["**/*.{ts,vibe}"],
  "plugins": [
    "https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a",
    "npm:vibelang/dprint-plugin.json"
  ]
}
```

The formatter and `vibelang/prettier` recognize `.vibe` and `.vibex`. Include `**/*.{vibe,vibex}` in dprint's `includes`; `vibelang-format` discovers both by default. JSX in `.vibex` uses the host's TSX mode, keeping comments, text, entities and the comma in `<T,>` generic arrows.


`dprint fmt` and `dprint check` then format `.vibe` files with the
configuration's `typescript` settings, so they read like the project's `.ts`
files. See [Format with dprint](https://vibelang.sh/setup/formatting).

## Lint .vibe and .vibex files with ESLint

`vibelang/eslint` is an ESLint parser for `.vibe` and `.vibex` files: it gives ESLint the
tree typescript-eslint gives for TypeScript, so the same rules and plugins
apply. Install `eslint` and `typescript-eslint` 8 beside `vibelang`:

```js
// eslint.config.js
import tseslint from "typescript-eslint"
import vibelang from "vibelang/eslint"

export default tseslint.config({
  files: ["src/**/*.{vibe,vibex}"],
  extends: [tseslint.configs.recommended],
  languageOptions: { parser: vibelang }
})
```

`.vibex` JSX has the same tree, tokens and tag references as TypeScript JSX.
Rules such as `react/jsx-key`, `react-hooks/rules-of-hooks` and
`solid/no-destructure` run on the source, including comments inside JSX.

Rules that need type information don't run on `.vibe` or `.vibex` files;
`vibelang --noEmit` checks types. For typed lint of `.ts` files that import
`.vibe` or `.vibex` modules, pass typescript-eslint the program `typedProgram` builds, in
which each `.vibe` module reads as its declaration:

```js
import { typedProgram } from "vibelang/eslint"

const parserOptions = {
  programs: [typedProgram({ project: "tsconfig.json", tsconfigRootDir: import.meta.dirname })]
}
```

Without `project`, `typedProgram()` discovers the nearest `vibe.config.json`,
`tsconfig.json`, or `jsconfig.json`, in that order per directory, starting at
`tsconfigRootDir` (the working directory by default). An explicit `project`
selects that config file.

The
[Devtools page](https://vibelang.sh/getting-started/012-devtools) lists the node types of VibeLang's own forms
and shows the whole configuration.

## Find unused code with Knip

`vibelang/knip` is a [Knip compiler](https://knip.dev/features/compilers) for
`.vibe` and `.vibex` files. It gives Knip a module's imports, re-exports, dynamic imports,
export names, JSX tag references and namespace member reads, from the compiler's ESTree, and the
`vibelang-runtime` import its JavaScript has. Knip takes a compiler only from a
configuration that is code:

```js
// knip.config.js
import vibelang from "vibelang/knip"

export default { compilers: { vibe: vibelang, vibex: vibelang }, ignore: ["**/*.d.vibe.ts", "**/*.d.vibex.ts"] }
```

## How the package finds the native compiler

`vibelang` is a small Node launcher. In 0.0.11, the native compiler comes from one of six
optional dependencies, and npm installs the one that matches your platform:
`vibelang-darwin-arm64`, `vibelang-darwin-x64`, `vibelang-linux-arm64`,
`vibelang-linux-x64`, `@vibelang/cli-win32-arm64`,
`@vibelang/cli-win32-x64`. The launcher
runs `VIBELANG_BINARY` when set, then `native/vibelang` (`native/vibelang.exe` on Windows) beside the package in a
VibeLang checkout, then the platform package. If you installed with optional
dependencies omitted, reinstall without that option. The launcher forwards
arguments, standard streams, signals, and the exit status.

## License

Apache-2.0. The compiler is a modified version of the TypeScript 7 compiler
(typescript-go); see `LICENSE` and `NOTICE`.

## Develop the compiler

From the VibeLang repository root:

```sh
sh scripts/build-vibelang.sh      # writes packages/compiler/native/vibelang, typescript/built/local/tsc and dprint-plugin.json
packages/compiler/bin/vibelang --version
node --test packages/compiler/test/*.test.mjs
```

A checkout's launcher prefers `native/vibelang`, so projects that link to the
checkout use a rebuilt compiler without reinstalling.

### Bun runtime watch limitation

With Bun 1.4.1, `bun --watch --preload vibelang/bun` does not reliably restart after a `.vibe` save. The preload compiles once per process and does not invalidate that result during watch. For development, use the starter's `npm run dev` or `bun run dev`: its compiler watch and Node process rebuild and restart the app.

### Bun test types

Install Bun's declarations before adding a `.test.ts` suite to the project:

```sh
bun add -d @types/bun
```

In the tsconfig that includes the tests, add `"bun"` to `compilerOptions.types` (the starter sets `types: []`):

```json
{ "compilerOptions": { "types": ["bun"] } }
```

Keep any existing type names in that array. Run `vibelang -p tsconfig.json` to check every selected project file, including native TypeScript tests selected by `include`. The preload checks and emits only the project's own `.vibe` files under its directory. Selected native TypeScript files supply types to those modules, but their independent errors are not checked. Errors in the loaded `.vibe` module and project-wide errors fail its import; an unrelated `.vibe` module's errors do not. In `bunfig.toml`:

```toml
[test]
preload = ["vibelang/bun"]
```

For a module exporting `greeting(name)` as an Effect, create `src/greeting.test.ts`:

```ts
// TypeScript (.ts)
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { greeting } from "./greeting.vibe"

test("greeting", () => {
  expect(Effect.runSync(greeting("Bun"))).toBe("Hello, Bun!")
})
```

Run `bun test`. Use `Effect.runPromise` in an async test when the Effect is asynchronous; provide any required services before running it.

The source loaders use the project program for type-directed emit, with the
same checking scope as the preload described above. Run
`vibelang -p tsconfig.json` to check every selected project file.

In a mixed migrated package, emitted native TypeScript entries under `.vibelang/js` resolve back to their original sources under the Node and Bun source hooks. Relative source imports and package imports therefore share module instances.
