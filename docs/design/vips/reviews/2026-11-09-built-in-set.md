# Review of the two draft sets, and how the final 18 were chosen

**Status:** proposed design review, recorded 2026-11-09. The recommendations below were subsequently adopted as Claude's decisions in optimistically accepted VIPs 55–72 under the pre-alpha standing approval. Will has not reviewed those decisions. Nothing is built.

```text
                 Fable's drafts                         Astra's drafts                       final
 design          a Vibe surface for each module         Smithers' names, re-exported         Fable's surface, 17 of 18
 Effect 4.1.1    probed: LanguageModel, DecisionModel,  could not read Effect                Effect's modules, and Effect's
                 McpClient, McpServer are in scope                                           provider packages too
 VIP-33          bare names: amends Will's words        vibe/experimental/* with imports     Experimental.X, no import, as 0.0.13 does
 errors          8 of the 11 in the table below         6 of the 11                          each fixed from source
 dependencies    one cycle                              acyclic                              acyclic
 checked         examples compiled, programs typed      nothing compiled                     21 examples compile, 19 programs type-check
 tokens          1,777 against 4,039                    1,504 against 1,888                  1,824 against 4,063
```

Astra's token totals are close because its examples are Smithers' API under a new import path. Its value was elsewhere: it read the Smithers source more carefully in five places, and it kept the dependency graph honest.

## How the review was done

1. Read the feature scope, both draft sets and their reports; the accepted VIPs 9, 14, 33 and 44; the proposals page; the 0.0.13 skill; `PRINCIPLES.md`, `THESIS.md`, `GOAL.md`, `OVERVIEW.md` and the open VIP-54 draft.
2. Checked every disputed API at the source: Smithers at `main@origin` `bcf8076a4ff4` (72 files), Effect 4.1.1 from the installed package, and two Effect provider packages from npm.
3. Probed `vibelang` 0.0.13: which names are in scope, and how `Experimental` resolves.
4. Compiled every final example that uses existing syntax, type-checked every comparison, and recounted every token total.

## What both drafts got wrong

| Claim | Who | The source says |
| --- | --- | --- |
| A step with no retry policy: "not stated" | Fable | `engine/src/FlowEngine/Dispatch.ts`: no retry of a typed failure. Transient infrastructure faults are retried for 2 hours when repeating is safe |
| Smithers' default retry is unbounded | Astra | The same file. `RetryPolicy.defaultRetryPolicy` never gives up, but the engine does not apply it to an undeclared step |
| MCP tools are named `mcp/<server>/<tool>` | both | Effect's `McpClient.toolkit`: a tool name is 1 to 64 letters, digits, underscores or hyphens. A slash is refused |
| `@smthrs/secrets` has one module, and a placeholder is the same wherever a name is used | Fable | Four modules. `Placeholder.minter` derives a placeholder per scope with HMAC-SHA-256 |
| No embedding route exists | Fable | `@effect/ai-openai-compat` exports `OpenAiEmbeddingModel.model` |
| Rules are evaluated in order; `attended` defaults to false | Fable | Last match wins, a deny is a veto, and `GrantStore`'s `attended` defaults to true |
| Port Smithers' `Model`, `Classifier`, `Evaluator` and `McpClient` | Astra | Effect 4.1.1 ships `LanguageModel`, `DecisionModel`, `McpClient` and `McpServer`. VIP-33: "do NOT implement anything that is already in effect" |
| A portable MCP server needs new work | Astra | `McpServer.toolkit` and `McpServer.layerStdio` exist and compile in Vibe today |
| Modules live at `vibe:agent` / `vibe/experimental/agent` | Fable / Astra | Vibe 0.0.13 resolves `Experimental` to `vibelang-runtime/experimental`, in scope with no import |
| `Action.make` has eight options | Fable | It also has `attemptTimeoutMs` and `heartbeatTimeoutMs`, and `interruptRetryPolicy` is a `Schedule` |
| Smithers at `2da147d2d610` | both | `main` moved 34 commits. VIP-44's three identity changes landed in Smithers on 2026-11-09 |

