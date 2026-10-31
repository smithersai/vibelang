# VIP-30: config files: `vibe.config.json`, `tsconfig.json`, `jsconfig.json`

**Status:** accepted, 2026-10-29. Will asked for this VIP ("accepting tsconfig.json jsconfig.json and vibe.config.json with vibe config being a strict superset of a tsconfig"); the details are recorded under his standing approval of recommendations.

## Decision

```jsonc
// tsconfig.json or jsconfig.json
{ "compilerOptions": { "strict": true }, "vibe": { "effectGlobals": false } }

// vibe.config.json: a strict superset of tsconfig.json
{ "extends": "./tsconfig.base.json", "compilerOptions": { … }, "vibe": { … } }
```

- **Precedence.** In a directory, VibeLang reads the first that exists: `vibe.config.json`, then `tsconfig.json`, then `jsconfig.json`.
- **Superset.** Every tsconfig field is accepted in `vibe.config.json`, including `extends`, with the file-kind exception below. The added top-level section is `"vibe"`.
- **Amendment: source module classification.** `moduleDetection` keeps its ordinary meaning for `.ts` and `.js`. As a deliberate exception, every source `.vibe` file is an external module before binding and checking; none of its values enables shared script globals. Written imports and exports, required prelude imports and both prelude switches cannot change that classification. JavaScript output and declaration sidecars retain an effective module marker when needed. Ordinary TypeScript module emission and host rules, including incompatible-option diagnostics, still apply (VIP-26).
- **VibeLang's options live under a top-level `"vibe"` key.** Plain `tsc` rejects unknown `compilerOptions` (TS5023) but ignores unknown top-level keys, so the repo's own TypeScript tooling keeps working.
- The switches for VIP-6 (Effect function globals) and VIP-14 (Effect modules in scope) live there; their final names are settled during implementation.
- **Amended 2026-10-29: the option names.** The keys are `vibe.effectGlobals`, `vibe.effectModules` and `vibe.severities`. Errors can't be set to `"off"` (VIP-34). Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: the `severities` format.** `vibe.severities` maps a diagnostic's printed `EKxxxx` code to `"error"`, `"warning"`, `"suggestion"` or `"off"`. Only a warning's code may appear; an error's code or an unknown code is a config error. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 57).
- **Amended 2026-10-29: `extends` and the `vibe` section.** `extends` merges the `vibe` section key by key, as tsconfig merges `compilerOptions`: the child's keys win, missing keys come from the base, and `severities` merges entry by code. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 59).
- **Amended 2026-10-30: legacy configuration migration.** Both root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics` are recognized in all three config files and their extended configs. Supported legacy settings (`"error"`, `"warning"` or `"off"`) keep applying until migrated. Missing legacy sections inherit; an explicit child legacy section replaces the whole inherited legacy section, including when empty or `null`. Modern severity entries still merge by code; an effective modern entry for the same diagnostic or its explicitly mapped port wins. Numeric code reuse does not map a legacy rule to a release error, and release-only codes are not accepted by the legacy validator. Each map reports warning `EK3009`; turning that warning off hides only the warning. `vibelang --fix` moves eligible maps to root `vibe.severities`, preserving JSONC comments, unrelated settings and modern entries. Maps containing obsolete or nonconfigurable codes remain until those entries are resolved. The complete rule and examples are in [Legacy severity maps](../src/007-tooling.md#legacy-severity-maps).

- **Amended 2026-10-30: recover invalid effective severity entries independently.** Merge `extends` entries by code before validating them. An invalid code or severity reports `EK3006` and is ignored as an override, while unrelated valid entries and options remain effective. An invalid child entry does not restore the displaced base entry for that code: lower-precedence Effect language-service configuration, where applicable, then the default applies. A non-object severity container remains `EK3007`; configuration errors keep their normal exit and emit consequences. See [Configuration](../src/007-tooling.md#config-files).

## Prior art

ts-node's top-level `"ts-node"` key in tsconfig; `deno.json`; VS Code's `jsconfig.json`.

## Will's words

> "There should be a proposal towards end about accepting tsconfig.json jsconfig.json and vibe.config.json with vibe config being a strict superset of a tsconfig."
