# VIP-64: `Experimental.Tools`: the standard tools for files, search, HTTP, the web, the shell and language servers

**Status:** accepted optimistically, 2026-11-09, under Will's pre-alpha standing approval (ruling 19:19 PST). Will has not reviewed this VIP's decisions.

## Will's words

> Ok so give me a list of smithers features. We need to figure out what the VIP should look like. Some of the features outside of durable execution likely should simply be in the standard library I'm guessing but we should enumerate all of them

## Summary

**One sentence.** `Experimental.Tools` is a module of ready-made tools, each one both a function a program calls and an Effect `Tool` a model calls, with bounded output and a declared permission.

**One paragraph.** An agent needs the same dozen tools everywhere: read a file, edit it, search, run a command, fetch a page. Smithers ships them in `@smthrs/std`, each with a schema for its input and output, a declared capability, a display limit that is disclosed and never silent, and a handler that runs on whatever `FileSystem`, `ChildProcessSpawner` and `HttpClient` the host provides. This VIP ports them as Effect tools. A program calls `Experimental.Tools.read({ path })` directly. A model gets `Experimental.Tools.filesystem`, a `Toolkit`, through `LanguageModel.generateText` or `Experimental.Agent.run`. Because the handlers use injected services, the same tools run on the local disk, in a container, or on another machine.

```text
                      ┌─ a program:  try Experimental.Tools.grep({ pattern: "TODO", root: "src" })
 Tools.grep ──────────┤
 input schema         └─ a model:    LanguageModel.generateText({ prompt, toolkit: Experimental.Tools.filesystem })
 output schema                       Experimental.Agent.run({ prompt, tools: Experimental.Tools.filesystem, output })
 capability: fs:read
 limit: a match cap, then `truncated: true`       runs on: FileSystem + Path from context (disk, container, remote)
```

## Decision

```ts
// proposed
export effect function todos() {
  const hits = try Experimental.Tools.grep({ pattern: "TODO", root: "/workspace/src" })
  const first = try Experimental.Tools.read({ path: "/workspace/src/index.ts" })
  return { hits, content: first.content }
}
```

### Module

`Experimental.Tools`, in scope with no import, as [VIP-33](0033-platform-stdlib.md) rules. Its code is `vibelang-runtime/experimental/Tools`. Effect's `Tool` and `Toolkit` keep their names: `Tool` defines one, `Tools` is the standard set.

| Toolkit | Tools | Needs | Capability | Smithers `@smthrs/std` modules |
| --- | --- | --- | --- | --- |
| `Tools.filesystem` | `read`, `write`, `edit`, `applyPatch`, `ls`, `glob`, `grep` | `FileSystem`, `Path` | `fs:read`, `fs:write` | `Read`, `Write`, `Edit`, `ApplyPatch`, `Ls`, `Glob`, `Grep`, `Search` |
| `Tools.shell` | `bash`, `test` | `ChildProcessSpawner` | `proc:spawn` | `Bash`, `TestRun`, `TestRunner` |
| `Tools.http` | `fetch`, `post` | `HttpClient` | `net:get`, `net:post` | `Fetch`, `HttpPost` |
| `Tools.web` | `webfetch`, `websearch` | `HttpClient`, a search provider | `net:get` | `WebFetch`, `WebSearch`, `ExaWebSearch` |
| `Tools.lsp` | The language-server queries | A language-server service | `fs:read` | `Lsp`, `LanguageServer` |
| `Tools.readOnly` | Every tool above that changes nothing | As above | Read actions only | `Manifest.readOnly` |

Each tool is also a function: `Tools.read(input)`, `Tools.grep(input)`, `Tools.bash(input)` and so on. There is no `Tools.all`: a tool set that can run a shell is chosen by name.

### Rules