## Each VIP

| VIP | Based on | Why | What changed |
| --- | --- | --- | --- |
| durable-tasks-workflows | Fable | It has the whole lowering table, VIP-44's own call form `try W(a)`, and an emitted program that type-checks. Astra's `try T.call(a)` reuses a Smithers name that means "plan, run nothing" | Tag derived from package and name, so a file move does not orphan runs (Astra's concern, without Astra's required `id`). A task's `A!E` is its boundary and the body's services go to `T.layer` (neither draft said). Retry default from engine source. `implementationVersion` derived only where Smithers requires one. Emitted code uses the canonical `Interpreter.layerWithImplementations` and `Flow.derived`. Added `attemptTimeoutMs`, `heartbeatTimeoutMs`, `cache`, `placement`, `W.start` and a warning for an unbounded policy |
| durable-waits | Astra's decision, Fable's surface | Astra is right that waits need recognition and no keyword. Fable's `Human` calls, tables and comparison are the better page | `signal` keyword removed. A signal is `Experimental.Durable.signal(name, schema)`: 13 tokens more, no clash with TC39 Signals, and the address already holds the workflow and the run |
| workers-remote | Fable | "we just use rpc" (VIP-44). `schema service` is an Rpc group; Astra's `worker task` puts a journal under a pure function | `Remote` became `Experimental.Rpc`. Added Astra's durable placement as a `task` member, with two Smithers gaps it found in `PlacedAction` and `Hosts`. Stated limits and what cancellation does not prove |
| capabilities | Fable, corrected by Astra | Fable's page reads better; Astra's rules are truer | Fixed rule order, globs and the `attended` default. Dropped the claim that VIP-33's ban is the kernel's guarantee: VIP-54 may relax it. Separated a grant from a ceiling. Added `Capability.journaled` |
| eval-declarations | Fable | A file kind, a command and an exit code are the standing THESIS 8 asks for | The default run replays and spends nothing; `--live` spends. An unguarded live eval can start many agent sessions |
| std-durable | Fable's API, Astra's guarantees | One module organized by run beats eight re-exported packages | Removed the dependency cycle with the language VIP. Added at-least-once, `plan_changed`, and `replay` with no jj (`ReadOnlyTimeTravel`). No default engine, decided |
| std-triggers | Fable | `Trigger.cron(W, …)` types `input`; Astra kept `flowId` strings | Added the rule that an occurrence is its own run even with equal input, which VIP-44's identity would otherwise join. Named the `Runner` adapter that must be written. A queue is not a broker |
| std-model | Fable's interface | Effect's `LanguageModel` and `DecisionModel` are in scope | **Provider code flipped to Effect's packages.** `@effect/ai-anthropic` 4.1.1 compiles in Vibe 0.0.13 today in 152 tokens; published Smithers cannot run on Effect 4.1.1. Module renamed `Experimental.Model`. Recording moved to the `LanguageModel` service. An unreachable decision model never answers yes |
| std-agent | Fable | `Agent.run` and `Agent.cli` are calls, not an eight-layer composition | A CLI session is one step and is never replayed per tool (Astra). A judge fails closed. Removed `Agent.spawn`, `send`, `await`: a sub-agent from code is `spawn W(a)`. Chain is not ported |
| std-tools | Fable | One declaration, two uses | No `Tools.all`. Effect's `Tool.Readonly` annotations. `edit` refuses a stale anchor. A read-only set is not a confinement. Smithers' checkpoint and plan tools left out (Astra) |
| std-mcp | Fable | Effect ships the client and the server | Fixed tool names. `include` is required. The catalog is a snapshot. A complete server example that compiles. Module is `Experimental.McpClient.toolkit`, one function |
| std-memory | Fable | Seven calls over one store | A model's toolkit is always bound to a namespace. Recalled text is data. No erasure is promised (Astra) |
| std-sandbox | Fable | A sandbox is a layer, so no call site changes | Five providers ship and four vendors become packages. `Sandbox.apply` is out, which removes jj from this module. "Sandbox" is three different claims (Astra). `Sandbox.job` for a command that outlives its host |
| std-secrets | Fable's surface, Astra's facts | A layer over `HttpClient` is the Vibe form; Astra read the package correctly | Placeholders are scoped and fetched with `try Experimental.Secrets.placeholder(name)`. Added exact audiences, the audit-before-send rule, limits, and a list of what the egress cannot stop |
| std-eval | Fable | `Eval.suite` infers its cases from the target | Five outcomes stay distinct. A baseline never updates itself. A rubric must name its judge. Noted that `eval-agent` does not exist |
| std-fuzz | Fable | Unchanged port, one overload | Stated where the closed world ends (Astra). `Experimental.Fuzz` is the one module VIP-33's rule fits exactly |
| std-test | Fable | Doubles as layers | `Test.replay` never spends; recording is `Test.record` with a named live layer. Dropped `Test.gate`, which is `Eval.gate`. A memory engine is not a crash test |
| std-observe | Fable | Effect's exporter already compiles; this adds a composition | Two additions under the names they extend: `Experimental.Otlp` and `Experimental.Logger.journal`. Content is off by default. An export failure never fails a step |

