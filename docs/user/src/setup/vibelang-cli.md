
# Build with the vibelang CLI

`vibelang` replaces `tsc`. It checks `.vibe` and `.ts` files as one program, emits JavaScript, and accepts TypeScript's compiler flags. Install the packages with [Add VibeLang to an existing project](existing-project.md) first.

`vibelang format --write` formats `.vibe` files with the shared formatter; `vibelang format --check` reports files that need formatting without writing them. `vibelang format --help` lists the options. Both accept file paths or glob patterns and use the nearest dprint configuration, as editor formatting does ([Format with dprint](formatting.md)).

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

Wildcard input discovery prefers `.ts`, `.tsx`, `.vibe`, then `.vibex` implementations before ordinary `.d.ts` and JavaScript files with the same stem. This keeps existing output files from hiding their source. A `files` list keeps every explicitly named input, following TypeScript's rules.

Ordinary relative config paths stay relative to the config that declares them. In supported path fields, `${configDir}` uses the selected project config’s directory even when inherited: a base config’s `"outDir": "${configDir}/dist"` gives each extending project its own `dist` directory.

Every source `.vibe` file has its own module scope, including when `moduleDetection` is `"legacy"` or both `vibe.effectGlobals` and `vibe.effectModules` are `false`. Share a value through an explicit `export` and `import`. The option retains its TypeScript meaning for `.ts` and `.js` files.

Top-level `await` is ES top-level await of a Promise, with its module and target requirements, whatever its operand. An unsupported target reports `TS1378`; CommonJS output under `module: "NodeNext"` reports `TS1309`.

A service needs a stable identity during migration. For a standalone source file whose package has no name, write an explicit `static readonly key` before running `--fix`. That keeps an unrelated generated-key repair out of the migration you are inspecting.

For a local service with a cached `static readonly default`, `--fix` writes the native `Context.Service` class while keeping the field, key and reads. It preserves eager initialization and missing-provider failure. Exported keys, commented service bodies and keys that also declare `defaultValue` require a manual native class migration.

The cached-default repair retains eager evaluation, the same object on repeated reads, mutable shape members and type-level reads of `default`. Replacing the field with a `Context.Reference` factory changes initialization and missing-provider behavior; choose that redesign explicitly rather than expecting `--fix` to introduce it.

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

The values are `"error"`, `"warning"`, `"suggestion"` and `"off"`. Keep leading zeroes in codes, as in `EK0508`. VibeLang warning and lint warning codes without error variants, including the TypeScript-form warnings such as `EK4830`, and every assigned imported `EK38xx` lint code are configurable. A code with context-dependent error and warning variants, such as `EK4402`, stays nonconfigurable. An error code, an unknown code or an invalid severity value reports `EK3006`; an unknown `vibe` key or another wrong-typed value reports `EK3007`. Remove the invalid entry or supply its declared value; other valid severity entries still apply. When a key is repeated inside `vibe` or `vibe.severities`, its last value wins and an invalid-value diagnostic points at that last value.

`extends` merges the `vibe` section by key and `severities` by diagnostic code; child entries win. An `extends` array applies bases left to right. Severity entries are validated after this merge: a valid child or later-base entry replaces an invalid ancestor entry without reporting the ancestor's `EK3006`. Invalid effective entries still report `EK3006` at their declaring config; unrelated configuration errors remain errors. `--showConfig` prints the effective `vibe` section. The compiler API preserves these effective settings when parsed options are passed to `createProgram` or used to reconfigure a program. A code setting overrides the Effect language-service rule configuration.

Invalid effective entries report `EK3006` individually and are ignored as overrides; other valid entries and independent options still apply. An invalid child entry does not restore the displaced base entry for the same code: its lower-precedence Effect language-service setting, when applicable, then its default applies. Other inherited codes remain. These are still configuration errors, with their normal exit and emit consequences.

VibeLang's own warnings print without failing the build or blocking `noEmitOnError`; set an own warning to `"error"` to fail CI. Own `"suggestion"` diagnostics appear only in the language server, and `"off"` suppresses a diagnostic. Imported Effect rules use the upstream compiler policy described below.

