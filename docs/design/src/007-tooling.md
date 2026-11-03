# Configuration and tooling

Sources: [VIP-30](../vips/0030-config-files.md), [VIP-32](../vips/0032-effect-version.md), [VIP-34](../vips/0034-compiler-and-tooling.md), [VIP-38](../vips/0038-effect-lint-built-in.md), [VIP-39](../vips/0039-vibex.md). Declaration output (VIP-27) is in [Functions](001-functions.md#declaration-output).

## Config files

```json
{ "extends": "./tsconfig.base.json", "compilerOptions": { "strict": true }, "vibe": { "effectGlobals": false, "effectModules": false } }
```

`-p <file>` reads that file, even when another config is beside it. `-p <dir>` reads the first of these that exists in that directory:

1. `vibe.config.json`
2. `tsconfig.json`
3. `jsconfig.json`

Without `-p`, search the current directory for the CLI, or the source file’s directory for the language server, then each parent. Stop at the nearest directory containing any of the three names; apply the order above there. Explicit file arguments bypass config discovery, as in `tsc`; combining them with `-p` is an error.

```sh
# repo/vibe.config.json and repo/packages/a/tsconfig.json exist
cd repo/packages/a
vibelang                       # packages/a/tsconfig.json
vibelang -p ../../vibe.config.json # the explicitly named file
```

`vibe.config.json` accepts every `tsconfig.json` field, `extends` included; `jsconfig.json` has TypeScript’s implied defaults. Ordinary relative paths, including relative `extends` entries, resolve from the config that declares them. A leading `${configDir}` in a supported path field instead expands from the selected project config’s directory, even when that field is inherited. Fields retain their TypeScript meaning with one deliberate file-kind exception: `moduleDetection` applies ordinarily to `.ts` and `.js`, but every source `.vibe` file is an external module before binding and checking, independently of imports and prelude switches ([Modules and the top level](001-functions.md#modules-and-the-top-level)). None of its values enables shared script globals in `.vibe`; ordinary module emission, host rules and incompatible-option diagnostics still apply. The added top-level `"vibe"` section holds VibeLang's options in any of the three files. Plain `tsc` rejects unknown `compilerOptions` (TS5023) but ignores unknown top-level keys, so a repository's own TypeScript tooling keeps working.

For example, TypeScript’s [`${configDir}` substitution](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#the-configdir-template-variable-for-configuration-files) keeps the inherited output directory local to the selected project while the ordinary source path stays relative to the base:

```jsonc
// configs/base.json
{ "compilerOptions": { "outDir": "${configDir}/dist", "rootDir": "./src" } }
// app/tsconfig.json
{ "extends": "../configs/base.json" }
// Effective paths: outDir is app/dist; rootDir is configs/src.
```

`.vibe` and `.vibex` are supported source extensions: `files` may list them, and `include`, `exclude` and the default `**/*` treat `.vibe` as they treat `.ts` and `.vibex` as they treat `.tsx` ([below](#vibex)). A compatibility sidecar is an emit output: when `include` or default discovery selects both `x.vibe` and `x.d.vibe.ts`, the source wins and the sidecar leaves the program, as discovery selects `x.ts` ahead of `x.d.ts`. A sidecar explicitly listed in `files` remains an input. If the compatibility write would overwrite it, the compiler reports native `TS5055` (`Cannot write file … because it would overwrite input file`), exits `1` and leaves its bytes unchanged. The same rule applies to `x.d.vibex.ts` and mapped sidecar locations. The compatibility write is independent of ordinary output: `noEmit: true` suppresses JavaScript and public declarations, and `declaration: false` suppresses public declarations but leaves ordinary JavaScript behavior unchanged; neither disables the required compatibility sidecar or its overwrite check ([VIP-27](../vips/0027-declaration-output.md#decision), amended). VibeLang resolves a relative `./x.vibe` to source; plain `tsc` reads the compatibility declaration. A non-relative specifier that TypeScript resolves to `x.d.vibe.ts` or `x.d.vibex.ts`, through a package `types` export, a `paths` entry or package `#imports`, resolves to the available `x.vibe` or `x.vibex` source when the final resolved path is outside `node_modules`. Classify the path after TypeScript's own `realpath` step, not the written name: a linked workspace package normally reads its source. With `preserveSymlinks: true` the logical path keeps its `node_modules` segment and therefore its declarations, as a published package does; TypeScript may then distinguish the source and declaration modules. For relocated sidecars, follow the source that the sidecar map names rather than guessing from basenames. An explicitly listed sidecar remains an input even when another import redirects to its source, and its attempted overwrite keeps `TS5055` protection. Ordinary `.ts` and `.d.ts` resolution does not change ([VIP-27](../vips/0027-declaration-output.md#decision), amended).

```json
{ "include": ["src"] }
```

This includes `src/user.vibe` without also checking its stale `src/user.d.vibe.ts`. With `vibe.sidecarDir`, a sidecar under that directory whose source exists at the mirrored path is left out the same way.

A non-relative import reaching a known compatibility declaration uses its available mapped source only when TypeScript's final resolved path is outside `node_modules`. This includes package exports, `paths` and package `#imports`. Apply `realpath` and `preserveSymlinks` first; a retained logical dependency path keeps its declaration and native module identity. The rule also applies to the effective `sidecarDir` map ([VIP-27's dated amendment](../vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01)). Explicitly selected declarations remain inputs subject to the ordinary overwrite guard.

Compatibility declarations preserve the actual module selected by a source import. An explicit `./tag.vibe` remains that module even beside `tag.ts`, including re-exports and inferred import types, under every declaration import style and in either layout ([VIP-27](../vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01)).

Relative imports in relocated sidecars resolve from the actual output location, including references to native TypeScript modules and mirrored VibeLang declarations. Another project's checker does not inherit the producer's `rootDirs`. Workspace package imports use the owning config to keep a relocated sidecar and its source as one module; published packages retain declarations. Migration setup removes superseded adjacent outputs in the same layout change and preserves existing scalar path inheritance and virtual roots.

```jsonc
// base.json
{ "vibe": { "effectGlobals": false, "severities": { "EK0801": "off" } } }
// child config
{ "extends": "./base.json", "vibe": { "effectModules": false } }
// effective vibe section
{ "effectGlobals": false, "effectModules": false, "severities": { "EK0801": "off" } }
```

`extends` inherits `vibe` key by key: child keys win and missing keys come from the base. `severities` merges entry by diagnostic code ([VIP-30](../vips/0030-config-files.md#decision)). An `extends` array merges bases left to right, later entries winning, before applying the child, as in TypeScript.

The decided keys (VIP-30, amended) are:

| Key | Meaning |
| --- | --- |
| `vibe.effectGlobals` | Boolean switch, default `true`, for Effect's function globals ([VIP-6](../vips/0006-effect-globals.md)); `false` turns them off. |
| `vibe.effectModules` | Boolean switch, default `true`, for Effect's modules in scope ([VIP-14](../vips/0014-effect-modules-in-scope.md)); `false` turns them off. |
| `vibe.sidecarDir` | Directory, default unset, that holds every declaration sidecar at its source's path under the config's directory, instead of `x.d.vibe.ts` beside `x.vibe` ([VIP-27](../vips/0027-declaration-output.md#decision), amended). Conventionally `.vibe/declarations`; pair it with `"rootDirs": [".", ".vibe/declarations"]` so stock TypeScript resolves `./x.vibe`. A relative path resolves from the config that declares it; a leading `${configDir}` from the selected config. An empty string names the declaring directory and overrides an inherited path; only an absent entry inherits. Wrong types report `EK3007`. |
| `vibe.severities` | Maps VibeLang's own warning codes and all imported `EK38xx` lint codes to `"error"`, `"warning"`, `"suggestion"` or `"off"` ([VIP-30](../vips/0030-config-files.md#decision), [VIP-34](../vips/0034-compiler-and-tooling.md#decision), [VIP-38](../vips/0038-effect-lint-built-in.md#decision)). |

An unknown `vibe` key or a value of the wrong type is a config error (`EK3007`), as for TypeScript’s `compilerOptions`; remove the key or supply its declared type. Exception: a `severities` entry whose value is not one of the four strings, whatever its JSON type, is `EK3006`; replace it with one of them. `EK3007` covers every other wrong-typed `vibe` value, including a `severities` value that is not an object.

After `extends` merges entries by code, validate each effective entry independently. An invalid entry still reports `EK3006` and is ignored as a severity override; other valid entries and independent options still apply. An invalid child entry has already displaced the same code's inherited setting and does not restore that base entry: the code uses its lower-precedence Effect language-service configuration, where applicable, then its default. Unaffected inherited codes remain. A non-object `severities` container remains `EK3007`, and configuration errors retain their ordinary exit and emit consequences.

```jsonc
// Effective-entry recovery: base.json
{ "vibe": { "effectGlobals": false, "severities": { "EK0801": "error", "EK4609": "off" } } }
// child config: EK3006 on "bad"; EK0801 follows its default, while EK4609 and EK0508 stay off.
{ "extends": "./base.json", "vibe": { "effectModules": false, "severities": { "EK0801": "bad", "EK0508": "off" } } }
```

```jsonc
{ "vibe": { "effectGlobal": false } } // EK3007: use effectGlobals
{ "vibe": { "effectModules": "no" } } // EK3007: use a boolean
{ "vibe": { "severities": { "EK0801": "info" } } } // EK3006: use warning
{ "vibe": { "severities": { "EK0801": 1 } } } // EK3006: use warning
{ "vibe": { "severities": [] } } // EK3007: use an object
```

These settings have no Effect TypeScript runtime translation. With both switches disabled, use explicit imports, just as in TypeScript:

```ts
import { Effect } from "effect"

Effect.runSync(Effect.succeed(42)) // 42
```

```json
{ "vibe": { "severities": { "EK0801": "error", "EK4609": "off", "EK38100": "warning" } } }
```

`vibe.severities` is a map keyed by the full `EK` code printed by the CLI and language server. Imported lint ordinals can add digits after `EK38`; `EK3801` and `EK38100` are distinct keys, compared as whole strings. Its values are TypeScript diagnostic category names (`"error"`, `"warning"`, `"suggestion"`) plus `"off"`. Only VibeLang's own warning codes and imported `EK38xx` codes may appear; a VibeLang error code, an interim `EK92xx` code, even one printed as a warning, or an unknown code is a config error (`EK3006`: remove the entry; [VIP-30](../vips/0030-config-files.md#decision), [VIP-38](../vips/0038-effect-lint-built-in.md#decision)). `EK0801` is the configurable `using` warning; `EK4701` is the non-exhaustive `match` error and cannot be configured. This is a compiler setting, with no Effect TypeScript runtime translation.

```jsonc
// Invalid even when retaining the severity: VibeLang's own error codes cannot be configured.
{ "vibe": { "severities": { "EK4701": "error" } } } // EK3006: remove the entry
```

The configured category controls reporting: an `"error"` makes both `vibelang` and `vibelang lint` exit non-zero and participates in `noEmitOnError`; a `"warning"` prints without changing exit status ([VIP-34](../vips/0034-compiler-and-tooling.md#decision)). A `"suggestion"` is shown by the language server only; `"off"` reports nothing. To fail CI on a configurable warning, set it to `"error"`.

### Declaration import spelling

Root `vibelang.declarationImportStyle` is `".js"` (the default), `"extensionless"` or `".ts"` ([VIP-30](../vips/0030-config-files.md#decision), amended). It decides how a package declaration in the output directory spells a relative import of a `.vibe` or `.vibex` module ([Declaration output](001-functions.md#declaration-output)); a source-adjacent sidecar keeps the source's `./x.vibe` and JavaScript output keeps `./x.js` under every setting. A relative `./x.vibex` is declared as its JavaScript output by default, `./x.jsx` under `"jsx": "preserve"` and `./x.js` otherwise; what the other two settings declare for it is not yet decided. Any other value is a configuration error. It sits in the legacy `vibelang` section, so a child config's own `vibelang` section replaces an inherited one as a whole, as an explicit child legacy section does for [legacy severity maps](#legacy-severity-maps).

### Legacy severity maps

Both historical paths, root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics`, are recognized in `vibe.config.json`, `tsconfig.json`, `jsconfig.json` and extended configs. Each maps supported printed legacy diagnostic codes to `"error"`, `"warning"` or `"off"`; `"suggestion"` is a value of the modern map, not a legacy one. Legacy replacement and inheritance behavior remains: a child without a legacy section inherits the effective base section, and adding only modern settings leaves it active. An explicit child legacy section replaces the inherited legacy section as a whole, rather than merging diagnostic entries; even an empty object or `null` clears the inherited legacy settings. The modern `vibe.severities` map still merges entry by code.

Until migrated, a supported legacy setting still controls its legacy diagnostic unless an effective modern entry for the same diagnostic or its explicitly mapped port overrides it. A reused numeric spelling alone does not establish that identity: newly assigned release errors cannot be disabled through an old map. A release-only code such as `EK0801` is not valid in a legacy map.

Each legacy map reports migration warning `EK3009`. Setting `EK3009` to `"off"` hides only this warning; it does not validate, migrate or disable the supported legacy settings.

```jsonc
// A supported legacy setting keeps applying, while its migration warning is hidden.
{ "vibelang": { "diagnostics": { /* old floating-Effect code */ "EK4801": "off" } }, "vibe": { "severities": { "EK3009": "off" } } }
// The explicit modern floatingEffect port takes precedence over the old setting:
{ "vibelang": { "diagnostics": { /* old floating-Effect code */ "EK4801": "off" } }, "vibe": { "severities": { "EK3801": "error" } } }
// Alternative historical location, in a separate config:
{ "compilerOptions": { "vibelang": { "diagnostics": { /* old floating-Effect code */ "EK4801": "warning" } } } }
```

`vibelang --fix` moves each eligible map to root `vibe.severities`, including in extended configs inside the repository, preserving JSONC comments, unrelated settings and existing modern entries; an extended config under `node_modules` is reported, not edited. It also removes the retired `declarationSidecars` setting from those owned configs. A map containing obsolete or nonconfigurable codes remains in place until those entries are resolved. Plain `tsc` ignores the custom root keys, but reports `TS5023` for `compilerOptions.vibelang`; VibeLang's legacy compatibility does not change that.

<a id="vibex"></a>

## JSX source files: `.vibex`

A `.vibex` file is a `.vibe` file read with TypeScript's JSX language variant ([VIP-39](../vips/0039-vibex.md)). Every JSX production, and its scanning, checking and emit, is `.tsx`'s; every VibeLang production is `.vibe`'s; where they compete for `<` in expression position, `.tsx`'s reading wins. The source-visible differences from `.vibe` are VIP-39's clash rows 1–5 and 39: write `x as T` for `<T>x`, `<T,>` for a generic arrow (`effect <T,>`, `async <T,>`, `catch <E,>`), and a space in `a < /re/`.

The `jsx` options and pragmas mean what they mean for `.tsx`, read through the configuration discovery above. A project without `jsx` gets `TS17004` at an element and `TS6142` at an import of a `.vibex` file. Under `react`, `react-jsx` and `react-jsxdev`, TypeScript transforms the element; under `preserve` and `react-native` the element stays in the output for the framework's compiler.

Relative specifiers resolve as follows, after TypeScript's `exports`, `imports`, `paths`, `moduleSuffixes` and resolution-mode rules select a lookup; NodeNext still requires extensions where `.ts` and `.tsx` do:

| Specifier | Tries, in order |
| --- | --- |
| `./App`, `./App.js` | `App.ts`, `App.tsx`, `App.vibe`, `App.vibex`, `App.d.ts`, then JavaScript |
| `./App.jsx` | `App.tsx`, `App.ts`, `App.vibex`, `App.vibe`, `App.d.ts`, `App.jsx`, `App.js` |
| `./App.vibe` | `App.vibe`, `App.d.ts` |
| `./App.vibex` | `App.vibex`, `App.d.ts` |

## TypeScript spellings with VibeLang forms

These built-in warnings suggest an accepted VibeLang form without changing the meaning of TypeScript-style source. They are warnings by default and use `vibe.severities`, independently of the imported Effect lint table. A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix. A warning does not itself rewrite code, and a warning-only run exits zero. Untagged `Data.Error` has no equivalent tagged declaration: keep its library form rather than adding a tag. An unsupported legacy repair is retired, rather than treated as a language requirement.

| Code | Trigger | Repair |
| --- | --- | --- |
| `EK4830` | A class written with `Data.TaggedError("Name")` | Use `error Name { … }` only when its tag and class behavior are preserved. |
| `EK4831` | A class written with `Context.Service` | Use `service Name { … }`, preserving the key with `static readonly key`. |
| `EK4832` | A `const` holding `Schema.Struct({ … })` | Use `schema Name { … }` where the field mapping and associated type are preserved. In a declaration-emitting project, preserve an own type written as `Schema.Schema.Type<typeof Name>`, private or exported, because a `schema` declaration prints `typeof Name.Type`. |
| `EK4833` | A written `Effect.Effect<A, E, R>` type, except an interface's `extends` element, which `A!E!R` cannot spell | Use the equivalent `A!E!R` spelling, preserving `never` slots and required parentheses. |
| `EK4834` | An explicitly run `Effect.succeed(v)` or `Effect.fail(e)` in effect code | Use the value `v` or `throw e`; do not apply this to an unrun Effect value. |
| `EK4835` | An explicitly run `Effect.catch`, `Effect.catchTag`, or `Effect.catchTags` in effect code | Use a `catch effect` handler, with `match` on the failure for tag cases and a typed `throw` for unmatched failures. |
| `EK4836` | An explicitly run `Effect.provide` or `Effect.provideService` in effect code | Use a `provide` statement with Layers or `Key = value`, preserving operand evaluation order. |
| `EK4837` | A class written with `Schema.TaggedError` | Use `schema error Name { … }` when the schema and tag are preserved; an ordinary `error` would lose the schema. |
| `EK4839` | An Effect `Match` chain with a supported finisher, or a direct `Option.match(value, handlers)` call | Use `match`, or a function returning `match` for `Match.type`, only for patterns and handlers whose tests and results are preserved. Direct `Option.match` keeps subject evaluation, handler construction, property reads and the selected callback in their original order. The fix refuses a choice returning a program or comments between its arguments; `Match` chains also keep refusals for unsupported patterns, handlers or return types. |
| `EK4841` | A schema `const` immediately followed by its matching `typeof Name.Type` alias | Use the corresponding `schema Name = …` declaration where the schema mapping preserves both exports. |
| `EK4842` | An Effect module imported under a conflicting JavaScript global name | Rename that import and its resolved uses, such as `Array as Arr`, only where emitted public types keep their meaning. |

For example, the `EK4830` repair may replace this class with `error Missing { id: string }` while preserving `Fail(Missing { id: "x" })`:

```vibe es
// compiler-gap: pending VIP-1, VIP-13
class Missing extends Data.TaggedError("Missing")<{ readonly id: string }> {}
effect function program() { throw new Missing({ id: "x" }) }
```

```ts effect
// TypeScript-form advisory reference
import { Data, Effect, Exit } from "effect"
class Missing extends Data.TaggedError("Missing")<{ readonly id: string }> {}
const result = Effect.runSyncExit(Effect.fail(new Missing({ id: "x" })))
if (Exit.isSuccess(result)) throw new Error("expected a failure")
const reason = result.cause.reasons[0]
if (reason._tag !== "Fail") throw new Error("expected a typed failure")
console.log(JSON.stringify([reason._tag, reason.error._tag, reason.error.id]))
```

## The Effect version

During alpha, VibeLang pins exactly one Effect version, and the pin moves to each new Effect release. The pinned dependency artifact is `effect@4.1.0`, and 4.1 is the earliest supported version (VIP-32, amended). Every Effect TypeScript mapping in this specification, and the `Exit` guarantee of [Runtime guarantees](008-runtime.md), is relative to the pin. The pin controls variables during alpha; it is not the long-term plan, and supported version ranges get their own VIP after alpha.

A migration upgrades the target repository to the pinned Effect first, on its own: it fixes what breaks and lands that commit with green tests. Only then does it convert files to `.vibe`, so each breakage shows its real cause. A repository that already uses VibeLang upgrades Effect together with the VibeLang release pinned to the new Effect, because the published `vibelang-runtime` enforces its exact pin.

VibeLang declares an exact `effect` peer dependency. The compiler reads the resolved `effect/package.json`; any version other than `4.1.0` is `EK3201` in the CLI and editor ([VIP-32](../vips/0032-effect-version.md#decision)). For example, resolving `effect@4.0.3` reports: `the resolved effect is 4.0.3; VibeLang Y pins 4.1.0: upgrade both together`, where `Y` is the VibeLang release.

## Compiler and tooling requirements

1. **Diagnostics.** Every VibeLang diagnostic has a code (`EKxxxx`) and a message in the user's words that says what is wrong and how to fix it, with a quick fix wherever the fix is mechanical. Quick fixes and codemods use the formatter to preserve the parse under Appendix A. [Appendix B](900-appendices.md#appendix-b-diagnostics) lists the codes. TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types. A rejection that depends on a VibeLang production, placement rule, proposal-specific early error or explicitly adopted reconciliation uses its owning VIP's `EK` code, even when a TypeScript parser helper implements it. Use an already assigned specific diagnostic for the same rejection; preserve independent native errors. A compilation whose emitted JavaScript imports `vibelang-runtime` and cannot resolve that package fails with one error naming it, TypeScript's `TS2307` for a missing module, as a missing dependency fails in TypeScript; it never reports the compiler-generated helpers the package provides as unresolved names.
2. **Codemods.** Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically. One `vibelang --fix` run applies fixes until none applies; running it again changes nothing. A run that has not converged within its pass limit reports the remaining fixes as an error. A `--fix` run writes only the selected project's own files: its `.vibe` and `.vibex` sources in the TypeScript program, including an owned source an import reaches even when `exclude` omits it from root discovery, and its own configuration files for the named legacy-severity and retired-`declarationSidecars` codemods. Config `extends` traversal stays inside the repository and outside `node_modules`. It never rewrites dependencies, sources resolved from `typeRoots` or bundled libraries, foreign `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` or `.cjs` sources, declaration files (`.d.ts`, `.d.vibe.ts`, `.d.vibex.ts`), emitted output, `tsBuildInfoFile`, lock files or another referenced project's files; with `-b`, each project fixes its own files in build order. The platform repair alone may create a fresh sibling `.ts` module after proving preservation of run phase, captures, receiver and public types; it never overwrites an existing file. A repair requiring any other write gives the not-fixed explanation and changes nothing ([VIP-34](../vips/0034-compiler-and-tooling.md#decision), amended). For example, a trailing block ([VIP-11](../vips/0011-trailing-blocks-denied.md)) is `EK1101`, and its codemod writes the block as the call's last argument in the spelling of what it ran as: `Layer.effect(Users) { … }` becomes `Layer.effect(Users, effect { … })`, `it.effect("loads") { … }` becomes `it.effect("loads", effect () => { … })`, and a block passed as a plain callback becomes `() => { … }`. The rewrite preserves runtime behavior. Comments stay in the source, though their printed placement and equivalent arrow layout can differ. A line break before the block, an optional chain, a heritage clause, and the providers of a `provide` block are outside this form. A comment between the call and its block has no place in the rewrite, so the codemod leaves that site to the author; a block after an Effect dual that `0.0.10` placed elsewhere keeps the existing dual-block compatibility migration.
3. **One formatter.** VibeLang's formatter is the only formatter. Prettier, dprint and Oxfmt reach it through plugins, so a repository's existing formatter command covers `.vibe` files. It takes the repository's quote style and print width from that formatter's configuration, so `.vibe` and `.ts` files share them. It preserves the `provide` line restrictions ([VIP-12](../vips/0012-provide.md)): never break after `provide`, before or after a provider-separating comma, or before the block’s `{`. A long provider list stays on one line. The formatter neither introduces nor removes `Layer.mergeAll(…)`; an author who writes it may break lines between its arguments ([example](005-services.md#syntax)). It preserves every line-sensitive and parenthesis-sensitive rule in [Appendix A](900-appendices.md#appendix-a-grammar): never insert or remove a line break or parentheses that change the parse. Its tests cover each such rule, including contextual keywords, Effect type slots, bodyless errors, field and variant separators, statement boundaries, `catch` arrows and `for concurrent` heads and bodies. Under the same compiler/options, formatting preserves parsed program meaning: bindings and scopes, operator and control-flow targets, evaluation order, receivers and call syntax, ordinary runtime values and effects, coldness, failures, interruption and finalizers. It preserves inferred and declared public types, declarations and throws contracts, and diagnostic codes, categories and occurrences; diagnostic locations and quoted source follow the formatted file. Comments and their code associations survive, including JSDoc, compiler/linter/tool directives and directive-prologue meaning. An unparsable file is reported and left unchanged; formatting is idempotent. Semantic migrations and diagnostic repairs belong to `vibelang --fix` or editor actions.

   Ordinary layout and lexical-spelling normalization may change emitted JavaScript bytes. `Function.prototype.toString`, generated source text, source offsets, line/column and stack presentation may reflect the formatted text. This source-text boundary never permits changes to ordinary strings/data, tagged-template raw or cooked values, regex meaning, function names or lengths, property names or directive semantics. For example, changing an escaped string into an actual `use strict` directive changes meaning. Regenerate compiler-generated source-map and declaration-map provenance, including `sourcesContent`, for the formatted file; never retain stale maps. Preservation tests compare parsed source/emit structure, runtime behavior, types/declarations, diagnostics, comments/directives and maps; arbitrary regex stripping is unsound, and a finite structural oracle is not a proof of all program equivalence. Exact-byte tests remain useful where equality is expected, without restricting advertised native formatter style settings.
4. **Existing tools work.** Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`. A repository's Oxlint JS-plugin rules run on `.vibe` files wherever the rule applies to the source or emitted forms. Every tool is tested against the dogfood repositories. The language server also resolves `./x.vibe` to the source whenever it is in the program, ignoring its stale `x.d.vibe.ts` beside it or under `vibe.sidecarDir`.
5. **Emit names.** `x.vibe` emits `x.js` beside `x.d.ts` in `outDir`; JavaScript output rewrites relative `./x.vibe` specifiers to `./x.js`. Declaration output selects `./x.js` (default), `./x` (`"extensionless"`) or `./x.ts` through `vibelang.declarationImportStyle`; every other written specifier stays as written under every style, including `./helper.ts` ([VIP-27](../vips/0027-declaration-output.md#decision), amended). The setting applies to package declarations only: a source-adjacent sidecar keeps `./x.vibe`. `x.vibex` emits `x.jsx` under `"jsx": "preserve"` and `x.js` otherwise, as `x.tsx` does, and a relative `./x.vibex` specifier becomes the target file's actual output name (VIP-39). Bundler plugins use the same names ([VIP-34](../vips/0034-compiler-and-tooling.md#decision)). The `.d.vibe.ts` compatibility route above remains for tools reading `.vibe` specifiers.
6. **Severities.** Only VibeLang's own warning codes and all imported `EK38xx` lint codes can be configured in `vibe.severities`. Entries for VibeLang's own error codes, interim `EK92xx` codes or unknown codes are config errors (`EK3006`), even if the requested severity is `"error"`.

The transitional compiler also emits four migration warnings: `EK4853` writes previously inferred requirements explicitly under VIP-3; `EK4854` changes the retired abstract-class service spelling to `service`; `EK4855` changes a service's `default` value to a `defaultValue` factory under VIP-9; and `EK4856` replaces a use of the retired global `Effect<A, E, R>` alias with `A!E!R`, or qualified `Effect.Effect<A, E, R>` where the syntax requires it under VIP-3. Their [compatibility inventory](900-appendices.md#transitional-compiler-diagnostics) records the emitted codes. `vibelang --fix` keeps the existing safe-fix checks and refusal rules. These repairs do not run Effects or change the normative omitted-slot and service semantics.

The `EK4856` transition selects the resolved legacy symbol, never the identifier spelling: a local or imported type named `Effect` retains its TypeScript meaning. Its quick fix preserves grouping and default slots, keeps required imports when globals are disabled, and leaves declarations qualified. The alias is removed only in a coordinated release of compiler, codemod and docs. Afterwards, module-only `Effect<number>` is native `TS2709`; an unbound name follows ordinary TypeScript resolution ([VIP-3](../vips/0003-effect-type-shorthand.md#decision), amended).

## Effect's type-aware lint

```sh
vibelang lint -p tsconfig.json
```

The Effect language service's type-aware rules (effect-tsgo's `effecttsgo/*` rules) run inside the `vibelang` compiler on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions. VibeLang-specific language checks remain confined to `.vibe`. They run wherever VibeLang reports diagnostics: the CLI, the language server, and `vibelang lint` for CI (VIP-38, amended). A repository's existing Effect language-service configuration selects and configures them, so its lint script covers `.vibe` as it covers `.ts`. The lint command emits no files and uses the same configuration and diagnostic categories as the compiler and language server; it has no Effect TypeScript runtime translation.

Each imported `effecttsgo/*` rule gets one stable `EK38xx` code, in a normative table generated from the pinned effect-tsgo version ([Imported lint codes](900-appendices.md#imported-lint-codes)); a VIP-32 bump regenerates the table, and a rule's code never changes once assigned ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)). The CLI and language server print that code with the rule name in the message: `EK3801 floatingEffect: …`. A rule's severity resolves in this order, the more specific winning, as a tsconfig child overrides its base: an entry for its code in `vibe.severities`; else the repository's Effect language-service configuration; else the rule's default. Every `EK38xx` code is a lint code and may be set to any value, `"off"` included: VIP-34's "errors can't be off" covers VibeLang's own rules.

```json
{ "vibe": { "severities": { "EK3801": "warning" } } }
```

An `effect { … }` expression statement builds an Effect and discards it without running it ([Effect blocks](002-running.md#effect-blocks)). The imported `floatingEffect` rule reports it under its `EK38xx` code, just as it reports a discarded Effect in TypeScript.

These are VibeLang’s own configurable warnings, distinct from the imported `EK38xx` rules; they already have decided codes and preserve the underlying TypeScript behavior ([Running Effects](002-running.md)):

| Warning | Code | Suggested fix |
| --- | --- | --- |
| A plain `catch` handler returns an unrun Effect ([VIP-5](../vips/0005-try-runs-effects.md#decision)) | `EK0508` | `catch effect (e) => try …` |
| An explicit `throw` can complete a plain `catch` handler ([VIP-5](../vips/0005-try-runs-effects.md#decision)) | `EK0511` | `catch effect (e) => { … }`, which makes the throw a typed failure |
| A legacy severity map remains in the config | `EK3009` | Run `vibelang --fix` after resolving obsolete entries. |
| `using` in effect code | `EK0801` | Use `acquireDisposable` inside `scoped`. |
| An extractor's argument count cannot match its extraction list | `EK0703` | Use a bare class test or the matching number of subpatterns. |
| `await` on a `Fiber` ([VIP-5](../vips/0005-try-runs-effects.md#decision)) | `EK4609` | `await runPromise(Fiber.join(fiber))` in `async` code; `join fiber` in effect code |
| `await` on a `Deferred` ([VIP-5](../vips/0005-try-runs-effects.md#decision)) | `EK4610` | `await runPromise(Deferred.await(deferred))` in `async` code; `try Deferred.await(deferred)` in effect code |

The imported rules are pinned by [`UPSTREAM`](../../../typescript/tsc/internal/effecttsgo/UPSTREAM) to `@effect/tsgo@0.57.0`, commit `999942fa41462eb46dfcb2d718e7671db8e14156` ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)). The normative [`lint-codes.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/lint-codes.json) and the table below are generated with `node docs/tools/lint-codes.mjs --write`. An upstream bump runs `sh tsc/internal/effecttsgo/sync.sh <tag>` from `typescript/` and regenerates the inventory.

Each rule has one stable code: the `EK38` prefix followed by a decimal ordinal of at least two digits. The initial allocation retains `EK3801` for `floatingEffect` and sorts all remaining rule names from ordinal 2 ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)); future additions sort only the new names and append after the largest reserved ordinal. After `EK3899` comes `EK38100`, so the prefix also accommodates this pin's 130 rules ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)). Keep assignments in `docs/tools/lint-code-assignments.json`; removed rules retain their reservation and codes are never renumbered or reused.

Severity resolves from an entry for the printed code in `vibe.severities`, then the repository's Effect language-service configuration, then the rule's default ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)). Every imported code accepts `"off"`, including rules whose default is `"error"`. A code identifies one rule even when that rule emits several upstream messages.

<!-- lint-codes:start: generated by docs/tools/lint-codes.mjs; do not edit -->

Imported rules from `@effect/tsgo@0.57.0` (commit `999942fa41462eb46dfcb2d718e7671db8e14156`).

| Code | Rule | VIP | Chapter | Default severity |
| --- | --- | --- | --- | --- |
| `EK3802` | `effecttsgo/abortControllerInEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3803` | `effecttsgo/acquireReleaseDisposable` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3804` | `effecttsgo/allOfMapToForEach` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3805` | `effecttsgo/anyUnknownInErrorContext` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3806` | `effecttsgo/apiStabilityLeak` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3807` | `effecttsgo/asyncFunction` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3808` | `effecttsgo/catchAllTagDispatchToCatchTag` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3809` | `effecttsgo/catchAllToMapError` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3810` | `effecttsgo/catchChainToFirstSuccessOf` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3811` | `effecttsgo/catchConditionalRefailToCatchIf` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3812` | `effecttsgo/catchDieToOrDie` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3813` | `effecttsgo/catchIfTagToCatchTag` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3814` | `effecttsgo/catchRefailToTapError` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3815` | `effecttsgo/catchTagToCatchReason` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3816` | `effecttsgo/catchToIgnore` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3817` | `effecttsgo/catchToOrElseSucceed` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3818` | `effecttsgo/catchUnfailableEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3819` | `effecttsgo/classSelfMismatch` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3820` | `effecttsgo/cryptoRandomUUID` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3821` | `effecttsgo/cryptoRandomUUIDInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3822` | `effecttsgo/deterministicKeys` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3823` | `effecttsgo/duplicatePackage` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3824` | `effecttsgo/effectDoNotation` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3825` | `effecttsgo/effectFnIife` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3826` | `effecttsgo/effectFnImplicitAny` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3827` | `effecttsgo/effectFnOpportunity` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3828` | `effecttsgo/effectGenUsesAdapter` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3829` | `effecttsgo/effectInFailure` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3830` | `effecttsgo/effectInVoidSuccess` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3831` | `effecttsgo/effectMapFlatten` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3832` | `effecttsgo/effectMapVoid` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3833` | `effecttsgo/effectSleepZeroToYieldNow` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3834` | `effecttsgo/effectSucceedWithVoid` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3835` | `effecttsgo/errorPayloadShadowsName` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3836` | `effecttsgo/experimentalApiUsage` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3837` | `effecttsgo/extendsNativeError` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3838` | `effecttsgo/flatMapConditionalToFilterOrFail` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3839` | `effecttsgo/flatMapIgnoredParamToAndThen` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3840` | `effecttsgo/flatMapToMap` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3841` | `effecttsgo/flatMapToTap` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3801` | `effecttsgo/floatingEffect` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3842` | `effecttsgo/floatingEffectInVitest` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3843` | `effecttsgo/genericEffectServices` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3844` | `effecttsgo/globalConsole` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3845` | `effecttsgo/globalConsoleInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3846` | `effecttsgo/globalDate` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3847` | `effecttsgo/globalDateInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3848` | `effecttsgo/globalErrorInEffectCatch` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3849` | `effecttsgo/globalErrorInEffectFailure` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3850` | `effecttsgo/globalFetch` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3851` | `effecttsgo/globalFetchInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3852` | `effecttsgo/globalRandom` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3853` | `effecttsgo/globalRandomInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3854` | `effecttsgo/globalTimers` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3855` | `effecttsgo/globalTimersInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3856` | `effecttsgo/instanceOfSchema` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3857` | `effecttsgo/layerMergeAllWithDependencies` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3858` | `effecttsgo/lazyEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3859` | `effecttsgo/lazyPromiseInEffectSync` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3860` | `effecttsgo/leakingRequirements` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3861` | `effecttsgo/mapSomeToAsSome` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3862` | `effecttsgo/matchEffectToMapBoth` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3863` | `effecttsgo/matchEffectToMatch` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3864` | `effecttsgo/missedPipeableOpportunity` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3865` | `effecttsgo/missingEffectContext` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3866` | `effecttsgo/missingEffectError` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3867` | `effecttsgo/missingEffectServiceDependency` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3868` | `effecttsgo/missingLayerContext` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3869` | `effecttsgo/missingPipeableSignature` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3870` | `effecttsgo/missingReturnYieldStar` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3871` | `effecttsgo/missingStarInYieldEffectGen` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3872` | `effecttsgo/multipleCatchTag` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3873` | `effecttsgo/multipleEffectProvide` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3874` | `effecttsgo/nestedEffectGenYield` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3875` | `effecttsgo/newPromise` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3876` | `effecttsgo/newSchemaClass` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3877` | `effecttsgo/nodeBuiltinImport` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3878` | `effecttsgo/nonObjectEffectServiceType` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3879` | `effecttsgo/obsoleteMatchImport` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3880` | `effecttsgo/obsoleteSchemaImport` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3881` | `effecttsgo/optionMatchToFromOption` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3882` | `effecttsgo/outdatedApi` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3883` | `effecttsgo/overriddenSchemaConstructor` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3884` | `effecttsgo/preferBarrelImport` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3885` | `effecttsgo/preferEffectArray` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3886` | `effecttsgo/preferEffectRecord` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3887` | `effecttsgo/preferEffectString` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3888` | `effecttsgo/preferNamespaceImport` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3889` | `effecttsgo/preferSchemaOverJson` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3890` | `effecttsgo/preferSchemaTaggedError` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3891` | `effecttsgo/preferSchemaTypeProperty` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3892` | `effecttsgo/preferSucceedSomeOrNone` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3893` | `effecttsgo/preferTypedSchemaDecoder` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3894` | `effecttsgo/preferUnsafeConstructor` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3895` | `effecttsgo/processEnv` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3896` | `effecttsgo/processEnvInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3897` | `effecttsgo/promiseInEffectSuccess` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3898` | `effecttsgo/provideLayerSucceedToProvideService` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3899` | `effecttsgo/raceFirstWithSleepToTimeout` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38100` | `effecttsgo/redundantMapError` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38101` | `effecttsgo/redundantOrDie` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38102` | `effecttsgo/redundantSchemaTagIdentifier` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38103` | `effecttsgo/returnEffectInGen` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38104` | `effecttsgo/runEffectInsideEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38105` | `effecttsgo/runOfExitToRunExit` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38106` | `effecttsgo/schemaClassMissingBrand` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38107` | `effecttsgo/schemaClassObjectLiteral` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK38108` | `effecttsgo/schemaLiteralNonFinite` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK38109` | `effecttsgo/schemaNumber` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38110` | `effecttsgo/schemaOpaqueInstanceMember` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK38111` | `effecttsgo/schemaStructWithTag` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38112` | `effecttsgo/schemaSync` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38113` | `effecttsgo/schemaSyncInEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38114` | `effecttsgo/schemaUnionOfLiterals` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38115` | `effecttsgo/scopeInLayerEffect` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK38116` | `effecttsgo/serviceNotAsClass` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38117` | `effecttsgo/strictBooleanExpressions` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38118` | `effecttsgo/strictEffectProvide` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38119` | `effecttsgo/syncToSucceed` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38120` | `effecttsgo/timeoutCatchTagToTimeoutOrElse` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38121` | `effecttsgo/tryCatchInEffectGen` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38122` | `effecttsgo/unknownInEffectCatch` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK38123` | `effecttsgo/unnecessaryArrowBlock` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38124` | `effecttsgo/unnecessaryEffectGen` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38125` | `effecttsgo/unnecessaryFailYieldableError` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38126` | `effecttsgo/unnecessaryPipe` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38127` | `effecttsgo/unnecessaryPipeChain` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38128` | `effecttsgo/unnecessaryTypeofType` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38129` | `effecttsgo/unsafeEffectTypeAssertion` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38130` | `effecttsgo/unstableApiUsage` | 38 | [Tooling](007-tooling.md) | `warning` |

<!-- lint-codes:end -->

Tools that only analyze code, such as cycle checkers (madge) and dependency graphs, may run on VibeLang's compiled output. Formatters cannot; they read `.vibe` itself.

`vibelang lint` accepts the compiler’s options, including `-p`/`--project` and file arguments, with no lint-specific options; for example, `vibelang lint --project tsconfig.json` selects that project ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)). `vibelang --fix` remains the codemod entry point. Two flags scope that invocation:

| Flag | Scope when used with `--fix` |
| --- | --- |
| `--fix-migration-only` | Migration fixes, excluding TypeScript-form teaching rewrites and prelude/import cleanup. |
| `--fix-vip-only` | The existing VIP migration passes, including the VIP-1/VIP-2 function-kind and `try` migration, excluding prelude/import cleanup. |

Either scope flag requires `--fix` somewhere in the argument list, before or after it; alone, each is an unknown compiler option (`TS5023`). The ordinary `--fix` invocation and its project options keep their existing meaning.

```sh
vibelang --fix --fix-migration-only -p tsconfig.json
vibelang --fix-vip-only --fix -p tsconfig.json
vibelang --fix-vip-only # TS5023: add --fix
```

The VIP-1 migration preserves each call's original run phase. When it removes a known legacy wrapper, it removes the `try` that ran that wrapper, even when the success data is an `error` or `schema error` instance, another Effect, or an object with an `asEffect` member. Keeping that `try` would fail with data or run a previously unrun program. A call whose written or native contract already returned the intended Effect keeps its `try`, including an error returned for intentional execution. Use the original resolved callable and migration provenance, not the final value's shape or annotation alone; refuse the repair when that provenance cannot be established ([VIP-34](../vips/0034-compiler-and-tooling.md#decision), amended).

Only `--fix-vip-only` runs the VIP-1/VIP-2 function-kind and `try` passes, reading input as source for the release before VIP-1. Ordinary `--fix` and `--fix-migration-only` do not run those passes: ordinary `--fix` never removes a valid `try` from current source merely because its callee is unannotated. In current source, `try make()` intentionally runs the result whenever it passes the [operand test](002-running.md#operand-test).

A value that fails that operand test, such as `Option.some(1)` or `Result.succeed(2)`, keeps `EK0502`: the migration inserts no conversion and unwraps nothing, whatever methods the value has ([VIP-5](../vips/0005-try-runs-effects.md#decision), amended). Removing the run of a proven legacy wrapper is a separate repair.

The VIP-1 migration writes `try` before each call that ran where it stood before VIP-1 and keeps that call's run phase; source whose old meaning it can't establish is not reinterpreted. It refuses such a call instead, names its file and line, and exits nonzero. When it refused any, it sets `"vibe": { "severities": { "EK4802": "error" } }` in the project's config with a comment that says why, so each refused site that returns its program fails to compile until it is migrated by hand; the owner removes the setting once a run refuses none.

These commands have no Effect TypeScript runtime translation.

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 117

**Match and is use the pinned per-evaluation cache and FinishMatch, including its error aggregation.** (Opus round-19 M1/m6; VIP-7 snapshot; refines detail 95.) Property-presence/read operations, iterator acquisition, and pulled elements are cached as the pinned CreateMatchCache algorithms prescribe, across arms of one match and within one is evaluation; do not hoist or share across separate evaluations. Run FinishMatch after the selected arm or no-match completion, closing cached iterators not already done. Its combination of an arm/no-match throw and closing errors is the snapshot's AggregateError, not destructuring's incoming-throw precedence. Synchronous JavaScript abrupt completions take that finishing path. In effect code a yielded failure, defect, or interruption abandons the generator and does not reach it, exactly as the existing native-using/destructuring rule; no automatic ensuring is added.
    **Immutable-main source scope (f6fe7a, 117).** 004 removes its flawed general Reflect.apply/cache lowering recipe and labels the new two-value generator example as a finite native witness. General cache/FinishMatch rules remain above; no full matcher implementation proof. `root-mainf6-source-receipt.json` and `root-mainf6-throws-audit.json` preserve reviewed-prose/structured-artifact limits; no full raw9.19MB human-read or owncompiler/Go/generator/test/gate claim.
    **Independent f6fe7 source portion (117).** Chapter004 replaces the purported general cache-lowering recipe with a native witness explicitly limited to the fixedtwo()generator. Generalcache/FinishMatch semantics still come from the existing rules, not the witness. Full27,227-character nongenerateddiffread; sourceonly, no decide-livecompiler/gaterun. `main-f6f-source-receipt.json` records limits.
    Current replacement: applied in ab3d71c5fb7c8da2c5b8eda36d67d6e7bc499267 (spec-fix-c; supersedes 525d50e66907 after main rebase and current-release placement; queued, not a main receipt).
    Related cache-counterpart follow-up: spec-fix-c reports c9b989606ad1c6ad093cf5ad264c7e6544f0e7d2 queued; this removes the remaining mutable-helper example. It is not a new main landing receipt or a reversal of the separate binding/cache status below.
    Status: applied in 525d50e66907693342d609d026f18487f348f563 (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    function* two() { yield 1; yield 2 }
    match (two()) { when [let a]: a; when [let a, let b]: a + b; default: 0; } // 3
    ```
    Effect TS: perform the pinned cached matching algorithm in the surrounding Effect.gen; later arms reuse the first arm's cached elements, then finish cached iterators. The schematic if-chain counterparts omit cache machinery only when that omission cannot affect their data-only witnesses. Decided by the agent from principle 2 (the pinned TC39 snapshot) and VIP-7's full-proposal decision, 2026-10-29. The r20-004/r20-008 fixes already state this behavior; no removal of cache semantics is approved.

72a. **The formatter only lays out; fixes belong to `vibelang --fix`** (c9's FuzzFormat finding, 2026-10-30; VIP-34 requirement 2). Chapter 7 states the formatter's contract: for any file that parses, formatting keeps its diagnostics (the same codes, at the moved positions) and its emitted JavaScript exactly; it never removes or adds a diagnostic. A file that doesn't parse is left unchanged. Rewrites that change meaning, including migrating removed forms such as the `async f()` / `effect f()` shorthand (EK4618) to `function` form, are quick fixes applied by `vibelang --fix` or the editor, never by formatting. The formatter that vip-core (3f873a15) taught to rewrite the shorthand gives that rewrite to `--fix` instead. Decided by the agent from principles 1 and 2 (Prettier and oxfmt never change meaning) and VIP-34 requirement 2, 2026-10-30.
    **Byte-equality erratum: detail234 supersedes this exact-emission requirement.** Keep this item's no-semantic-codemod, diagnostic-preservation and unparsable-input rules; source-map correctness remains as174 requires. Ordinary formatter layout/spelling changes follow234's semantic, declaration, comment/directive and source-text-reflection contracts instead of executable-byte identity.
    Status: applied in 781a52f073ba (spec-fix-d; queued, not yet a main receipt).

### Detail 174

**Formatting preserves executable emission while regenerating source-map provenance.** (live `007-formatter-inline-map`; clarifies detail 72a without changing its layout-only policy, VIP-30/VIP-34.) The formatter preserves diagnostic codes and the emitted JavaScript apart from compiler-generated source-map material. Source positions, inline/external maps, declaration maps and embedded `sourcesContent` must instead describe the formatted source under the same supported tsconfig options. Do not preserve a stale map to force byte-identical `.js`, and do not ban `inlineSourceMap` or `inlineSources`. An exact-emission preservation check runs with map emission disabled, or removes only the compiler-generated map directive/trailer for its byte comparison and validates map correctness separately. This exemption is not permission to strip arbitrary source comments or string contents or to alter non-map code. Semantic rewrites and any diagnostic-code change remain exclusive to `vibelang --fix`; unparsable input remains unchanged as detail 72a requires.
    **Immutable-main source scope (d0cdbe, 174).** 007 publishes the earlier source-map provenance correction and its then-current non-map-byte requirement. The byte clause is superseded internally by234, whose broader formatter publication is still pending at this main. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    **Byte-equality erratum: detail234 supersedes this exact-emission requirement.** Keep this item's no-semantic-codemod, diagnostic-preservation and unparsable-input rules; source-map correctness remains as174 requires. Ordinary formatter layout/spelling changes follow234's semantic, declaration, comment/directive and source-text-reflection contracts instead of executable-byte identity.
    Status: applied in 781a52f073ba (spec-fix-d; queued, not yet a main receipt).
    ```vibe
    export const n=1 // before formatting
    // Formatted source: export const n = 1;
    // Both emit the same executable statement; inline sourcesContent records the actual source.
    ```
    Effect TS: native TypeScript with `{ inlineSourceMap: true, inlineSources: true }` emits `export const n = 1;` for both layouts, followed by different generated mapping trailers containing the respective original source and mappings. Decided by the agent from principle 2 (TypeScript's existing source-map options), VIP-30's identical tsconfig meanings, and detail 72a's prohibition on semantic formatter rewrites, 2026-10-30. Update 007's preservation contract and its check, plus any shared formatter-guarantee wording. Evidence: `decide-live-scratch/formatter-inline-map.log` verifies equal non-map emission, zero diagnostics on both sides, different mappings and correct respective source contents under TypeScript 5.9.3; main's printer explicitly embeds `source.Text()` for `inlineSources`. This is a contract/reference check, not VibeLang formatter-conformance evidence.

### Detail 180

**Every source .vibe compilation unit is a module (class B, timed default A applied).** (live `007-file-module-policy` and `001-implicit-import-script-kind`; timed default A applied; originally class B because it changes script-style binding visibility and needs an explicit VIP-30 exception.) Applied A: classify every source `.vibe` file as an external module before binding/checking, independently of written imports/exports, required prelude imports, `vibe.effectGlobals` and `vibe.effectModules`. Preserve that classification in emitted JavaScript and declaration sidecars, supplying the emitter's effective empty module marker when needed; do not check script scope and emit module scope. Ordinary TypeScript module emission/host rules and incompatible-option diagnostics still apply. State the deliberate file-kind exception: `moduleDetection` continues its ordinary meaning for `.ts`/`.js`, but none of its values opts `.vibe` into shared script globals. No magic main or implicit Effect execution is added. Alternative B retains TypeScript detection on written source and preserves script scope/strictness. If a source script requires a generated runtime import, issue a coded error with a quick fix adding an explicit module marker such as `export {}` (or a real import); do not silently promote the script only at emission. This is the conservative script-preservation branch from live `001-implicit-import-script-kind`, folded into this same timed question. Automatic promotion by a required import is a separate possible policy, but changes plain-call `this`/strictness and is not the recommended script alternative.
    **Immutable-main source scope (d0cdbe, 180).** 001/007/008 and VIP26/30 explicitly classify every source .vibe as an external module before checking, with the approved moduleDetection exception, emission marker and ordinary host/configuration rules. This is publication of the resolved A default, not compiler confirmation. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in 12456ffdee3e (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    // a.vibe
    const laneSharedValue = 1 // A: private to this module; B: global if this file remains a script
    // b.vibe, moduleDetection: legacy, no source/required imports
    const laneReadValue = laneSharedValue // A: missing-name error; B: accepted shared script binding
    // A shares explicitly: export laneSharedValue in a.vibe and import it in b.vibe.
    ```
    Effect TS: A corresponds to ordinary modules with `export {}` in each otherwise import-free input; B preserves TypeScript classification on written source; a script needing a generated runtime import is rejected with an explicit export/import quick fix rather than silently promoted. `decide-live-scratch/root-module-policy-reference.log` on TypeScript `5.9.3` accepts the two scripts and reports TS2552 after making the defining file a module. Main's `ast/parseoptions.go` currently follows TypeScript detection options, so all-module scope cannot be asserted as a harmless clarification of existing script behavior. **Timed default A applied effective 2026-10-30 09:00 PT; processed 2026-10-30T16:00:22.159322+00:00. No Will answer was recorded at handling**. Recommended by the agent from principles 4 and 8 (one stable file scope independent of prelude use, avoiding accidental cross-file global capture), 2026-10-30. Class B is justified because those preferences do not override VIP-30's explicit identical-field promise or choose away an observable script/module compatibility change. The next spec round applies the timed default in 001/VIP-26, 007/VIP-30 and 008; cover two-file visibility, no-export top-level await under a supported module target, both prelude switches, adding/removing implicit uses and declaration scope. This is a policy/reference receipt, not a VibeLang compiler-conformance claim.

Landing receipt: source 12456ffdee3e landed in main d0cdbe5a0a7f (queue 1793378032-spec-fix-a, gate mq-10302149-2).

    Compiler scope/emission applied in `0a12ca311bfa` (spec-fix-d45; source queued). Native module classification, private binding/strict/emission regression and static keyed fuzz pass; top-level Promise await is a separately claimed native-parser gap.

- Native option-gating implementation applied in `5f2b1ed175f9` (spec-fix-d46, queued): every reparsed native source.Vibe top-level await retains supported module/target checks; source007/module classification implementation `0a12ca311bfa` is LANDED main77510050781c. No ordinary.TS behavior change.

    **Immutable-main source publication (773bddb1d57f, 180).** Chapter 001 publishes supported `module`/`target` checks for unary and multiline top-level `await`, naming `NodeNext`/`CommonJS` `TS1309` and ESM `ES2016` `TS1378`. This verifies source wording only; no compiler option checks were rerun. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.

### Detail 234

**Formatting preserves program meaning and contracts, not emitted-file bytes.** (live `007-formatter-byte-emission-style`; accepted VIP-34's shared native-style formatter; corrects only the overstrong byte-equality clauses in72a/174.) Under the same compiler/options, formatting preserves the source's parsed meaning: bindings/scopes, operator/control-flow targets, evaluation order, receivers, call syntax, runtime values/effects, coldness, failures/interruption and finalizer behavior. Keep required parentheses and VibeLang's line-sensitive/contextual grammar. Ordinary layout and lexical-spelling normalization may change emitted JavaScript bytes without changing those contracts; advertised native formatter style settings are not disabled to manufacture byte equality.
    **Immutable-main source scope (d0cdbe, 234).** At this main007 still states the older exact executable-emission clause. Decision234 remains authoritative for the requested correction; no source publication or current formatter conformance is claimed for234. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Preserve inferred/declared public types, declaration/throws contracts, and diagnostic identities/categories/occurrences under the same configuration, with locations and quoted source adjusted to the formatted file. Retain comments and their code associations, including JSDoc, compiler/linter/tool directives and directive-prologue meaning; formatting is not a migration or a diagnostic repair. An unparsable input is reported and left unchanged, as detail72a requires. Retain formatter idempotence and existing supported-style behavior. Semantic rewrites, removed-form migration and diagnostic-changing fixes remain `vibelang --fix`/editor actions.
    State the ordinary formatter source-text boundary explicitly: `Function.prototype.toString`, generated source text/bytes, source offsets/line-column/stack presentation and map provenance may reflect the formatted text. They are not byte/string identity guarantees. Regenerate correct source/declaration maps and `sourcesContent` under detail174; never retain stale maps. This boundary does not permit changing ordinary program strings/data, tagged-template raw or cooked values, regex meanings, function names/lengths, property names or directive semantics. For example, normalizing an escaped string into an actual `use strict` directive is a semantic change, not harmless quote styling.
    Replace exact-emission equality as the general preservation oracle with checks of source/emit structure and semantics, types/declarations, diagnostics and comment/directive/source-map contracts. A parse-aware comparison may account for harmless layout/spelling/grouping, but must preserve literal values, raw-template contracts, directive positions and semantic source grammar; arbitrary regex stripping of comments/strings/parentheses is unsound. Exact-byte checks may remain stronger tests for cases where equality is expected, not a prerequisite for every formatting option. Do not add quote/comma/parenthesis exceptions one witness at a time or claim that a finite oracle proves all program equivalence.
    ```vibe
    // Before formatting
    export function label() { return 'x' }
    ```
    ```vibe
    // After ordinary formatting
    export function label() {
      return "x"
    }
    ```
    Effect TS: these are the same native TypeScript function before/after formatting, returning the same string; its emitted layout and source-text reflection can differ. Decided by the agent from VIP-34's one formatter/native-tool parity, principle 1 (ordinary idiomatic formatting), principle 2 (TypeScript formatting/emission behavior), and principle 4 (one semantic contract rather than per-token exclusions), 2026-10-30. The exact-byte clause was an agent-derived overstatement, not a Will requirement; this corrects that derivation without adopting new language syntax/runtime APIs or permitting semantic codemods, so no Will question is needed. Reconcile `007-tooling.md`, the formatting guide and public VIP-34 under detail213, retaining detail174's map-correctness requirement.
    `root-formatter-observables-reference.log`/`.json` independently verify TypeScript5.9.3 with maps disabled: quote, redundant-grouping, trailing-comma and function-layout pairs all emit different bytes with equal ordinary reference values; function-layout reflection changes. Negative semantic controls distinguish tagged raw text and an escaped versus actual strict directive. The fixer's earlier frozen lane22 Vibe binary/dprint proofs remain attributed, not a fresh main formatter check. No VibeLang compiler/formatter run, source fix, all-options proof or main landing is claimed by decide-live.



    Status: applied in41f7056d05743fdfbf1256eae775258b77fef64c (spec-fix-d; verified and queued, not a main landing receipt). Canonical007, formatting guide and publicVIP34 preserve the complete meaning/type/diagnostic/directive/map contract with the explicit source-text boundary. General emit comparison now uses parsed ESTree/declaration structure;30 positive/negative Go controls pass via the spec gate, including raw-template, strict-directive, optional-chain, child-role and lone-surrogate controls. New3 docs guards fail actual main d0cdbe5a and all5 docs/map checks pass. Regen183/docs9/forms(no moved decisions)/spec pass. Retains the earlier exact-code inline-map control as a stronger finite case. Generalizes landed d8c6d703aae9's map-only distinction; no whole-program-equivalence or all-options proof is claimed.

### Detail 268

**Declaration sidecars stay beside source by default; a setting moves them to one directory, and migration setup picks it where code globs `*.ts`.** (spec agent, 2026-11-01, common sense and precedent; amends VIP-27's Location bullet with an opt-in, reversing nothing; raised by the Smithers migration: `.smithers/flows/test/coding-stable-plan.test.ts:57` lists `*.ts`, skips `*.d.ts`, and imports `coding/metered-steps.d.vibe.ts` as source.) Precedent: TypeScript writes declarations beside output unless `declarationDir` moves them, and `rootDirs` merges directories for resolution. Rule:
    - Default unchanged: `x.d.vibe.ts` beside `x.vibe` (VIP-27), zero configuration.
    - A `vibe.config.json` setting (named and placed by VIP-30's conventions) names one sidecar directory, conventionally `.vibe/declarations`; sidecars mirror the source tree under it, and setup adds it to tsconfig `rootDirs` (with `.`), so stock `tsc`, TypeDoc and editors still resolve `import "./x.vibe"` through `allowArbitraryExtensions`. The directory is hidden, so `*.ts` globs and `readdir` walks of source folders don't see it.
    - The migrate flow's setup scans tracked code for patterns that enumerate `*.ts` files (globs, `readdir`/`readdirSync` with a `.ts` filter, test runners' include lists) in a directory that will hold `.vibe` files, and turns the setting on when it finds one, recording why.
    - Tests: stock `tsc --noEmit` over a `.ts` consumer of `./x.vibe` passes in both modes; a fixture that dynamically imports every `*.ts` but `*.d.ts` in its directory passes with the setting; switching modes removes stale sidecars from the other location; LSP, bundler plugins and `vibelang --watch` find declarations in both; a fuzz/property test over random source trees checks that every `.vibe` gets exactly one sidecar in the chosen location and that resolution matches.

    **Migration coverage clarification (decide-live, existing every-tool and test-identity rule).** Sidecar location and source discovery are separate. Moving `x.d.vibe.ts` prevents a source-folder `*.ts` selector from importing that declaration, but an unchanged selector still does not select the renamed `x.vibe` implementation. Setup must preserve the original implementation/test identities through faithful discovery/loader wiring, or retain the affected source as TypeScript. A dynamic-import fixture that merely stops throwing, while testing zero renamed modules, does not satisfy the migration contract. Assert the same concrete implementation inventory and checks before/after; exclude sidecars rather than execute them. A hidden directory alone is not a universal guarantee that every recursive walker or explicitly configured glob excludes it.

    Three stock TypeScript5.9.3 controls establish only native declaration resolution: colocated sidecar passes; relocated without `rootDirs` fails `TS2307`; relocated mirrored tree with `rootDirs: [".", ".vibe/declarations"]` passes. Four native Node controls show the unchanged source selector sees `leaf.ts` originally, incorrectly sees `leaf.d.vibe.ts` when colocated, sees no file after relocation, and regains the original logical implementation ID only with an adapted implementation selector. These are bounded native counterparts, not VibeLang option/writer, runtime-loader, TypeDoc, LSP, watch,7.1 or delivered-fuzz conformance. Receipt: `sidecar-rootdirs-native-reference.json`. This clarifies existing coverage requirements; it does not allocate a new option name, diagnostic or numbered decision.

    - **Addendum to detail 268 (2026-11-01, from opencode-34): why the suffix is fixed, and the migration hazard.** The name `x.d.vibe.ts` is forced: TypeScript's `allowArbitraryExtensions` resolves `import "./x.vibe"` only through a declaration file named `x.d.vibe.ts` (the `.d.<ext>.ts` rule), so stock `tsc`, TypeDoc and editors need exactly that name. A consequence is that every `*.ts` glob matches a sidecar beside its source: opencode's test globbing `src/*.ts`, and ast-grep and lint rules scanning them twice. The spec text (VIP-27 amendment and chapter 7) states both facts, and the migrate flow treats any `*.ts` enumeration in a directory that will hold `.vibe` files as a known hazard, resolved by this detail's sidecar directory, not by per-tool `**/*.d.vibe.ts` ignores. Tests add an ast-grep/lint double-scan fixture beside the Smithers-shaped one.


    **Private migration-process qualification, detail272 (decide-live test-edit audit, 2026-11-01).** The discovery/loader preservation requirement above never authorizes changing target tests, test fixtures, snapshots or protected test-runner configuration to make a migration pass. Preserve the original test/implementation inventory through permitted product/source/export wiring, or retain the affected TypeScript closure. A test-owned literal selector is not rewritten. VibeLang repository regression/fuzz tests remain the explicit exception. This qualifies migration advice under268/271; it is not a new public language option, source-root rule or permission to weaken a test.

### Detail 281

**A declaration sidecar is an emit output and behaves exactly as `.d.ts` does; this replaces detail 280 entirely, its marker, backup folder, warning and conditions included.** (Will, 2026-10-31/11-01: "The correct answer is to do whatever typescript does if you do the same with .d.ts file." Recorded by the spec agent 2026-11-01T06:54:33Z. This also overrules the "no silent wrong results" framing for this case.) Evidence: effectscript-11 ran `tsc` 5.9.3 with a hand-written `main.d.ts` beside `main.ts` and `declaration` on, and the spec agent reproduced both shapes with the fork at main:
    ```text
    shape                 main.ts + main.d.ts (TypeScript)        main.vibe + main.d.vibe.ts at main
    found via include     exit 0, the source wins, overwritten    exit 0, overwritten                  (matches)
    listed in files       TS5055, exit 1, file untouched          exit 0, overwritten                  (gap)
    ```
    Rule: `x.d.vibe.ts` matches both. Found through `include`, the `.vibe` source wins, the sidecar leaves the program, and emit overwrites it silently. Listed explicitly in `files` with its source, emit reports `TS5055` "Cannot write file ... because it would overwrite input file", the compile exits 1, and the file stays untouched. No marker, no backup folder, no warning. The same holds in the `vibe.sidecarDir` directory (details 268, 271). The spec states that sidecars are emit outputs like `.d.ts`: VIP-27 amendment and chapter 7. Tests: a differential case that runs both shapes for `.ts`/`.d.ts` and `.vibe`/`.d.vibe.ts` and compares exit code, diagnostic code and on-disk bytes; a fuzz oracle over `files`/`include` shapes with the same comparison.

### Detail 296

**OPEN for the spec agent: does a written relative `./x.ts` resolve to `x.vibe` (or `x.vibex`) when `x.ts` no longer exists?** (Round 14 Opus OPUS-1 at frozen `b48c60e5ee9a`, 007:198; lane spec-fix-r14 under Will's 2026-11-02 fix-on-find instruction.) Compiler commit `9920b1a4e8a8` (foldkit-113) wrote into chapter 7: "A relative `./x.ts` that resolves to `x.vibe`, as an import written before `x.ts` became `x.vibe` does, is checked and emitted as it is for `x.ts`: `rewriteRelativeImportExtensions` rewrites it to `./x.js`, and a declaration keeps `./x.ts`." No VIP, decided detail or ruling approves that resolution: VIP-39's resolution table (copied at 007:136-143) has no `./App.ts` or `./App.tsx` row, stock `tsc` 5.9.3 tries `x.ts`, `x.tsx`, `x.d.ts` and then reports `TS2307`, and details 258 and 272 have migration rewrite consumers to name `./x.vibe`. spec-fix-r14 deleted the sentence; the linter `//:spec-lint` (rule `resolution-claims`) now rejects any "`./x.e` resolves to `x.f`" claim the resolution table does not list.

    **The compiler still does it.** On main the compiler resolves a written `./x.ts` to `x.vibe`, rewrites it to `./x.js` under `rewriteRelativeImportExtensions` and keeps `./x.ts` in declarations; `TestWrittenSpecifierMigratedTarget` (`typescript/tsc/internal/vibelangfuzz/written_specifier_target_test.go`) pins that behavior. This lane changed no compiler behavior.

    **To decide.** Either (a) approve the rule as a VIP-34/VIP-39 amendment and add `./App.ts` and `./App.tsx` rows to both resolution tables with their complete try order (by the `./App.js` pattern, `./App.ts`: `App.ts`, `App.tsx`, `App.vibe`, `App.vibex`, `App.d.ts`), stating whether `./x.ts` also reaches `x.vibex` and whether `./x.tsx` reaches `x.vibex` or `x.vibe`; or (b) retire the compiler behavior, so a stale `./x.ts` is `TS2307` as in `tsc` and migration rewrites the specifier as details 258 and 272 already require. Option (b) breaks programs that compile today (foldkit-113's `import { type Factory } from './target.ts'`), so ask Will before taking it.

    **296 compatibility disposition, decide-live, 2026-11-02.** Class B, OPEN through `pending-stale-ts-import-resolution` on the Mac monitor. Recommend B (explicit migrated-source naming), from TypeScript consistency and existing258/272, but the shipped fallback has an actual regression fixture and its removal needs Will under the standing breaking-change rule. This is a new finding after the lane's original2026-10-30 deadline; that expired deadline authorizes no retroactive breaking default. No automatic retirement applies; current compilation behavior stays until his answer. This is the agent's recommendation, not Will's answer.

    ```vibe
    import { Factory } from "./target.ts" // A: keep current fallback to target.vibe
    import { Factory } from "./target.vibe" // B: explicit migrated target, old name gets TS2307
    ```

    Effect TypeScript counterpart for B is the original explicit import naming an existing target.ts; the preserving migration changes only affected references to target.vibe and checks the same resolved module, declarations and runtime output. Retaining A would require an explicit VIP34/39 amendment and complete tested native-first lookup orders; it does not silently approve new .ts/.tsx-to-.vibex combinations. Current251 resolver source confirms .ts -> .vibe and the full TestWrittenSpecifierMigratedTarget matrix was read; no compiler or stock probe was executed by this lane. Source-only readings do not prove all proposed table cells. Keep this external item296 separately from decide-live's170owned105–295 records; it is not a new detail297.

    **Current disposition of detail 296 (2026-11-02, spec agent): DECIDED by Will, "Typescript already has rules for handling this based on tsconfig. For example if you nodenext you import .js" (WILL-ANSWERS.md, 2026-11-02).** Option B: resolution follows tsc's tsconfig-driven rules with `.vibe`/`.vibex` as source extensions beside `.ts`/`.tsx`. A stale `./x.ts` is TS2307. The fallback retires after the migrate codemod rewrites stale specifiers, with release notes. Lane resolve-like-tsc implements it.

### Detail 297

**RESOLVED by the November2 tooling/trust rulings, implementation pending; historical question: three configuration rules the compiler has with no VIP: the `compilerOptions.vibelang.declarationImportStyle` path, `vibelang.trustedPackages`, and `TS6046` for an invalid `declarationImportStyle`.** (Round 14 Opus OPUS-3 at frozen `b48c60e5ee9a`, 007:107; lane spec-fix-r14 under Will's 2026-11-02 fix-on-find instruction.) Compiler commit `04db4f250ebf` wrote into chapter 7: "Root `vibelang.declarationImportStyle`, or `compilerOptions.vibelang.declarationImportStyle`, is ... Any other value is a configuration error (`TS6046`). It sits in the legacy `vibelang` section with `trustedPackages` and `tracing`". Detail 263 approves one path, root `vibelang.declarationImportStyle`, and says "do not add a new canonical alias"; VIP-30 keeps VibeLang's options out of `compilerOptions` because "Plain `tsc` rejects unknown `compilerOptions` (TS5023)". No VIP, detail or ruling defines `trustedPackages` (only the non-normative history's D261) or `tracing`, which the compiler now rejects (release notes: "The compiler and TypeScript mapper now reject `tracing`"). spec-fix-r14 removed the second path, the two keys and the code from chapter 7, published the root key as the VIP-30 amendment detail 263 asks for, and added the linter rule `config-keys` to `//:spec-lint`.

    **The compiler still does it.** On main the compiler reads `compilerOptions.vibelang.declarationImportStyle` as well as the root key, reads `trustedPackages` from the legacy `vibelang` section (`internal/vibelang/trust.go`), and reports `TS6046` for an invalid `declarationImportStyle` value. This lane changed no compiler behavior.

    **To decide.** (1) Retire the `compilerOptions.vibelang.declarationImportStyle` path, or approve it as a VIP-30 amendment (it costs a `TS5023` from plain `tsc`). (2) Give `trustedPackages` a VIP or a migration out of the language. (3) Pick the code for an invalid `declarationImportStyle` value: VIP-30's `EK3007` covers only `vibe` keys, and chapter 7 now says only "a configuration error".


    **297 disposition, decide-live, 2026-11-02: one Class A clarification and two separate Class B compatibility questions.** The existing root path in detail263 stays canonical. The fact that a compiler accepts an additional legacy path or trust option is implementation evidence, not accepted public authority under213; neither finding authorizes immediate removal of compiling behavior.

    **297.3, Class A — retain `TS6046` for an invalid `vibelang.declarationImportStyle` value.** The supported enum remains `".js"`, `"extensionless"` and `".ts"`. The existing TypeScript option-validation diagnostic `TS6046` expresses “Argument for ... option must be ...”; keep that diagnostic for any supplied value outside the enum, including a wrong-typed value. Do not extend `EK3007` from the distinct modern `vibe` object to this legacy root option, allocate an unnecessary new code, silently accept an invalid value, or alter inheritance/recovery from this decision. Public VIP-30/config/declaration documentation must name the diagnostic explicitly under213.

    ```vibe
    // config: { "vibelang": { "declarationImportStyle": ".tsx" } }
    export { value } from "./value.vibe" // configuration is invalid: TS6046
    ```

    Effect TS counterpart: an invalid enum-valued compiler option such as `{ "compilerOptions": { "module": "not-a-module-kind" } }` uses TypeScript's `TS6046`; an accepted root declaration style still preserves the native declaration counterpart under263. This is code-selection/validation policy, not a claim that stock TypeScript implements the VibeLang setting. Decided by the agent from principle2 (mirror TypeScript compiler-option validation), principle4 (reuse the appropriate existing rule) and existing263/213, 2026-11-02 under Will's 2026-10-29 delegation. Source evidence at main2519454b6513: `internal/tsoptions/vibelang.go` validates the three values through `diagnostics.Argument_for_0_option_must_be_Colon_1`. No compiler or stock probe was run here.

    **297.1, Class B — legacy declaration-style alias, OPEN `pending-legacy-declaration-style-alias`.** Recommend B: migrate `compilerOptions.vibelang.declarationImportStyle` to root `vibelang.declarationImportStyle`, preserving JSONC comments, unrelated keys, precedence and effective inheritance, then retire the old path. A is a public compatibility amendment retaining the existing alias, with exact precedence/inheritance rather than a new canonical spelling. VIP-30 and263 settle the preferred location but do not authorize breaking a shipped accepted configuration. Existing legacy `diagnostics` paths retain their independently approved compatibility rule.

    ```vibe
    // A: retain compilerOptions.vibelang.declarationImportStyle as a legacy alias
    // B: preserving config migration to root vibelang.declarationImportStyle, then retire alias
    ```

    Effect TS counterpart: ordinary TypeScript options remain inside `compilerOptions`, while tool-specific top-level settings avoid an unknown compiler option. This does not claim plain TypeScript implements either VibeLang path. Agent recommendation from principles2/4 and263, not Will's answer. The original October30 deadline predates this finding; it is not an automatic breaking default. Current behavior remains until Will answers.

    **297.2, Class B — package trust, OPEN `pending-package-trust-retirement`.** Recommend B: retire user-configured package-wide `trustedPackages` through a reviewed preservation migration to actual foreign contracts and explicit approved Effect bridges. A is an explicit VIP retaining the option and fully specifying its globs, owning-project selection, imported/re-exported/returned callable behavior and exception semantics. Historical D261/D297 and current regression tests establish compatibility risk, not accepted current language authority. Fixed built-in Effect package handling is a separate rule and is not retired by this question.

    ```vibe
    effect function load(s: string) { return foreignParse(s) } // A: retain configured package trust
    effect function load(s: string) { return try Effect.try(() => foreignParse(s)) } // B: explicit foreign boundary
    ```

    Effect TS counterpart for the explicit boundary: `Effect.gen(function* () { return yield* Effect.try(() => foreignParse(s)) })`. That illustration may turn a legacy defect into a typed failure and is not a universally safe codemod. Preserve actual expected error/defect contracts, receiver identity, call/run phases and runtime/declaration behavior in any approved migration; where those cannot be proved, keep the old configuration/source until an authorized route exists. Source2519454b6513 `origins.go:isTrustedPackage` adds owner-project package-name globs to the fixed Effect package set; `trust.go` and `trust_test.go` retain the observed callable-trust paths. The source and historical D261 paragraph were read; no own compiler test was run. Agent recommendation from principles1/4/6 and VIP-4's explicit foreign bridges, not Will's answer. The expired October30 deadline cannot retire this shipped permission retroactively. Current behavior remains until his answer.

    Monitor receipt: two new asks added to the existing19-item Mac JSON list, yielding21; every original item is unchanged. Before SHA256 `0998de0f25923e8b95bada9120af5fcd1c8b3f913aa4ac0f443143f36ccfd827`; after `351578cf360fd8f1f67730744661581174866f5adcb2abb9c1024449f5e4982c`. No question was closed and no source, compiler, public API, commit, bookmark, queue or publication was changed by this disposition.

    **Detail 297 part 1 disposition (2026-11-02, spec agent, recording effectscript-11's decision; AGENT-DECISIONS.md 2026-11-02):** root `vibelang.declarationImportStyle` only. A codemod moves the `compilerOptions.vibelang` spelling to root, then the old path is a configuration error, with release notes. Grounds: detail 263, VIP-30 (TS5023). Part 2 (`trustedPackages`) stays open as before.

    **Superseding tooling disposition (2026-11-02T13:15Z, decide-live records the newer owner receipt):** Will, verbatim relayed by effectscript-11: "Yea no decision you just fit the pattern of how typescript already works as well as possible" (`loop/WILL-ANSWERS.md`). The newer `AGENT-DECISIONS.md` stops the root-only alias codemod before enqueue and assigns `declstyle-from-tsc` the native TypeScript5.9.3 matrix: written `./user.js`, `./user`, `./user.ts`, each module-resolution mode, with/without `rewriteRelativeImportExtensions` and `allowImportingTsExtensions`. Match the native `.ts`/`.tsx` twins for Vibe source extensions. If ordinary source spelling/configuration determines declaration spelling, the extra `declarationImportStyle` option goes away and the root-only codemod is moot; retain an option only for a concrete named example TypeScript cannot express. This supersedes the earlier root-only disposition, not the public-declaration preservation requirement277. Actual matrix/proof and preserving implementation remain the named owner's work, not completed here. Package trust (297part2) remains open.

    **Detail 297 part 2 disposition (2026-11-02, spec agent): DECIDED by Will (WILL-ANSWERS.md, 2026-11-02).** `trustedPackages` is removed. An npm package's functions follow the same rule as a local `.ts` file's: no `@throws` means it may throw unknown, and `@throws` means what it says. A tsconfig that still sets the key gets a deprecation warning and the key is ignored. Release notes list the calls it covered. Lane no-trusted-packages implements it.


    **Final native-matrix disposition cross-reference, decide-live, 2026-11-02.** The completed 384-cell TypeScript5.9.3 matrix and the newer amendment recorded under263 supersede the root-only alias/codemod and invalid-enum policies above. No named case requires `declarationImportStyle`: retire both legacy paths, ignore every value with a nonfatal deprecation warning, and derive declaration spelling from the actual native `.ts`/`.tsx` twin and its source/configuration. This also settles298; there are no two extra `.vibex` style choices left for Will. Source-sidecar identity remains its distinct approved compatibility route, and generated import types keep native preferences. Package-trust297.2 remains separately resolved by Will.

    The newly landed `5e496f0dc5ec` VIP-27/VIP-30/001/007 amendments cite the older263 policy and still advertise the root enum, invalid-value error and two undecided JSX styles. Those are stale public documentation awaiting reconciliation with the newer ruling; landing is not a Will override or permission to revive the option/question. The delivery owner's current composition is `f3b5982f` on930, with focused verification running and old9309 queue entry retained until a green replacement; this is attributed status, not a new landing or root execution. Owner report intro and complete non-matrix authority/validation sections were read, not every cell of its 566311-character table. Native matrix evidence and all failed/missing-runtime attempts remain retained. Existing263/297/298, Will's recorded TypeScript principle and277 settle the outcome; no new numbered detail, API choice, diagnostic allocation or monitor question.
