
`vibelang format --write` formats `.vibe` files with the shared formatter; `vibelang format --check` reports files that need formatting without writing them. `vibelang format --help` lists the options. Both accept file paths or glob patterns and use the nearest dprint configuration, as editor formatting does ([Format with dprint](formatting.md)).# Build with the vibelang CLI

`vibelang` replaces `tsc`. It checks `.vibe` and `.ts` files as one program, emits JavaScript, and accepts TypeScript's compiler flags. Install the packages with [Add VibeLang to an existing project](existing-project.md) first.

If the emitted program needs `vibelang-runtime` but the package cannot be resolved, compilation reports one `TS2307` naming the missing package. Install `vibelang-runtime` at the compiler's version. Written imports of the same absent package in `.vibe` and `.ts` files share that dependency error. Independent errors in your source still report.


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

Ordinary relative config paths stay relative to the config that declares them. In supported path fields, `${configDir}` uses the selected project config’s directory even when inherited: a base config’s `"outDir": "${configDir}/dist"` gives each extending project its own `dist` directory.

Every source `.vibe` file has its own module scope, including when `moduleDetection` is `"legacy"` or both `vibe.effectGlobals` and `vibe.effectModules` are `false`. Share a value through an explicit `export` and `import`. The option retains its TypeScript meaning for `.ts` and `.js` files.

Top-level `await` is ES top-level await of a Promise, with its module and target requirements, whatever its operand. An unsupported target reports `TS1378`; CommonJS output under `module: "NodeNext"` reports `TS1309`.

### Inspect or initialize configuration

- `vibelang --init` creates TypeScript's generic `tsconfig.json`. For an ESM project, set `"type": "module"` in `package.json`; then adapt `include` and the output options as above. The initializer does not create VibeLang's package setup.
- `vibelang --showConfig` prints the effective project configuration, including inherited options, without compiling. Invalid local or inherited settings report configuration errors and make the command exit unsuccessfully. Warnings keep the preview successful and leave its JSON output intact. Use `-p path/to/tsconfig.json` to inspect another project.
- `vibelang --noEmit --module nodenext --target es2022 src/hello.vibe` checks explicit files using the supplied compiler options. File arguments bypass config discovery, including nearby or parent `vibe.config.json`, `tsconfig.json` and `jsconfig.json` files; project include patterns and references do not apply. `--ignoreConfig` remains accepted and is optional for explicit files. Combining files with `-p`/`--project` is an error.

### Diagnostic severities

TypeScript's own lexical, syntax and static errors keep their `TS` codes, including errors inside embedded expressions and types. VibeLang's productions, placement rules and adopted proposal restrictions use the owning VIP's `EK` codes, regardless of the parser helper used. A specific diagnostic takes priority for the same rejection; independent native errors still report.

Set `vibe.severities` in any supported project config:

```json
{ "vibe": { "severities": { "EK0508": "off", "EK0801": "error", "EK4609": "off", "EK3801": "warning" } } }
```

The values are `"error"`, `"warning"`, `"suggestion"` and `"off"`. Keep leading zeroes in codes, as in `EK0508`. Every VibeLang code marked as a warning or lint warning in Appendix B, including the TypeScript-form warnings such as `EK4830`, and every assigned imported `EK38xx` lint code is configurable. An error code, an unknown code or an invalid severity value reports `EK3006`; an unknown `vibe` key or another wrong-typed value reports `EK3007`. Remove the invalid entry or supply its declared value; other valid severity entries still apply. When a key is repeated inside `vibe` or `vibe.severities`, its last value wins and an invalid-value diagnostic points at that last value.

`extends` merges the `vibe` section by key and `severities` by diagnostic code; child entries win. An `extends` array applies bases left to right. Severity entries are validated after this merge: a valid child or later-base entry replaces an invalid ancestor entry without reporting the ancestor's `EK3006`. Invalid effective entries still report `EK3006` at their declaring config; unrelated configuration errors remain errors. `--showConfig` prints the effective `vibe` section. A code setting overrides the Effect language-service rule configuration.

Invalid effective entries report `EK3006` individually and are ignored as overrides; other valid entries and independent options still apply. An invalid child entry does not restore the displaced base entry for the same code: its lower-precedence Effect language-service setting, when applicable, then its default applies. Other inherited codes remain. These are still configuration errors, with their normal exit and emit consequences.

