# Configuration and tooling

Sources: [VIP-30](../vips/0030-config-files.md), [VIP-32](../vips/0032-effect-version.md), [VIP-34](../vips/0034-compiler-and-tooling.md), [VIP-38](../vips/0038-effect-lint-built-in.md). Declaration output (VIP-27) is in [Functions](001-functions.md#declaration-output).

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

`vibe.config.json` accepts every `tsconfig.json` field, `extends` included; `jsconfig.json` has TypeScript’s implied defaults. Relative paths, including `extends`, resolve from the config that contains them. Fields retain their TypeScript meaning with one deliberate file-kind exception: `moduleDetection` applies ordinarily to `.ts` and `.js`, but every source `.vibe` file is an external module before binding and checking, independently of imports and prelude switches ([Modules and the top level](001-functions.md#modules-and-the-top-level)). None of its values enables shared script globals in `.vibe`; ordinary module emission, host rules and incompatible-option diagnostics still apply. The added top-level `"vibe"` section holds VibeLang's options in any of the three files. Plain `tsc` rejects unknown `compilerOptions` (TS5023) but ignores unknown top-level keys, so a repository's own TypeScript tooling keeps working.

`.vibe` is a supported source extension: `files` may list it, and `include`, `exclude` and the default `**/*` treat it as they treat `.ts`. When both `x.vibe` and its compatibility declaration `x.d.vibe.ts` are selected, VibeLang uses the source and resolves `./x.vibe` to it; plain `tsc` uses the declaration.

```json
{ "include": ["src"] }
```

This includes `src/user.vibe` without also checking its stale `src/user.d.vibe.ts`.

```jsonc
// base.json
{ "vibe": { "effectGlobals": false, "severities": { "EK0801": "off" } } }
// child config
{ "extends": "./base.json", "vibe": { "effectModules": false } }
// effective vibe section
{ "effectGlobals": false, "effectModules": false, "severities": { "EK0801": "off" } }
```

`extends` inherits `vibe` key by key: child keys win and missing keys come from the base. `severities` merges entry by diagnostic code (decided detail 59). An `extends` array merges bases left to right, later entries winning, before applying the child, as in TypeScript.

The decided keys (VIP-30, amended) are:

| Key | Meaning |
| --- | --- |
| `vibe.effectGlobals` | Boolean switch, default `true`, for Effect's function globals ([VIP-6](../vips/0006-effect-globals.md)); `false` turns them off. |
| `vibe.effectModules` | Boolean switch, default `true`, for Effect's modules in scope ([VIP-14](../vips/0014-effect-modules-in-scope.md)); `false` turns them off. |
| `vibe.severities` | Maps VibeLang's own warning codes and all imported `EK38xx` lint codes to `"error"`, `"warning"`, `"suggestion"` or `"off"` (VIP-34, VIP-38; decided details 57 and 77). |

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

`vibe.severities` is a map keyed by the full `EK` code printed by the CLI and language server. Imported lint ordinals can add digits after `EK38`; `EK3801` and `EK38100` are distinct keys, compared as whole strings. Its values are TypeScript diagnostic category names (`"error"`, `"warning"`, `"suggestion"`) plus `"off"`. Only VibeLang's own warning codes and imported `EK38xx` codes may appear; a VibeLang error code or an unknown code is a config error (`EK3006`: remove the entry; decided details 57 and 77). `EK0801` is the configurable `using` warning; `EK4701` is the non-exhaustive `match` error and cannot be configured. This is a compiler setting, with no Effect TypeScript runtime translation.

```jsonc
// Invalid even when retaining the severity: VibeLang's own error codes cannot be configured.
{ "vibe": { "severities": { "EK4701": "error" } } } // EK3006: remove the entry
```

The configured category controls reporting: an `"error"` makes both `vibelang` and `vibelang lint` exit non-zero and participates in `noEmitOnError`; a `"warning"` prints without changing exit status (decided detail 71). A `"suggestion"` is shown by the language server only; `"off"` reports nothing. To fail CI on a configurable warning, set it to `"error"`.

The legacy `vibelang.diagnostics` key reports migration warning `EK3009`. `vibelang --fix` rewrites each map whose codes are all configurable to `vibe.severities`, including in extended configs, and retains existing modern entries. Maps with obsolete nonconfigurable codes stay in place until those entries are removed. Like other warnings, `EK3009` can be configured through `vibe.severities`.

## TypeScript spellings with VibeLang forms

These built-in warnings suggest an accepted VibeLang form without changing the meaning of TypeScript-style source. They are warnings by default and use `vibe.severities`, independently of the imported Effect lint table. A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix. A warning does not itself rewrite code, and a warning-only run exits zero. Untagged `Data.Error` has no equivalent tagged declaration: keep its library form rather than adding a tag. An unsupported legacy repair is retired, rather than treated as a language requirement.

| Code | Trigger | Repair |
| --- | --- | --- |
| `EK4830` | A class written with `Data.TaggedError("Name")` | Use `error Name { … }` only when its tag and class behavior are preserved. |
| `EK4831` | A class written with `Context.Service` | Use `service Name { … }`, preserving the key with `static readonly key`. |
| `EK4832` | A `const` holding `Schema.Struct({ … })` | Use `schema Name { … }` where the field mapping and associated type are preserved. |
| `EK4833` | A written `Effect.Effect<A, E, R>` type, except an interface's `extends` element, which `A!E!R` cannot spell | Use the equivalent `A!E!R` spelling, preserving `never` slots and required parentheses. |
| `EK4834` | An explicitly run `Effect.succeed(v)` or `Effect.fail(e)` in effect code | Use the value `v` or `throw e`; do not apply this to an unrun Effect value. |
| `EK4835` | An explicitly run `Effect.catch`, `Effect.catchTag`, or `Effect.catchTags` in effect code | Use a `catch effect` handler, with `match` on the failure for tag cases and a typed `throw` for unmatched failures. |
| `EK4836` | An explicitly run `Effect.provide` or `Effect.provideService` in effect code | Use a `provide` statement with Layers or `Key = value`, preserving operand evaluation order. |
| `EK4837` | A class written with `Schema.TaggedError` | Use `schema error Name { … }` when the schema and tag are preserved; an ordinary `error` would lose the schema. |
| `EK4839` | An Effect `Match` chain with a supported finisher | Use `match`, or a function returning `match` for `Match.type`, only for patterns and handlers whose tests and results are preserved. |
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

VibeLang declares an exact `effect` peer dependency. The compiler reads the resolved `effect/package.json`; any version other than `4.1.0` is `EK3201` in the CLI and editor (decided detail 70). For example, resolving `effect@4.0.3` reports: `the resolved effect is 4.0.3; VibeLang Y pins 4.1.0: upgrade both together`, where `Y` is the VibeLang release.

## Compiler and tooling requirements

1. **Diagnostics.** Every VibeLang diagnostic has a code (`EKxxxx`) and a message in the user's words that says what is wrong and how to fix it, with a quick fix wherever the fix is mechanical. Quick fixes and codemods use the formatter to preserve the parse under Appendix A. [Appendix B](900-appendices.md#appendix-b-diagnostics) lists the codes. TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types. A rejection that depends on a VibeLang production, placement rule, proposal-specific early error or explicitly adopted reconciliation uses its owning VIP's `EK` code, even when a TypeScript parser helper implements it. Use an already assigned specific diagnostic for the same rejection; preserve independent native errors.
2. **Codemods.** Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically.
3. **One formatter.** VibeLang's formatter is the only formatter. Prettier, dprint and Oxfmt reach it through plugins, so a repository's existing formatter command covers `.vibe` files. It takes the repository's quote style and print width from that formatter's configuration, so `.vibe` and `.ts` files share them. It preserves the `provide` line restrictions ([VIP-12](../vips/0012-provide.md)): never break after `provide`, before or after a provider-separating comma, or before the block’s `{`. A long provider list stays on one line. The formatter neither introduces nor removes `Layer.mergeAll(…)`; an author who writes it may break lines between its arguments ([example](005-services.md#syntax)). It preserves every line-sensitive and parenthesis-sensitive rule in [Appendix A](900-appendices.md#appendix-a-grammar): never insert or remove a line break or parentheses that change the parse. Its tests cover each such rule, including contextual keywords, Effect type slots, bodyless errors, field and variant separators, statement boundaries, `catch` arrows and `for concurrent` heads and bodies. Under the same compiler/options, formatting preserves parsed program meaning: bindings and scopes, operator and control-flow targets, evaluation order, receivers and call syntax, ordinary runtime values and effects, coldness, failures, interruption and finalizers. It preserves inferred and declared public types, declarations and throws contracts, and diagnostic codes, categories and occurrences; diagnostic locations and quoted source follow the formatted file. Comments and their code associations survive, including JSDoc, compiler/linter/tool directives and directive-prologue meaning. An unparsable file is reported and left unchanged; formatting is idempotent. Semantic migrations and diagnostic repairs belong to `vibelang --fix` or editor actions.

   Ordinary layout and lexical-spelling normalization may change emitted JavaScript bytes. `Function.prototype.toString`, generated source text, source offsets, line/column and stack presentation may reflect the formatted text. This source-text boundary never permits changes to ordinary strings/data, tagged-template raw or cooked values, regex meaning, function names or lengths, property names or directive semantics. For example, changing an escaped string into an actual `use strict` directive changes meaning. Regenerate compiler-generated source-map and declaration-map provenance, including `sourcesContent`, for the formatted file; never retain stale maps. Preservation tests compare parsed source/emit structure, runtime behavior, types/declarations, diagnostics, comments/directives and maps; arbitrary regex stripping is unsound, and a finite structural oracle is not a proof of all program equivalence. Exact-byte tests remain useful where equality is expected, without restricting advertised native formatter style settings.
4. **Existing tools work.** Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`. Every tool is tested against the dogfood repositories. The language server also resolves `./x.vibe` to the source whenever it is in the program, ignoring its stale `x.d.vibe.ts`.
5. **Emit names.** `x.vibe` emits `x.js` beside `x.d.ts` in `outDir`; relative `./x.vibe` specifiers become `./x.js`, as TypeScript’s `rewriteRelativeImportExtensions` does for `.ts`. Bundler plugins use the same names (decided detail 72). The `.d.vibe.ts` compatibility route above remains for tools reading `.vibe` specifiers.
6. **Severities.** Only VibeLang's own warning codes and all imported `EK38xx` lint codes can be configured in `vibe.severities`. Entries for VibeLang's own error codes or unknown codes are config errors (`EK3006`), even if the requested severity is `"error"`.

The transitional compiler also emits three migration warnings: `EK4853` writes previously inferred requirements explicitly under VIP-3; `EK4854` changes the retired abstract-class service spelling to `service`; and `EK4855` changes a service's `default` value to a `defaultValue` factory under VIP-9. Their [compatibility inventory](900-appendices.md#transitional-compiler-diagnostics) records the emitted codes. `vibelang --fix` keeps the existing safe-fix checks and refusal rules. These repairs do not run Effects or change the normative omitted-slot and service semantics.

## Effect's type-aware lint

```sh
vibelang lint -p tsconfig.json
```

The Effect language service's type-aware rules (effect-tsgo's `effecttsgo/*` rules) run inside the `vibelang` compiler on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions. VibeLang-specific language checks remain confined to `.vibe`. They run wherever VibeLang reports diagnostics: the CLI, the language server, and `vibelang lint` for CI (VIP-38, amended). A repository's existing Effect language-service configuration selects and configures them, so its lint script covers `.vibe` as it covers `.ts`. The lint command emits no files and uses the same configuration and diagnostic categories as the compiler and language server; it has no Effect TypeScript runtime translation.

Each imported `effecttsgo/*` rule gets one stable `EK38xx` code, in a normative table generated from the pinned effect-tsgo version ([Imported lint codes](900-appendices.md#imported-lint-codes)); a VIP-32 bump regenerates the table, and a rule's code never changes once assigned (decided detail 77). The CLI and language server print that code with the rule name in the message: `EK3801 floatingEffect: …`. A rule's severity resolves in this order, the more specific winning, as a tsconfig child overrides its base: an entry for its code in `vibe.severities`; else the repository's Effect language-service configuration; else the rule's default. Every `EK38xx` code is a lint code and may be set to any value, `"off"` included: VIP-34's "errors can't be off" covers VibeLang's own rules.

```json
{ "vibe": { "severities": { "EK3801": "warning" } } }
```

An `effect { … }` expression statement builds an Effect and discards it without running it ([Effect blocks](002-running.md#effect-blocks)). The imported `floatingEffect` rule reports it under its `EK38xx` code, just as it reports a discarded Effect in TypeScript.

These are VibeLang’s own configurable warnings, distinct from the imported `EK38xx` rules; they already have decided codes and preserve the underlying TypeScript behavior ([Running Effects](002-running.md)):

| Warning | Code | Suggested fix |
| --- | --- | --- |
| A plain `catch` handler returns an unrun Effect (decided detail 62) | `EK0508` | `catch effect (e) => try …` |
| `await` on a `Fiber` (decided detail 28) | `EK4609` | `await runPromise(Fiber.join(fiber))` in `async` code; `join fiber` in effect code |
| `await` on a `Deferred` (decided detail 29) | `EK4610` | `await runPromise(Deferred.await(deferred))` in `async` code; `try Deferred.await(deferred)` in effect code |

The imported rules are pinned by [`UPSTREAM`](../../../typescript/tsc/internal/effecttsgo/UPSTREAM) to `@effect/tsgo@0.57.0`, commit `999942fa41462eb46dfcb2d718e7671db8e14156` (decided detail 98). The normative [`lint-codes.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/lint-codes.json) and the table below are generated with `node docs/tools/lint-codes.mjs --write`. An upstream bump runs `sh tsc/internal/effecttsgo/sync.sh <tag>` from `typescript/` and regenerates the inventory.

Each rule has one stable code: the `EK38` prefix followed by a decimal ordinal of at least two digits. The initial allocation retains `EK3801` for `floatingEffect` and sorts all remaining rule names from ordinal 2 (decided detail 106); future additions sort only the new names and append after the largest reserved ordinal. After `EK3899` comes `EK38100`, so the prefix also accommodates this pin's 130 rules (decided detail 142). Keep assignments in `docs/tools/lint-code-assignments.json`; removed rules retain their reservation and codes are never renumbered or reused.

Severity resolves from an entry for the printed code in `vibe.severities`, then the repository's Effect language-service configuration, then the rule's default (details 60 and 77). Every imported code accepts `"off"`, including rules whose default is `"error"`. A code identifies one rule even when that rule emits several upstream messages.

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

`vibelang lint` accepts the compiler’s options, including `-p`/`--project` and file arguments, with no lint-specific options; for example, `vibelang lint --project tsconfig.json` selects that project (decided detail 58). `vibelang --fix` remains the codemod entry point. Two flags scope that invocation:

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

These commands have no Effect TypeScript runtime translation.
