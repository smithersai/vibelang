# VIP-38: Effect's type-aware lint is built into VibeLang

**Status:** accepted by Will, 2026-10-29.

## Decision

- The Effect language service's type-aware rules (effect-tsgo's `effecttsgo/*` rules) run inside the `vibelang` compiler on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions. VibeLang-specific language checks remain confined to `.vibe`. Both are typescript-go forks, so the rule runner is built in rather than run beside it.
- They run wherever VibeLang reports diagnostics: the CLI, the language server, and a lint command for CI. A repo's existing Effect language-service configuration selects and configures them, so a repo's lint script covers `.vibe` the same way it covers `.ts`.
- Tools that only analyze code (cycle checkers such as madge, and dependency graphs) may run on VibeLang's compiled output. That cannot work for formatters, which must read `.vibe` itself (VIP-34).
- **Amended 2026-10-29: the command.** The lint command is `vibelang lint`. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: lint options.** `vibelang lint` takes the compiler's options (`-p`/`--project` and files) and no others. `vibelang --fix` stays the one codemod entry point. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 58).
- **Amended 2026-10-29: codes for the imported rules.** Each imported `effecttsgo/*` rule gets one stable `EK38xx` code, in a table generated from the pinned effect-tsgo version. Severity resolves from `vibe.severities`, then the repository's Effect language-service configuration, then the rule's default; every `EK38xx` code may be set to any value, `"off"` included. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 77).
- **Amended 2026-10-29: the imported rules are pinned to `@effect/tsgo@0.57.0`.** `typescript/tsc/internal/effecttsgo/UPSTREAM` (tag `@effect/tsgo@0.57.0`, commit `999942fa41462eb46dfcb2d718e7671db8e14156`) is the normative pin; `sync.sh <tag>` is the only update path, and a VIP-32 bump runs it and regenerates the `EK38xx` table, keeping every assigned code. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 98).

- **Amended 2026-10-30: stable imported codes.** The normative [`lint-codes.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/lint-codes.json) is generated from the `UPSTREAM` pin, currently `@effect/tsgo@0.57.0`. Keep `EK3801` for `floatingEffect`; allocate the other initial rule names in ascending ASCII order from ordinal 2. Future new names append in sorted order after the highest reserved ordinal, and removed names keep their slots. Codes use the `EK38` prefix and a minimum-two-digit decimal ordinal: after `EK3899` comes `EK38100`. This amends VIP-34's capacity rule for imported lint without reserving `EK39xx` (decided details 98, 106 and 142).

## Will's words

> "1. The effect ts go should absolutely be built into Vibelang in fact this was always supposed to be part of the spec"

> "Some of these can work via just compiling vibe and then running the tool. Obv that doesn't work for formatters though"

## Context

The tool-risk report (2026-10-29, `~/migrate/TOOL-RISK.md` on nyc-02) found type-aware Effect lint was the one tool with no workaround: it blocks alchemy's `lint` and foldkit's `lint:effect`.
