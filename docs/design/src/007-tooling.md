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

This includes `src/user.vibe` without also checking its stale `src/user.d.vibe.ts`. With `vibe.sidecarDir`, a sidecar under that directory whose source exists at the mirrored path is left out the same way.

Declaration sidecars are emit outputs like `.d.ts`. Under [VIP-27’s native overwrite amendment](../vips/0027-declaration-output.md#amendment-native-overwrite-protection-2026-11-02), a sidecar found through `include` yields to its source and emit may overwrite it. Listing both the source and its sidecar explicitly in `files` keeps the sidecar as an input: emit reports `TS5055`, exits `1`, and leaves its bytes untouched. The same rule applies in the `vibe.sidecarDir` directory.

A non-relative import reaching a known compatibility declaration uses its available mapped source only when TypeScript's final resolved path is outside `node_modules`. This includes package exports, `paths` and package `#imports`. Apply `realpath` and `preserveSymlinks` first; a retained logical dependency path keeps its declaration and native module identity. The rule also applies to the effective `sidecarDir` map ([VIP-27's dated amendment](../vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01)). Explicitly selected declarations remain inputs subject to the ordinary overwrite guard.

Compatibility declarations preserve the actual module selected by a source import. An explicit `./tag.vibe` remains that module even beside `tag.ts`, including re-exports and inferred import types, in either layout ([VIP-27](../vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01)).

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

`trustedPackages` is removed (VIP-4, amended 2026-11-02). A tsconfig that still sets it gets a deprecation warning and the key is ignored. Module resolution follows TypeScript's tsconfig-driven rules, with `.vibe` and `.vibex` as source extensions beside `.ts` and `.tsx`: under NodeNext `./user.js` resolves to `user.vibe`, and a written `./x.ts` finds only `x.ts`, so a stale one is `TS2307`. Migration never writes `moduleSuffixes`.

### Declaration import spelling

Declaration import spelling follows TypeScript's source and tsconfig rules ([Declaration output](001-functions.md#declaration-output)). `declarationImportStyle` is retired: root `vibelang.declarationImportStyle` and `compilerOptions.vibelang.declarationImportStyle` are ignored with a nonfatal deprecation warning for every value, including invalid values (VIP-30, amended). No replacement option or spelling codemod is needed.

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

During alpha, VibeLang pins exactly one Effect version, and the pin moves to each new Effect release. The pinned dependency artifact is `effect@4.1.1`, and 4.1 is the earliest supported version (VIP-32, amended). Every Effect TypeScript mapping in this specification, and the `Exit` guarantee of [Runtime guarantees](008-runtime.md), is relative to the pin. The pin controls variables during alpha; it is not the long-term plan, and supported version ranges get their own VIP after alpha.

A migration upgrades the target repository to the pinned Effect first, on its own: it fixes what breaks and lands that commit with green tests. Only then does it convert files to `.vibe`, so each breakage shows its real cause. A repository that already uses VibeLang upgrades Effect together with the VibeLang release pinned to the new Effect, because the published `vibelang-runtime` enforces its exact pin.

