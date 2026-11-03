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

`.vibe` and `.vibex` are supported source extensions: `files` may list them, and `include`, `exclude` and the default `**/*` treat `.vibe` as they treat `.ts` and `.vibex` as they treat `.tsx` ([below](#vibex)). A compatibility sidecar is an emit output: discovery selects the source ahead of its sidecar, while an explicit `files` input keeps native overwrite protection (`TS5055`). The required sidecar write is independent of `noEmit` and `declaration: false` ([VIP-27](../vips/0027-declaration-output.md#decision), amended).

```json
{ "include": ["src"] }
```

This includes `src/user.vibe` without also checking its stale `src/user.d.vibe.ts`. With `vibe.sidecarDir`, a sidecar under that directory whose source exists at the mirrored path is left out the same way. So is a [module body](001-functions.md#module-declarations)'s declaration written beside a sidecar, such as `src/main.vibe.parse.d.ts`, while its source declares that body ([VIP-40](../vips/0040-module-declarations.md#emit-declarations-source-maps)).

Declaration sidecars are emit outputs like `.d.ts`. Under [VIP-27’s native overwrite amendment](../vips/0027-declaration-output.md#amendment-native-overwrite-protection-2026-11-02), a sidecar found through `include` yields to its source and emit may overwrite it. Listing both the source and its sidecar explicitly in `files` keeps the sidecar as an input: emit reports `TS5055`, exits `1`, and leaves its bytes untouched. The same rule applies in the `vibe.sidecarDir` directory.

A non-relative import reaching a known compatibility declaration uses its available mapped source only when TypeScript's final resolved path is outside `node_modules`. This includes package exports, `paths` and package `#imports`. Apply `realpath` and `preserveSymlinks` first; a retained logical dependency path keeps its declaration and native module identity. The rule also applies to the effective `sidecarDir` map ([VIP-27's dated amendment](../vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01)). Explicitly selected declarations remain inputs subject to the ordinary overwrite guard.

Compatibility declarations preserve the actual module selected by a source import. An explicit `./tag.vibe` remains that module even beside `tag.ts`, including re-exports and inferred import types, in either layout ([VIP-27](../vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01)).

Relative imports in relocated sidecars resolve from the actual output location, including references to native TypeScript modules and mirrored VibeLang declarations. Another project's checker does not inherit the producer's `rootDirs`. Workspace package imports use the owning config to keep a relocated sidecar and its source as one module; published packages retain declarations. Migration setup removes superseded adjacent outputs in the same layout change and preserves existing scalar path inheritance and virtual roots.

Sidecar placement follows TypeScript 5.9's declaration layout, with `vibe.sidecarDir` taking the place of `declarationDir`: an explicit `rootDir` supplies the source root, a composite project defaults to its config directory, and otherwise the root is the common source directory. An imported source outside the compiling config's directory is emitted by that compiling project, under its own `sidecarDir` if set or beside the source otherwise; its nearest config is irrelevant. An explicit `rootDir` that excludes the source reports `TS6059`. Through a project reference, only the owning project writes the source's sidecar under its own `sidecarDir`. Migration setup gives configs compiling outside sources their own `sidecarDir` unless references already keep those sources with their owner, and pairs the output directory with the source root in `rootDirs`. Config-relative mirrored-path examples assume `rootDir: "."`; root inference follows this rule.

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
| `vibe.sidecarDir` | Directory, default unset, that holds every declaration sidecar at its source's path relative to TypeScript's declaration source root (explicit `rootDir`, the config directory for a composite project, or the common source directory otherwise), instead of `x.d.vibe.ts` beside `x.vibe` ([VIP-27](../vips/0027-declaration-output.md#decision), amended). Conventionally `.vibe/declarations`; pair it with virtual roots for the source root and output directory, such as `"rootDirs": [".", ".vibe/declarations"]` with `rootDir: "."` so stock TypeScript resolves `./x.vibe`. A relative path resolves from the config that declares it; a leading `${configDir}` from the selected config. An empty string names the declaring directory and overrides an inherited path; only an absent entry inherits. Wrong types report `EK3007`. |
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

The retired `trustedPackages` key is ignored in `vibe` and every supported legacy section (VIP-4, amended 2026-11-02), with warning `EK3010`. Remove it: npm functions follow the same foreign-callable contract as local TypeScript, including `unknown` when no `@throws` is written; use a signature contract or an explicit `Effect.try` bridge. Module resolution follows TypeScript's tsconfig-driven rules, with `.vibe` and `.vibex` as source extensions beside `.ts` and `.tsx`: under NodeNext `./user.js` resolves to `user.vibe`, and a written `./x.ts` keeps TypeScript's native source and declaration substitutions, including `x.tsx` and `x.d.ts`, but does not fall back to `x.vibe` or `x.vibex`. If no native candidate resolves, it is `TS2307`. Migration never writes `moduleSuffixes`.

Written relative `./x.vibe` and `./x.vibex` specifiers follow the `.ts`/`.tsx` twin's source-extension checks under the same tsconfig, including `TS5097` for a value import when neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` is enabled. Native restrictions on those options still apply. `rewriteRelativeImportExtensions` rewrites JavaScript specifiers, not declaration specifiers ([VIP-27](../vips/0027-declaration-output.md#decision)).

A stale relative `.ts` name for a module migrated to `.vibe` or `.vibex` is `TS2307` under the rule above. `vibelang --fix` rewrites it in the selected project's own VibeLang sources to the name the project's import policy uses: `.vibe` or `.vibex` with `rewriteRelativeImportExtensions`, otherwise the runtime output `.js` (`.jsx` for a JSX-preserving target). A rewrite that can't preserve types, behavior and declaration output refuses at that site, and an unresolved name without a migrated sibling stays unresolved.

### Declaration import spelling

Declaration import spelling follows TypeScript's source and tsconfig rules ([Declaration output](001-functions.md#declaration-output)). `declarationImportStyle` is retired: root `vibelang.declarationImportStyle` and `compilerOptions.vibelang.declarationImportStyle` are ignored with nonfatal deprecation warning `EK3011` for every value, including invalid values (VIP-30, amended). No replacement option or spelling codemod is needed.

A published package carries JavaScript and ordinary `.d.ts` files. Compatibility `*.d.vibe.ts` and `*.d.vibex.ts` sidecars serve source tools and do not ship; published type exports point at the build’s ordinary declarations.

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

`vibelang --fix` moves each eligible map to root `vibe.severities`, including in extended configs inside the repository, preserving JSONC comments, unrelated settings and existing modern entries; an extended config under `node_modules` is reported, not edited. It also removes the retired `declarationSidecars` setting from those owned configs. A rewrite that can't preserve types, behavior and declaration output refuses at that site. A map containing obsolete or nonconfigurable codes remains in place until those entries are resolved. Plain `tsc` ignores the custom root keys, but reports `TS5023` for `compilerOptions.vibelang`; VibeLang's legacy compatibility does not change that.

<a id="vibex"></a>

## JSX source files: `.vibex`

A `.vibex` file is a `.vibe` file read with TypeScript's JSX language variant ([VIP-39](../vips/0039-vibex.md)). Every JSX production, and its scanning, checking and emit, is `.tsx`'s; every VibeLang production is `.vibe`'s; where they compete for `<` in expression position, `.tsx`'s reading wins. The source-visible differences from `.vibe` are VIP-39's clash rows 1–5 and 39: write `x as T` for `<T>x`, `<T,>` for a generic arrow (`effect <T,>`, `async <T,>`, `catch <E,>`), and a space in `a < /re/`.

The `jsx` options and pragmas mean what they mean for `.tsx`, read through the configuration discovery above. A project without `jsx` gets `TS17004` at an element and `TS6142` at an import of a `.vibex` file. Under `react`, `react-jsx` and `react-jsxdev`, TypeScript transforms the element; under `preserve` and `react-native` the element stays in the output for the framework's compiler.

Relative specifiers resolve as follows, after TypeScript's `exports`, `imports`, `paths`, `moduleSuffixes` and resolution-mode rules select a lookup; NodeNext still requires extensions where `.ts` and `.tsx` do:

| Specifier | Tries, in order |
| --- | --- |
| `./App`, `./App.js` | `App.ts`, `App.tsx`, `App.vibe`, `App.vibex`, `App.d.ts`, then JavaScript |
| `./App.jsx` | `App.tsx`, `App.ts`, `App.vibex`, `App.vibe`, `App.d.ts`, `App.jsx`, `App.js` |
| `./App.vibe` | `App.vibe`, `App.vibex`, `App.d.ts` |
| `./App.vibex` | `App.vibex`, `App.vibe`, `App.d.ts` |

## TypeScript spellings with VibeLang forms

These built-in warnings suggest an accepted VibeLang form without changing the meaning of TypeScript-style source. They are warnings by default and use `vibe.severities`, independently of the imported Effect lint table. A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix. A warning does not itself rewrite code, and a warning-only run exits zero. Untagged `Data.Error` has no equivalent tagged declaration: keep its library form rather than adding a tag. An unsupported legacy repair is retired, rather than treated as a language requirement.

In the `EK4834`, `EK4835` and `EK4836` rows, the call is the direct operand of bare `try` in effect code. Parentheses and erased TypeScript expression forms (`as`, `satisfies`, `!`) around it still leave it the direct operand; the call is recognized by its resolved symbol, so an import alias counts and a local binding that shadows `Effect` does not. An operand of `fork` in any form, of `join`, of `try.all`, `try.race`, `try.any` or `try.allSettled` or one of its elements, an argument of an Effect API, the head of a `catch`, and a stored or returned Effect are not direct operands, and these rows do not warn on them: `fork Effect.catch(e, h)` keeps recovery in the child ([`fork` and `join`](002-running.md#fork-and-join)), and `fork Effect.fail(e)` fails the child, not the caller.

| Code | Trigger | Repair |
| --- | --- | --- |
| `EK4830` | A class written with `Data.TaggedError("Name")` | Use `error Name { … }` only when its tag and class behavior are preserved. |
| `EK4831` | A class written with `Context.Service` | Use `service Name { … }`, preserving the key with `static readonly key`. |
| `EK4832` | A `const` holding `Schema.Struct({ … })` | Use `schema Name { … }` where the field mapping and associated type are preserved. In a declaration-emitting project, preserve an own type written as `Schema.Schema.Type<typeof Name>`, private or exported, because a `schema` declaration prints `typeof Name.Type`. |
| `EK4833` | A written `Effect.Effect<A, E, R>` type, except an interface's `extends` element, which `A!E!R` cannot spell | Use the equivalent `A!E!R` spelling, preserving `never` slots and required parentheses. |
| `EK4834` | `Effect.succeed(v)` or `Effect.fail(e)` as the direct operand of bare `try` in effect code | Use the value `v` or `throw e`. |
| `EK4835` | `Effect.catch`, `Effect.catchTag`, or `Effect.catchTags` as the direct operand of bare `try` in effect code | Use a `catch effect` handler, with `match` on the failure for tag cases and a typed `throw` for unmatched failures. |
| `EK4836` | `Effect.provide` or `Effect.provideService` as the direct operand of bare `try` in effect code | Use a `provide` statement with Layers or `Key = value`, preserving operand evaluation order. |
| `EK4837` | A class written with `Schema.TaggedError` | Use `schema error Name { … }` when the schema and tag are preserved; an ordinary `error` would lose the schema. |
| `EK4839` | An Effect `Match` chain with a supported finisher, or a direct `Option.match(value, handlers)` call | Use `match`, or a function returning `match` for `Match.type`, only for patterns and handlers whose tests and results are preserved. Direct `Option.match` keeps subject evaluation, handler construction, property reads and the selected callback in their original order. The fix refuses a choice returning a program or comments between its arguments; `Match` chains also keep refusals for unsupported patterns, handlers or return types. |
| `EK4841` | A schema `const` immediately followed by its matching `typeof Name.Type` alias | Use the corresponding `schema Name = …` declaration where the schema mapping preserves both exports. |
| `EK4842` | An Effect module imported under a conflicting JavaScript global name | Rename that import and its resolved uses, such as `Array as Arr`, only where emitted public types keep their meaning. |

The `EK4833` advisory treats a custom qualified alias named `Effect` as an equivalent spelling only when its resolved type is Effect's own `Effect` interface and its written arguments match that type's success, error and requirements slots. An omitted slot must resolve to `never`. An exact forwarding alias may qualify; aliases whose parameter order, defaults, wrapped slots, added requirements or union branches would change the repaired type retain their spelling without this advisory.

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

Only the first line of `demo` warns. The other three run their Effect in a child fiber or as an element, where the suggested form would change meaning: a `throw` in place of `fork Effect.fail("boom")` would fail `demo` itself, while the child's failure lets `demo` go on and inspect it.

```vibe es
// compiler-gap: pending VIP-34
effect function demo(e: number!string, h: (x: string) => number!!) {
  const one = try Effect.succeed(1)              // EK4834
  const child = fork Effect.catch(e, h)          // no EK4835: recovery stays in the child
  const failedChild = fork Effect.fail("boom")   // no EK4834: it fails the child, not demo
  const both = try.all [Effect.succeed(one), e]  // no EK4834 on an element
  return [child, failedChild, both]
}
```

```ts effect
// TypeScript-form advisory reference
import { Effect } from "effect"
function demo(e: Effect.Effect<number, string>, h: (x: string) => Effect.Effect<number>) {
  return Effect.gen(function* () {
    const one = yield* Effect.succeed(1)
    const child = yield* Effect.forkChild(Effect.catch(e, h))
    const failedChild = yield* Effect.forkChild(Effect.fail("boom"))
    const both = yield* Effect.all([Effect.succeed(one), e], { concurrency: "unbounded" })
    return [child, failedChild, both]
  })
}
```

## The Effect version

During alpha, VibeLang pins exactly one Effect version, and the pin moves to each new Effect release. The pinned dependency artifact is exactly `effect@4.1.1`; the `4.1` minimum means the pin never moves below `4.1`, not that other `4.1.x` versions are supported (VIP-32, amended). Every Effect TypeScript mapping in this specification, and the `Exit` guarantee of [Runtime guarantees](008-runtime.md), is relative to the pin. The pin controls variables during alpha; it is not the long-term plan, and supported version ranges get their own VIP after alpha.

A migration upgrades the target repository to the pinned Effect first, on its own: it fixes what breaks and lands that commit with green tests. Only then does it convert files to `.vibe`, so each breakage shows its real cause. A repository that already uses VibeLang upgrades Effect together with the VibeLang release pinned to the new Effect, because the published `vibelang-runtime` enforces its exact pin.

VibeLang declares an exact `effect` peer dependency. The compiler reads the resolved `effect/package.json`; any version other than `4.1.1`, including `4.1.0`, is `EK3201` in the CLI and editor ([VIP-32](../vips/0032-effect-version.md#decision)). For example, resolving `effect@4.0.3` reports: `the resolved effect is 4.0.3; VibeLang Y pins 4.1.1: upgrade both together`, where `Y` is the VibeLang release.

## Compiler and tooling requirements

1. **Diagnostics.** Every VibeLang diagnostic has a code (`EKxxxx`) and a message in the user's words that says what is wrong and how to fix it, with a quick fix wherever the fix is mechanical. Quick fixes and codemods use the formatter to preserve the parse under Appendix A. [Appendix B](900-appendices.md#appendix-b-diagnostics) lists the codes. TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types. A rejection that depends on a VibeLang production, placement rule, proposal-specific early error or explicitly adopted reconciliation uses its owning VIP's `EK` code, even when a TypeScript parser helper implements it. Use an already assigned specific diagnostic for the same rejection; preserve independent native errors. A compilation whose emitted JavaScript imports `vibelang-runtime` and cannot resolve that package fails with one error naming it, TypeScript's `TS2307` for a missing module, as a missing dependency fails in TypeScript; it never reports the compiler-generated helpers the package provides as unresolved names.
2. **Codemods.** Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically. One `vibelang --fix` run applies fixes until none applies; running it again changes nothing. A run that has not converged within its pass limit reports the remaining fixes as an error. A `--fix` run writes only the selected project's own files: its `.vibe` and `.vibex` sources in the TypeScript program, including an owned source an import reaches even when `exclude` omits it from root discovery, and its own configuration files for the named legacy-severity and retired-`declarationSidecars` codemods. Config `extends` traversal stays inside the repository and outside `node_modules`. It never rewrites dependencies, sources resolved from `typeRoots` or bundled libraries, foreign `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` or `.cjs` sources, declaration files (`.d.ts`, `.d.vibe.ts`, `.d.vibex.ts`), emitted output, `tsBuildInfoFile`, lock files or another referenced project's files; with `-b`, each project fixes its own files in build order. The platform repair alone may create a fresh sibling `.ts` module after proving preservation of run phase, captures, receiver and public types; it never overwrites an existing file. A repair requiring any other write gives the not-fixed explanation and changes nothing ([VIP-34](../vips/0034-compiler-and-tooling.md#decision), amended). For example, a trailing block ([VIP-11](../vips/0011-trailing-blocks-denied.md)) is `EK1101`, and its codemod writes the block as the call's last argument in the spelling of what it ran as: `Layer.effect(Users) { … }` becomes `Layer.effect(Users, effect { … })`, `it.effect("loads") { … }` becomes `it.effect("loads", effect () => { … })`, and a block passed as a plain callback becomes `() => { … }`. The rewrite preserves runtime behavior. A rewrite that can't preserve types, behavior and declaration output refuses at that site (VIP-34). Its kind and argument position come from the pinned legacy source, compiler and options, never from the callee's parameter type alone. Comments stay in the source, though their printed placement and equivalent arrow layout can differ; a comment between the call and its block makes the fix refuse the site. A versioned Effect-dual migration runs first: it retains its native call error (`TS2345`, `TS2554` or `TS2769`), or transitional `EK1023` when the appended call type-checks with changed meaning, without a duplicate `EK1101`, and preserves the original data-first or curried argument position ([VIP-11](../vips/0011-trailing-blocks-denied.md#amendments)). Ordinary parsing uses TypeScript's statement boundaries and recovery; private compatibility decoding supplies diagnosis and migration only, never a callback to execute. `EK1101` suppresses only a redundant missing-separator `TS1005` for the identical rejection; independent native errors remain. A line break before the block, an optional chain, a heritage clause, and the providers of a `provide` block are outside this form.
3. **One formatter.** VibeLang's formatter is the only formatter. Prettier, dprint and Oxfmt reach it through plugins, so a repository's existing formatter command covers `.vibe` files. It takes the repository's quote style and print width from that formatter's configuration, so `.vibe` and `.ts` files share them. It preserves the `provide` line restrictions ([VIP-12](../vips/0012-provide.md)): never break after `provide`, before or after a provider-separating comma, or before the block’s `{`. A long provider list stays on one line. The formatter neither introduces nor removes `Layer.mergeAll(…)`; an author who writes it may break lines between its arguments ([example](005-services.md#syntax)). It preserves every line-sensitive and parenthesis-sensitive rule in [Appendix A](900-appendices.md#appendix-a-grammar): never insert or remove a line break or parentheses that change the parse. Its tests cover each such rule, including contextual keywords, Effect type slots, bodyless errors, field and variant separators, statement boundaries, `catch` arrows and `for concurrent` heads and bodies. Under the same compiler/options, formatting preserves parsed program meaning: bindings and scopes, operator and control-flow targets, evaluation order, receivers and call syntax, ordinary runtime values and effects, coldness, failures, interruption and finalizers. It preserves inferred and declared public types, declarations and throws contracts, and diagnostic codes, categories and occurrences; diagnostic locations and quoted source follow the formatted file. Comments and their code associations survive, including JSDoc, compiler/linter/tool directives and directive-prologue meaning. An unparsable file is reported and left unchanged; formatting is idempotent. Semantic migrations and diagnostic repairs belong to `vibelang --fix` or editor actions.

   Ordinary layout and lexical-spelling normalization may change emitted JavaScript bytes. `Function.prototype.toString`, generated source text, source offsets, line/column and stack presentation may reflect the formatted text. This source-text boundary never permits changes to ordinary strings/data, tagged-template raw or cooked values, regex meaning, function names or lengths, property names or directive semantics. For example, changing an escaped string into an actual `use strict` directive changes meaning. Regenerate compiler-generated source-map and declaration-map provenance, including `sourcesContent`, for the formatted file; never retain stale maps. Preservation tests compare parsed source/emit structure, runtime behavior, types/declarations, diagnostics, comments/directives and maps; arbitrary regex stripping is unsound, and a finite structural oracle is not a proof of all program equivalence. Exact-byte tests remain useful where equality is expected, without restricting advertised native formatter style settings.
4. **Existing tools work.** Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`. A repository's Oxlint JS-plugin rules run on `.vibe` files wherever the rule applies to the source or emitted forms. Every tool is tested against the dogfood repositories. The language server also resolves `./x.vibe` to the source whenever it is in the program, ignoring its stale `x.d.vibe.ts` beside it or under `vibe.sidecarDir`.
5. **Emit names.** `x.vibe` emits `x.js` beside `x.d.ts` in `outDir`; JavaScript output rewrites relative `./x.vibe` specifiers to `./x.js`. Ordinary package declarations use the native twin’s relative specifiers: `./user.vibe` is declared as `./user.ts` and `./App.vibex` as `./App.tsx`; written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling. Synthesized import types use TypeScript’s spelling for the twin under the same imports and tsconfig. Compatibility sidecars instead keep VibeLang source references such as `./user.vibe` and `./App.vibex`, relocated to the selected compatibility declaration when necessary, to preserve source identity. Neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` rewrites declaration specifiers; JavaScript output rewriting is separate. See [Declaration output](001-functions.md#declaration-output) (VIP-27, amended). `x.vibex` emits `x.jsx` under `"jsx": "preserve"` and `x.js` otherwise, as `x.tsx` does, and a relative `./x.vibex` specifier becomes the target file's actual output name (VIP-39). Bundler plugins use the same names ([VIP-34](../vips/0034-compiler-and-tooling.md#decision)). The `.d.vibe.ts` compatibility route above remains for tools reading `.vibe` specifiers.
6. **Severities.** Only VibeLang's own warning codes and all imported `EK38xx` lint codes can be configured in `vibe.severities`. Entries for VibeLang's own error codes, interim `EK92xx` codes or unknown codes are config errors (`EK3006`), even if the requested severity is `"error"`.

The transitional compiler also emits four migration warnings: `EK4853` writes previously inferred requirements explicitly under VIP-3; `EK4854` changes the retired abstract-class service spelling to `service`; `EK4855` changes a service's `default` value to a `defaultValue` factory under VIP-9; and `EK4856` replaces a use of the retired global `Effect<A, E, R>` alias with `A!E!R` where that needs no new parentheses, and with qualified `Effect.Effect<A, E, R>` otherwise, heritage elements included, under VIP-3. Migration error `EK4857` retires written `infer` slots in Effect return annotations: write the inferred types, or omit the annotation when every slot is `infer`, preserving declaration types under the safe-fix checks (VIP-3, amended). Their [compatibility inventory](900-appendices.md#transitional-compiler-diagnostics) records the emitted codes. `vibelang --fix` keeps the existing safe-fix checks and refusal rules. These repairs do not run Effects or change the normative omitted-slot and service semantics.

The `EK4856` transition selects the resolved legacy symbol, never the identifier spelling: a local or imported type named `Effect` retains its TypeScript meaning. Existing parentheses and written default slots stay, and the fix is refused where it cannot keep the `Effect` namespace binding ([VIP-3](../vips/0003-effect-type-shorthand.md#decision), amended). A rewrite that can't preserve types, behavior and declaration output refuses at that site; emitted declarations already print `Effect.Effect<…>` and do not change. The alias is removed only in a coordinated release of compiler, codemod and docs. Afterwards, module-only `Effect<number>` is native `TS2709`; an unbound name follows ordinary TypeScript resolution ([VIP-3](../vips/0003-effect-type-shorthand.md#decision), amended).

**Formatting** preserves program meaning and contracts, not emitted bytes: bindings, evaluation order, receivers, runtime effects, failures and finalizers. Source maps are regenerated to describe the formatted source.

**Migration.** `vibelang --fix` rewrites each retired form to its VIP form or to the native Effect TypeScript it means; the sections below name each form's diagnostic and rewrite. The legacy `fork(program, options)` call becomes `try Effect.forkChild(program, options)`. A rewrite that can't preserve types, behavior and declaration output refuses at that site ([VIP-34](../vips/0034-compiler-and-tooling.md#decision)). The user guide's *Migrating retired forms* page describes how the rewrites work; it is not normative.

### Ordinary mutable-marker migration

`EK3410` reports a retired `mutable` marker on an ordinary interface or object-type property or index signature, or on a plain `error` payload. `vibelang --fix`, including `--fix-migration-only`, removes the redundant member marker and rewrites a marked plain `error` payload to an explicit compatibility class using the existing runtime error factory, which keeps tagged matching. A rewrite that can't preserve types, behavior and declaration output refuses at that site. Schema fields, schema errors, schema tuples and `data` bodies use their separate rules. A method or identifier named `mutable` keeps its TypeScript meaning.

The rejection applies once the preserving codemods ship and all migration repositories have zero remaining accepted uses. This specifies the retirement target; it does not claim the held rejection implementation or consumer migration is complete.

### Legacy data receiver methods

At the retirement target, `EK1402` is an error for a legacy Effect data receiver method, such as `Option.some(1).map(f)`. `vibelang --fix`, including `--fix-migration-only`, rewrites it to the resolved module's data-first function: `Option.map(Option.some(1), f)`. A rewrite that can't preserve types, behavior and declaration output refuses at that site. Native/own methods, namespace calls, computed access and optional chains are not this form. This specifies the retirement target; enforcement waits for the preserving codemod to ship and migration repositories to have zero remaining uses. It does not specify an interim diagnostic or claim that the held rejection implementation or consumer migration is complete.

### Legacy prelude shorthand

The transitional compiler accepts the two legacy shorthands below with no migration diagnostic; the migration is selected by its resolved legacy binding. This is temporary compatibility, not a VIP-14 namespace rule. Remove that compatibility only in a coordinated compiler/codemod/docs release after the preserving migrations ship and migration repositories have zero remaining uses. Afterwards, using a module namespace as a type, such as bare `Scope` or `Option<A>`, reports native `TS2709`; looking up a member absent from that namespace, such as `FileSystem.of`, reports native `TS2339`. These are TypeScript's errors on the equivalent explicit namespace imports, not newly allocated `EK` codes. The [transitional inventory](900-appendices.md#transitional-compiler-diagnostics) records the diagnostic-free compatibility.

For a legacy bare prelude `Scope` type, `vibelang --fix` writes `Scope.Scope`; `--fix-migration-only` and `--fix-vip-only` apply this migration too. A written import, local or ambient type, or type parameter named `Scope` keeps its TypeScript meaning. Prelude cleanup retains the qualified namespace type.

`--fix`, including `--fix-vip-only` and `--fix-migration-only`, expands the retired same-named module-export shorthand using the resolved binding: `Option<A>` becomes `Option.Option<A>`, and `FileSystem.of(impl)` becomes `FileSystem.FileSystem.of(impl)`. VIP-14 supplies module namespaces; a local type, an ambient type, an already qualified export and a namespace's own member keep their meaning. Prelude import cleanup retains these explicit export names. For both shorthands, a rewrite that can't preserve types, behavior and declaration output refuses at that site.

### Legacy fork, try-statement and wire migration

A bare `fork { … }` block is `EK1707`. `vibelang --fix` rewrites it to `fork effect { … }` (VIP-2 and VIP-17); explicit Effect operands are unchanged.

A `try` statement in effect code is `EK0503`. `vibelang --fix` rewrites its catches and finalizers to explicit Effects, `catch effect` and native cleanup combinators under VIP-5.

The resolved retired `wire` intrinsic is `EK2401`. `vibelang --fix` rewrites it to explicit `Layer.provideMerge` composition under VIP-24. An unrelated local function named `wire` keeps its TypeScript meaning.

For each of the three, a rewrite that can't preserve types, behavior and declaration output refuses at that site. The held enforcement changes still require landed codemods and zero remaining uses in every migration repository. The spec does not wait for those code receipts.

### Empty legacy trust wrappers

The resolved `trusted(f, [])` runtime wrapper is retired with `EK0407`. `vibelang --fix` rewrites each private direct synchronous call in an explicit Effect body to an identity-mapped `Effect.try` and `Effect.orDie` bridge over `f`, captured at the original declaration. A rewrite that can't preserve types, behavior and declaration output refuses at that site. A reviewed `.ts` helper with `@throws {never}` is another replacement. Listed-failure wrappers are outside this migration.

### Legacy entry-dispatch migration

The side-effect imports `vibelang/platform/node`, `vibelang/platform/bun` and `vibelang/platform/browser` are retired compiler-only entry markers, including in a module without `main`: `EK2601`, `legacy platform entry marker: run vibelang --fix and write an explicit runner`. The migration input is a marked module, not an ordinary exported `main` without a marker. An eligible legacy startup is an exported, non-default, zero-parameter function declaration `main` with a body, without a checker-resolved top-level runner call under the pinned legacy compiler and options. A marked module without an eligible startup has no startup to expand: `vibelang --fix` removes its inert marker and keeps any existing explicit runner unchanged.

For an eligible startup, `vibelang --fix` writes an explicit Effect platform runner call and removes the marker. The `node` marker selects `NodeRuntime.runMain` from `@effect/platform-node/NodeRuntime`; `bun` selects that same runner, with `BunServices.layer` from `@effect/platform-bun/BunServices` when the legacy compiler selected it; `browser` selects `BrowserRuntime.runMain` from `@effect/platform-browser/BrowserRuntime`. Preserve the layers the pinned legacy compiler actually selected: `NodeServices.layer`, `BunServices.layer` or `BrowserServices.layer`, the selected experimental layers and their nesting order. A marker does not by itself add a layer. The runner receives `main()` for a legacy Effect function and `Effect.sync(main)` otherwise, keeping the declaration's callable kind and public types.

A rewrite that can't preserve types, behavior and declaration output refuses at that site. In particular, preserve entry-only execution and import-only behavior; refuse an unavailable selected runner or layer, or an entry test that cannot be expressed in admitted source. CommonJS does not authorize retaining the retired runtime entry dispatcher, and an ESM rewrite cannot introduce the forbidden `import.meta.main` read. If either needs such a form to preserve startup, leave the marker unchanged and report its file, line and reason as not fixed, with a nonzero exit. No retired runtime dispatcher or fallback runner is a migration target. A remaining marker still reports `EK2601`. A function named `main` alone remains ordinary source and gets no entry diagnostic, and current compilation emits no implicit startup ([VIP-26](../vips/0026-top-level-and-main.md#decision), [VIP-34](../vips/0034-compiler-and-tooling.md#decision)).

### Selecting ordinary fix files

`--only <files>` limits ordinary `--fix` to the listed modules ([VIP-34, amended](../vips/0034-compiler-and-tooling.md#decision)). `<files>` is a comma-separated list of paths relative to the current directory, or `@list.txt`, a file of such paths, one per line; the flag can repeat. An empty list, or a path that is not a `.vibe` or `.vibex` module of the project, stops the invocation before it writes anything. The repairs write no other file, a config included, even when they are interrupted; the compilation after them still writes what any compilation writes, such as declaration sidecars. A fix that would edit another file is not applied. Only an error in a listed module refuses a fix: a fix that breaks an unlisted module is kept, and the compilation after `--fix` reports the error. The result is a partial repair and its report says so: a clean run does not verify the project. `--only` cannot be combined with `--fix-migration-only` or `--fix-vip-only`, because a project-wide migration changes what other modules mean. Alone, it is an unknown compiler option (`TS5023`).

```sh
vibelang --fix --only src/a.vibe,src/b.vibe -p tsconfig.json
vibelang --fix --only @batch.txt -p tsconfig.json
vibelang --only src/a.vibe # TS5023: add --fix
```

## Effect's type-aware lint

```sh
vibelang lint -p tsconfig.json
```

The Effect language service's type-aware rules (effect-tsgo's `effecttsgo/*` rules) run inside the `vibelang` compiler on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions. VibeLang-specific language checks remain confined to `.vibe`. They run wherever VibeLang reports diagnostics: the CLI, the language server, and `vibelang lint` for CI (VIP-38, amended). A repository's existing Effect language-service configuration selects and configures them, so its lint script covers `.vibe` as it covers `.ts`. The lint command emits no files and uses the same configuration and diagnostic categories as the compiler and language server; it has no Effect TypeScript runtime translation.

In compiler builds and the language server, the resolved `compilerOptions.plugins` entry named `@effect/language-service` activates the imported rules. Read that entry, inherited configuration, native disable settings and file eligibility as the pinned upstream does; `diagnostics: false` or `diagnosticSeverity: null` disables its diagnostics. A `vibe.severities` entry alone does not activate the plugin or re-enable disabled diagnostics. Once the plugin's diagnostics are enabled, the severity order below applies; an override may enable a default-off rule. The explicit `vibelang lint` command retains its existing runner behavior ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)).

The pinned plugin defaults are `diagnostics: true`, `includeSuggestionsInTsc: true`, `ignoreEffectWarningsInTscExitCode: false`, `ignoreEffectErrorsInTscExitCode: false` and `ignoreEffectSuggestionsInTscExitCode: true`. A severity override changes a rule's category, leaving these native print, exit and emit settings in force. Before retiring the implementation's implicit activation from imported severity keys, migration must write an equivalent normal plugin entry for projects relying on it, preserving explicit disable settings and existing diagnostic, exit and emit behavior (VIP-38, amended).

Each imported `effecttsgo/*` rule gets one stable `EK38xx` code, in a normative table generated from the pinned effect-tsgo version ([Imported lint codes](900-appendices.md#imported-lint-codes)); a VIP-32 bump regenerates the table, and a rule's code never changes once assigned ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)). The CLI and language server print that code with the rule name in the message: `EK3801 floatingEffect: …`. A rule's severity resolves in this order, the more specific winning, as a tsconfig child overrides its base: an entry for its code in `vibe.severities`; else the repository's Effect language-service configuration; else the rule's default. Every `EK38xx` code is a lint code and may be set to any value, `"off"` included: VIP-34's "errors can't be off" covers VibeLang's own rules.

```json
{ "compilerOptions": { "plugins": [{ "name": "@effect/language-service" }] }, "vibe": { "severities": { "EK3801": "warning" } } }
```

An `effect { … }` expression statement builds an Effect and discards it without running it ([Effect blocks](002-running.md#effect-blocks)). The imported `floatingEffect` rule reports it under its `EK38xx` code, just as it reports a discarded Effect in TypeScript.

These are VibeLang’s own configurable warnings, distinct from the imported `EK38xx` rules; they already have decided codes and preserve the underlying TypeScript behavior ([Running Effects](002-running.md)):

| Warning | Code | Suggested fix |
| --- | --- | --- |
| A plain `catch` handler returns an unrun Effect ([VIP-5](../vips/0005-try-runs-effects.md#decision)) | `EK0508` | `catch effect (e) => try …` |
| A plain call in effect code infers an Effect type argument outside a declared Effect position ([Inferred Effect arguments](002-running.md#inferred-effect-arguments); [VIP-1, amended](../vips/0001-effect-and-async-functions.md#amendment-inferred-effect-arguments-2026-11-03)) | `EK4802` | The editor offers `try` for a direct Effect-valued argument when its written failure and requirement contract accepts it, or explicit type arguments to keep the program. Batch `--fix` chooses only `try` and refuses an edit that adds an error. |
| An `effect` function returns an Effect value unrun, so its caller gets the program instead of its result ([VIP-1](../vips/0001-effect-and-async-functions.md), [VIP-5](../vips/0005-try-runs-effects.md#decision)) | `EK4802` | `return try e`; no automatic fix in ordinary `--fix` |
| A legacy severity map remains in the config | `EK3009` | Run `vibelang --fix` after resolving obsolete entries. |
| The retired `trustedPackages` key is ignored ([VIP-4](../vips/0004-throw.md), amended 2026-11-02) | `EK3010` | Remove the key; npm functions follow the ordinary foreign-callable contract. |
| A retired `declarationImportStyle` setting is ignored, for every value ([VIP-30](../vips/0030-config-files.md)) | `EK3011` | Remove the setting; declaration spelling follows the native TypeScript twin. |
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

`vibelang lint` accepts the compiler’s options, including `-p`/`--project` and file arguments, with no lint-specific options; for example, `vibelang lint --project tsconfig.json` selects that project ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)). `vibelang --fix` remains the codemod entry point. Two flags scope that invocation ([VIP-34, amended](../vips/0034-compiler-and-tooling.md#decision)):

| Flag | Scope when used with `--fix` |
| --- | --- |
| `--fix-migration-only` | Migration fixes, excluding TypeScript-form teaching rewrites and prelude/import cleanup. |
| `--fix-vip-only` | The existing VIP migration passes, including the VIP-1/VIP-2 function-kind and `try` migration, excluding prelude/import cleanup. |

In every scope, `--fix` removes an import only when the resulting declaration preserves [API identity](001-functions.md#api-identity): the same exports, types and documentation. The prelude supplying a name does not itself prove that its import is unneeded. Changes only to formatting, quote style, import extension spelling, or import and member order where `tsc` does not care do not prevent removal; an inferred import type must still denote the same public type. Source checking remains a separate requirement: under `noUnusedLocals`, an import the fixes leave unused in the source is removed, since it would report `TS6133`. Every `.vibe` module has a declaration, its sidecar, so `noEmit` and `declaration: false` change nothing here.

Either scope flag requires `--fix` somewhere in the argument list, before or after it; alone, each is an unknown compiler option (`TS5023`). The ordinary `--fix` invocation and its project options keep their existing meaning.

```sh
vibelang --fix --fix-migration-only -p tsconfig.json
vibelang --fix-vip-only --fix -p tsconfig.json
vibelang --fix-vip-only # TS5023: add --fix
```

Only `--fix-vip-only` runs the VIP-1/VIP-2 function-kind and `try` passes, reading input as source for the release before VIP-1. It writes `try` before each call that ran where it stood before VIP-1, and removes the `try` that ran a known legacy wrapper, deciding from the original resolved callable and migration provenance, not the final value's shape or annotation alone. A rewrite that can't preserve types, behavior and declaration output refuses at that site ([VIP-34](../vips/0034-compiler-and-tooling.md#decision), amended). Ordinary `--fix` and `--fix-migration-only` do not run those passes: ordinary `--fix` never removes a valid `try` from current source merely because its callee is unannotated. In current source, `try make()` intentionally runs the result whenever it passes the [operand test](002-running.md#operand-test).

A value that fails that operand test, such as `Option.some(1)` or `Result.succeed(2)`, keeps `EK0502`: the migration inserts no conversion and unwraps nothing, whatever methods the value has ([VIP-5](../vips/0005-try-runs-effects.md#decision), amended).

When `--fix-vip-only` refused any call, it sets `"vibe": { "severities": { "EK4802": "error" } }` in the project's config with a comment that says why, so all `EK4802` sites in the project, both unrun returns and inferred Effect arguments, fail to compile; the owner removes the setting once a run refuses none.

These commands have no Effect TypeScript runtime translation.
