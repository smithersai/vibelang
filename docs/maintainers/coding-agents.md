# Coding agents and .vibe

How `npx vibelang agents init` (`packages/compiler/agents.mjs`) wires each coding agent to VibeLang, the extension point it uses and the primary source for it, and what the evals measured. User docs: [Coding agents](../user/src/setup/coding-agents.md).

Read on 2026-10-29 against Claude Code 2.1.312, Codex CLI 0.165.0, opencode 1.18.33, and the Cursor and VS Code docs of that date.

## Extension points

| Need | Claude Code | Codex | opencode | Cursor | VS Code with Copilot |
| --- | --- | --- | --- | --- | --- |
| Skill | `.claude/skills/<name>/SKILL.md` [C1] | `.agents/skills/` from the working directory up to the repository root [X1] | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` [O1] | `.agents/skills/`, `.cursor/skills/` [U1] | `.github/skills/`, `.claude/skills/`, `.agents/skills/` [V1] |
| Instructions | `CLAUDE.md`; `AGENTS.md` when no `CLAUDE.md` exists, since v2.1.277 [C2] | `AGENTS.md` [X2] | `AGENTS.md` [O2] | `AGENTS.md`, nested ones too [U2] | `AGENTS.md`, `.github/copilot-instructions.md` [V2] |
| Language server | A plugin's `lspServers`, which pushes diagnostics into context after edits; loads from a repository's `.claude/skills/<plugin>/` once the folder is trusted [C3, C4] | None | `lsp` in `opencode.json`; its edit, write and patch tools append "LSP errors detected" to the result [O3, O6] | The editor's extension | The editor's extension |
| After an edit | `PostToolUse` hook in `.claude/settings.json`: exit 2 returns stderr to the model; `hookSpecificOutput.additionalContext` adds context [C5] | `PostToolUse` hook in `.codex/hooks.json`, matcher `apply_patch`, the same exit-2 and `additionalContext` contract; runs once the project and the hook are trusted [X3] | A plugin in `.opencode/plugins/` whose `tool.execute.after` may change the tool's `output` [O4, O5] | `.cursor/hooks.json`; also loads Claude Code's hooks from `.claude/settings.json` [U3, U4] | Loads hooks from `.github/hooks/*.json` and from `.claude/settings.json` [V3] |

## What init writes, and why

| File | For | Why this one |
| --- | --- | --- |
| `.agents/skills/vibelang/SKILL.md` | Codex, opencode, Cursor, VS Code | The one skill location they share |
| `.claude/skills/vibelang/SKILL.md` | Claude Code | Claude Code reads no other location. opencode warns that the name is duplicated and uses the first |
| `AGENTS.md` section, and the same in `CLAUDE.md` when one exists | All | Claude Code reads `AGENTS.md` only without a `CLAUDE.md` [C2] |
| `.claude/settings.json` `PostToolUse` on `Edit\|Write\|MultiEdit` | Claude Code, Cursor, Copilot | One hook that three agents load |
| `.claude/skills/vibelang-lsp/.claude-plugin/plugin.json` | Claude Code | A repository plugin needs no marketplace; a project's `.claude/plugins/` is not scanned [C4] |
| `.codex/hooks.json` `PostToolUse` on `apply_patch` | Codex | Codex edits files only through `apply_patch`; `tool_input.command` holds the patch, whose `*** Update File:` lines name the files [X3] |
| `opencode.json` `lsp.vibelang` | opencode | opencode's own diagnostics loop |
| `.opencode/plugins/vibelang.js` | opencode | Runs `vibelang --fix`, which the LSP does not |

Two choices were checked against the agents' source:

- **No opencode `formatter` entry.** Any `formatter` object also turns on every built-in formatter whose tool is installed, such as Prettier for `.ts` files (`packages/core/src/config/plugin/formatter.ts` in opencode's `dev` branch). The plugin runs `--fix` without that side effect.
- **`npx --no -- vibelang`.** npm 11's `npx --no vibelang --lsp --stdio` passes no arguments to `vibelang`, which then compiles the project instead of starting the server. `--` passes them.

## The language server and push-only clients

Claude Code's LSP client declares `textDocument.publishDiagnostics` and no `textDocument.diagnostic` capability, and never sends `textDocument/diagnostic`. A stub server recorded Claude Code 2.1.312's `initialize` `textDocument` capabilities as `synchronization`, `publishDiagnostics`, `hover`, `definition`, `references`, `documentSymbol` and `callHierarchy`, then only `didOpen`. The TypeScript 7 server answers only pull requests for file diagnostics and pushes only a `tsconfig.json`'s, so Claude Code saw none. `typescript/tsc/internal/lsp/pushdiagnostics.go` now publishes each open document's diagnostics to a client that declares push and not pull. opencode (`packages/opencode/src/lsp/client.ts`) and VS Code pull, and are unchanged.

## Evals

Each trial copies a sample repository (`src/store.vibe`, `src/profile.vibe` and tests in `.vibe`), runs the real agent headless on a task, then checks from outside that the test file is unchanged, that `vibelang -p tsconfig.test.json --noEmit` passes, and that `vitest run` passes. A trial "saw a diagnostic" when a tool result in its transcript holds a VibeLang diagnostic line (`file.vibe(line,col): error TS…/EK…`) or opencode's "LSP errors detected" block.

| Agent | Command | Model |
| --- | --- | --- |
| Claude Code | `claude -p … --permission-mode bypassPermissions --output-format stream-json` (with: `--plugin-dir .claude/skills/vibelang-lsp`) | The account default, `claude-sonnet-5-5` |
| Codex | `codex exec -m gpt-6.1-sol -s workspace-write --json …` (with: `--dangerously-bypass-hook-trust`) | `gpt-6.1-sol` |
| opencode | `opencode run -m kimi-code-plan-global/k3 --auto --format json …` | Kimi K3 |

"With" runs `npx vibelang agents init` first; "without" is the same repository with no agent files. Both use the owner's own agent configuration. The trust flags stand in for a person trusting the folder.

Four tasks, three trials each per agent and condition, 72 runs on 2026-10-29:

| Task | Prompt, in short | What it tests |
| --- | --- | --- |
| retry | Add a retry to `load()` for `Unavailable`, not `Missing` | A small edit with a test to pass |
| loadall | Add `loadAll(ids)`, at most 4 at once, skipping `Missing` | A new function with bounded concurrency |
| port | Port `src/fetch.ts` (`Effect.gen`, `Effect.retry`, `Data.TaggedError`) to `src/fetch.vibe` | A migration |
| seeded | Make `load()` trim its id; the file also holds `display(id): string`, which calls `load` and is EK2003 | A diagnostic the agent did not cause and cannot see by reading |

| Task | Agent | With | Without | Saw a diagnostic (with / without) | Mean seconds (with / without) | Mean tool calls (with / without) |
| --- | --- | --- | --- | --- | --- | --- |
| retry | claude | 3/3 | 3/3 | 0 / 0 | 21 / 31 | 6 / 7 |
| retry | codex | 3/3 | 3/3 | 0 / 0 | 45 / 57 | 11 / 12 |
| retry | opencode | 3/3 | 3/3 | 1 / 0 | 89 / 90 | 7 / 10 |
| loadall | claude | 3/3 | 3/3 | 0 / 0 | 26 / 34 | 6 / 6 |
| loadall | codex | 3/3 | 3/3 | 1 / 2 | 61 / 68 | 11 / 13 |
| loadall | opencode | 3/3 | 3/3 | 1 / 0 | 94 / 176 | 7 / 18 |
| port | claude | 3/3 | 3/3 | 0 / 0 | 22 / 20 | 4 / 3 |
| port | codex | 3/3 | 3/3 | 0 / 0 | 52 / 57 | 11 / 11 |
| port | opencode | 3/3 | 3/3 | 0 / 2 | 66 / 206 | 6 / 15 |
| seeded | claude | 3/3 | 0/3 | 3 / 0 | 30 / 11 | 7 / 3 |
| seeded | codex | 3/3 | 0/3 | 1 / 3 | 48 / 30 | 11 / 6 |
| seeded | opencode | 3/3 | 0/3 | 3 / 0 | 86 / 60 | 7 / 3 |

| Agent | With | Without |
| --- | --- | --- |
| claude | 12/12 | 9/12 |
| codex | 12/12 | 9/12 |
| opencode | 12/12 | 9/12 |

What the numbers say:

- **On the three ordinary tasks the integration changed no pass rate**: every agent passed 9 of 9 with and without it. Without it, agents found the skill on their own in `node_modules/vibelang/skills/vibelang/SKILL.md` (15 of 18 trials on retry and loadall), because the package ships it. With it, they finished sooner and with fewer tool calls, most for opencode (loadall 94 s and 7 calls against 176 s and 18; port 66 s against 206 s).
- **On the seeded task it decided the result: 9 of 9 with, 0 of 9 without.** With it, the hook or `agents check` reported EK2003 after the edit and each agent removed `display`'s annotation. Without it, Claude Code and opencode never compiled the project, and Codex saw EK2003 when it ran the tests, called it pre-existing, and stopped.
- **Codex's `--json` stream leaves out hook output**, so "saw a diagnostic" undercounts Codex with the integration: in the seeded task all three trials fixed EK2003, and two of them learned of it only from the hook.
- **The agents rarely wrote an error themselves**, so "saw a diagnostic" is low outside the seeded task. When opencode did (TS2339, TS2304), the edit tool's result carried it and the next edit fixed it.

The trial copies lose `node_modules` to something on the eval host about 15 minutes after they are made; the grader restores it from the base copy, which is the same install, before grading.

## Gaps that need an agent change

- **Claude Code: pull diagnostics.** Its LSP client neither declares nor requests LSP 3.17 pull diagnostics, so a server that only answers `textDocument/diagnostic`, as TypeScript 7's does, shows Claude nothing. VibeLang now pushes; other TypeScript 7 based servers still don't.
- **Codex: no LSP client.** Codex learns about errors only from hooks and the commands it runs.
- **Repository trust in headless runs.** `claude -p` doesn't load a repository's plugins, and `codex exec` needs `--dangerously-bypass-hook-trust` for repository hooks. A CI or batch run must pass `--plugin-dir` or the bypass flag.

## Sources

- [C1] Claude Code, Skills: https://code.claude.com/docs/en/skills
- [C2] Claude Code, Memory, "AGENTS.md": https://code.claude.com/docs/en/memory
- [C3] Claude Code, Plugins reference, "lspServers": https://code.claude.com/docs/en/plugins-reference
- [C4] Claude Code, Plugin loading, "Plugins shared through a repository": https://code.claude.com/docs/en/plugins/loading
- [C5] Claude Code, Hooks, "PostToolUse": https://code.claude.com/docs/en/hooks
- [X1] Codex, Build skills, "Where Codex loads local skills": https://developers.openai.com/codex/skills
- [X2] Codex, AGENTS.md: https://developers.openai.com/codex/guides/agents-md
- [X3] Codex, Hooks ("Where Codex looks for hooks", "Review and trust hooks", "PostToolUse"): https://developers.openai.com/codex/hooks
- [O1] opencode, Agent Skills: https://opencode.ai/docs/skills
- [O2] opencode, Rules: https://opencode.ai/docs/rules
- [O3] opencode, LSP servers: https://opencode.ai/docs/lsp
- [O4] opencode, Plugins: https://opencode.ai/docs/plugins
- [O5] opencode 1.18.33 source, `packages/plugin/src/index.ts` (`tool.execute.after`) and `packages/opencode/src/session/tools.ts`: https://github.com/anomalyco/opencode/tree/v1.18.33
- [O6] opencode 1.18.33 source, `packages/opencode/src/tool/edit.ts` and `lsp/lsp.ts`: https://github.com/anomalyco/opencode/tree/v1.18.33
- [U1] Cursor, Skills: https://cursor.com/docs/skills
- [U2] Cursor, Rules, "AGENTS.md": https://cursor.com/docs/rules
- [U3] Cursor, Hooks: https://cursor.com/docs/hooks
- [U4] Cursor, Third Party Hooks: https://cursor.com/docs/reference/third-party-hooks
- [V1] VS Code, Agent skills: https://code.visualstudio.com/docs/copilot/customization/agent-skills
- [V2] VS Code, Custom instructions: https://code.visualstudio.com/docs/copilot/customization/custom-instructions
- [V3] VS Code, Hooks: https://code.visualstudio.com/docs/copilot/customization/hooks
