# Configuration and tooling

Sources: [VIP-30](../vips/0030-config-files.md), [VIP-32](../vips/0032-effect-version.md), [VIP-34](../vips/0034-compiler-and-tooling.md), [VIP-38](../vips/0038-effect-lint-built-in.md). Declaration output (VIP-27) is in [Functions](001-functions.md#declaration-output).

## Config files

```json
{ "extends": "./tsconfig.base.json", "compilerOptions": { "strict": true }, "vibe": { "effectGlobals": false, "effectModules": false } }
```

In a directory, VibeLang reads the first of these that exists:

1. `vibe.config.json`
2. `tsconfig.json`
3. `jsconfig.json`

`vibe.config.json` is a strict superset of `tsconfig.json`. Every tsconfig field means the same there, `extends` included. The only addition is a top-level `"vibe"` section, which holds VibeLang's options in any of the three files. Plain `tsc` rejects unknown `compilerOptions` (TS5023) but ignores unknown top-level keys, so a repository's own TypeScript tooling keeps working.

```jsonc
// base.json
{ "vibe": { "effectGlobals": false, "severities": { "EK0801": "off" } } }
// child config
{ "extends": "./base.json", "vibe": { "effectModules": false } }
// effective vibe section
{ "effectGlobals": false, "effectModules": false, "severities": { "EK0801": "off" } }
```

`extends` inherits `vibe` key by key: child keys win and missing keys come from the base. `severities` merges entry by diagnostic code (decided detail 59).

The decided keys (VIP-30, amended) are:

| Key | Meaning |
| --- | --- |
| `vibe.effectGlobals` | Boolean switch for Effect's function globals ([VIP-6](../vips/0006-effect-globals.md)); `false` turns them off. |
| `vibe.effectModules` | Boolean switch for Effect's modules in scope ([VIP-14](../vips/0014-effect-modules-in-scope.md)); `false` turns them off. |
| `vibe.severities` | Maps warning codes to `"error"`, `"warning"`, `"suggestion"` or `"off"` (VIP-34; decided detail 57). |

These settings have no Effect TypeScript runtime translation. With both switches disabled, use explicit imports, just as in TypeScript:

```ts
import { Effect } from "effect"

Effect.runSync(Effect.succeed(42)) // 42
```

```json
{ "vibe": { "severities": { "EK0801": "error", "EK4609": "off" } } }
```

`vibe.severities` is a map keyed by the `EKxxxx` code printed by the CLI and language server. Its values are TypeScript diagnostic category names (`"error"`, `"warning"`, `"suggestion"`) plus `"off"`. Only warning codes may appear; an error code or an unknown code is a config error (`EK3006`: remove the entry; decided detail 57). `EK0801` is the configurable `using` warning; `EK4701` is the non-exhaustive `match` error and cannot be configured. This is a compiler setting, with no Effect TypeScript runtime translation.

## The Effect version

During alpha, VibeLang pins exactly one Effect version, and the pin moves to each new Effect release. The pinned dependency artifact is `effect@4.1.0`, and 4.1 is the earliest supported version (VIP-32, amended). Every Effect TypeScript mapping in this specification, and the `Exit` guarantee of [Runtime guarantees](008-runtime.md), is relative to the pin. The pin controls variables during alpha; it is not the long-term plan, and supported version ranges get their own VIP after alpha.

A migration upgrades the target repository to the pinned Effect first, on its own: it fixes what breaks and lands that commit with green tests. Only then does it convert files to `.vibe`, so each breakage shows its real cause. A repository that already uses VibeLang upgrades Effect together with the VibeLang release pinned to the new Effect, because the published `vibelang-runtime` enforces its exact pin.

## Compiler and tooling requirements

1. **Diagnostics.** Every diagnostic has a code (`EKxxxx`) and a message in the user's words that says what is wrong and how to fix it, with a quick fix wherever the fix is mechanical. [Appendix B](900-appendices.md#appendix-b-diagnostics) lists the codes.
2. **Codemods.** Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically.
3. **One formatter.** VibeLang's formatter is the only formatter. Prettier, dprint and Oxfmt reach it through plugins, so a repository's existing formatter command covers `.vibe` files. It preserves the `provide` line restrictions ([VIP-12](../vips/0012-provide.md)): never break after `provide`, before or after a provider-separating comma, or before the block’s `{`. Wrap a long list inside `Layer.mergeAll(…)`, where argument line breaks are allowed ([example](005-services.md#syntax)).
4. **Existing tools work.** Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`. Every tool is tested against the dogfood repositories.
5. **Severities.** Warning severities can be adjusted in `vibe.severities`. Errors cannot be set to `"off"`.

## Effect's type-aware lint

```sh
vibelang lint -p tsconfig.json
```

The Effect language service's type-aware rules (effect-tsgo's `effecttsgo/*` rules) run inside the `vibelang` compiler on `.vibe` files. They run wherever VibeLang reports diagnostics: the CLI, the language server, and `vibelang lint` for CI (VIP-38, amended). A repository's existing Effect language-service configuration selects and configures them, so its lint script covers `.vibe` as it covers `.ts`. The lint command uses the same configuration and diagnostics as the compiler and language server; it has no Effect TypeScript runtime translation.

An `effect { … }` expression statement builds an Effect and discards it without running it ([Effect blocks](002-running.md#effect-blocks)). The Effect language service's floating-Effect rule reports it, just as it reports a discarded Effect in TypeScript, and the existing Effect language-service configuration selects and configures the rule. Whether the rule also gets an `EK` code that `vibe.severities` can adjust is Undecided (pending VIP).

Tools that only analyze code, such as cycle checkers (madge) and dependency graphs, may run on VibeLang's compiled output. Formatters cannot; they read `.vibe` itself.

`vibelang lint` accepts the compiler’s options, including `-p`/`--project` and file arguments, with no lint-specific options (decided detail 58). `vibelang --fix` remains the codemod entry point. These commands have no Effect TypeScript runtime translation.
