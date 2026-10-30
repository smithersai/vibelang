# VIP-38: Effect's type-aware lint is built into VibeLang

**Status:** accepted by Will, 2026-10-29.

## Decision

- The Effect language service's type-aware rules (effect-tsgo's `effecttsgo/*` rules) run inside the `vibelang` compiler on `.vibe` files. Both are typescript-go forks, so the rule runner is built in rather than run beside it.
- They run wherever VibeLang reports diagnostics: the CLI, the language server, and a lint command for CI. A repo's existing Effect language-service configuration selects and configures them, so a repo's lint script covers `.vibe` the same way it covers `.ts`.
- Tools that only analyze code (cycle checkers such as madge, and dependency graphs) may run on VibeLang's compiled output. That cannot work for formatters, which must read `.vibe` itself (VIP-34).
- **Amended 2026-10-29: the command.** The lint command is `vibelang lint`. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: lint options.** `vibelang lint` takes the compiler's options (`-p`/`--project` and files) and no others. `vibelang --fix` stays the one codemod entry point. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 58).

## Will's words

> "1. The effect ts go should absolutely be built into Vibelang in fact this was always supposed to be part of the spec"

> "Some of these can work via just compiling vibe and then running the tool. Obv that doesn't work for formatters though"

## Context

The tool-risk report (2026-10-29, `~/migrate/TOOL-RISK.md` on nyc-02) found type-aware Effect lint was the one tool with no workaround: it blocks alchemy's `lint` and foldkit's `lint:effect`.