Both legacy paths, root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics`, are recognized in `vibe.config.json`, `tsconfig.json`, `jsconfig.json` and extended configs. Their supported legacy settings keep applying until migrated; an effective `vibe.severities` entry for the same diagnostic or its explicitly mapped port wins. The legacy validator still accepts only its own supported codes and values, so a release-only code such as `EK0801` does not belong there. Numeric code reuse does not make a release error configurable.

A compatibility warning that defaults to `"off"` can therefore appear at error severity when its supported legacy entry selects `"error"`. For example, an effective legacy `EK4824` override enables the unnecessary-pipe warning at that severity; unrelated warnings keep their own defaults.

Each map reports migration warning `EK3009`. Setting `EK3009` to `"off"` only hides the warning; it leaves the supported legacy settings active. Run `vibelang -p tsconfig.json --fix` to move eligible maps to root `vibe.severities`, including in extended configs inside the repository, preserving JSONC comments, unrelated settings and existing modern entries. Extended configs outside the repository or under `node_modules`, including symlinks that reach either location, are reported and left unchanged. Without a `.jj` or `.git` repository marker, migration stays inside the selected config’s directory. Maps containing retired or nonconfigurable codes remain in place; resolve those entries, then rerun `--fix`. Plain `tsc` ignores the custom root keys but rejects `compilerOptions.vibelang` with `TS5023`. JSONC comments, including comments containing braces, stay intact while the migrated settings remain active. Comments in an empty legacy map, around its wrapper, after its final entry, or on an entry superseded by a modern setting survive too. Comments that cannot move with an entry stay beside the removed map; a second `--fix` run leaves the config unchanged.


### Retired declaration and package-trust settings

`declarationImportStyle` is ignored under root `vibelang` and `compilerOptions.vibelang`, with warning `EK3011`. `trustedPackages` is ignored under both legacy sections and root `vibe`, with warning `EK3010`. Every value, including malformed values, gets a deprecation warning by default. The keys do not appear in `--showConfig`; default warnings do not block `noEmitOnError`. Remove the keys; there is no replacement setting. Declaration spelling follows the source and TypeScript compiler options. Run `vibelang --fix` to wrap eligible foreign calls in Effect's exception boundary while preserving their defect behavior. Use `vibe.severities` to configure these warnings.

An import a declaration file adds, such as `import { Effect } from 'effect'` for a file that writes `number!!`, takes the quotes of the file's first written import or export specifier, as an import the TypeScript language service adds does; a file with none gets double quotes. Module types written through the file's own import, `HashSet<string>` through `import { HashSet, Option } from 'effect'`, keep that one import, and an added `Effect` joins it.

Inferred declaration imports use the TypeScript twin's module choice, including in a retained `.ts` or `.tsx` file that imports a `.vibe` module. Migrating a dependency does not introduce an import of a re-exporting package index and its unrelated declarations.

For `export { value } from "./producer.vibe"`, public `.d.ts` output writes `./producer.ts` and the adjacent `.d.vibe.ts` writes `./producer.vibe`. A written `.vibex` specifier similarly uses `.tsx` in public output. The declaration spellings stay the same with either value of `rewriteRelativeImportExtensions`; that option rewrites JavaScript output.

## 2. Replace tsc in the scripts

![vibelang in place of tsc](/videos/eco-tsc.mp4)

In `package.json`, replace `tsc` with `vibelang` in every script. `vibelang` runs the rules of the tsconfig's `@effect/language-service` entry, which plain `tsc` ignores. If nothing in the project runs `effect-tsgo patch` or `effect-language-service patch`, set `ignoreEffectWarningsInTscExitCode` and `ignoreEffectErrorsInTscExitCode` to `true` in that entry so Effect diagnostics print without failing a build `tsc` passed ([Lint Effect code](#lint-effect-code)). If the project has no build script, add these:

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

When repairing a `Schema.TaggedError` class, `--fix` names a field codec in a constant if it has no direct `schema error` field form. That constant retains the codec's checked contextual type. Generic factories such as `Schema.instanceOf(Date)` therefore keep the original schema input type instead of selecting a narrower default after hoisting.

Prelude cleanup keeps imports used by bare type references, including interface base types, and does not shorten a qualified type such as `FileSystem.FileSystem` to a bare name. Where a module's name is written for its same-named export, every `--fix` scope writes the export: `Option<number>` becomes `Option.Option<number>`, a bare `Scope` type `Scope.Scope`, `Experimental.Process` in a type `Experimental.Process.Process`, and `FileSystem.of` `FileSystem.FileSystem.of`; a written `Experimental.Process.Process` is kept, never shortened. A shared module can be checked by configs with different `lib` or `types` settings; fixing it under one config must not make its types bind to another config’s ambient declarations.

An unchanged native importer can use `./Leaf.js` while its producer moves from `Leaf.ts` to `Leaf.vibe` and back. A written `./Leaf.ts` still requires a native TypeScript candidate and reports `TS2307` when none exists, even if a `Leaf.vibe` sibling is present.

Before updating to the resolver that retires stale native-source imports, run `vibelang -p tsconfig.json --fix`. It repairs a relative `./user.ts` whose native target is gone and whose migrated `user.vibe` exists, and the corresponding `.tsx` to `.vibex` pattern. With `rewriteRelativeImportExtensions`, it writes `./user.vibe`; with source extensions allowed in a type-only project, it also writes the source name. Otherwise it writes `./user.js` (or `.jsx` for a JSX-preserving target). A matching native TypeScript implementation keeps its name. Emitted JavaScript and declarations do not mask an available VibeLang source. The repair honors `rootDirs` and `moduleSuffixes`, so a migrated `user.native.vibe` is found through the same configured suffixes and native matches still win. This repair also runs under `--fix-vip-only`. The migrate flow uses the same project settings when renaming a source file.

For a private `const f = trusted(impl, [])`, `vibelang --fix` and `--fix-migration-only` can capture `impl` once, preserve its forwarding behavior, and wrap each call in an explicit Effect function with `try Effect.orDie(Effect.try({ try: () => f(x), catch: (e) => e }))`. The nonthrowing inline mapper keeps the exact thrown value as a defect and leaves the public error channel unchanged. The migration leaves exported or escaping function values, plain callers, comments inside the wrapper, constructor values reached through proxies or local namespace aliases, and calls whose arguments run Effects or transfer control for manual review. A reviewed `.ts` helper with `@throws {never}` is another replacement.

Generated synchronous defect bridges reuse `identity` from `effect/Function` as their catch mapper. They keep the original thrown value and add no unused local catch function to the module's coverage.

`vibelang --fix` also removes redundant `mutable` markers from ordinary interface and object-type properties and index signatures. Their fields remain writable unless written `readonly`; comments and emitted declarations stay the same. This rewrite also runs with `--fix-migration-only`. For a plain `error` with a legacy `mutable` payload, the fix writes an explicit class using the existing runtime error factory, preserving the payload declaration bytes and tagged matching. Schema fields, schema errors, tuples and `data` bodies stay with their own migrations.

The VIP migration also marks Effect functions `effect`, including arrows with an Effect return annotation such as `const value = (): number!! => 1`. Run `vibelang --fix --fix-vip-only` to apply only the VIP migrations. Repeat the same repair selection to check that the migration is complete. A later ordinary `--fix` can additionally remove an unused explicit Effect import; repeating that ordinary repair then leaves the source unchanged. Legacy running calls migrate before retired `infer` slots are written explicitly, so the error and requirement channels describe the migrated body. Leading and trailing comments stay in place, including comments after the final declaration.

Use `PlatformError.PlatformError` to name the failure type through the implicit `PlatformError` module. An annotation can also use an imported alias for that same type.

When an `Effect.gen` body binds an Effect returned by a factory, `--fix` keeps the factory call at that binding. Reusing the bound program preserves one factory invocation and its shared closure state; it does not postpone startup validation until each run.
Legacy bare `yieldNow(priority)`, `yieldNow()` and `interrupt()` factory calls migrate to native Effect values under `--fix`, `--fix-vip-only` and `--fix-migration-only`. The fix evaluates the priority once, including when it is optional, and preserves comments and local bindings. Held and returned programs remain cold in effect code, plain factories and top-level initializers. Existing `try` operations still run them; a discarded Effect statement, already rejected with `EK4801`, gains an explicit `try`. Native `yieldNow` is a value; new code runs it with `try yieldNow`, or uses `try Effect.yieldNowWith(priority)` for a numeric priority.

The migration also handles direct calls through named aliases or namespace imports of the retired `vibelang-runtime` factories. It keeps the runtime module dependency in its original import order and retains an existing `try`. If a factory binding escapes, appears in a type, or is read dynamically, update that binding explicitly; the fix leaves it unchanged.


For VIP-10, `vibelang --fix` and `--fix-vip-only` rewrite a direct implementation call inside Effect code, `Users.find(id)`, as `(try Users).find(id)`. A tried Effect-returning call retains its outer `try`; a tried method with a known plain return drops only that outer run. Arguments and comments stay in place, and a held Effect stays unrun. Module services use an explicit key, such as `(try FileSystem.FileSystem).readFileString(path)`. Native key properties, optional calls, plain functions, malformed functions and tried calls with ambiguous return types need no automatic rewrite. Read implementation member values explicitly.

For VIP-19, a closure in a `for concurrent` iterable expression retains the uninitialized head binding. If this correction makes an old outer capture fail type checking, `--fix` and `--fix-vip-only` rename the item binding and its uses, preserving the RHS reference to the live outer binding, including later mutations. See [basic concurrency](../concurrency/007-basic-concurrency.md).

Plain `vibelang --fix` and the editor quick fix also rewrite service access written as a call, `try FileSystem.FileSystem()`, to `try FileSystem.FileSystem`. The call reports `TS2349`, or `TS2348` for a class tag or a `Context.Reference`. A function that returns an Effect keeps its call, and a read without `try` keeps its error.

To fix part of a large package, list the modules: `vibelang --fix --only src/a.vibe,src/b.vibe`, or `--only @batch.txt` with one path per line. Paths are relative to the current directory. The repairs write no other file, even if you interrupt them, so a repair that would create one, such as the sibling `.ts` module of an `EK4402` platform split, is refused for that site with the reason; they check only the listed modules, so they take far less time than a run over the package. A repair that would create a file, such as moving a platform wrapper into a new `.platform-N.ts` module, is refused at its site, and the run keeps its other fixes. The compilation after them still checks the whole project and writes its usual output, such as declaration sidecars. Because the repairs do not check the rest, a fix that breaks a module you did not list is kept, and that compilation reports the error. The report calls the run a partial repair: a clean run does not verify the project. An empty list, or a path that is not a `.vibe` module of the project, stops the run before it writes anything. `--only` does not combine with `--fix-migration-only` or `--fix-vip-only`.

The VIP-1 migration writes `try` before each call that ran where it stood before VIP-1, whatever the position: a statement, an initializer, a return value, an arm of `?:` or `match`, either side of `??` or `||`, the right side of `&&`, a `do` expression's result, an `effect` arrow's body, a `catch` handler or fallback, an argument, an element or a property value, as in `when Option.None: try die(new Error("missing"))`. A function the old compiler made an Effect function gets `effect`: a declaration, a method, an arrow that initializes an unannotated `const`, or a `catch` handler that ran a call (`catch effect (e) => try load(e.id)`). The `try` before a call of a plain declaration whose result is data, such as an error instance, goes. Where the migration can't tell whether a call ran, as in a callback whose form came from where it was passed, it writes nothing and reports the line as `try not written: …`. Ordinary `vibelang --fix` adds none of these. A returned Effect stays success data without an own `EK4802` warning; write `return try program` explicitly to run it. Own `EK4802` is reserved for inferred Effect arguments at plain generic calls.

The VIP migration also removes empty calls of Effect values at a `catch` head: `Port() catch () => "fallback"` becomes `(Port) catch () => "fallback"`. This includes factory-produced configuration values such as `Config.option(Config.String("PORT"))`. The head remains an Effect for `catch` to run, preserving its failure handler.

For a current generic call such as `expect(awaited())`, the `EK4802` repair writes `expect(try awaited())` when the function's written error and requirement channels accept it. Ordinary `--fix` applies that direct-argument repair only when checking accepts the edit. To pass the unrun program intentionally, write the call's Effect type argument explicitly. Arrays and callbacks need a repair where their Effects are constructed; an Effect returned as data has no automatic execution repair. The historical `--fix-vip-only` migration keeps its separate run-phase rules.

For the VIP syntax migration, `vibelang --fix --fix-vip-only` writes explicit `effect` functions and `effect { … }` blocks. Program literals passed to combinators, including elements of `Effect.all` and racing collections and a legacy runtime program parameter such as `forkIn(scope, () => work())`, become Effects; callback arguments such as `Effect.forEach` stay functions. A function whose only Effect operation is a `catch` expression is marked `effect` where its form was an Effect function, as `(text: string): number!! => parse(text) catch () => 0` was; a `catch` that stays outside effect code, as in an `: infer _` factory or at the top level, becomes `effect { return … catch … }`, the same program, which builds its left side each time it runs, and so does a `catch` in effect code that is passed where an Effect is expected, as in `FiberMap.run(map, key, task catch h)`, or held in a `const` whose type is an Effect. Annotated literals, named function expressions and optional parameters retain their contracts and delayed evaluation through `Effect.suspend`. By-name arguments that compute a value become `effect { … }` blocks, function values at program positions are captured with `Effect.suspend` or `Effect.sync`, a function declaration that only such captures read becomes an `effect function`, and `fork` callbacks become `fork effect { … }`. A retired `try(…)` hatch becomes `try Effect.try(…)` (`EK4616`): its function stays plain TypeScript, its second argument becomes `catch` whether it is a function literal or a function by name such as `try(parse, onError, text)`, and `undefined` in that place leaves `catch` out.

The VIP migration preserves the old call phase even when current source would receive an inferred-Effect warning. For `check<T>(actual: T, other: T): T`, an independent Effect supplied by `other` keeps `actual` as a program; the migration runs the returned program. A generic assertion whose type parameter comes only from its actual argument instead runs that argument before calling the assertion. An optional `undefined`, an empty collection, or a second legacy call supplies no independent program value; the migration still runs the original calls in those positions.

For a monorepo, use `vibelang -b -w <solution-or-consuming-project>` to watch and rebuild the project-reference graph. Ordinary `-w` watches the selected project's compilation inputs; it does not keep referenced libraries built. For example:

```sh
vibelang -b -w packages/app
```

Repeated foreign calls in one effect function can be fixed together without redeclaring their captured inputs. The repair preserves argument evaluation order and existing narrowed property types.

### Lint Effect code

![Effect's lint rules in vibelang lint](/videos/eco-lint-effect.mp4)

Lint leaves existing declaration sidecars and incremental build information unchanged and creates no output files.

`vibelang` runs Effect's type-aware lint rules, the `effecttsgo/*` rules of [`@effect/tsgo`](https://github.com/Effect-TS/tsgo), inside the compiler on selected `.ts` and `.vibe` inputs (VIP-38), keeping the pinned upstream rule/file eligibility and declaration/library exclusions. VibeLang-specific language checks remain confined to `.vibe`. They run wherever VibeLang reports diagnostics: every `vibelang` build, the language server, and `vibelang lint` for CI. The repository's existing Effect language-service configuration, the `@effect/language-service` plugin in `tsconfig.json`, selects and configures them, so a lint script covers `.vibe` as it covers `.ts`. A `vibe.severities` entry only overrides a rule of the resolved plugin. It does not activate an absent plugin or override `diagnosticSeverity: null` or `diagnostics: false`:

```json
{
  "scripts": {
    "lint": "vibelang lint -p tsconfig.json"
  }
}
```

The plugin also checks plain `.ts` projects, including schemas built with `Schema.optional` or `Schema.optionalKey`; no `.vibe` file is required. The presence of `.oxlintrc.json` or `oxlint.config.ts` does not change the project, compiler options or diagnostics selected by `vibelang lint -p tsconfig.json`. Native lint help also follows the compiler's options.

An explicit legacy Oxlint adapter invocation, `vibelang lint -c .oxlintrc.json [--deny-warnings] [<path>...]` runs the configuration's `effecttsgo/*` rules on the `.vibe` files under each path and walks the files Oxlint walks for the same invocation. It skips files that `.gitignore` files up to the repository root (a directory with `.git` or `.jj`) and `.git/info/exclude` ignore, the configuration's `ignorePatterns`, the `--ignore-path` file (`.eslintignore` by default, read beside each `.gitignore`) and each `--ignore-pattern` glob. `--no-ignore` turns off the ignore file and the patterns only. Build output such as a package's `dist/` that the repository ignores is not walked, so a copied source there is not reported as outside its project. Exact Unicode filenames such as `src/café.vibe` match in both `overrides[].files` and `ignorePatterns`. A `*` stays within a path segment, `**` crosses segments, `?` matches one character, and `[!…]` negates a character class.

The explicit adapter follows project `references` when finding the configuration that includes a selected file. A solution `tsconfig.json` with `"files": []` can point to `tsconfig.node.json` or another referenced project. This works with automatic discovery and when `-p` selects the solution file or its directory. A file excluded from every selected project still reports that it was not linted and makes the command fail.

In that explicit adapter, a rule the configuration turns on reports a `.vibe` file under its `EK38xx` code, including a rule the [Devtools table](../getting-started/012-devtools.md) answers with syntax or a build diagnostic: a migrated file that still writes `Effect.succeed(undefined)` under `effecttsgo/effect-succeed-with-void` gets `EK3834`. Imported `effecttsgo/floating-effect` reports once as `EK3801` on selected `.ts` and `.vibe` inputs, using the configured severity. The rules read the program's types, and `vibelang lint` does not print the compiler's own errors, so build referenced projects first (`vibelang -b`): a reference with no built declaration files gives `unknown` types, which `missing-effect-error`, `missing-effect-context` and `missing-layer-context` report as missing Effect errors or services. `missed-pipeable-opportunity` counts no `try` or `catch` as a pipeline stage, though both compile to calls. Builds and the language server keep the table's rule set. `vibelang lint --help` prints this help with or without a configuration.

Imported Effect warnings make a compiler build exit non-zero and block `noEmitOnError` by default, as in the pinned Effect TypeScript compiler. Suggestions print when `includeSuggestionsInTsc` is `true` and affect a build only when `ignoreEffectSuggestionsInTscExitCode` is `false`.

The plugin's `ignoreEffectErrorsInTscExitCode`, `ignoreEffectWarningsInTscExitCode` and `ignoreEffectSuggestionsInTscExitCode` options keep these rules' `EK38xx` diagnostics of that category out of a `vibelang` build's exit status and out of `noEmitOnError`; the diagnostics still print.

`vibelang agents init` also teaches coding agents to run `vibelang lint` before finishing a change.

`vibelang lint` accepts the compiler's options, including `-p`/`--project` and file arguments, and has no options of its own. The unsupported `--config` alias reports `TS5023`; select a compiler project with `-p` or `--project`. Without file arguments, it reads the first of `vibe.config.json`, `tsconfig.json` and `jsconfig.json` in each directory. Explicit files bypass that discovery and use the supplied compiler options, as with the compiler. It reports the same diagnostics as the compiler and the language server. It exits with status `1` on an error. Warnings never change the exit status, so set a code to `"error"` in `vibe.severities` to fail CI. Invalid project settings report their compiler diagnostic and exit with status `2`.

In a `.vibe` file, a rule runs in one of three ways. A rule whose pattern VibeLang's syntax rules out, such as `missingStarInYieldEffectGen`, does not run. A rule that a VibeLang diagnostic already ports runs as that diagnostic at the rule's severity. Every other rule runs as Effect wrote it. [Effect language service rules](../getting-started/012-devtools.md#effect-language-service-rules) lists each rule's answer.

The explicit Oxlint adapter honors the disable comments a migrated file keeps from its TypeScript, as Oxlint does: `// oxlint-disable-next-line effecttsgo/schema-sync -- why` turns the rule off on the next line, `oxlint-disable-line` on its own line, and `/* oxlint-disable effecttsgo/schema-sync */` until the matching `oxlint-enable`; the `eslint-` spellings work the same, and a comment that names no rule turns every rule off. Builds and the language server read `// @effect-diagnostics-next-line schemaSync:off`.

