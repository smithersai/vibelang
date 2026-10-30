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
- **Superset.** Every tsconfig field means the same in `vibe.config.json`, including `extends`. The only addition is the `"vibe"` section.
- **VibeLang's options live under a top-level `"vibe"` key.** Plain `tsc` rejects unknown `compilerOptions` (TS5023) but ignores unknown top-level keys, so the repo's own TypeScript tooling keeps working.
- The switches for VIP-6 (Effect function globals) and VIP-14 (Effect modules in scope) live there; their final names are settled during implementation.
- **Amended 2026-10-29: the option names.** The keys are `vibe.effectGlobals`, `vibe.effectModules` and `vibe.severities`. Errors can't be set to `"off"` (VIP-34). Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: the `severities` format.** `vibe.severities` maps a diagnostic's printed `EKxxxx` code to `"error"`, `"warning"`, `"suggestion"` or `"off"`. Only a warning's code may appear; an error's code or an unknown code is a config error. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 57).
- **Amended 2026-10-29: `extends` and the `vibe` section.** `extends` merges the `vibe` section key by key, as tsconfig merges `compilerOptions`: the child's keys win, missing keys come from the base, and `severities` merges entry by code. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 59).
- **Amended 2026-10-30: legacy configuration migration.** The legacy `vibelang.diagnostics` key reports warning `EK3009`; `vibelang --fix` rewrites configurable maps to `vibe.severities` while preserving comments and modern entries. Maps containing obsolete nonconfigurable codes remain until those entries are removed. Decided by the agent on 2026-10-30 under VIP-34's rule that every breaking change ships a `vibelang --fix` codemod.

## Prior art

ts-node's top-level `"ts-node"` key in tsconfig; `deno.json`; VS Code's `jsconfig.json`.

## Will's words

> "There should be a proposal towards end about accepting tsconfig.json jsconfig.json and vibe.config.json with vibe config being a strict superset of a tsconfig."