1. **One declaration, two uses.** A tool is an Effect `Tool` with a handler. `Tools.read` called directly is the same handler a model's call reaches.
2. **Ordinary outcomes are values.** A non-zero exit code, an empty match set and an HTTP 500 are successes with data. `Tools.ToolError` is for failures a model must see as failures. Its `code` is a closed list, with the `path` where one exists.
3. **Limits are disclosed.** A capped result says so: `truncated`, `stdoutTruncated`, or a notice line naming what was shown and what there was.
4. **Capture is bounded where it is read.** A command that prints gigabytes costs the bound.
5. **Child processes get a small environment**: `PATH`, `HOME`, `USER`, `LANG`, `LC_*`, `TERM`, `TMPDIR`, `SHELL`, and what the caller declares. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GH_TOKEN` are withheld unless named.
6. **Each tool declares its capability**, so [capabilities](0058-capabilities.md) checks every call, and a plan can list what a tool set may touch. A tool's arguments come from a model, so the kernel checks the resolved resource again at the call.
7. **Each tool carries Effect's annotations.** `Tool.Readonly`, `Tool.Destructive` and `Tool.Idempotent` are set from the declared capability, so an MCP host that lists these tools sees the same facts ([std-mcp](0065-std-mcp.md)).
8. **`read` preserves bytes.** It keeps a trailing `\r` in CRLF files, so its text is a valid edit anchor. `edit` fails on an anchor that no longer matches; it never overwrites a concurrent change.
9. **Search has three implementations behind one service**: ripgrep (`NativeSearch`), an in-process walk (`PortableSearch`) and a remote machine (`RemoteSearch`). The host picks.
10. **`Tools.readOnly` is a tool set, not a confinement.** A program that also hands over `Tools.shell` has handed over writes.
11. **Inside a task, each call is a recorded step**, as every durable call is. A direct call outside a task is an ordinary live Effect.
12. **A custom tool is Effect's.** `Tool.make` and `Toolkit.make` work in Vibe 0.0.13, and `Toolkit.merge` joins one to the standard set.

### What must be built

`@smthrs/std` declares each tool as a Smithers flow (`Read.flow`, `Read.run`, `Read.capabilities`, `Read.effects`). Effect's `LanguageModel` takes `Tool`s. No adapter exists at `main@origin` `bcf8076a4ff4`. This VIP needs one function in each direction: a flow declaration with a handler as a `Tool`, and a `Tool` as a `FlowBinding.Binding` for the cell loop. [std-agent](0063-std-agent.md) needs the second.

### Host needs

`Tools.filesystem` and `Tools.shell` need a machine: Node, Bun or a sandbox. `Tools.http` and `Tools.web` run anywhere `HttpClient` does, including a browser and a Worker. `@smthrs/std`'s root "reaches no `node:*` module".

## Claude's decisions

This is the decision record for the design above, including each API signature, rule and diagnostic table entry. The code examples illustrate those decisions. Optimistic acceptance records the authorship below; Will has not reviewed these choices and may overturn them.

- `Experimental.Tools`, in scope with no import, as [VIP-33](0033-platform-stdlib.md) rules. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Its code is `vibelang-runtime/experimental/Tools`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Effect's `Tool` and `Toolkit` keep their names: `Tool` defines one, `Tools` is the standard set. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Toolkit `Tools.filesystem`: Tools: `read`, `write`, `edit`, `applyPatch`, `ls`, `glob`, `grep`; Needs: `FileSystem`, `Path`; Capability: `fs:read`, `fs:write`; Smithers `@smthrs/std` modules: `Read`, `Write`, `Edit`, `ApplyPatch`, `Ls`, `Glob`, `Grep`, `Search`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Toolkit `Tools.shell`: Tools: `bash`, `test`; Needs: `ChildProcessSpawner`; Capability: `proc:spawn`; Smithers `@smthrs/std` modules: `Bash`, `TestRun`, `TestRunner`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Toolkit `Tools.http`: Tools: `fetch`, `post`; Needs: `HttpClient`; Capability: `net:get`, `net:post`; Smithers `@smthrs/std` modules: `Fetch`, `HttpPost`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Toolkit `Tools.web`: Tools: `webfetch`, `websearch`; Needs: `HttpClient`, a search provider; Capability: `net:get`; Smithers `@smthrs/std` modules: `WebFetch`, `WebSearch`, `ExaWebSearch`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Toolkit `Tools.lsp`: Tools: The language-server queries; Needs: A language-server service; Capability: `fs:read`; Smithers `@smthrs/std` modules: `Lsp`, `LanguageServer`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Toolkit `Tools.readOnly`: Tools: Every tool above that changes nothing; Needs: As above; Capability: Read actions only; Smithers `@smthrs/std` modules: `Manifest.readOnly`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Each tool is also a function: `Tools.read(input)`, `Tools.grep(input)`, `Tools.bash(input)` and so on. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- There is no `Tools.all`: a tool set that can run a shell is chosen by name. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- **One declaration, two uses.** A tool is an Effect `Tool` with a handler. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `Tools.read` called directly is the same handler a model's call reaches. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Ordinary outcomes are values.** A non-zero exit code, an empty match set and an HTTP 500 are successes with data. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `Tools.ToolError` is for failures a model must see as failures. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Its `code` is a closed list, with the `path` where one exists. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Limits are disclosed.** A capped result says so: `truncated`, `stdoutTruncated`, or a notice line naming what was shown and what there was. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Capture is bounded where it is read.** A command that prints gigabytes costs the bound. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Child processes get a small environment**: `PATH`, `HOME`, `USER`, `LANG`, `LC_*`, `TERM`, `TMPDIR`, `SHELL`, and what the caller declares. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GH_TOKEN` are withheld unless named. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Each tool declares its capability**, so [capabilities](0058-capabilities.md) checks every call, and a plan can list what a tool set may touch. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A tool's arguments come from a model, so the kernel checks the resolved resource again at the call. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Each tool carries Effect's annotations.** `Tool.Readonly`, `Tool.Destructive` and `Tool.Idempotent` are set from the declared capability, so an MCP host that lists these tools sees the same facts ([std-mcp](0065-std-mcp.md)). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **`read` preserves bytes.** It keeps a trailing `\r` in CRLF files, so its text is a valid edit anchor. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `edit` fails on an anchor that no longer matches; it never overwrites a concurrent change. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Search has three implementations behind one service**: ripgrep (`NativeSearch`), an in-process walk (`PortableSearch`) and a remote machine (`RemoteSearch`). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- The host picks. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **`Tools.readOnly` is a tool set, not a confinement.** A program that also hands over `Tools.shell` has handed over writes. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Inside a task, each call is a recorded step**, as every durable call is. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A direct call outside a task is an ordinary live Effect. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A custom tool is Effect's.** `Tool.make` and `Toolkit.make` work in Vibe 0.0.13, and `Toolkit.merge` joins one to the standard set. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `@smthrs/std` declares each tool as a Smithers flow (`Read.flow`, `Read.run`, `Read.capabilities`, `Read.effects`). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-must-be-built) · [Review](reviews/2026-11-09-built-in-set.md).
- Effect's `LanguageModel` takes `Tool`s. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-must-be-built) · [Review](reviews/2026-11-09-built-in-set.md).
- No adapter exists at `main@origin` `bcf8076a4ff4`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-must-be-built) · [Review](reviews/2026-11-09-built-in-set.md).
- This VIP needs one function in each direction: a flow declaration with a handler as a `Tool`, and a `Tool` as a `FlowBinding.Binding` for the cell loop. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-must-be-built) · [Review](reviews/2026-11-09-built-in-set.md).
- [std-agent](0063-std-agent.md) needs the second. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-must-be-built) · [Review](reviews/2026-11-09-built-in-set.md).
- `Tools.filesystem` and `Tools.shell` need a machine: Node, Bun or a sandbox. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- `Tools.http` and `Tools.web` run anywhere `HttpClient` does, including a browser and a Worker. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- `@smthrs/std`'s root "reaches no `node:*` module". Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).

