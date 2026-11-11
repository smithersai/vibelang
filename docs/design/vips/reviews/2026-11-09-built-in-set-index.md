# The built-in VIP set: index (final)

**Status:** proposed design index, recorded 2026-11-09; the linked VIPs 55–72 were accepted optimistically under the pre-alpha standing approval and became open proposals on 2026-11-11 ([VIPs](../README.md#the-built-in-set)). Will has not reviewed their decisions. Parts are built as experimental code; each VIP's Status line says which. The comparative review records the adopted recommendations.

```text
 ┌─ language: the compiler must understand it ─────────────────────────────────────────────────┐
 │  task · workflow · spawn          schema service · with { type: "worker" }                   │   3 keywords, 1 modifier pair, 1 import attribute
 │  durable waits: three library calls the compiler lowers to plan nodes, no keyword            │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌─ standard library: a program calls it, as Experimental.X with no import (VIP-33) ───────────┐
 │  Durable  Human  Trigger  WorkQueue  Agent  Tools  Memory  Sandbox  Secrets  Capability      │   new modules
 │  Eval  Scorer  Fuzz  FuzzSimulation  Test                                                    │
 │  Model  McpClient  Rpc  Otlp  Logger                                                         │   additions to an Effect module, under its name
 ├─ already in scope in Vibe 0.0.13, from Effect 4.1.1 ────────────────────────────────────────┤
 │  LanguageModel  DecisionModel  Decision  EmbeddingModel  Chat  Tool  Toolkit                 │   used as they are
 │  McpClient  McpServer  Rpc  RpcClient  RpcServer  Worker  Otlp  Cron  TestClock              │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌─ outside the language: the reference engine's products ─────────────────────────────────────┐
 │  CLI · build · control plane · UI · integrations · notifications                             │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

A small complete program in the proposed language. [durable-tasks-workflows](../0055-durable-tasks-workflows.md) defines its forms:

```ts
// proposed
task Summarize {
  effect call(url: string): string!AiError.AiError {
    return (try LanguageModel.generateText({ prompt: `Summarize ${url}` })).text
  }
}

export workflow Digest {
  effect call(url: string) { return try Summarize(url) }
}

export effect function main() {
  provide Experimental.Model.use("anthropic:claude-sonnet-5-5") {
    provide Layer.provideMerge(Digest.layer, Experimental.Durable.sqlite({ filename: "runs.db" })) {
      return try Digest("https://example.com/post")     // kill it mid-run: the next start resumes, and pays for no finished step
    }
  }
}
```

## The set

| Slug | Title | Home | One sentence | Depends on (in this set) |
| --- | --- | --- | --- | --- |
| [durable-tasks-workflows](../0055-durable-tasks-workflows.md) | `task` and `workflow`, durable steps and the plan the compiler derives | language | A `task` is one recorded step and a `workflow` is a plan over tasks; the compiler derives schemas, the reference engine's declarations and the static plan. | std-durable, capabilities |
| [durable-waits](../0056-durable-waits.md) | Durable waits: timers, signals and human answers | language | Inside a workflow a wait parks the run, and the compiler lowers three library calls to plan nodes, with no keyword. | durable-tasks-workflows, std-durable |
| [workers-remote](../0057-workers-remote.md) | `schema service` and worker imports | language | `schema service` declares a service whose calls can cross a boundary, and a layer decides whether it runs here, on worker threads or on another machine. | none |
| [capabilities](../0058-capabilities.md) | Capabilities: a permission kernel in the standard library | library (decided) | `Experimental.Capability` puts a check in front of every platform service a program can reach; the language adds no syntax. | none |
| [eval-declarations](../0059-eval-declarations.md) | Eval declarations: a file kind and a function, no syntax | library (decided) | An eval is `Experimental.Eval.suite(…)` in a `*.eval.vibe` file, with the standing a test has, and its command spends nothing unless told to. | std-eval, std-test |
| [std-durable](../0060-std-durable.md) | `Experimental.Durable`, the durable runtime | stdlib | `Durable` journals each step, replays a run after a crash, caches results, and reads, forks or rewinds a run's past. | capabilities |
| [std-triggers](../0061-std-triggers.md) | `Experimental.Trigger` and `Experimental.WorkQueue` | stdlib | `Trigger` starts a workflow on a schedule or from a verified webhook, and `WorkQueue` hands work to a pool of workers. | durable-tasks-workflows, std-durable, durable-waits |
| [std-model](../0062-std-model.md) | `Experimental.Model`: language models and decision models with no SDK | stdlib | Programs call Effect's `LanguageModel` and `DecisionModel`; `Model` turns `"anthropic:claude-sonnet-5-5"` into the layer that serves them, on Effect's provider packages. | std-durable, capabilities |
| [std-agent](../0063-std-agent.md) | `Experimental.Agent`: the agent loop, model-written scripts and coding-agent CLIs | stdlib | `Agent.run` loops a model that writes short scripts over its tools until it gives a typed answer; `Agent.cli` runs Claude Code, Codex or OpenCode as one step. | std-model, std-tools, std-sandbox, capabilities, std-durable |
| [std-tools](../0064-std-tools.md) | `Experimental.Tools`: the standard tools | stdlib | Each standard tool is both a function a program calls and an Effect `Tool` a model calls, with bounded output and a declared permission. | capabilities, std-durable |
| [std-mcp](../0065-std-mcp.md) | `Experimental.McpClient`: MCP servers as toolkits | stdlib | MCP is Effect's `McpClient` and `McpServer`, in scope today; one function connects a server and returns the tools you named as a `Toolkit`. | std-tools, capabilities, std-durable |
| [std-memory](../0066-std-memory.md) | `Experimental.Memory`: durable facts, notes, history and recall | stdlib | `Memory` stores what the next run should still know and recalls it by query within a byte budget. | std-durable, std-model, capabilities |
| [std-sandbox](../0067-std-sandbox.md) | `Experimental.Sandbox`: provisioned machines | stdlib | A sandbox is a layer: inside `provide Experimental.Sandbox.container({ image }) { … }` the process and file services belong to another machine. | capabilities |
| [std-secrets](../0068-std-secrets.md) | `Experimental.Secrets`: secrets a step uses without holding them | stdlib | A step holds a placeholder, and the egress swaps in the value only on an HTTPS request to that secret's own hosts. | capabilities |
| [std-eval](../0069-std-eval.md) | `Experimental.Eval` and `Experimental.Scorer` | stdlib | `Eval` runs fixed cases against a target, `Scorer` grades each answer from 0 to 1, and a gate compares scores with a committed baseline. | std-model, std-durable |
| [std-fuzz](../0070-std-fuzz.md) | `Experimental.Fuzz`: fuzzing and deterministic fiber simulation | stdlib | `Fuzz.run` generates inputs from a schema, keeps what found new behavior, and reports a shrunk, replayable failure, including fiber interleavings. | none |
| [std-test](../0071-std-test.md) | `Experimental.Test`: doubles, assertions and conformance | stdlib | `Test` supplies a model that replays a recording, a host with fixed files, an engine that crashes on purpose, and assertions over a plan and a journal. | std-durable, std-model, std-fuzz |
| [std-observe](../0072-std-observe.md) | `Experimental.Otlp`: logs, metrics and traces over OTLP | stdlib | Logging, metrics and tracing are Effect's; `Experimental.Otlp` adds redaction and a bounded transport, and `Experimental.Logger.journal` copies a run's logs into its journal. | none |

## Dependencies

A VIP needs only VIPs on the levels above it. The graph has no cycle. The table lists exactly which.

```text
 accepted   VIP-9 services · VIP-14 modules in scope · VIP-29 schema errors · VIP-33 platform stdlib · VIP-44 durable values
            ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
 level 1    capabilities            workers-remote        std-fuzz        std-observe
               │      │     │
 level 2    std-durable   std-sandbox   std-secrets
               │    │  │        │
 level 3    durable-tasks-workflows   std-model   std-tools
               │                         │   │      │   │
 level 4    durable-waits   std-eval  std-memory  std-test   std-mcp   std-agent
               │               │                     │
 level 5    std-triggers       └──── eval-declarations
```

## One vocabulary

| Thing | Spelling in every VIP |
| --- | --- |
| A new standard-library module | `Experimental.Agent`, in scope with no import. Its code is `vibelang-runtime/experimental/Agent`, the path Vibe 0.0.13 already uses for `Experimental.Dns` |
| An addition to an Effect module | Under that module's name: `Experimental.Model`, `Experimental.McpClient`, `Experimental.Rpc`, `Experimental.Otlp`, `Experimental.Logger` |
| A host layer | Imported from `vibelang-runtime/experimental/platform-node` and its siblings. Which host has what is VIP-54's question |
| A durable step, a plan of steps | `task`, `workflow`. The reference engine calls them an action and a flow |
| One execution of a workflow | A run, with a run id. The reference engine's `executionId` |
| The durable name of a declaration | Its tag, `"<package>#<Name>"`, or `static readonly key` |
| Calling a durable declaration | `try T(a)`, `try W(a)`, `spawn W(a)`, `try W.start(a)` |
| A member that sets an option | `static readonly`, under the reference engine's own option name |
| A model, written down | A seat, `"provider:modelId"` |
| A set of tools | Effect's `Toolkit` |
| A diagnostic not yet numbered | A slug, such as `workflow-try`, until the VIP is built |

Tables and diagrams drop the `Experimental.` prefix once a VIP has introduced its module. Code always writes it.

## Rules every VIP in the set follows

1. **Syntax only where the compiler must derive something.** `task` and `workflow` derive schemas, tags and a plan. `schema service` derives an Rpc group. Durable waits add recognition and no keyword. Everything else is a library call.
2. **Effect's module where one exists** ([VIP-33](../0033-platform-stdlib.md): "Make sure you do NOT implement anything that is already in effect"). A probe of `vibelang` 0.0.13 shows `LanguageModel`, `DecisionModel`, `Decision`, `EmbeddingModel`, `Chat`, `Tool`, `Toolkit`, `McpClient`, `McpServer`, `McpProtocol`, `Rpc`, `RpcGroup`, `RpcClient`, `RpcServer`, `Worker`, `Otlp`, `Cron` and `TestClock` in scope with no import. No VIP here renames, wraps or reimplements them. Model providers are Effect's own packages.
3. **What Effect lacks goes under `Experimental`**, as VIP-33 says in Will's words. It costs 43 tokens across the 18 examples, 29 uses. Whether these modules should be promoted to bare names is recorded in the comparative review.
4. **The reference engine (an existing Effect durable-execution framework these built-ins are modelled on) is the implementation of what Effect lacks.** Each standard-library VIP names the reference engine package it ports and the calls it maps to, read at `main@origin` `bcf8076a4ff4`.
5. **Hosts are VIP-54's question.** Each VIP states what its module needs from a host and stops there.
6. **Every claim says how it was checked.** See below.

## What "Checked" means in each VIP

- **Vibe examples.** An example that uses only existing syntax was compiled with `vibelang` 0.0.13 on `effect` 4.1.1, against type declarations of the proposed module. That checks the syntax and the proposed types, including inference. Twenty-one examples compile. An example with new syntax is marked `// proposed`; its bodies were compiled as ordinary `effect function`s where possible.
- **Reference engine comparisons.** Each was type-checked with `tsc` 5.9.3 against the reference engine's published 1.0.0-rc.16 packages on `effect` 4.0.5, or with `vibelang` 0.0.13 on `effect` 4.1.1 for the Effect-only programs and the emitted program. Two were not: the reference engine's secrets and fuzz packages are not on npm, so their programs follow the package README.
- **Tokens.** OpenAI `o200k_base` through js-tiktoken 1.0.21, over each program's complete text, the comparison’s `o200k_base` counting method.

| VIP | Vibe, proposed | Reference engine 1.x or Effect TypeScript |
| --- | --- | --- |
| durable-tasks-workflows | 268 | 547 (its emitted program), 442 (home page sample) |
| durable-waits | 133 | 299 |
| workers-remote | 193 | 451 |
| capabilities | 70 | 178 |
| eval-declarations | 69 | 320 |
| std-durable | 62 | 153 |
| std-triggers | 76 | 92 |
| std-model | 101 | 317 |
| std-agent | 75 | 114 |
| std-tools | 57 | 83 |
| std-mcp | 87 | 140 |
| std-memory | 67 | 145 |
| std-sandbox | 56 | 160 |
| std-secrets | 97 | 261 |
| std-eval | 130 | 392 |
| std-fuzz | 90 | 143 |
| std-test | 142 | 185 |
| std-observe | 51 | 83 |
| **Total** | **1,824** | **4,063** (with 547 for the first row) |

The pairs are not all the same size of program; each VIP says where its two sides differ.

## What must exist before any of this runs

1. **A reference engine release on Effect 4.1.1.** The reference engine's published 1.0.0-rc.16 packages require `effect` 4.0.5, and Vibe 0.0.13 pins 4.1.1. The reference engine's `main` is on 4.1.1.
2. **Four adapters.** Effect `Tool` to and from a reference engine flow binding ([std-tools](../0064-std-tools.md)); the reference engine's `Model.stream` over Effect's `LanguageModel` ([std-agent](../0063-std-agent.md)); Effect's `DecisionModel` over the reference engine's `Evaluator` ([std-model](../0062-std-model.md)); a scheduler `Runner` over the durable engine ([std-triggers](../0061-std-triggers.md)).
3. **Two fixes to placed actions** in the reference engine ([workers-remote](../0057-workers-remote.md)).
4. **Two private packages published:** the reference engine's secrets and fuzz packages.
5. **VIP-44's storage rows.** Its identity rows landed in the reference engine on 2026-11-09; its serializer rows have not ([std-durable](../0060-std-durable.md)).

## What stays out

VIP-43 (proofs), VIP-44 (durable values) and VIP-54 (platform model) are not redone. Generated views, the database package, artifacts and sync are out of scope. The reference engine's CLI, build, control plane, UI, integrations and notifications stay products: where a program needs one of their behaviors, such as answering a human question or listing runs, the matching library call is in a VIP above.

## Sources

- The reference engine 1.x at `main@origin` `bcf8076a4ff4c1d667ddd09c5015474123a8b744`: each package's `README.md`, its `docs/`, and the source files named in each VIP. Both drafts read `2da147d2d610`. The 34 commits since include VIP-44's three identity changes and one engine-store fix; the rest are the reference engine's product apps.
- Vibe: `docs/design/vips/README.md`, VIP-9, VIP-14, VIP-33 and VIP-44 at `vibe@origin` `f2c643b42dcd`; `site/src/pages/proposals.mdx`; `skills/vibelang/SKILL.md` and `vibelang-runtime`'s export map in the 0.0.13 tarballs.
- Effect 4.1.1: `effect/ai`, `effect/rpc`, `effect/workers`, `effect/workflow`, `effect/observability`, read from the installed package; `@effect/ai-anthropic` and `@effect/ai-openai-compat` 4.1.1, read from their npm tarballs.
- The project's planning notes: its principles, thesis, goal, problem statement and overview, its VIP and decision logs, its problem examples, and the open VIP-54 draft.
