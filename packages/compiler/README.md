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
npm install --save-exact effect@4.0.6 vibelang-runtime
npm install --save-dev vibelang
```

Install exactly `effect@4.0.6`. The version is exact because the runtime reads
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
| `npx vibelang --version` | Print the VibeLang and TypeScript versions |

For tests with Vitest, add [`vibelang-vite`](https://www.npmjs.com/package/vibelang-vite).

## Run .vibe modules in Node

```sh
node --import vibelang/register src/main.ts
```

`vibelang/register` lets Node import `.vibe` modules from source, so a
TypeScript entry point, a script, or a test that spawns `node` needs no `dist/`.
The first `.vibe` import compiles the whole project in the nearest
`tsconfig.json` above the module, once per process; every `.vibe` module of that
project comes from that compile. The compile type-checks the project's own
files, those under its directory. A workspace package the project imports as
source only supplies types to it; that package's own compile checks it when
one of its `.vibe` modules loads. Set `VIBELANG_PROJECT` to a tsconfig path to
choose another project, such as `tsconfig.test.json` for an example beside a
library; it compiles the modules in its directory, and a module of another
workspace package, such as a dependency linked to its source, still compiles
with that package's own `tsconfig.json`. A module keeps its source URL, so a `.ts` file imported
by both a TypeScript and a `.vibe` module loads once. A `module` declaration in
`main.vibe` is a module of its own, `main.vibe.text.js` beside it, which is not
on disk; the hook serves it from the same compile. Errors in the loaded source and project-wide errors are thrown at the import;
unrelated source diagnostics do not block a clean module. The hook turns on Node's source-map support,
so a stack trace names `.vibe` lines. It needs Node 26 or later, for
`module.registerHooks`. `VIBELANG_REGISTER_DEBUG=1` prints each project's
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

The cache keeps one entry per project. It does not see a file that changes
module resolution from outside the project's `include` and outside
`node_modules`, or a `node_modules` link changed by hand rather than by a
package manager; edit the importing file, or delete the cache directory.

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
file that imports `.vibe` modules.

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
--loader-root <root>`, which type-checks and emits only the files under `root`,
the modules it serves. When the compiler is the `vibelang` launcher, the compile
runs the native compiler the launcher would run, without starting Node for it. `compileProjectSync`, `projectBackend`, and
`projects` take `cache: false` to turn the cache off, or `cache: { directory }`
to move it.

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

The package ships an agent skill for writing VibeLang, `node_modules/vibelang/skills/vibelang/SKILL.md`: every form, rule and idiom of this version, with [measured token counts](https://vibelang.sh/vibelang-features/117-token-counts). Point an agent's instructions at it (D292).

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

`dprint fmt` and `dprint check` then format `.vibe` files with the
configuration's `typescript` settings, so they read like the project's `.ts`
files. See [Format with dprint](https://vibelang.sh/setup/formatting).

## Lint .vibe files with ESLint

`vibelang/eslint` is an ESLint parser for `.vibe` files: it gives ESLint the
tree typescript-eslint gives for TypeScript, so the same rules and plugins
apply. Install `eslint` and `typescript-eslint` 8 beside `vibelang`:

```js
// eslint.config.js
import tseslint from "typescript-eslint"
import vibelang from "vibelang/eslint"

export default tseslint.config({
  files: ["src/**/*.vibe"],
  extends: [tseslint.configs.recommended],
  languageOptions: { parser: vibelang }
})
```

Rules that need type information don't run on `.vibe` files;
`vibelang --noEmit` checks types. For typed lint of `.ts` files that import
`.vibe` modules, pass typescript-eslint the program `typedProgram` builds, in
which each `.vibe` module reads as its declaration:

```js
import { typedProgram } from "vibelang/eslint"

const parserOptions = {
  programs: [typedProgram({ project: "tsconfig.json", tsconfigRootDir: import.meta.dirname })]
}
```

The
[Devtools page](https://vibelang.sh/getting-started/012-devtools) lists the node types of VibeLang's own forms
and shows the whole configuration.

## How the package finds the native compiler

`vibelang` is a small Node launcher. In 0.0.11, the native compiler comes from one of four
optional dependencies, and npm installs the one that matches your platform:
`vibelang-darwin-arm64`, `vibelang-darwin-x64`, `vibelang-linux-arm64`,
`vibelang-linux-x64`. Native Windows binaries are not published yet; use WSL. The launcher
runs `VIBELANG_BINARY` when set, then `native/vibelang` beside the package in a
VibeLang checkout, then the platform package. If you installed with optional
dependencies omitted, reinstall without that option. The launcher forwards
arguments, standard streams, signals, and the exit status.

## License

Apache-2.0. The compiler is a modified version of the TypeScript 7 compiler
(typescript-go); see `LICENSE` and `NOTICE`.

## Develop the compiler

From the VibeLang repository root:

```sh
sh scripts/build-vibelang.sh      # writes packages/compiler/native/vibelang and dprint-plugin.json
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

Keep any existing type names in that array. The preload checks the whole project, including tests selected by `include`, even when running a different entry point. In `bunfig.toml`:

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

The source loaders compile the whole project for type-directed emit, but report
only diagnostics for the source being loaded and project-wide errors, including
configuration diagnostics.
An unrelated file's type errors do not prevent loading a clean module. Run
`vibelang -p tsconfig.json` to check every project file.