### Adopted review answers

- Keep `Experimental.X` names under VIP-33. Promotion to a bare module name requires a later decision. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Review question 1](reviews/2026-11-09-built-in-set.md#1-experimentalagent-or-agent).

## Compared

The same program in Smithers 1.x. It type-checks against `@smthrs/std` 1.0.0-rc.16.

```ts
import { Grep, Read } from "@smthrs/std"
import { Effect } from "effect"

export const program = Effect.gen(function*() {
  const hits = yield* Grep.run({ pattern: "TODO", root: "/workspace/src" })
  const first = yield* Read.run({ path: "/workspace/src/index.ts" })
  return { hits, content: first.content }
})
```

| Program | Tokens (o200k_base) | Lines |
| --- | --- | --- |
| Vibe, proposed | 57 | 5 |
| Smithers 1.x | 83 | 8 |

A direct call is nearly the same in both. The gap opens when a model uses the tools: Smithers registers flows with the host's catalog, and Vibe passes `Experimental.Tools.filesystem`.

**Checked.** The Vibe example uses only existing syntax and compiles under `vibelang` 0.0.13 against a declaration of `Tools.grep` and `Tools.read`. The Smithers program type-checks as shown. `Tool.make`, `Toolkit.make` and the `Tool.Readonly` annotation resolve in 0.0.13 with no import.

## Principles

- **TypeScript-first.** Functions and values.
- **Effect-second.** `Tool` and `Toolkit` are Effect's. This module is a set of them. No second tool type.
- **Optimized for agentic programs.** THESIS 7: tool calls are "as basic as HTTP and files". The standard set is in scope.
- **Highly forkable.** A fork adds or removes a tool in one list. The search service already has three implementations behind one seam.
- **Factory-first.** The factory's agents use these tools and no private ones.

## What this changes

- `Experimental.Tools` is new. No grammar changes.
- One adapter pair is built, as listed.

## Alternatives

- **Keep them as Smithers flows**, `Read.run` and `Read.flow`. Then a model reached through Effect's `LanguageModel` cannot use them, and Vibe has two tool types.
- **Derive a tool from an `effect function`**, so any function is a tool: `Tool.from(grep)`. The compiler would derive the parameter schema from the signature, as it does for `task`. It is a real token saving and a language feature. See open question 1.
- **Ship no tools; let each project write its own.** Every agent then rewrites file reading with different truncation, and none of them match what a model was trained to expect.
- **Everything `@smthrs/std` exports.** It also has `Checkpoints`, `Container`, `Relocate`, `TreeFingerprint`, `Probe`, `Explore` and `UpdatePlan`, which serve Smithers' own run model and products. A language's tools do not need a repository to read a file.

## Follow-up questions

1. **Tools from functions.** Should `Tool.from(effectFunction)` derive a tool's schemas from a signature? It needs the compiler, as VIP-44's derivation does. Recommendation: yes, as its own language VIP after this set; it removes the last place a Vibe program writes a schema by hand for a model.
2. **Which shell shape?** Smithers ships `Bash` and a Codex-shaped `ShellCommand`, because models trained on different tool sets call different shapes. Recommendation: `Tools.shell` is `Bash`; ship the Codex shapes (`ShellCommand`, `ApplyPatch`) as `Tools.codex`.
3. **A default web search provider.** Smithers implements `WebSearch` with Exa. A standard library naming one vendor is a decision. Recommendation: ship the `WebSearch` service and the Exa layer, and make no layer the default.

## Depends on

- [capabilities](0058-capabilities.md): each tool's declared permission.
- [std-durable](0060-std-durable.md): recorded calls inside a task. A direct call needs nothing in this set.

[std-sandbox](0067-std-sandbox.md) runs the same tools on another machine and needs no change here.