## Cross-cutting decisions

1. **`Experimental.X`, as VIP-33 says.** Fable's bare names amend Will's words; Astra's imports cost 13 tokens a file and use a path that does not exist. The final set follows the accepted VIP and the convention 0.0.13 ships, and retains that decision for v1 (question 1).
2. **An addition to an Effect module takes that module's name**, which is VIP-33's own rule: `Experimental.Model`, `Experimental.McpClient`, `Experimental.Rpc`, `Experimental.Otlp`, `Experimental.Logger`.
3. **Effect before Smithers, wherever Effect has it.** That now includes model providers.
4. **Smithers' option names, unchanged**, for every `static readonly` member. Astra's `id`, `version`, `retry` and `target` were new words for existing options.
5. **Run identity follows VIP-44**: equal inputs join one run. Triggers and `W.start` create a second run. This recommendation is adopted as Claude's decision under the pre-alpha standing approval (question 2).
6. **No dependency cycle.** std-durable runs Smithers flow values and does not depend on the syntax that produces them.
7. **Spend is explicit.** `vibelang eval` and `Test.replay` call no model. `--live` and `Test.record` do.
8. **Security claims are bounded.** Each of capabilities, sandbox, secrets and MCP has a section saying what it does not stop.
9. **Format.** Fable's: a diagram, a complete example, then rules in tables. Astra's repeated boilerplate paragraphs and acceptance-case lists were folded into rules where they said something.
10. **The review questions and their adopted recommendations remain recorded below.** The recommendations are Claude's decisions under the pre-alpha standing approval; Will has not reviewed them and may overturn them.

## Review questions and adopted decisions

### 1. `Experimental.Agent` or `Agent`?

Your words in VIP-33: "if we were forced to add something because Effect doesn't already have a namespace for it it should be under Experimental."

```ts
// the final set, VIP-33 as written
const result = try Experimental.Agent.run({ prompt, tools: Experimental.Tools.filesystem, output: Review })

// promoted, VIP-33 amended
const result = try Agent.run({ prompt, tools: Tools.filesystem, output: Review })
```

The prefix costs 43 tokens across the 18 examples (2.4%). It keeps Vibe's names out of Effect's way: `effect/ai` gained `Decision`, `DecisionModel` and `McpClient` between 4.0.0 and 4.1.1, and `Model` and `Prompt` already collide in Vibe.