### Bridge imported validation helpers

An imported TypeScript validation helper may throw even when its return type is
`void`. Inside Effect code, wrap that call with
`Effect.orDie(Effect.try({ try: () => check(), catch: error => error }))`.
The `catch` mapping retains the original thrown value, and `Effect.orDie`
keeps it as a defect. The helper runs when the Effect runs. Do not mark a
throwing validation helper `@nothrow` to pass a non-throwing callback check.

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

JSX VibeLang sources use `.vibex` with the same `jsx` option as `.tsx`. Runtime and extensionless imports prefer native TypeScript files before VibeLang files:

| Import | Source lookup order |
| --- | --- |
| `./App`, `./App.js` | `App.ts`, `App.tsx`, `App.vibe`, `App.vibex` |
| `./App.jsx` | `App.tsx`, `App.ts`, `App.vibex`, `App.vibe` |
| `./App.vibe` | `App.vibe`, `App.vibex` |
| `./App.vibex` | `App.vibex`, `App.vibe` |

TypeScript's `moduleSuffixes`, `paths`, package exports, and resolution mode still apply. Declaration and JavaScript fallbacks follow the source lookup. A written VibeLang extension can also resolve its own compatibility declaration when the source is absent. Wildcard project discovery excludes `App.d.vibex.ts` when `App.vibex` is present, including relocated sidecars; an explicitly listed sidecar stays an input.

