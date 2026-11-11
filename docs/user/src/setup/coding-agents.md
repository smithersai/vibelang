# Coding agents

Run the setup command in an existing project directory containing `package.json`. A missing target path reports an error without creating the directory.

`npx vibelang agents init` sets up a repository's coding agents for `.vibe` and `.vibex` files. Each agent gets the VibeLang skill, instructions in `AGENTS.md`, the language server where it has an LSP client, and a check after each edit that returns the errors to the agent. Each part uses the agent's own configuration files.

![The compiler reports a discarded Effect, and the agent runs it with try](/videos/agent-loop.mp4)

In a new starter, Effect's `floatingEffect` rule reports the discarded Effect as `EK3801`. The example adds `try` to run it, then checks that the program prints its greeting.

## 1. Set up the repository

Install `vibelang` ([Add VibeLang to an existing project](existing-project.md)), then run this from the repository root:

```sh
npx vibelang agents init
```

It prints each file it writes. Commit them, so everyone who clones the repository gets the same setup. After you update `vibelang`, run it again: it rewrites its own files and its section of `AGENTS.md`, and keeps everything else in the files it shares, such as your own hooks and settings.

## 2. Trust the repository

Claude Code and Codex run a repository's code only after you trust it.

- **Claude Code** loads the language server plugin once you trust the folder. `claude -p` doesn't trust a folder; pass the plugin instead: `claude -p --plugin-dir .claude/skills/vibelang-lsp "…"`.
- **Codex** runs the hook once the project is trusted and you trust the hook in `/hooks`. Automation that vets the repository itself can run `codex exec --dangerously-bypass-hook-trust`.

## What each agent gets

| Agent | Skill | Instructions | Language server | After each edit |
| --- | --- | --- | --- | --- |
| Claude Code | `.claude/skills/vibelang/` | `AGENTS.md`, or `CLAUDE.md` when the repository has one | The plugin in `.claude/skills/vibelang-lsp/` | A `PostToolUse` hook in `.claude/settings.json` |
| Codex | `.agents/skills/vibelang/` | `AGENTS.md` | None: Codex has no LSP client | A `PostToolUse` hook on `apply_patch` in `.codex/hooks.json` |
| opencode | `.agents/skills/vibelang/` | `AGENTS.md` | `lsp.vibelang` in `opencode.json` | The plugin `.opencode/plugins/vibelang.js` |
| Cursor | `.agents/skills/vibelang/` | `AGENTS.md` | The [VibeLang extension](vscode.md) | Cursor loads Claude Code's hooks from `.claude/settings.json` |
| VS Code with Copilot | `.agents/skills/vibelang/` | `AGENTS.md` | The [VibeLang extension](vscode.md) | Copilot loads Claude Code's hooks from `.claude/settings.json` |

`init` doesn't install the editor extension; install it as [VS Code and Cursor](vscode.md) describes.

## The check after each edit

The hooks and the opencode plugin run `npx vibelang agents check` on the `.vibe` and `.vibex` files the agent edited. You can run it too:

```sh
npx vibelang agents check src/profile.vibe
```

It finds the nearest directory with a compiler configuration above each file, checking `vibe.config.json`, `tsconfig.json` and `jsconfig.json` in that order, then prints the errors in those files:

```out
src/profile.vibe(6,10): error TS2322: Type 'string' is not assignable to type 'number'.
vibelang: 1 error left in the files you edited. Fix it before you finish.
```

It exits with status `1` when the project has an error, including errors outside the files you named. Errors in the project's other files are counted on one line. If the compiler exits unsuccessfully, is terminated by a signal or cannot start, the check also fails: it reports that the check is incomplete, names the exit status, signal or spawn error, and includes the compiler's standard error output. It never reports `no errors` for a failed compiler check. When the directory has multiple configurations, it selects the first project that includes the file, in the order above followed by alternate `tsconfig*.json` projects such as `tsconfig.test.json`.

Explicit `agents check` inputs must name existing files. A missing file or directory reports an error and exits with status `1`; other existing inputs are still checked. Hooks skip deleted files.

If a named source has no project configuration above it, the check reports that the file was not checked and exits with status `1`. Add a project config that includes the file, or check it directly with `vibelang --noEmit <file>`. A skipped file also fails a check that includes files from a successful project.

Project-wide compiler diagnostics without a source location, such as `TS18003` when a config selects no input files, keep their code, message and continuation lines in the report. They do not count as errors in the edited source files.

A hook returns a project error or an incomplete compiler check to the agent with exit status `2`, and a warning as context the agent reads with the tool's result.

Included Effect lint suggestions are shown with their codes and explanations, too. They keep the compiler's configured exit behavior; a successful check returns them to the hook as context.

The generated instructions also recommend `vibelang lint`. It uses the compiler’s configuration and Effect language-service plugin settings; select a non-default project with `vibelang lint --project <config>`. This command reports diagnostics without emitting files.

## In a workspace

When `vibelang` is installed in a workspace package rather than at the root, run `init` from that package's directory, with the root as its argument:

```sh
cd packages/core && npx vibelang agents init ../..
```

The commands it writes then name the package, as `npx --no --prefix packages/core -- vibelang agents hook`.

Workspace package paths with spaces, quotes or shell punctuation work in the generated hooks, language-server commands and opencode plugin. Rerun `init` to update an existing setup.
