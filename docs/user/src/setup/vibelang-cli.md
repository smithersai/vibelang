# Build with the vibelang CLI

`vibelang` replaces `tsc`. It checks `.vibe` and `.ts` files as one program, emits JavaScript, and accepts TypeScript's compiler flags. Install the packages with [Add VibeLang to an existing project](existing-project.md) first.

VibeLang uses TypeScript 7, which rejects removed options such as `moduleResolution: "node"` / `"node10"` and `baseUrl` (TS5108 / TS5102); update an older tsconfig using the [TypeScript 7 migration notes](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md).

## 1. Configure tsconfig.json

VibeLang discovers `vibe.config.json`, `tsconfig.json`, then `jsconfig.json`, in that order. `vibe.config.json` accepts every tsconfig field and a top-level `"vibe"` section for language options. If the project has no configuration, create this `tsconfig.json`. It selects `.vibe` files under `src/` and emits Node ESM to `dist/`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "noEmitOnError": true,
    "rewriteRelativeImportExtensions": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/**/*.vibe"]
}
```

If the project has a `tsconfig.json`, keep it and check that `include` selects `.vibe` files: a directory entry such as `"src"` does; a glob such as `"src/**/*.ts"` does not, so add `"src/**/*.vibe"` beside it.

### Inspect or initialize configuration

- `vibelang --init` creates TypeScript's generic `tsconfig.json`. For an ESM project, set `"type": "module"` in `package.json`; then adapt `include` and the output options as above. The initializer does not create VibeLang's package setup.
- `vibelang --showConfig` prints the effective project configuration, including inherited options, without compiling. Use `-p path/to/tsconfig.json` to inspect another project.
- `vibelang --ignoreConfig --noEmit --module nodenext --target es2022 src/hello.vibe` checks explicit files without loading the discovered tsconfig. Supply the compiler options those files require; project include patterns and references do not apply.

### Diagnostic severities

TypeScript's own lexical, syntax and static errors keep their `TS` codes, including errors inside embedded expressions and types. VibeLang's productions, placement rules and adopted proposal restrictions use the owning VIP's `EK` codes, regardless of the parser helper used. A specific diagnostic takes priority for the same rejection; independent native errors still report.

Set `vibe.severities` in any supported project config:

```json
{ "vibe": { "severities": { "EK0508": "off", "EK0801": "error", "EK4609": "off", "EK3801": "warning" } } }
```

The values are `"error"`, `"warning"`, `"suggestion"` and `"off"`. Keep leading zeroes in codes, as in `EK0508`. Every VibeLang code marked as a warning or lint warning in Appendix B, including the TypeScript-form warnings such as `EK4830`, and every assigned imported `EK38xx` lint code is configurable. An error code, an unknown code or an invalid severity value reports `EK3006`; an unknown `vibe` key or another wrong-typed value reports `EK3007`. Remove the invalid entry or supply its declared value; other valid severity entries still apply.

`extends` merges the `vibe` section by key and `severities` by diagnostic code; child entries win. An `extends` array applies bases left to right. `--showConfig` prints the effective `vibe` section. A code setting overrides the Effect language-service rule configuration.

Invalid effective entries report `EK3006` individually and are ignored as overrides; other valid entries and independent options still apply. An invalid child entry does not restore the displaced base entry for the same code: its lower-precedence Effect language-service setting, when applicable, then its default applies. Other inherited codes remain. These are still configuration errors, with their normal exit and emit consequences.

Warnings print without failing the build or blocking `noEmitOnError`; set a warning to `"error"` to fail CI. `"suggestion"` is shown only by the language server, and `"off"` suppresses the diagnostic.

The legacy `vibelang.diagnostics` setting reports migration warning `EK3009`. Run `vibelang -p tsconfig.json --fix` to move it to `vibe.severities`, including settings in extended config files. Existing `vibe.severities` entries take precedence. Legacy maps containing retired or nonconfigurable codes remain in place so the rewrite does not break a working project; remove those obsolete entries, then rerun `--fix`. JSONC comments, including comments containing braces, stay intact while the migrated settings remain active.


## 2. Replace tsc in the scripts

In `package.json`, replace `tsc` with `vibelang` in every script. If the project has no build script, add these:

```json
{
  "scripts": {
    "build": "vibelang",
    "start": "vibelang && node --enable-source-maps dist/main.js",
    "test": "vitest run"
  }
}
```

`vibelang` with no arguments checks and emits the project, `vibelang --noEmit` only checks it, `vibelang --watch` rebuilds when a compilation input of the selected project changes, and `vibelang -b` builds project references. `vibelang --fix` first rewrites Effect code written in TypeScript's style into VibeLang's forms, such as a `Data.TaggedError` class into an `error` declaration, and then runs as the rest of the command says ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)).

The VIP migration also marks Effect functions `effect`, including arrows with an Effect return annotation such as `const value = (): number!! => 1`. Run `vibelang --fix --fix-vip-only` to apply only the VIP migrations.

For the VIP syntax migration, `vibelang --fix --fix-vip-only` writes explicit `effect` functions and `effect { … }` blocks. Program literals passed to combinators, including elements of `Effect.all` and racing collections, become Effects; callback arguments such as `Effect.forEach` stay functions. Annotated literals, named function expressions and optional parameters retain their contracts and delayed evaluation through `Effect.suspend`. By-name arguments that compute a value become `effect { … }` blocks, function values at program positions are captured with `Effect.suspend` or `Effect.sync`, and `fork` callbacks become `fork effect { … }`.

For a monorepo, use `vibelang -b -w <solution-or-consuming-project>` to watch and rebuild the project-reference graph. Ordinary `-w` watches the selected project's compilation inputs; it does not keep referenced libraries built. For example:

```sh
vibelang -b -w packages/app
```

### Lint Effect code

`vibelang` runs Effect's type-aware lint rules, the `effecttsgo/*` rules of [`@effect/tsgo`](https://github.com/Effect-TS/tsgo), inside the compiler on selected `.ts` and `.vibe` inputs (VIP-38), keeping the pinned upstream rule/file eligibility and declaration/library exclusions. VibeLang-specific language checks remain confined to `.vibe`. They run wherever VibeLang reports diagnostics: every `vibelang` build, the language server, and `vibelang lint` for CI. The repository's existing Effect language-service configuration, the `@effect/language-service` plugin in `tsconfig.json`, selects and configures them, so a lint script covers `.vibe` as it covers `.ts`:

```json
{
  "scripts": {
    "lint": "vibelang lint -p tsconfig.json"
  }
}
```

The plugin also checks plain `.ts` projects, including schemas built with `Schema.optional` or `Schema.optionalKey`; no `.vibe` file is required.

`vibelang agents init` also teaches coding agents to run `vibelang lint` before finishing a change.

`vibelang lint` accepts the compiler's options, including `-p`/`--project` and file arguments, and has no options of its own. Like the compiler, it reads the first of `vibe.config.json`, `tsconfig.json` and `jsconfig.json` in each directory. It reports the same diagnostics as the compiler and the language server. It exits with status `1` on an error. Warnings never change the exit status, so set a code to `"error"` in `vibe.severities` to fail CI. Invalid project settings report their compiler diagnostic and exit with status `2`.

In a `.vibe` file, a rule runs in one of three ways. A rule whose pattern VibeLang's syntax rules out, such as `missingStarInYieldEffectGen`, does not run. A rule that a VibeLang diagnostic already ports runs as that diagnostic at the rule's severity: `effecttsgo/floating-effect` reports EK4801. Every other rule runs as Effect wrote it. [Effect language service rules](../getting-started/012-devtools.md#effect-language-service-rules) lists each rule's answer.

Oxlint never reads a `.vibe` file, so `vibelang lint` honors the disable comments a migrated file keeps from its TypeScript, as Oxlint does: `// oxlint-disable-next-line effecttsgo/schema-sync -- why` turns the rule off on the next line, `oxlint-disable-line` on its own line, and `/* oxlint-disable effecttsgo/schema-sync */` until the matching `oxlint-enable`; the `eslint-` spellings work the same, and a comment that names no rule turns every rule off. Builds and the language server read `// @effect-diagnostics-next-line schemaSync:off`.