Warnings print without failing the build or blocking `noEmitOnError`; set a warning to `"error"` to fail CI. `"suggestion"` is shown only by the language server, and `"off"` suppresses the diagnostic.

Both legacy paths, root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics`, are recognized in `vibe.config.json`, `tsconfig.json`, `jsconfig.json` and extended configs. Their supported legacy settings keep applying until migrated; an effective `vibe.severities` entry for the same diagnostic or its explicitly mapped port wins. The legacy validator still accepts only its own supported codes and values, so a release-only code such as `EK0801` does not belong there. Numeric code reuse does not make a release error configurable.

Each map reports migration warning `EK3009`. Setting `EK3009` to `"off"` only hides the warning; it leaves the supported legacy settings active. Run `vibelang -p tsconfig.json --fix` to move eligible maps to root `vibe.severities`, including in extended configs, preserving JSONC comments, unrelated settings and existing modern entries. Maps containing retired or nonconfigurable codes remain in place; resolve those entries, then rerun `--fix`. Plain `tsc` ignores the custom root keys but rejects `compilerOptions.vibelang` with `TS5023`. JSONC comments, including comments containing braces, stay intact while the migrated settings remain active. Comments in an empty legacy map, around its wrapper, after its final entry, or on an entry superseded by a modern setting survive too. Comments that cannot move with an entry stay beside the removed map; a second `--fix` run leaves the config unchanged.


### Keep the package's import spelling in declarations

A `.d.ts` file names another VibeLang module through its output, `./user.js` for `./user.vibe`, because no TypeScript resolves `./user.vibe` to `user.d.ts`. A package whose sources write `./user` or `./user.ts` sets the spelling its declarations use:

```json
{ "vibelang": { "declarationImportStyle": ".ts" } }
```

| Value | `import { find } from "./user.vibe"` is declared as |
| --- | --- |
| `".js"` (default) | `import { find } from "./user.js"` |
| `"extensionless"` | `import { find } from "./user"` |
| `".ts"` | `import { find } from "./user.ts"` |

Under every value, every other specifier keeps the source's spelling, as `tsc` keeps it, so a `.vibe` file's `./plain.ts` stays `./plain.ts`. An import written before its module became VibeLang keeps working too: `./user.ts` resolves to `user.vibe`, `rewriteRelativeImportExtensions` emits it as `./user.js`, and the declaration keeps `./user.ts` under every value. A type the compiler infers from a VibeLang module the file does not import, `import("./user.ts").User`, is spelled as `tsc` spells it for the file before migration: `./user.ts` under `module: nodenext` with `rewriteRelativeImportExtensions` or `allowImportingTsExtensions`, even in a file that writes `./x.js`, and otherwise the ending its imports use. Any other value is a configuration error. The migrate flow's setup sets it for each package from the spelling its relative imports already use. Plain `tsc` ignores the top-level `vibelang` key.

An import a declaration file adds, such as `import { Effect } from 'effect'` for a file that writes `number!!`, takes the quotes of the file's first written import or export specifier, as an import the TypeScript language service adds does; a file with none gets double quotes. Module types written through the file's own import, `HashSet<string>` through `import { HashSet, Option } from 'effect'`, keep that one import, and an added `Effect` joins it.

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

Plain `vibelang --fix` and the editor quick fix also rewrite service access written as a call, `try FileSystem.FileSystem()`, to `try FileSystem.FileSystem`. The call reports `TS2349`, or `TS2348` for a class tag or a `Context.Reference`. A function that returns an Effect keeps its call, and a read without `try` keeps its error.

The VIP-1 migration writes `try` before each call that ran where it stood before VIP-1, whatever the position: a statement, an initializer, a return value, an arm of `?:` or `match`, either side of `??` or `||`, the right side of `&&`, a `do` expression's result, an `effect` arrow's body, a `catch` handler or fallback, an argument, an element or a property value, as in `when Option.None: try die(new Error("missing"))`. A function the old compiler made an Effect function gets `effect`: a declaration, a method, an arrow that initializes an unannotated `const`, or a `catch` handler that ran a call (`catch effect (e) => try load(e.id)`). The `try` before a call of a plain declaration whose result is data, such as an error instance, goes. Where the migration can't tell whether a call ran, as in a callback whose form came from where it was passed, it writes nothing and reports the line as `try not written: …`. Ordinary `vibelang --fix` adds none of these: an Effect that an `effect` function returns stays the warning `EK4802`, with its two choices.

For the VIP syntax migration, `vibelang --fix --fix-vip-only` writes explicit `effect` functions and `effect { … }` blocks. Program literals passed to combinators, including elements of `Effect.all` and racing collections and a runtime program parameter such as `forkIn(scope, () => work())`, become Effects; callback arguments such as `Effect.forEach` stay functions. A function whose only Effect operation is a `catch` expression is marked `effect` where its form was an Effect function, as `(text: string): number!! => parse(text) catch () => 0` was; a `catch` that stays outside effect code, as in an `: infer _` factory or at the top level, becomes `effect { return … catch … }`, the same program, which builds its left side each time it runs, and so does a `catch` in effect code that is passed where an Effect is expected, as in `FiberMap.run(map, key, task catch h)`, or held in a `const` whose type is an Effect. Annotated literals, named function expressions and optional parameters retain their contracts and delayed evaluation through `Effect.suspend`. By-name arguments that compute a value become `effect { … }` blocks, function values at program positions are captured with `Effect.suspend` or `Effect.sync`, a function declaration that only such captures read becomes an `effect function`, and `fork` callbacks become `fork effect { … }`. A retired `try(…)` hatch becomes `try Effect.try(…)` (`EK4616`): its function stays plain TypeScript, its second argument becomes `catch` whether it is a function literal or a function by name such as `try(parse, onError, text)`, and `undefined` in that place leaves `catch` out.

For a monorepo, use `vibelang -b -w <solution-or-consuming-project>` to watch and rebuild the project-reference graph. Ordinary `-w` watches the selected project's compilation inputs; it does not keep referenced libraries built. For example:

```sh
vibelang -b -w packages/app
```

### Lint Effect code

Lint leaves existing declaration sidecars and incremental build information unchanged and creates no output files.

`vibelang` runs Effect's type-aware lint rules, the `effecttsgo/*` rules of [`@effect/tsgo`](https://github.com/Effect-TS/tsgo), inside the compiler on selected `.ts` and `.vibe` inputs (VIP-38), keeping the pinned upstream rule/file eligibility and declaration/library exclusions. VibeLang-specific language checks remain confined to `.vibe`. They run wherever VibeLang reports diagnostics: every `vibelang` build, the language server, and `vibelang lint` for CI. The repository's existing Effect language-service configuration, the `@effect/language-service` plugin in `tsconfig.json`, selects and configures them, so a lint script covers `.vibe` as it covers `.ts`. In a project without that plugin, a `vibe.severities` entry for an imported `EK38xx` code turns the rules on at their defaults; an entry for a VibeLang warning such as `EK4842` leaves them off:

```json
{
  "scripts": {
    "lint": "vibelang lint -p tsconfig.json"
  }
}
```

The plugin also checks plain `.ts` projects, including schemas built with `Schema.optional` or `Schema.optionalKey`; no `.vibe` file is required.

With an Oxlint configuration, `vibelang lint -c .oxlintrc.json [--deny-warnings] [<path>...]` runs the configuration's `effecttsgo/*` rules on the `.vibe` files under each path and walks the files Oxlint walks for the same invocation. It skips files that `.gitignore` files up to the repository root (a directory with `.git` or `.jj`) and `.git/info/exclude` ignore, the configuration's `ignorePatterns`, the `--ignore-path` file (`.eslintignore` by default, read beside each `.gitignore`) and each `--ignore-pattern` glob. `--no-ignore` turns off the ignore file and the patterns only. Build output such as a package's `dist/` that the repository ignores is not walked, so a copied source there is not reported as outside its project. Exact Unicode filenames such as `src/café.vibe` match in both `overrides[].files` and `ignorePatterns`. A `*` stays within a path segment, `**` crosses segments, `?` matches one character, and `[!…]` negates a character class.

The plugin's `ignoreEffectErrorsInTscExitCode`, `ignoreEffectWarningsInTscExitCode` and `ignoreEffectSuggestionsInTscExitCode` options keep these rules' `EK38xx` diagnostics of that category out of a `vibelang` build's exit status and out of `noEmitOnError`; the diagnostics still print.

`vibelang agents init` also teaches coding agents to run `vibelang lint` before finishing a change.

`vibelang lint` accepts the compiler's options, including `-p`/`--project` and file arguments, and has no options of its own. Without file arguments, it reads the first of `vibe.config.json`, `tsconfig.json` and `jsconfig.json` in each directory. Explicit files bypass that discovery and use the supplied compiler options, as with the compiler. It reports the same diagnostics as the compiler and the language server. It exits with status `1` on an error. Warnings never change the exit status, so set a code to `"error"` in `vibe.severities` to fail CI. Invalid project settings report their compiler diagnostic and exit with status `2`.

In a `.vibe` file, a rule runs in one of three ways. A rule whose pattern VibeLang's syntax rules out, such as `missingStarInYieldEffectGen`, does not run. A rule that a VibeLang diagnostic already ports runs as that diagnostic at the rule's severity: `effecttsgo/floating-effect` reports EK4801. Every other rule runs as Effect wrote it. [Effect language service rules](../getting-started/012-devtools.md#effect-language-service-rules) lists each rule's answer.

Oxlint never reads a `.vibe` file, so `vibelang lint` honors the disable comments a migrated file keeps from its TypeScript, as Oxlint does: `// oxlint-disable-next-line effecttsgo/schema-sync -- why` turns the rule off on the next line, `oxlint-disable-line` on its own line, and `/* oxlint-disable effecttsgo/schema-sync */` until the matching `oxlint-enable`; the `eslint-` spellings work the same, and a comment that names no rule turns every rule off. Builds and the language server read `// @effect-diagnostics-next-line schemaSync:off`.