**Adopted decision (optimistic, pre-alpha):** keep `Experimental` for the first release. Promote a module to a bare name in the VIP that ships it, when its eval shows agents write it correctly. A rename before the first stable release costs nothing.

### 2. Does running a workflow twice with the same input run it twice?

**Decision recorded under optimistic acceptance.** Equal-input calls join the first run, per VIP-44; triggers and `W.start` create another. This is Claude's adopted recommendation, which Will has not individually reviewed.

```ts
try Triage("smithersai/smithers")
try Triage("smithersai/smithers")     // VIP-44: joins the first run, calls nothing.  Smithers today: runs again.
try Triage.start("smithersai/smithers")   // always a new run, in the final set
```

VIP-44 says equal inputs join one run. Smithers changed its own default to new work each time, with `Flow.derived` as the opt-in.

**Adopted decision (optimistic, pre-alpha):** VIP-44's rule. It is what makes a crashed program resume its run on restart with no saved id, and it prevents a double charge. A scheduled trigger still gets one run per occurrence.

### 3. Whose code calls the model provider?

```ts
provide Experimental.Model.use("anthropic:claude-sonnet-5-5") { … }
//   final set: Effect's @effect/ai-anthropic underneath. Compiles in Vibe 0.0.13 today.
//   Fable's draft: Smithers' Route.anthropic underneath. Needs a Smithers release on Effect 4.1.1 and an adapter.
```

**Adopted decision (optimistic, pre-alpha):** Effect's packages. VIP-33 says not to implement what Effect has, they have no dependencies, and they work on the pinned Effect now. Smithers adds the layer above: seats, recording, quota parking, fallback and Jev.

### 4. May a workflow loop?

```ts
workflow Fix {
  effect call(issue: string, attempt: number) {
    const patch = try Patch(issue)
    const check = try Check(patch)
    if (check.ok) return patch
    return Fix.to(issue, attempt + 1)     // the final set: a loop is a chain of rounds, bounded by maxRounds
  }
}
// refused in the final set:  while (!(try Check(patch)).ok) patch = try Patch(issue)
```

A static plan cannot hold a loop whose count depends on a step's answer. Body replay, as Effect's and Temporal's engines do, allows the loop and gives up the plan you can inspect before a model is called.

**Adopted decision (optimistic, pre-alpha):** refuse the loop in the first release and name `W.to` in the error. Compile `while` into rounds in a follow-up VIP: agents write loops first.

### 5. Is `jj` an acceptable requirement?

```ts
try Experimental.Durable.fork({ run, seq })     // needs jj 0.39.0 on PATH
task Edit { static readonly tier = "compensable"; … }   // so does this
try Experimental.Durable.replay(at, fold)        // does not
```

Smithers snapshots and restores a workspace with jj. A language's standard library that needs a version-control tool is unusual.

**Adopted decision (optimistic, pre-alpha):** accept it for the first release, only for fork and compensable tasks (including compensable workspace restoration), and fail with `not_installed` at the first jj operation. Sealed and irreversible steps, replay, and everything else in the set need no jj.

### 6. Is a signal worth a keyword?

```ts
// the final set: no keyword
schema Paid { amount: number }
export const paid = Experimental.Durable.signal("paid", Paid)
const payment = try paid.wait()

// Fable's draft: a keyword
signal Paid { amount: number }
const payment = try Paid()
```

The keyword saves 13 tokens a signal. It has no TypeScript or TC39 source, and TC39's Signals proposal gives `Signal` another meaning.

**Adopted decision (optimistic, pre-alpha):** no keyword. The set then adds three keywords in all: `task`, `workflow` and `spawn`.


## Decision provenance

The writers were vip-fable (Fable 5.2) and vip-astra (Codex Astra), merged by vip-final (Fable 5.2), adopted by lang-5e. Each VIP records its design choices and these answers in its Claude's decisions section. Optimistic acceptance records authorship; it does not mean Will reviewed an individual decision, and he may overturn it.