VibeLang declares an exact `effect` peer dependency. The compiler reads the resolved `effect/package.json`; any version other than `4.1.1` is `EK3201` in the CLI and editor ([VIP-32](../vips/0032-effect-version.md#decision)). For example, resolving `effect@4.0.3` reports: `the resolved effect is 4.0.3; VibeLang Y pins 4.1.1: upgrade both together`, where `Y` is the VibeLang release.

## Compiler and tooling requirements

1. **Diagnostics.** Every VibeLang diagnostic has a code (`EKxxxx`) and a message in the user's words that says what is wrong and how to fix it, with a quick fix wherever the fix is mechanical. Quick fixes and codemods use the formatter to preserve the parse under Appendix A. [Appendix B](900-appendices.md#appendix-b-diagnostics) lists the codes. TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types. A rejection that depends on a VibeLang production, placement rule, proposal-specific early error or explicitly adopted reconciliation uses its owning VIP's `EK` code, even when a TypeScript parser helper implements it. Use an already assigned specific diagnostic for the same rejection; preserve independent native errors. A compilation whose emitted JavaScript imports `vibelang-runtime` and cannot resolve that package fails with one error naming it, TypeScript's `TS2307` for a missing module, as a missing dependency fails in TypeScript; it never reports the compiler-generated helpers the package provides as unresolved names.
2. **Codemods.** Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically. One `vibelang --fix` run applies fixes until none applies; running it again changes nothing. A run that has not converged within its pass limit reports the remaining fixes as an error. A `--fix` run writes only the selected project's own files: its `.vibe` and `.vibex` sources in the TypeScript program, including an owned source an import reaches even when `exclude` omits it from root discovery, and its own configuration files for the named legacy-severity and retired-`declarationSidecars` codemods. Config `extends` traversal stays inside the repository and outside `node_modules`. It never rewrites dependencies, sources resolved from `typeRoots` or bundled libraries, foreign `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` or `.cjs` sources, declaration files (`.d.ts`, `.d.vibe.ts`, `.d.vibex.ts`), emitted output, `tsBuildInfoFile`, lock files or another referenced project's files; with `-b`, each project fixes its own files in build order. The platform repair alone may create a fresh sibling `.ts` module after proving preservation of run phase, captures, receiver and public types; it never overwrites an existing file. A repair requiring any other write gives the not-fixed explanation and changes nothing ([VIP-34](../vips/0034-compiler-and-tooling.md#decision), amended). For example, a trailing block ([VIP-11](../vips/0011-trailing-blocks-denied.md)) is `EK1101`, and its codemod writes the block as the call's last argument in the spelling of what it ran as: `Layer.effect(Users) { … }` becomes `Layer.effect(Users, effect { … })`, `it.effect("loads") { … }` becomes `it.effect("loads", effect () => { … })`, and a block passed as a plain callback becomes `() => { … }`. The repair is selected from the pinned legacy source, compiler and options, preserving the actual old program or callback kind and argument position; the callee's parameter type alone cannot decide it. If kind, placement or body preservation is unproved, refuse with an explanation. Ordinary parsing uses TypeScript's statement boundaries and recovery; private compatibility decoding supplies diagnosis and migration only, never a callback to execute. `EK1101` suppresses only a redundant missing-separator `TS1005` for the identical rejection; independent native errors remain. The rewrite preserves runtime behavior. Comments stay in the source, though their printed placement and equivalent arrow layout can differ. A line break before the block, an optional chain, a heritage clause, and the providers of a `provide` block are outside this form. A comment between the call and its block has no place in the rewrite, so the codemod leaves that site to the author; a block after an Effect dual that `0.0.10` placed elsewhere first uses its versioned compatibility repair, retaining a native call error or transitional `EK1023` for a type-correct appended call with changed meaning, without duplicate `EK1101` (VIP-34).
3. **One formatter.** VibeLang's formatter is the only formatter. Prettier, dprint and Oxfmt reach it through plugins, so a repository's existing formatter command covers `.vibe` files. It takes the repository's quote style and print width from that formatter's configuration, so `.vibe` and `.ts` files share them. It preserves the `provide` line restrictions ([VIP-12](../vips/0012-provide.md)): never break after `provide`, before or after a provider-separating comma, or before the block’s `{`. A long provider list stays on one line. The formatter neither introduces nor removes `Layer.mergeAll(…)`; an author who writes it may break lines between its arguments ([example](005-services.md#syntax)). It preserves every line-sensitive and parenthesis-sensitive rule in [Appendix A](900-appendices.md#appendix-a-grammar): never insert or remove a line break or parentheses that change the parse. Its tests cover each such rule, including contextual keywords, Effect type slots, bodyless errors, field and variant separators, statement boundaries, `catch` arrows and `for concurrent` heads and bodies. Under the same compiler/options, formatting preserves parsed program meaning: bindings and scopes, operator and control-flow targets, evaluation order, receivers and call syntax, ordinary runtime values and effects, coldness, failures, interruption and finalizers. It preserves inferred and declared public types, declarations and throws contracts, and diagnostic codes, categories and occurrences; diagnostic locations and quoted source follow the formatted file. Comments and their code associations survive, including JSDoc, compiler/linter/tool directives and directive-prologue meaning. An unparsable file is reported and left unchanged; formatting is idempotent. Semantic migrations and diagnostic repairs belong to `vibelang --fix` or editor actions.

   Ordinary layout and lexical-spelling normalization may change emitted JavaScript bytes. `Function.prototype.toString`, generated source text, source offsets, line/column and stack presentation may reflect the formatted text. This source-text boundary never permits changes to ordinary strings/data, tagged-template raw or cooked values, regex meaning, function names or lengths, property names or directive semantics. For example, changing an escaped string into an actual `use strict` directive changes meaning. Regenerate compiler-generated source-map and declaration-map provenance, including `sourcesContent`, for the formatted file; never retain stale maps. Preservation tests compare parsed source/emit structure, runtime behavior, types/declarations, diagnostics, comments/directives and maps; arbitrary regex stripping is unsound, and a finite structural oracle is not a proof of all program equivalence. Exact-byte tests remain useful where equality is expected, without restricting advertised native formatter style settings.
4. **Existing tools work.** Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`. A repository's Oxlint JS-plugin rules run on `.vibe` files wherever the rule applies to the source or emitted forms. Every tool is tested against the dogfood repositories. The language server also resolves `./x.vibe` to the source whenever it is in the program, ignoring its stale `x.d.vibe.ts` beside it or under `vibe.sidecarDir`.
5. **Emit names.** `x.vibe` emits `x.js` beside `x.d.ts` in `outDir`; JavaScript output rewrites relative `./x.vibe` specifiers to `./x.js`. Declaration output preserves written relative specifiers in package declarations and compatibility sidecars, as TypeScript does for the `.ts`/`.tsx` twin; synthesized import types follow its inference under the same source and options, with VibeLang extensions substituted back (VIP-27, amended). `x.vibex` emits `x.jsx` under `"jsx": "preserve"` and `x.js` otherwise, as `x.tsx` does, and a relative `./x.vibex` specifier becomes the target file's actual output name (VIP-39). Bundler plugins use the same names ([VIP-34](../vips/0034-compiler-and-tooling.md#decision)). The `.d.vibe.ts` compatibility route above remains for tools reading `.vibe` specifiers.
6. **Severities.** Only VibeLang's own warning codes and all imported `EK38xx` lint codes can be configured in `vibe.severities`. Entries for VibeLang's own error codes, interim `EK92xx` codes or unknown codes are config errors (`EK3006`), even if the requested severity is `"error"`.

The transitional compiler also emits four migration warnings: `EK4853` writes previously inferred requirements explicitly under VIP-3; `EK4854` changes the retired abstract-class service spelling to `service`; `EK4855` changes a service's `default` value to a `defaultValue` factory under VIP-9; and `EK4856` replaces a use of the retired global `Effect<A, E, R>` alias with `A!E!R` where that needs no new parentheses, and with qualified `Effect.Effect<A, E, R>` otherwise, heritage elements included, under VIP-3. Migration error `EK4857` retires written `infer` slots in Effect return annotations: write the inferred types, or omit the annotation when every slot is `infer`, preserving declaration types under the safe-fix checks (VIP-3, amended). Their [compatibility inventory](900-appendices.md#transitional-compiler-diagnostics) records the emitted codes. `vibelang --fix` keeps the existing safe-fix checks and refusal rules. These repairs do not run Effects or change the normative omitted-slot and service semantics.

The `EK4856` transition selects the resolved legacy symbol, never the identifier spelling: a local or imported type named `Effect` retains its TypeScript meaning. Its quick fix keeps existing parentheses and written default slots, keeps required imports when globals are disabled, and is refused where it cannot keep the `Effect` namespace binding; emitted declarations already print `Effect.Effect<…>` and do not change. The alias is removed only in a coordinated release of compiler, codemod and docs. Afterwards, module-only `Effect<number>` is native `TS2709`; an unbound name follows ordinary TypeScript resolution ([VIP-3](../vips/0003-effect-type-shorthand.md#decision), amended).

**Formatting** preserves program meaning and contracts, not emitted bytes: bindings, evaluation order, receivers, runtime effects, failures and finalizers. Source maps are regenerated to describe the formatted source.

**Migration** rewrites toward the VIP form or native Effect TypeScript and preserves evaluation order, captures, the call-versus-run phase, coldness, error and environment channels, and public declarations. It never edits a test or a fixture: a test that bundles `.vibe` passes unchanged, or its modules stay `.ts`. A default plan leaves Effect type-only users in TypeScript. A legacy `try make()` of a removed plain wrapper loses its `try`, whatever the result's shape. An old call whose behavior it can't preserve keeps a `.ts` boundary, with an explicit refusal. It never invents `asEffect()`, never turns `Match.withReturnType<T>()` into an unchecked `as T`, and writes `try Effect.forkChild(program, options)` for the legacy `fork(program, options)`. Prelude cleanup keeps an explicit Effect import where removing it would change the declaration. A tool cache for type-directed compilation is reusable only while its source, declarations, configuration, versions and project are unchanged. A missing validation outcome is unverified: a later stage never inherits an earlier stage's exit.

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
| An `effect` function returns an Effect value unrun, so its caller gets the program instead of its result ([VIP-1](../vips/0001-effect-and-async-functions.md), [VIP-5](../vips/0005-try-runs-effects.md#decision)) | `EK4802` | `return try e`; no automatic fix in ordinary `--fix` |
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

`vibelang lint` accepts the compiler’s options, including `-p`/`--project` and file arguments, with no lint-specific options; for example, `vibelang lint --project tsconfig.json` selects that project ([VIP-38](../vips/0038-effect-lint-built-in.md#decision)). `vibelang --fix` remains the codemod entry point. Two flags scope that invocation ([VIP-34, amended](../vips/0034-compiler-and-tooling.md#decision)):

| Flag | Scope when used with `--fix` |
| --- | --- |
| `--fix-migration-only` | Migration fixes, excluding TypeScript-form teaching rewrites and prelude/import cleanup. |
| `--fix-vip-only` | The existing VIP migration passes, including the VIP-1/VIP-2 function-kind and `try` migration, excluding prelude/import cleanup. |

In every scope, `--fix` keeps an import that a module's declaration needs, in its place and under its name, so the declaration stays the same bytes: an import goes only where the module's declaration is the same bytes without it. The prelude supplying a name does not make its import unneeded: without `import { Layer, Schema } from "effect"` written before a relative import, the declaration can list it after that import, and print an inferred `Schema.String` as an `import("effect/Schema")` type, so the import stays. Where the declaration is the same without it, as when it writes `import { Option } from "effect"` for `Option.Option<number>` either way, the import goes. Under `noUnusedLocals`, an import the fixes leave unused in the source is removed, since it would report `TS6133`. Every `.vibe` module has a declaration, its sidecar, so `noEmit` and `declaration: false` change nothing here.

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