A native `.ts` or `.tsx` consumer importing a live `.vibe` or `.vibex` source follows the corresponding `.ts` or `.tsx` source-extension checks. Without `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`, a value import reports `TS5097`; `allowArbitraryExtensions` does not permit a live source import. With `rewriteRelativeImportExtensions`, relative JavaScript imports use `.js` (`.jsx` for `.vibex` under `jsx: preserve`). With rewriting disabled, emitted imports keep the written extension. Plain `tsc` reading only a compatibility sidecar uses arbitrary-extension declaration rules instead.

Declaration emit imports a prelude module whose name the source uses when an inferred type needs it: for example, `Layer.empty` declares a value of `Layer.Layer<never, never, never>` through an import from `effect`. This also applies with `module: Preserve` and `moduleResolution: Bundler`.

The `vibelang/bun` preload loads `.vibex` modules as well as `.vibe`, including extensionless imports, directory indexes, `paths` aliases, and relative `.js` or `.jsx` output names. Preserved JSX is passed to Bun's JSX loader.

A native `module view { ... }` body in `main.vibex` uses TSX syntax. Its emitted file is `main.vibex.view.jsx` under `jsx: preserve` and `main.vibex.view.js` in other JSX modes. Generated imports and re-exports name that actual output independently of `rewriteRelativeImportExtensions`; its declarations remain `main.vibex.view.d.ts`.

A `.vibex` source emits `.jsx` under `jsx: preserve`, even when it contains no JSX elements, and `.js` in other JSX modes. Its source map uses the same suffix, `.jsx.map` or `.js.map`; public declarations remain `.d.ts`.

Malformed JSX containers, such as `<p>{render { return 1 }}</p>`, report the same syntax errors as `.tsx`; they do not add the trailing-block migration diagnostic `EK1101`. Written function bodies, `do {}` and `effect {}` inside a container retain VibeLang diagnostics. `vibelang --fix` still migrates a legacy trailing callback in a container to an explicit argument when the rewrite preserves its behavior.

A native `.tsx` sibling keeps the project’s `jsx` output extension: a source import such as `./token.tsx` becomes `./token.jsx` in JavaScript under `preserve`, and `./token.js` under `react-native` and the React transform modes, as `tsc` names them.

### Inspect repaired trailing blocks

A legacy trailing block reports `EK1101`. Apply its repair before running the program. Inspect the explicit argument: an Effect program uses `effect { ... }`, an Effect callback uses `effect () => { ... }`, and a plain callback uses `() => { ... }`. These destinations have different execution behavior. The automatic repair needs to prove the argument kind and placement; an ambiguous call requires a manual rewrite.

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

Use a project path without `#` for Vitest. The pinned Vitest `5.1.0` fails to resolve test modules when the absolute project path contains `#`; this also affects plain TypeScript projects.

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

Migration setup excludes generated module-body declarations such as `main.vibe.parse.d.ts` from explicit Vitest coverage globs. It preserves source coverage, sibling `.platform.ts` implementations and the configured coverage thresholds.

Stock `tsc`, `tsrs`, TypeDoc and other checkers built on TypeScript cannot read a `.vibe` file, so the compiler writes each module's declarations beside it (VIP-27). `vibelang`, `vibelang --watch` and `vibelang -b` write them, `src/greet.d.vibe.ts` for `src/greet.vibe`, even with `--noEmit`. A sidecar is rewritten only when its text changes. Published declarations retain the corresponding TypeScript class surface: generated matcher members and runtime reference directives are not added. Generated matchers remain in JavaScript; VibeLang consumers load the protocol from their own runtime prelude. User-written matcher members retain their TypeScript declarations and explicit dependencies. Its text is the module's declaration file with one change: an import or re-export of another `.vibe` module names its source, `./name.vibe`, even when an unrelated `name.ts`, `name.tsx`, `name.d.ts` or `name.js` sits beside it. An explicit native import keeps its native target. Relative module specifiers are resolved as decoded TypeScript strings, so quoted filenames and Unicode escapes select the same module as the source import. Rewritten paths keep the declaration's quote style and escape that quote when needed. With `vibe.sidecarDir`, relative imports and references are rebased from the sidecar's actual location. Reference directives are relocated and source-map directives removed only in actual line comments; directive-looking text inside string or template literal types and block comments stays unchanged.

When comparing a published declaration with an ordinary TypeScript implementation, retain the TypeScript source as written. A locally declared non-effectful VibeLang callable adds the generated `@throws {never}` contract. That permitted addition does not excuse changed parameter or return types, changes to authored comments, or additional JSDoc tags.

A TypeScript `module parse { … }` body in `src/main.vibe` also gets `src/main.vibe.parse.d.ts`, beside the source, even with `--noEmit` (VIP-40). A sidecar re-export such as `export { port } from parse` names that declaration through `./main.vibe.parse.js`, so stock `tsc` sees the exported types and TypeScript's JSDoc, including `@throws`. With `vibe.sidecarDir`, the body declaration stays beside the source and the relocated sidecar refers back to it. Wildcard discovery ignores a declaration belonging to a source's module body; an explicitly listed declaration remains an input and is protected from being overwritten.