## 3. Compile a first module

Create `src/hello.vibe`, in a directory that `include` selects:

```vibe
// src/hello.vibe
// run: try Console.log(try hello("VibeLang"))
export effect function hello(name: string) {
  return `Hello, ${name}!`
}
// Output: Hello, VibeLang!
```

Run `npx vibelang`: it prints nothing, exits with status 0, and writes `hello.js` to the `outDir` (`dist/` above). Run `vibelang` to write adjacent `.d.vibe.ts` declarations, even with `--noEmit`; [configure TypeScript tools to read them](#let-typescript-tools-read-vibe-modules).

In `.vibe` files, import local modules by their source name: `import { hello } from "./hello.vibe"`. For this CLI build, a `.ts` importer can use `./hello.js`: VibeLang resolves it to `hello.vibe` while checking, and Node loads the emitted `hello.js`. With Vite or Vitest, use `./hello.vibe` from `.ts` too, so the plugin loads the source ([Vite setup](vite.md#3-add-a-first-module)); `rewriteRelativeImportExtensions` permits that source extension and rewrites it when emitting JavaScript.

Declaration emit imports a prelude module whose name the source uses when an inferred type needs it: for example, `Layer.empty` declares a value of `Layer.Layer<never, never, never>` through an import from `effect`. This also applies with `module: Preserve` and `moduleResolution: Bundler`.

A native `.tsx` sibling keeps the project’s `jsx` output extension: a source import such as `./token.tsx` becomes `./token.jsx` in JavaScript under `preserve`, and `./token.js` under `react-native` and the React transform modes, as `tsc` names them.

## 4. Add an entry point

The `start` script runs `dist/main.js`, so create `src/main.vibe`:

```vibe
// src/main.vibe
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

Stock `tsc`, `tsrs`, TypeDoc and other checkers built on TypeScript cannot read a `.vibe` file, so the compiler writes each module's declarations beside it (VIP-27). `vibelang`, `vibelang --watch` and `vibelang -b` write them, `src/greet.d.vibe.ts` for `src/greet.vibe`, even with `--noEmit`. A sidecar is rewritten only when its text changes. Its text is the module's declaration file with one change: an import or re-export of another `.vibe` module names its source, `./name.vibe`, even when an unrelated `name.ts`, `name.tsx`, `name.d.ts` or `name.js` sits beside it. An explicit native import keeps its native target. Relative module specifiers are resolved as decoded TypeScript strings, so quoted filenames and Unicode escapes select the same module as the source import. Rewritten paths keep the declaration's quote style and escape that quote when needed. With `vibe.sidecarDir`, relative imports and references are rebased from the sidecar's actual location.

A TypeScript `module parse { … }` body in `src/main.vibe` also gets `src/main.vibe.parse.d.ts`, beside the source, even with `--noEmit` (VIP-40). A sidecar re-export such as `export { port } from parse` names that declaration through `./main.vibe.parse.js`, so stock `tsc` sees the exported types and TypeScript's JSDoc, including `@throws`. With `vibe.sidecarDir`, the body declaration stays beside the source and the relocated sidecar refers back to it. Wildcard discovery ignores a declaration belonging to a source's module body; an explicitly listed declaration remains an input and is protected from being overwritten.

A TypeScript `module parse { … }` body in `src/main.vibe` also gets `src/main.vibe.parse.d.ts`, beside the source, even with `--noEmit` (VIP-40). A sidecar re-export such as `export { port } from parse` names that declaration through `./main.vibe.parse.js`, so stock `tsc` sees the exported types and TypeScript's JSDoc, including `@throws`. With `vibe.sidecarDir`, the body declaration stays beside the source and the relocated sidecar refers back to it. Wildcard discovery ignores a declaration belonging to a source's module body; an explicitly listed declaration remains an input and is protected from being overwritten.

A `schema` declaration's JSDoc is emitted on its constant only; the generated `typeof Name.Type` alias has no comment. This includes visibility and deprecation tags, following ordinary TypeScript declaration emit. One written, nongeneric `type Name = typeof Name.Type` beside either ordinary `schema Name` form replaces the generated alias in the same scope, in either order. The written declarations keep their own comments, order and exports; `removeComments` and `stripInternal` apply as on the native pair. `vibelang --fix` keeps such a documented type when it rewrites the native pair to a `schema` declaration, and removes an undocumented one.

A compatibility declaration keeps an explicit `./tag.vibe` import bound to that source when `tag.ts` is also present. The same applies to inferred import types and every `declarationImportStyle`: sidecar resolution preserves the selected source before computing its output-relative path. Public `.d.ts` files keep their configured import spelling.

The Node and Bun loaders reuse a cached compile when generated sidecars beside their sources, or anywhere under `vibe.sidecarDir`, appear, change or disappear. They still recompile when a source or a standalone declaration file changes.

No VibeLang setting is needed. The retired `declarationSidecars` option is an error. Run `vibelang -p tsconfig.json --fix` to remove it from the project and its local inherited configs. This also removes the obsolete key from the top-level `vibe` section in `tsconfig.json` or `vibe.config.json`, preserving other settings, comments and a UTF-8 BOM.

`bun check` runs the project's `check` script; a script that invokes a TypeScript checker uses that checker's sidecar resolution.

In each project whose checker is not `vibelang`, set TypeScript's [`allowArbitraryExtensions`](https://www.typescriptlang.org/tsconfig/allowArbitraryExtensions.html), and import the module by its source name:

```json
{ "compilerOptions": { "allowArbitraryExtensions": true } }
```

TypeScript then resolves `import { greet } from "./greet.vibe"` to `greet.d.vibe.ts`, as it resolves `./styles.css` to `styles.d.css.ts`. Without the option it reports `TS6263`. Without custom `moduleSuffixes`, TypeScript does not map `./greet.js` or `./greet` to a sidecar, so a `.ts` file that such a checker reads names the `.vibe` module by its source. `vibelang` itself reads `greet.vibe` and never the sidecar, and a project's `include` leaves out a sidecar whose source is beside it.

A workspace package can expose a module through its `x.d.vibe.ts` declaration under `types` and its `x.vibe` source under `vibelang-source`. Inferred declarations in consumers keep the package export name, such as `import("lib/x").Provider<number>`, including exact and wildcard export entries.

This source preference also applies when `moduleSuffixes` places a paired `.d.vibe` fallback after its original suffix. Stock TypeScript keeps its own suffix order, which can select the sidecar before a `.tsx` sibling.

Cyclic inferred declaration types retain TypeScript 5.9/7.0 elision: a repeated anonymous type prints `/*elided*/ any` rather than the new TypeScript 7.1 `TS5088`. Other recursion checks still apply; see [Declaration output](https://vibelang.sh/spec/001-functions#declaration-output).

What a sidecar cannot print, such as `TS4094` for a private member of an exported class expression or `TS2883` for a type it can name only through `node_modules`, is an error where the project emits declarations (`declaration` or `composite`): declaration emit writes `any` in its place, and a stock checker that reads the sidecar would accept that `any` silently. A project with neither publishes nothing, so its sidecars name such a type by its path into `node_modules`, which its own checkers resolve. What it still cannot print there, such as `TS4094`, is an error only where a `.ts` file of the project imports the module, as for the same TypeScript under `tsc`, since that file reads the sidecar: it is reported at that import. Annotate the export, or keep the module `.ts`.

### Keep the sidecars in one directory

Code that lists a folder's `*.ts` files and skips `*.d.ts`, such as a test that imports every module in a folder, also picks up `greet.d.vibe.ts`. Set `vibe.sidecarDir` to move every sidecar into one hidden directory, and add it to `rootDirs` so stock TypeScript still finds them:

```jsonc
{
  "compilerOptions": { "allowArbitraryExtensions": true, "rootDirs": [".", ".vibe/declarations"] },
  "vibe": { "sidecarDir": ".vibe/declarations" }
}
```

`src/greet.vibe` then gets `.vibe/declarations/src/greet.d.vibe.ts`: the path under the config's directory, mirrored. Relative imports in the sidecar target native TypeScript files or the selected VibeLang declarations from its actual output location, so a consumer in another project does not need to inherit the producer's `rootDirs` for those references. An empty `sidecarDir` string names the declaring config directory and overrides an inherited path; omitting the entry inherits it. A directory that overlaps the source tree, such as `src`, or an ancestor such as `..`, still mirrors each source's config-relative path; cleanup keeps outputs selected for other modules. A relative `sidecarDir` resolves from the config that declares it; in a shared base config, write `${configDir}/.vibe/declarations` in both settings. A `.vibe` file outside the config's directory keeps its sidecar beside it. Turning the setting on removes the sidecars beside the sources; turning it off removes those under `.vibe/declarations`, and the folder once it is empty. Remove a sidecar directory with any other name by hand. `vibelang --watch` writes each changed sidecar to the chosen place and settles, and the language server reads a `.ts` file's `./greet.vibe` import from `greet.vibe` itself in either mode. A bare import in a sidecar resolves from the sidecar's folder upward, so keep the directory inside the package whose `node_modules` it needs.

For stock TypeScript consumers, choose a separate directory such as `.vibe/declarations`. When a source is inside the chosen directory, native `rootDirs` longest-prefix resolution can shadow or miss its mirrored declaration. The compiler still emits each source at its mirrored path and preserves every selected output during cleanup.

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
The loaders leave an absent application `TMPDIR` untouched: compilation and the default cache use its nearest existing parent directory. An explicit `VIBELANG_CACHE_DIR` still names the exact cache directory to create.

A committed loader record from `writeLoaderRecord` in `vibelang/project` can move with the checkout. It relocates recorded file paths and source-map sources while preserving emitted JavaScript bytes, including strings containing the old checkout path. Records from the older format are ignored and compiled again.

The result is cached on disk, so the next process starts in milliseconds until
a source, a tsconfig, an installed package, or the compiler changes. Set
`VIBELANG_CACHE_DIR` to move the cache and `VIBELANG_DISABLE_CACHE=1` to turn it
off, and `VIBELANG_REGISTER_DEBUG=1` to print how long each project's compile
took, stage by stage. Errors in the loaded source and project-wide errors
stop the import with the compiler's diagnostics, and a stack trace names `.vibe` lines. A workspace package the
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

or on the command line: `bun --preload vibelang/bun src/main.ts`. The first `.vibe` import compiles the project's `.vibe` files in the nearest `tsconfig.json` above the module, once per process, with the same cache as Node. Set `VIBELANG_PROJECT` to a tsconfig path to choose another project for the modules in its directory; a module of another workspace package compiles with that package's own `tsconfig.json`. A TypeScript module may import a `.vibe` module by its emitted name, such as `./x.js` for `x.vibe`, as a migrated project does after it replaces `x.ts`; an `x.ts` beside it still wins. An extensionless import, such as `../src/archive`, resolves to `archive.vibe` or a directory's `index.vibe` as TypeScript's `Bundler` resolution does. So does an alias of the nearest `tsconfig.json`'s `paths`, through its `extends` chain: with `"@/*": ["./src/*"]`, `@/archive` and `@/archive.js` load `src/archive.vibe` when TypeScript resolves them there, and an `archive.ts` still wins. The preload rewrites these imports in the module's source before runtime resolution. The rewrite is synchronous, so `require()` and a `createRequire` require load such a module wherever they load it when the modules it imports are `.ts`. A composite project compiles too. Errors in the loaded source and project-wide errors fail the import. Bun ignores a plugin's source maps, so a stack frame names the `.vibe` file with the line of its compiled JavaScript.

The preload discovers imports in the project's sources, leaving dependency modules in `node_modules` to Bun's native loader. A workspace package linked into `node_modules` still uses its real source path, so its extensionless imports can reach `.vibe` files. Tests that load only TypeScript keep the native dependency loader even when the project contains migrated files. A CommonJS `require("./archive")` reaches `archive.vibe` through Node's CommonJS resolve hook. Bun 1.3.13 calls a replaced hook without the requiring module for a `require` that `createRequire(url)` made, so the request would resolve from the working directory instead of `url`. On such a Bun the preload leaves the hook alone: `createRequire` keeps resolving from its URL, and a CommonJS `require` of a `.vibe` module names its extension, `require("./archive.vibe")`. Bun 1.4.2 has the hook.

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

Typed ESLint integration follows the same config discovery: `typedProgram()` checks `vibe.config.json`, `tsconfig.json`, then `jsconfig.json` in each directory, starting at `tsconfigRootDir`. Set `project` to select an explicit config file.

For VIP-2, `vibelang --fix` also migrates a `do { … }` used as an Effect argument to `effect { return do { … } }`. The inner `do` preserves its completion value; the effect block delays evaluation until each run. This migration also runs under `--fix-vip-only`.

The `--fix-vip-only` pass reads pre-VIP-1 code and preserves the old call's run phase: it removes a known wrapper's run even when its result was an error value or another Effect. It refuses unknown provenance. Ordinary `--fix` keeps intentional `try` operations in current source. A non-Effect operand keeps `EK0502`; no `asEffect()` call is guessed.

The `--fix` command changes only your project's `.vibe` and `.vibex` program sources and eligible owned configs. It includes owned imported sources even when excluded from root discovery, and never edits dependency configs under `node_modules`, foreign TypeScript/JavaScript, generated declarations or another referenced project's files. In `-b`, projects are fixed separately in build order. The platform repair can create a new absent sibling `.ts` file when it proves preservation, but never overwrite one.

Compatibility declarations are output files. Let `include` discover source/sidecar pairs; listing the sidecar explicitly in `files` keeps it as an input, so an attempted overwrite reports `TS5055`, exits `1` and preserves the file. Compatibility writes remain required under `noEmit: true` or `declaration: false`; those options still control ordinary JavaScript and public declarations.

A non-relative name reaching a compatibility sidecar in a linked workspace package reads its available source when TypeScript's final resolved path is outside `node_modules`. Package exports, `paths` and `#imports` share this rule. Published packages and logical `node_modules` paths retained by `preserveSymlinks` keep declarations. Relocated sidecars use their recorded source map.

The migration flow keeps only the selected batch's fixes. It lists the compiler project's VibeLang sources and dependency closure before the fix loop and restores earlier batches within that graph on every exit, including interruption. Concurrent calls in one flow process take turns when their source graphs overlap; disjoint projects can fix their files together. The `*.scope.log` receipt records project discovery and when the fix acquires and releases its source graph.

The migrate flow also detects TypeScript ast-grep rules and unquoted script globs. Setup preserves an existing effective `sidecarDir`, adds its matching virtual root, records why it selected directory mode, and removes the paired adjacent sidecars it supersedes immediately. A rerun makes no further removals. Unrelated declarations remain. In workspace packages, a bare `types` import of a relocated sidecar and an explicit import of its `.vibe` source keep one module identity.

Migration setup adapts release helpers that map source paths to JavaScript and declarations, including `const` arrow mappers in nested package `imports` conditions. The helper keeps its authored `dist` and declaration layout. Tests, fixtures and helpers used only by tests stay unchanged.

The migrate flow keeps packed runtime exports reachable: when `default` names `.vibelang/js/`, an existing package `files` list gains that directory, including its loader records. Packing ignore exceptions cover only this generated runtime tree and preserve other exclusions. Reverting the last migrated module removes the flow's additions and keeps authored packing entries.

A migration batch retains the packing files its emit creates, including when verification first creates them. Repeated verification, recording and revert recognize those exact files as the batch's output.