## 3. Compile a first module

Create `src/hello.vibe`, in a directory that `include` selects:

```vibe
// src/hello.vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try hello("VibeLang"))
export effect function hello(name: string) {
  return `Hello, ${name}!`
}
// Output: Hello, VibeLang!
```

Run `npx vibelang`: it prints nothing, exits with status 0, and writes `hello.js` to the `outDir` (`dist/` above). Support for the new forms and adjacent `.d.vibe.ts` declarations arrives with the compiler's VIP implementation.

In `.vibe` files, import local modules by their source name: `import { hello } from "./hello.vibe"`. For this CLI build, a `.ts` importer can use `./hello.js`: VibeLang resolves it to `hello.vibe` while checking, and Node loads the emitted `hello.js`. With Vite or Vitest, use `./hello.vibe` from `.ts` too, so the plugin loads the source ([Vite setup](vite.md#3-add-a-first-module)); `rewriteRelativeImportExtensions` permits that source extension and rewrites it when emitting JavaScript.

## 4. Add an entry point

The `start` script runs `dist/main.js`, so create `src/main.vibe`:

```vibe
// src/main.vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-26
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { hello } from "./hello.vibe"

export effect function main() {
  try Console.log(try hello("VibeLang"))
}
NodeRuntime.runMain(main())
// Output: Hello, VibeLang!
```

Run `npm run start`, or `bun run start`. The output ends with:

```out
Hello, VibeLang!
```

The explicit `NodeRuntime.runMain(main())` call starts the application when the entry module loads. Keep reusable functions in separate modules so imports do not start the process.

## 5. Test with Vitest

Use a project path without `#` for Vitest. The pinned Vitest `5.0.5` fails to resolve test modules when the absolute project path contains `#`; this also affects plain TypeScript projects.

Create `vitest.config.ts`, which compiles `.vibe` tests through `vibelang-vite`:

```ts
// TypeScript (.ts)
// vitest.config.ts
import { defineConfig } from "vitest/config"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang()],
  test: { include: ["src/**/*.test.vibe"] }
})
```

Create `src/hello.test.vibe`:

```vibe
// src/hello.test.vibe
// pending: VIP-2, VIP-5, VIP-6
import { assert, it } from "@effect/vitest"
import { hello } from "./hello.vibe"

it.effect("says hello", () => effect {
  const message = try hello("VibeLang")
  try Effect.try(() => assert.strictEqual(message, "Hello, VibeLang!"))
})
```

Run `npx vitest run`. The output includes:

```out
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

You now have `src/hello.vibe`, `src/main.vibe`, and `src/hello.test.vibe`. Keep them as a starting point or delete them.

## Let TypeScript tools read .vibe modules

Stock `tsc`, `tsrs`, TypeDoc and other checkers built on TypeScript cannot read a `.vibe` file, so the compiler writes each module's declarations beside it (VIP-27). `vibelang`, `vibelang --watch` and `vibelang -b` write them, `src/greet.d.vibe.ts` for `src/greet.vibe`, even with `--noEmit`. A sidecar is rewritten only when its text changes. Its text is the module's declaration file with one change: an import of another `.vibe` module names its source, `./name.vibe`.

`bun check` runs the project's `check` script; a script that invokes a TypeScript checker uses that checker's sidecar resolution.

In each project whose checker is not `vibelang`, set TypeScript's [`allowArbitraryExtensions`](https://www.typescriptlang.org/tsconfig/allowArbitraryExtensions.html), and import the module by its source name:

```json
{ "compilerOptions": { "allowArbitraryExtensions": true } }
```

TypeScript then resolves `import { greet } from "./greet.vibe"` to `greet.d.vibe.ts`, as it resolves `./styles.css` to `styles.d.css.ts`. Without the option it reports `TS6263`. TypeScript never maps `./greet.js` or `./greet` to a sidecar, so a `.ts` file that such a checker reads names the `.vibe` module by its source. `vibelang` itself reads `greet.vibe` and never the sidecar, and a project's `include` leaves out a sidecar whose source is beside it.

A project that asks for no declarations, with neither `declaration` nor `composite`, gets what a sidecar cannot print as a warning, such as `TS7056` for a type too long to serialize, and the sidecar holds what emit writes. With either option it stays an error.

These checkers read only the sidecars: they do not type-check the `.vibe` files themselves. Run `vibelang` before them, in the same script, so a sidecar is current and a type error in a `.vibe` file fails the check:

```sh
vibelang --noEmit && tsrs -b
```

## Run sources with Node

To run a TypeScript entry point that imports `.vibe` modules without building
`dist/` first, load the `vibelang/register` hook:

```sh
node --import vibelang/register src/start.ts
```

The first `.vibe` import compiles the project in the nearest `tsconfig.json`.
The result is cached on disk, so the next process starts in milliseconds until
a source, a tsconfig, an installed package, or the compiler changes. Set
`VIBELANG_CACHE_DIR` to move the cache and `VIBELANG_DISABLE_CACHE=1` to turn it
off, and `VIBELANG_REGISTER_DEBUG=1` to print how long each project's compile
took, stage by stage. A type error stops the import with the compiler's
diagnostics, and a stack trace names `.vibe` lines. A workspace package the
project imports as source is checked by that package's own compile, when one of
its `.vibe` modules loads. The cache tracks that package's nearest config,
`vibe.config.json`, then `tsconfig.json`, then `jsconfig.json`, so editing it
invalidates the cached result. An extensionless import resolves as TypeScript's
`Bundler` resolution does: `../src/archive` reaches `archive.vibe` when there
is no `archive.ts` or `archive.tsx`, and `./mount` reaches `mount/index.vibe`.

## Run sources with Bun

Bun can run and test the project from source, without `dist/`. Preload `vibelang/bun`, in `bunfig.toml`:

```toml
preload = ["vibelang/bun"]

[test]
preload = ["vibelang/bun"]
```

or on the command line: `bun --preload vibelang/bun src/main.ts`. The first `.vibe` import compiles the whole project in the nearest `tsconfig.json` above the module, once per process, with the same cache as Node. Set `VIBELANG_PROJECT` to a tsconfig path to choose another project for the modules in its directory; a module of another workspace package compiles with that package's own `tsconfig.json`. A TypeScript module may import a `.vibe` module by its emitted name, such as `./x.js` for `x.vibe`, as a migrated project does after it replaces `x.ts`; an `x.ts` beside it still wins. An extensionless import, such as `../src/archive`, resolves to `archive.vibe` or a directory's `index.vibe` as TypeScript's `Bundler` resolution does. The preload uses Bun's parser to rewrite these imports before runtime resolution. A composite project compiles too. Diagnostics that stop the compile fail the import. Bun ignores a plugin's source maps, so a stack frame names the `.vibe` file with the line of its compiled JavaScript.

Bun also leaves stack locations unmapped when it runs the compiler's emitted JavaScript, such as `bun dist/main.js`, even with `"sourceMap": true`. For mapped traces, run `node --enable-source-maps dist/main.js`; see [Debug stack traces](../getting-started/012-devtools.md#debug-stack-traces) for a debugging entry that prints the underlying stack.

`bun test` finds only files named `*.test.ts`, `*.test.js` and the like, never `*.test.vibe`. Write Bun suites as `.test.ts` files that import `.vibe` modules, or run `.test.vibe` files with Vitest.

## Next

Set up the editor: [VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md). Then verify with step 4 of [Set up VibeLang](../setup.md).

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

Typed ESLint integration follows the same config discovery: `typedProgram()` checks `vibe.config.json`, `tsconfig.json`, then `jsconfig.json` in each directory, starting at `tsconfigRootDir`. Set `project` to select an explicit config file.