A TypeScript `module parse { … }` body in `src/main.vibe` also gets `src/main.vibe.parse.d.ts`, beside the source, even with `--noEmit` (VIP-40). A sidecar re-export such as `export { port } from parse` names that declaration through `./main.vibe.parse.js`, so stock `tsc` sees the exported types and TypeScript's JSDoc, including `@throws`. With `vibe.sidecarDir`, the body declaration stays beside the source and the relocated sidecar refers back to it. Wildcard discovery ignores a declaration belonging to a source's module body; an explicitly listed declaration remains an input and is protected from being overwritten.

A `schema` declaration's JSDoc is emitted on its constant only; the generated `typeof Name.Type` alias has no comment. This includes visibility and deprecation tags, following ordinary TypeScript declaration emit. One written, nongeneric `type Name = typeof Name.Type` beside either ordinary `schema Name` form replaces the generated alias in the same scope, in either order. The written declarations keep their own comments, order and exports; `removeComments` and `stripInternal` apply as on the native pair. `vibelang --fix` keeps such a documented type when it rewrites the native pair to a `schema` declaration, and removes an undocumented one.

A compatibility declaration keeps an explicit `./tag.vibe` import bound to that source when `tag.ts` is also present. The same applies to inferred import types: sidecar resolution preserves the selected source before computing its output-relative path.

The Node and Bun loaders reuse a cached compile when generated sidecars beside their sources, or anywhere under `vibe.sidecarDir`, appear, change or disappear. They still recompile when a source or a standalone declaration file changes.

No VibeLang setting is needed. The retired `declarationSidecars` option is an error. Run `vibelang -p tsconfig.json --fix` to remove it from the project and its local inherited configs. This also removes the obsolete key from the top-level `vibe` section in `tsconfig.json` or `vibe.config.json`, preserving other settings, comments and a UTF-8 BOM.

When a `check` script is declared, `bun check` runs the project's `check` script; a script that invokes a TypeScript checker uses that checker's sidecar resolution. Bun 1.4.4 also provides a native checker: `bun check --no-script` selects it even when the project has a `check` script.

In each project whose checker is not `vibelang`, set TypeScript's [`allowArbitraryExtensions`](https://www.typescriptlang.org/tsconfig/allowArbitraryExtensions.html), and import the module by its source name:

```json
{ "compilerOptions": { "allowArbitraryExtensions": true } }
```

TypeScript then resolves `import { greet } from "./greet.vibe"` to `greet.d.vibe.ts`, as it resolves `./styles.css` to `styles.d.css.ts`. Without the option it reports `TS6263`. Without custom `moduleSuffixes`, TypeScript does not map `./greet.js` or `./greet` to a sidecar, so a `.ts` file that such a checker reads names the `.vibe` module by its source. `vibelang` reads `greet.vibe` when its source is available, and a project's `include` leaves out a sidecar whose source is beside it. When only `greet.d.vibe.ts` is available, an explicit `./greet.vibe` import resolves to that compatibility declaration. This also covers a declaration's self-namespace re-export, such as `export * as Greet from "./greet.vibe"`, so callbacks accessed through the namespace retain their contextual parameter types.

The `vibelang/register` Node preload enables the `vibelang-source` condition for package exports and private `#` imports. It retains Node’s existing conditions, including custom conditions, so unbuilt workspace packages load from their declared source target.

A workspace package can expose a module through its `x.d.vibe.ts` declaration under `types` and its `x.vibe` source under `vibelang-source`. Inferred declarations in consumers keep the package export name, such as `import("lib/x").Provider<number>`, including exact and wildcard export entries.

This source preference also applies when `moduleSuffixes` places a paired `.d.vibe` fallback after its original suffix. Stock TypeScript keeps its own suffix order, which can select the sidecar before a `.tsx` sibling.

Cyclic inferred declaration types retain TypeScript 5.9/7.0 elision: a repeated anonymous type prints `/*elided*/ any` rather than the new TypeScript 7.1 `TS5088`. Other recursion checks still apply; see [Declaration output](https://vibelang.sh/spec/001-functions#declaration-output).

What a sidecar cannot print, such as `TS4094` for a private member of an exported class expression or `TS2883` for a type it can name only through `node_modules`, is an error where the project emits declarations (`declaration` or `composite`): declaration emit writes `any` in its place, and a stock checker that reads the sidecar would accept that `any` silently. A project with neither publishes nothing, so its sidecars name such a type by its path into `node_modules`, which its own checkers resolve. What it still cannot print there, such as `TS4094`, is an error only where a `.ts` file of the project imports the module, as for the same TypeScript under `tsc`, since that file reads the sidecar: it is reported at that import. Annotate the export, or keep the module `.ts`.

### Keep the sidecars in one directory

Code that lists a folder's `*.ts` files and skips `*.d.ts`, such as a test that imports every module in a folder, also picks up `greet.d.vibe.ts`. Set `vibe.sidecarDir` to move every sidecar into one hidden directory, and add it to `rootDirs` so stock TypeScript still finds them:

```jsonc
{
  "compilerOptions": { "allowArbitraryExtensions": true, "rootDir": ".", "rootDirs": [".", ".vibe/declarations"] },
  "vibe": { "sidecarDir": ".vibe/declarations" }
}
```

`src/greet.vibe` then gets `.vibe/declarations/src/greet.d.vibe.ts`: the path under the explicit `rootDir`, mirrored. Relative imports in the sidecar target native TypeScript files or the selected VibeLang declarations from its actual output location, so a consumer in another project does not need to inherit the producer's `rootDirs` for those references. An empty `sidecarDir` string names the declaring config directory and overrides an inherited path; omitting the entry inherits it. A directory that overlaps the source tree, such as `src`, or an ancestor such as `..`, still mirrors each source's path under the declaration source root; cleanup keeps outputs selected for other modules. A relative `sidecarDir` resolves from the config that declares it; in a shared base config, write `${configDir}/.vibe/declarations` in both settings.

Sidecars follow TypeScript's declaration layout: `rootDir` supplies the source root, a composite project defaults to its config directory, and otherwise the compiler infers the common source directory. Without `sidecarDir`, even a source outside the compiling config's directory gets its sidecar beside it. With `sidecarDir`, that compiling config writes every source's sidecar under its own output directory, relative to the common root; it does not inherit an imported source's nearest config. For example, `b/src/z.vibe` importing `../../a/src/x.vibe` with `b`'s `sidecarDir: "decl"` and no `rootDir` writes `b/decl/a/src/x.d.vibe.ts` and `b/decl/b/src/z.d.vibe.ts`. Add the inferred source root and the sidecar directory to `rootDirs` for stock TypeScript consumers. An explicit `rootDir: "src"` reports `TS6059` for that outside source. With a project reference to `a`, `a` writes its own sidecar under its own `sidecarDir`; `b` writes none for it.

Turning the setting on removes the sidecars beside the sources; turning it off removes those under `.vibe/declarations`, and the folder once it is empty. Remove a sidecar directory with any other name by hand. `vibelang --watch` writes each changed sidecar to the chosen place and settles, and the language server reads a `.ts` file's `./greet.vibe` import from `greet.vibe` itself in either mode. A bare import in a sidecar resolves from the sidecar's folder upward, so keep the directory inside the package whose `node_modules` it needs.

The migrate flow also handles a native `.ts` module checked through another package. A consumer's `rootDirs` does not supply the imported package's hidden directory. Setup gives that native import a package-private `types` target naming its physical compatibility declaration. The loader follows its source, emitted consumers use the compiler's actual JavaScript output, and the package's normal publication mapper selects its built JavaScript and declarations. The chosen checker command stays in place. Missing declarations, ambiguous output locations and direct imports across package boundaries receive a located review reason.

Migration drivers can save each completed package declaration layout before planning the next package. Before restoring a saved layout, the driver validates that the original sources and configuration inputs are unchanged. Restoring layouts preserves the full declaration-route selection, including wildcards and imports across packages.

The migrate flow follows source renames in authored declaration imports, including `.d.ts` and asset declarations such as `prompt.d.mdx.ts`. An import of `./Prompt.ts` becomes `./Prompt.vibe` when that source is renamed. Returning the source restores the original specifier. Generated declarations, including compatibility sidecars and configured declaration output directories, are regenerated from their source.

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
`require()` and `createRequire()` calls through a migrated package’s emitted exports load the same source module as an `import`.
The loaders leave an absent application `TMPDIR` untouched: compilation and the default cache use its nearest existing parent directory. An explicit `VIBELANG_CACHE_DIR` still names the exact cache directory to create.

A committed loader record from `writeLoaderRecord` in `vibelang/project` can move with the checkout. It relocates recorded file paths and source-map sources while preserving emitted JavaScript bytes, including strings containing the old checkout path. Records from the older format are ignored and compiled again. The migrate flow’s `loaderRecords` receipts preserve each written file and module count and record validation separately: `"checked"`, `"unavailable"` with an `unchecked` reason, or `"failed"` with a `miss` reason. An unavailable checker never counts as completed validation. The migration flow bounds each optional record compilation to one minute. A timeout terminates that compiler and its descendants, keeps the emitted JavaScript, and records the project, `stage`, `timeoutMs`, `ms`, and `signal` with `timedOut: true`; later projects still run. A timed-out record is unavailable, not a successful compile.

The public `vibelang/project` adapters, `compileProjectSync` and
`projectBackend().compile`, report errors and warnings from all project inputs,
including native TypeScript files. Their output maps hold the project’s own
`.vibe` modules. These full project checks use a separate cache from the loaders
and do not reuse narrowed loader records.

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

When a package export names an emitted module under `.vibelang/js/`, both source loaders follow its source map or migration-generated source header. They distinguish `x.js` from `x.jsx` under the project’s inherited `jsx` mode. Without that metadata, a mirrored path redirects only when exactly one source can produce that output; ambiguous siblings leave the emitted module in place.

## Tools that read source files

A snippet builder or documentation tool reads source text with `vibelang/source`:

```js
import { readFileSync } from "node:fs"
import { listSources, resolveSource } from "vibelang/source"

const files = listSources("snippets")
const file = resolveSource("snippets/example.ts")
if (file === undefined) throw new Error("Missing snippet")
const text = readFileSync(file, "utf8")
```

`listSources(directory)` returns sorted absolute paths for immediate `.ts`,
`.tsx`, `.vibe` and `.vibex` source files. It excludes declaration outputs,
including compatibility sidecars, and directories; file symlinks are followed.
Call it for each snippet directory the tool owns.

`resolveSource(file)` prefers an existing exact file. Only an absent `.ts`
or `.tsx` source name tries its `.vibe` or `.vibex` sibling. Missing files
and directories return `undefined`; other filesystem errors propagate.
Declaration paths never redirect. This is an opt-in source-text lookup:
module imports retain the compiler's ordinary resolution rules.

Check native snippets with `projectBackend().compile(project)` from
`vibelang/project`, using the returned `files` to confirm each selected
source was checked and `errors` to associate diagnostics with its resolved
path. Diagnostics retain `TS` or `EK` codes and one-based source positions.
An expected-error snippet must have its own error; a missing source,
configuration error or compiler failure must fail the build separately.
Recognize expected-error names in both languages, such as `.error.ts` and
`.error.vibe`. Keep warning policy explicit.

Use the project cache instead of a stamp based only on `.ts` names or mtimes;
it tracks native sources, dependencies, configs and compiler changes. Await
`close()` when finished. Module loader hooks do not change `readFile` or
directory enumeration.

## Run Playwright with native modules

Preload the Node hook before Playwright starts so its configuration and test
workers can import `.vibe` modules:

```sh
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" npx playwright test
```

The hook uses Node's module customization API. Native stack frames keep their source locations even when the runner installs a custom stack formatter.
A `.vibe` configuration is selected explicitly with
`--config playwright.config.vibe`. Playwright's test discovery recognizes
JavaScript and TypeScript extensions; keep its `.spec.ts` entries and import
native modules from them. The preload also reaches Node child processes that
inherit `NODE_OPTIONS`.

The same environment setting lets a bare `node src/main.vibe` command run a
native entry. Without the preload, Node cannot parse VibeLang syntax.

## Run sources with Bun

Bun can run and test the project from source, without `dist/`. Preload `vibelang/bun`, in `bunfig.toml`:

```toml
preload = ["vibelang/bun"]

[test]
preload = ["vibelang/bun"]
```

or on the command line: `bun --preload vibelang/bun src/main.ts`. The first `.vibe` import compiles the project's `.vibe` files in the nearest `tsconfig.json` above the module, once per process, with the same cache as Node. Set `VIBELANG_PROJECT` to a tsconfig path to choose another project for the modules in its directory; a module of another workspace package compiles with that package's own `tsconfig.json`. A TypeScript module may import a `.vibe` module by its emitted name, such as `./x.js` for `x.vibe`, as a migrated project does after it replaces `x.ts`; an `x.ts` beside it still wins. An extensionless import, such as `../src/archive`, resolves to `archive.vibe` or a directory's `index.vibe` as TypeScript's `Bundler` resolution does. So does an alias of the nearest `tsconfig.json`'s `paths`, through its `extends` chain: with `"@/*": ["./src/*"]`, `@/archive` and `@/archive.js` load `src/archive.vibe` when TypeScript resolves them there, and an `archive.ts` still wins. The preload rewrites these imports in the module's source before runtime resolution. The rewrite is synchronous, so `require()` and a `createRequire` require load such a module wherever they load it when the modules it imports are `.ts`. A composite project compiles too. Errors in the loaded source and project-wide errors fail the import. Bun ignores a plugin's source maps, so a stack frame names the `.vibe` file with the line of its compiled JavaScript.

Use Bun `1.4.2` or newer for the runtime loader. Bun `1.3.13` can return an asset path instead of a module for computed imports that a plugin resolves, and Bun `1.4.0` can corrupt Unicode import paths.

The preload discovers imports in the project's sources, leaving dependency modules in `node_modules` to Bun's native loader. A workspace package linked into `node_modules` still uses its real source path, so its extensionless imports can reach `.vibe` files. Tests that load only TypeScript keep the native dependency loader even when the project contains migrated files. A CommonJS `require("./archive")` reaches `archive.vibe` through Node's CommonJS resolve hook. Bun 1.3.13 calls a replaced hook without the requiring module for a `require` that `createRequire(url)` made, so the request would resolve from the working directory instead of `url`. On such a Bun the preload leaves the hook alone: `createRequire` keeps resolving from its URL, and a CommonJS `require` of a `.vibe` module names its extension, `require("./archive.vibe")`. Bun 1.4.2 has the hook.

When a migrated package export names JavaScript under `.vibelang/js/`, the preload forwards the source module’s live bindings. A `default` binding stays live, a source without one gains none, and `export *` keeps its named bindings.

Bun also leaves stack locations unmapped when it runs the compiler's emitted JavaScript, such as `bun dist/main.js`, even with `"sourceMap": true`. For mapped traces, run `node --enable-source-maps dist/main.js`; see [Debug stack traces](../getting-started/012-devtools.md#debug-stack-traces) for a debugging entry that prints the underlying stack.

`bun test` reads only `[test]`'s preload, never the top-level one, even when a program such as `bun run script/test.ts` spawns it. Without `vibelang/bun` under `[test]`, Bun loads `x.vibe` as a file: a test fails with `Export named '…' not found` or, for an extensionless import, `Cannot find module`. The migrate flow adds it to `[test]` for a script that runs `bun test`, a Bun program that spawns it, or a `bunfig.toml` that already gives `[test]` a preload.

A child `bun test` process reads `bunfig.toml` from its own working directory. If a test starts a child in a fixture directory, add the same `[test].preload` there; the parent's configuration alone does not apply. The migrate flow writes this fixture loader when the child's test entries reach migrated sources, without rewriting the tests.

`bun test` finds only files named `*.test.ts`, `*.test.js` and the like, never `*.test.vibe`. Write Bun suites as `.test.ts` files that import `.vibe` modules, or run `.test.vibe` files with Vitest.

## Next

Set up the editor: [VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md). Then verify with step 4 of [Set up VibeLang](../setup.md).

The Bun preload resolves a missing `.ts` import to its sibling `.vibe` source
when the import is relative, absolute or mapped by `paths` in `tsconfig.json`.
A native launcher or test can retain a literal import after migration. Existing native files keep their priority.
Alias lookup keeps the config's inherited paths and substitution order. This
runtime fallback does not change the compiler's handling of written `.ts` imports.
The command-line entry itself must name an existing file; update that path when
migrating the entry.

For computed dynamic imports, use a relative or absolute source path, such as
`const name = "./src/feature.vibe"; await import(name)`. Bun does not invoke
runtime resolver hooks for computed bare aliases such as `import(alias)`
where `alias` is `"@/feature.ts"`; use a literal alias import instead.
This [Bun runtime limitation](https://github.com/oven-sh/bun/issues/40579)
also affects extensionless aliases.

### Builds inside Bun scripts and tests

The runtime preload `vibelang/bun` does not configure `Bun.build`.
Install `vibelang-unplugin` alongside `vibelang` and use
`vibelang-unplugin/bun/register` in both top-level `preload` and
`[test].preload` to compile `.vibe` dependencies in builds owned by scripts
or unchanged tests. It includes the runtime loader, preserves existing
plugins and options, and gives each build its own compiler backend.
A missing literal `.ts` bundle entry resolves to its sibling `.vibe`,
so an unchanged test can keep its entrypoint. Existing TypeScript and
in-memory entries retain their priority.
An explicitly configured `vibelang-unplugin/bun` plugin keeps its own
project and compiler choices. Child processes need the preload in their own
working directory's configuration, or the `--preload` flag.
See the [Bun configuration](https://github.com/smithersai/vibelang/tree/main/packages/unplugin#bun-builds-inside-tools-and-tests).

### Bun runtime watch limitation

With Bun 1.4.1, `bun --watch --preload vibelang/bun` does not reliably restart after a `.vibe` save. The preload compiles once per process and does not invalidate that result during watch. For development, use the starter's `npm run dev` or `bun run dev`: its compiler watch and Node process rebuild and restart the app.

Bun sets each test’s time budget through `--timeout`. For service-initialization tests that need more than the default five seconds, use `bun test --timeout 30000`. This changes the test deadline, not the Effect’s cancellation or service lifetime.

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

For VIP-22, interruption blocks outside effect code report `EK2201`. The old compiler emitted them as ordinary JavaScript blocks. `vibelang --fix` removes only the `uninterruptible`, `interruptible` or `restore` keyword there, retaining the block, comments, scope and control flow. The migration also runs under `--fix-vip-only`. To mask an Effect instead, move the block into an `effect` function or `effect { }` block.

For VIP-2, `vibelang --fix` also migrates a `do { … }` used as an Effect argument to `effect { return do { … } }`. The inner `do` preserves its completion value; the effect block delays evaluation until each run. This migration also runs under `--fix-vip-only`.

The `--fix-vip-only` pass reads pre-VIP-1 code and preserves the old call's run phase: it removes a known wrapper's run even when its result was an error value or another Effect. It refuses unknown provenance. Ordinary `--fix` keeps intentional `try` operations in current source. A non-Effect operand keeps `EK0502`; no `asEffect()` call is guessed.

The `--fix` command changes only your project's `.vibe` and `.vibex` program sources and eligible owned configs. For an inherited configuration, repository ownership is bounded by the nearest `.jj` or `.git` marker; without one, only the selected project's directory is owned. A parent configuration outside that boundary remains unchanged. It includes owned imported sources even when excluded from root discovery, and never edits dependency configs under `node_modules`, foreign TypeScript/JavaScript, generated declarations or another referenced project's files. `vibelang --help`, `vibelang -h`, and their `--all` forms describe project repairs in build order and the `--watch` restriction.

With `vibelang --build --fix tsconfig.json`, projects are fixed separately in build order, including each project's eligible config migrations, before the normal build. A shared dependency is repaired once. The repair report identifies each project and its position in that order. Build-only options such as `--force` retain their normal meaning; `--dry`, `--clean` and `--help` apply no repairs. Cyclic project references are reported before repairs write anything. `--fix --only` validates its complete file list before repairing each listed module in its owning project; it writes no configs. `--watch` remains incompatible with `--fix`. The platform repair can create a new absent sibling `.ts` file when it proves preservation, but never overwrite one.

When converting `Effect.fn`, `--fix` keeps a written parameter type such as `ReturnType<typeof make>` if expanding it would introduce an import type. This keeps the original source binding, including types from named `module` bodies, instead of loading generated declaration sidecars into the check program. A valid native `function*` callback can compile without a diagnostic before this conversion; `--fix` still offers the preserving rewrite. Existing sidecars do not prevent repeating the conversion. A declaration explicitly selected as an input still receives `TS5055` if emission would overwrite it.

Platform repairs from one source share one fresh `<source>.platform.ts` companion. Explicit `sync` inputs stay evaluated at the original call site, in order; the callback still runs only when its Effect runs. A callback that captures other bindings or a lexical receiver keeps the existing preservation checks, and an existing foreign module is never rewritten. During migration, host access inside formerly accepted boundary callbacks reports an `EK4402` warning; `--fix` and `--fix-migration-only` can repair explicit-input writes and deletes such as restoring `process.env`. Unwrapped host access remains an error.

Compatibility declarations are output files. Let `include` discover source/sidecar pairs; listing the sidecar explicitly in `files` keeps it as an input, so an attempted overwrite reports `TS5055`, exits `1` and preserves the file. Compatibility writes remain required under `noEmit: true` or `declaration: false`; those options still control ordinary JavaScript and public declarations.

A non-relative name reaching a compatibility sidecar in a linked workspace package reads its available source when TypeScript's final resolved path is outside `node_modules`. Package exports, `paths` and `#imports` share this rule. Published packages and logical `node_modules` paths retained by `preserveSymlinks` keep declarations. Relocated sidecars use their recorded source map.

A whole-scope migration plan honors `--route-bundled-imports` when selecting modules reached by unchanged test bundles, as the rename stage does. Unconfigured bundle graphs keep their existing deferrals. Runtime tests and declaration comparisons still gate the converted batch.

When emitted-import routing is enabled, migration planning can include library dependencies of bare Node or Bun entrypoints. The entrypoints keep their source paths, and protected test imports remain native until an eligible product import provides a route to emitted JavaScript. Runtime and declaration checks still apply.

The migration flow keeps only the selected batch's fixes. It lists the compiler project's VibeLang sources and dependency closure before the fix loop and restores earlier batches within that graph on every exit, including interruption. Concurrent calls in one flow process take turns when their source graphs overlap; disjoint projects can fix their files together. The `*.scope.log` receipt records project discovery and when the fix acquires and releases its source graph. Projects above `240` modules normally use import-closed temporary projects for selected roots. If a selected import closure exceeds that cap, the flow fixes the original project so every root, including retained TypeScript and TSX importers, stays in the compiler's safety check. The `mode` and `fallback` receipts record this choice and its closure size. The same timeout and fix limits apply; use a box with enough memory for the full project. A selected module outside every configured project is reported in `fix.uncovered`; the fix pass fails and preserves its source. Include its actual project in the migration run before retrying. Project membership comes from the compiler's `--listFilesOnly` result. An import that resolves to a declaration does not authorize fixing the corresponding source, even when the migration graph reaches it. Temporary shards keep the same membership boundary, and each project's `membership` receipt links its discovery log.

Temporary fixing projects list only roots from the original project; imported TypeScript and VibeLang dependencies remain imports. This preserves `rootDir` checks and declaration-backed views. If retained roots cannot reach a selected module, the flow keeps the original project. Each shard receipt lists its `roots` separately from its dependency closure.

Migration setup installs the selected dependencies before formatting the files it writes, so newly selected formatter plugins are available. The same order applies when adding workspace packages to an existing setup. If installation fails, setup stops before formatting; formatter failures after a successful install remain recorded warnings.

Setup refreshes matching whole-file Markdown code blocks marked `<!-- source: relative/path.ts -->` after rewriting and formatting their owned source. It preserves prose, named excerpts such as `#start`, markers quoted inside code fences, and already mismatched snippets. A mismatch or a document changed during setup produces a review warning. The `sourceSnippets` receipt records changed documents and before/after source hashes.

Migration retains a tracked authored source after renaming it to `.vibe`, including under an ignored directory such as `src/lib/`. Returning that module to TypeScript retains its original path too. Only the journaled files are explicitly tracked; unrelated ignored files remain excluded.

The migration rename step preserves written TypeScript return annotations. Once the compiler probe confirms that unmodified functions stay plain by syntax, the legacy annotation pass skips loading TypeScript programs and their dependency graphs. With explicit Effect functions, it also leaves unwritten return types unwritten, including generator callbacks passed to `Effect.fn`. An inferred `Generator<…>` annotation could otherwise widen the original error and service requirements and prevent the compiler’s generator rewrite.

The migrate flow also detects TypeScript ast-grep rules and unquoted script globs. Setup preserves an existing effective `sidecarDir`, adds its matching virtual root, records why it selected directory mode, and removes the paired adjacent sidecars it supersedes immediately. A rerun makes no further removals. Unrelated declarations remain. For an explicit `rootDir` or `composite` project, setup computes known source paths from the configuration without loading the complete import graph. Inferred source roots, imported-only sources and overlapping output directories retain the full graph checks. In workspace packages, a bare `types` import of a relocated sidecar and an explicit import of its `.vibe` source keep one module identity.

Rerunning migration setup removes the exact `moduleSuffixes: ["", ".d.vibe"]` list written by older setups, including in packages outside the current run. This removes Bun’s unsupported-option warning. Other suffix lists remain unchanged.

Migration setup adapts release helpers that map source paths to JavaScript and declarations, including `const` arrow mappers in nested package `imports` conditions. The helper keeps its authored `dist` and declaration layout. Tests, fixtures and helpers used only by tests stay unchanged.

Named source-selection regexes in `.js`, `.mjs` and `.jsx` tooling use the same local binding and selected-file proof as TypeScript. A selector that escapes to another consumer stays unchanged; an unexpected reference-analysis failure reports the source filename.

When a package `files` or `publishConfig.files` allowlist selected a source before conversion but misses its renamed `.vibe` path, the migrate flow adds that exact path. Existing directory selectors, unrelated sources and explicit exclusions stay intact. The durable `exportEdits` receipt records each `fileEntry`; reverting one module removes only its recorded additions. Published types still use ordinary `.d.ts` files, and compatibility sidecars remain excluded.

The migrate flow keeps packed runtime exports reachable: when `default` names `.vibelang/js/`, an existing package `files` list gains that directory, including its loader records. Packing ignore exceptions cover only this generated runtime tree and preserve other exclusions. Reverting the last migrated module removes the flow's additions and keeps authored packing entries.

A migration batch retains the packing files its emit creates, including when verification first creates them. Repeated verification, recording and revert recognize those exact files as the batch's output.

The migrate flow discovers the compiler program before each fixing pass. Errors in source files, such as `EK0301` or `EK1702` in modules outside the batch, can accompany the file list without stopping that pass. Its `.scope.log` receipt lists their codes and records that semantic checking is deferred; normal checks after fixing still report them. Configuration failures, errors with no file, crashes and empty file lists stop discovery.

During migration, a generated source-child helper that cannot safely move to a platform sibling stays private in a TypeScript `module` body. The spawning module passes its `import.meta.url`, so loader resolution still starts in the parent package. This avoids platform imports in VibeLang and extra public exports. The `sourceChildModules` receipt lists conversions and warnings for helpers the flow cannot safely adopt.

## Legacy readonly upgrade

Use `vibelang --fix --fix-migration-only` on existing `.vibe` source to preserve the former readonly defaults of schema fields and service shape properties. It adds `readonly` to their unmarked fields, including the keys of a nested schema in a `schema error` payload. Error and data fields are already readonly at the property only; the upgrade writes explicit modifiers on nested payload and error method-type members that the pre-pin compiler made readonly so published declarations stay identical. Ordinary classes, interfaces and object types outside these declarations retain their written modifiers. Normal checking and ordinary `--fix` use shallow readonlyness and keep schema fields and service properties writable unless written `readonly`. Combined with `exactOptionalPropertyTypes`, the upgrade preserves both readonly fields and acceptance of explicitly written `undefined`.

For example, `interface Options { name: string; readonly id: number }` keeps `name` writable and `id` readonly after the upgrade. The same rule applies inside ordinary nested object types, index signatures, mapped types, classes and namespaces; only the legacy schema, service, error and data shapes above receive restored defaults.

The explicit upgrade also writes `readonly` on legacy `service` body fields and in their nested types, including whole-shape service types. A method keeps its method spelling, and a static field keeps its own mutability; their parameter and result types retain the old nested readonly members. For example, `service Jobs { start: () => void }` becomes `service Jobs { readonly start: () => void }`. Current checking and ordinary fixes do not add these legacy defaults.


When `--fix` checks declaration imports across several modules, declaration emission runs in parallel and collects every module's result before comparing the proposed imports.

For `EK0505`, `vibelang --fix` keeps a running `try` or operator head in an explicit `effect` block. Direct `join` and `fork` heads use `Fiber.join` and child-side recovery. Source jumps and wrapped forks need an explicit boundary choice; see [fallbacks](../error-management/016-fallback.md).

### Parenthesize legacy throw expressions

For a legacy throw expression before a comma, `--fix` groups the whole throw: `f(throw error, next)` becomes `f((throw error), next)`. This preserving repair also runs with `--fix-migration-only` and `--fix-vip-only`. Other forbidden punctuators retain `EK1010` when choosing a different operand would require intent.

### Migrate legacy Effect globals

`forkIn` is Effect's native `forkIn(program, scope)`. For a legacy `forkIn(scope, program)` call, `vibelang --fix` snapshots the scope and program in their original order before calling the native function. Source comments or an ambiguous argument contract can require a manual rewrite. The explicit legacy source upgrade preserves stored legacy helper values through an explicit compatibility import.

With `vibe.effectGlobals: false`, `sync` and `callback` require explicit imports. `--fix` supplies native imports for stored values and synchronous, argument-free `sync` callbacks whose result is not a Promise. Other legacy callbacks need their intended boundary written explicitly.

### Preserve imported lint activation

A configuration with an assigned `EK38xx` entry in `vibe.severities` and no resolved `@effect/language-service` plugin reports `EK3012`. During migration it retains the legacy default plugin, including when the entry is `"off"`. Run `vibelang --fix` to add the explicit plugin to the selected project configuration. Existing plugin options, inherited entries and comments stay intact; explicit `diagnostics: false` and `diagnosticSeverity: null` stay disabled. Selected-file `--fix --only` does not write configurations.

The readonly source upgrade interprets existing members using their pre-flip defaults before establishing the diagnostic baseline. A pre-existing invalid schema codec can expose downstream diagnostics when its former readonly API is restored; those diagnostics remain visible. The report counts the fields upgraded. Codec expansions and all other repairs still use the project-wide no-new-errors gate.

For an imported `EK3801` diagnostic in a `.vibe` file, ordinary `--fix` writes `void (expression)`. The expression is still evaluated once and the Effect remains unrun; use `try` explicitly when execution is intended.

