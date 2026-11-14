# VIP-73: `Experimental.Patterns` and `PACKAGE.vibe`: the reference engine's patterns and build graph, written in VibeLang

**Status:** open, 2026-11-10. Not part of the language: it needs Will's own approval to be accepted ([VIPs](README.md#acceptance)). Will chose the direction below; he has not reviewed this VIP's individual decisions. An experimental implementation exists: the runtime module `Experimental.Patterns`. It compiles only in a project that opts in with `"vibe": { "experimental": ["builtins"] }` ([VIP-30](0030-config-files.md#decision)); without it, the first use in a file is `EK3013`.

## Will's words

Asked whether the reference engine's patterns library and build graph should be writable in VibeLang, and in what form (a library and `PACKAGE.vibe`; a library only; or neither for now):

> ALl typescript code shoudl be writable in vibelang.

## Summary

**One sentence.** `Experimental.Patterns` is a standard-library module that runs the reference engine's orchestration patterns (a review loop, a panel, a merge queue, a runbook and the rest) as plain Effect code with no new syntax, and a package may declare its build targets in `PACKAGE.vibe` where it writes `PACKAGE.ts` today.

**One paragraph.** The built-in set ([VIPs 55 to 72](reviews/2026-11-09-built-in-set-index.md)) covers flows, triggers, models, agents, tools, memory, sandboxes, secrets, evals, fuzzing and tests. Two of the reference engine's fundamentals had no VibeLang form: `@smthrs/patterns`, the library of higher-order orchestration shapes, and the build graph, whose declarations live in `PACKAGE.ts`. Without them a release runbook, a four-reviewer panel or a merge queue stays TypeScript even after `workflow` compiles. This VIP adds both. A pattern is a function that takes Effect callbacks and returns one Effect, so it needs no grammar. A build declaration is a module of plain values, so `PACKAGE.vibe` needs no grammar either; the build system finds and loads it. The rule behind both is wider than this VIP: anything written in TypeScript must be writable in VibeLang. TypeScript keeps working: `PACKAGE.ts` and the TypeScript patterns API are unchanged.

```text
 question ──► Panel.run ──┬─► astra  ─┐
                          ├─► sol    ─┤ opinions, keyed by name, in declaration order
                          ├─► fable  ─┼──────────────────────────────────────────────► moderator ──► verdict
                          └─► opus   ─┘

 goal ──► ReviewLoop.run ──► produce ──► review ──► approved?  yes ──► { _tag: "Approved", output }
                                            ▲          │ no, rounds left
                                            └─ revise ◄┘          none left ──► { _tag: "Exhausted", output, review }
```

## Decision

```ts
// proposed
task Ask {
  effect call(reviewer: string, question: string) { return try Review(reviewer, question) }
}

workflow SpecGate {
  effect call(revision: string) {
    return try Experimental.Patterns.Panel.run(revision, {
      panelists: {
        astra: (revision) => Ask("astra", revision),
        sol: (revision) => Ask("sol", revision),
        fable: (revision) => Ask("fable", revision),
        opus: (revision) => Ask("opus", revision)
      },
      moderator: effect ({ opinions }) => Object.values(opinions).every((grade) => grade.lgtm)
    })
  }
}
```

### `Experimental.Patterns`

In scope with no import, as [VIP-33](0033-platform-stdlib.md) rules. Its code is `vibelang-runtime/experimental/Patterns`. It ports the run forms of `@smthrs/patterns`. Each pattern is a namespace inside it: `Experimental.Patterns.Panel`, `Experimental.Patterns.ReviewLoop`.

| Call | Meaning | Reference engine |
| --- | --- | --- |
| `Panel.run(input, { panelists, moderator, concurrency? })` | Ask every panelist the same input, then hand the moderator one record of opinions | `Panel.run` |
| `ReviewLoop.run(input, { produce, review, revise, maxRounds, stall? })` | Produce, review, and revise until a review approves or the rounds are spent | `ReviewLoop.run` |
| `Debate.run(input, options)` | A bounded, alternating exchange that a judge settles | `Debate.run` |
| `Escalation.run(input, { rungs })` | Try each rung in order until one result is accepted | `Escalation.run` |
| `MapReduce.run(input, options)` | Split, map each part, reduce the results | `MapReduce.run` |
| `Bounded.run(members, { concurrency })` | Run a fixed set of Effects at most `concurrency` at a time, highest priority first | `Bounded.run` |
| `Quarantine.run(members, options)`, `Quarantine.settle(result)` | Continue past a failed member and report each member as `Succeeded` or `Quarantined` | `Quarantine` |
| `Saga.run(input, { steps })` | Forward steps whose compensations unwind in reverse on a failure | `Saga.run` |
| `CheckSuite.run(input, { checks, strategy })` | Run independent checks with a concurrency bound and reduce their rows to one verdict | `CheckSuite.run` |
| `MergeQueue.run(input, { members, concurrency })` | Land members in one prioritized order at a concurrency the queue owns | `MergeQueue.run` |
| `Runbook.run(input, { steps, approve, onDeny })` | Ordered steps; a step's risk decides whether an approval gates it | `Runbook.run` |
| `Kanban.run(items, { columns })` | Move every item through ordered columns, bounded inside each column | `Kanban.run` |
| `Supervisor.run(input, options)` | One boss plans, workers execute, the boss reviews, and only retriable tasks are delegated again | `Supervisor.run` |
| `Sidecar.run(input, options)` | Run a cheap shadow beside the primary and measure the gap | `Sidecar.run` |
| `DriftDetector.run(input, options)` | Capture a snapshot, compare it with a baseline, alert when it moved | `DriftDetector.run` |
| `Intervene.run(input, options)` | Read a target, propose a change, apply it behind an optional approval, report | `Intervene.run` |
| `Trellis.validate(plan, envelope)`, `Trellis.execute(plan, options)` | Check and run a delegation plan a model wrote, inside a fixed envelope | `Trellis` |
| `DelegationChain.run(prompt, options)` | The fixed chain: refine, plan, derisk, execute, review, settle | `DelegationChain.run` |
| `Optimizer.run(input, options)` | Generate, evaluate, improve, until a target score or the iteration bound | `Optimizer.make` |
| `ScanFixVerify.run(input, options)` | Scan for issues, fix them concurrently, verify, repeat until clean | `ScanFixVerify.make` |
| `Recursion.run(input, options)` | Bounded recursive expansion inside a depth and fan-out envelope | `Recursion.recurse` |
| `Burndown.run(items, options)` | Work a backlog down round after round at a concurrency and capacity the burndown owns | `Burndown.round` |
| `PatternError` | The failure every pattern refuses bad options with: `code`, `message`, `cause?` | `PatternError` |

Rules:

1. **A pattern is a function.** It takes its stages as functions that return Effects and returns one Effect. It adds no keyword, no declaration form and no diagnostic.
2. **The types are the callbacks' types.** The result, the error union and the requirements of `run` are inferred from the stages; nothing is `unknown` unless a stage says so.
3. **A pattern adds no durability of its own.** A stage that calls a `task` inside a `workflow` is a durable step as [VIP-55](0055-durable-tasks-workflows.md) defines it; a stage that is an ordinary Effect is not.
4. **Bad options fail, they do not throw.** `run` fails with `PatternError` in its error channel, so `catch` claims it. `PatternError` keeps the reference engine's nine codes: `missing_slot`, `recursion_bound`, `envelope_conflict`, `invalid_decorator`, `invalid_input`, `exhausted`, `stalled`, `quarantined`, `compensation_failed`.
5. **Options are read once, at the call.** A later change to the caller's option object does not reach a run that has not started.
6. **Results that can end more than one way are tagged.** `ReviewLoop.run` gives `{ _tag: "Approved", output }`, `{ _tag: "Exhausted", output, review }` or `{ _tag: "Stalled", output, review, stalled }`, and `match` branches on `_tag`.
7. **Records keep declaration order.** `Panel.run` gives the moderator opinions keyed by panelist name in the order the panelists were written, whatever order they finish in.
8. **A review approves with the shared vocabulary:** the value `true`, the string `"approved"`, or an object whose own `approved` or `accepted` property is `true`.
9. **A stall breaker compares values by their canonical JSON text.** `stall: { rounds, on }` ends a loop whose reviewed output repeats `rounds` times in a row; `on` is `"stop"`, `"park"` or `"escalate"`. A value with no JSON form, such as a `bigint` or a class instance, is not compared.

### What is not ported

`@smthrs/patterns` gives most patterns two forms: `make`, which declares a flow graph before anything runs, and `run`, which performs it. Only `run` is ported. A VibeLang `workflow` is the declared form: the compiler derives its plan from the code ([VIP-55](0055-durable-tasks-workflows.md)), so a second graph model would be a second way to say the same thing. For the same reason `Pattern`, the module of flow-valued slots and decorators, is not ported; a slot is a parameter and a decorator is a function.

The reference engine declares `Optimizer`, `ScanFixVerify` and `Recursion` only as graphs. Their `run` forms here are new code with the semantics of the declared graph.

### `PACKAGE.vibe`

A package declares its build targets in `PACKAGE.vibe` where it writes `PACKAGE.ts` today.

```ts
// proposed: PACKAGE.vibe
import { Filegroup } from "@smthrs/targets/Filegroup"
import { glob } from "@smthrs/targets/Input"
import { Package as declare } from "@smthrs/targets/Package"

export const Package = declare({
  targets: {
    sources: Filegroup({ srcs: [glob("src/**/*.vibe")] })
  }
})
```

1. **It is an ordinary VibeLang module.** It has no file kind in the compiler and no special scope: it imports the target constructors as a `PACKAGE.ts` does, and it exports the same values.
2. **The build system finds it.** Discovery, loading, cache keys and affected-file selection treat `PACKAGE.vibe` as they treat `PACKAGE.ts`. That work is in the reference engine's build system, not in the compiler.
3. **One declaration a directory.** A directory that holds both `PACKAGE.ts` and `PACKAGE.vibe` is refused with a diagnostic that names both files; neither wins silently.
4. **Evaluating it runs nothing.** A declaration module builds values. It is loaded without a runtime layer, so it has no top-level Effect to run.
5. **`PACKAGE.ts` stays.** A TypeScript-only workspace never loads the VibeLang compiler.

### Host needs

None for the patterns: they are pure Effect code and run in a browser, a Worker, Node and Bun. `PACKAGE.vibe` needs the VibeLang compiler where the build system runs.

## Maintainers' decisions

This is the decision record for the design above. Will decided that both exist and that the patterns are a library with no syntax; every signature, rule and name below is the maintainers'. Will has not reviewed these choices.

- The module is `Experimental.Patterns`, one namespace holding one namespace a pattern, because [VIP-33](0033-platform-stdlib.md) puts what Effect lacks under `Experimental.X`.
- Its code is `vibelang-runtime/experimental/Patterns`, and it depends on `effect` only.
- Only run forms are ported; `make` and `Pattern` are not, because `workflow` is the declared form.
- `Optimizer.run`, `ScanFixVerify.run`, `Recursion.run` and `Burndown.run` are run forms that the reference engine does not have under those names.
- The options type of each `run` is named `Options`, where the reference engine names it `RuntimeOptions`, because there is no second options type to tell it from.
- `PatternError` is a `Data.TaggedError` whose tag is `PatternError`, and it keeps the reference engine's nine codes so one handler reads both libraries' failures.
- Refusal messages are the reference engine's sentences, word for word, so a test written against one library passes against the other.
- The stall breaker compares canonical JSON text where the reference engine compares a digest of the same canonical form. Two values are equal under one exactly when they are equal under the other, and the module needs no hash.
- `Panel.run` keeps a record of panelists, not a list, so each opinion has a stable name.
- `PACKAGE.vibe` is found by the build system and gets no compiler support, because a declaration module is plain values.
- A directory with both declaration files is an error, not a precedence rule.

## Compared

The same panel in the reference engine 1.x. It type-checks against `@smthrs/patterns` 1.0.0-rc.17.

```ts
import { Panel } from "@smthrs/patterns"
import * as Effect from "effect/Effect"

declare const ask: (reviewer: string, revision: string) => Effect.Effect<{ readonly lgtm: boolean }>

export const specGate = (revision: string) =>
  Panel.run(revision, {
    panelists: {
      astra: (revision) => ask("astra", revision),
      sol: (revision) => ask("sol", revision),
      fable: (revision) => ask("fable", revision),
      opus: (revision) => ask("opus", revision)
    },
    moderator: ({ opinions }) => Effect.succeed(Object.values(opinions).every((grade) => grade.lgtm))
  })
```

The two programs are the same size. The gain is not tokens: it is that the panel is written in the language of the workflow around it, so its panelists are `task` calls and the whole gate is one durable `workflow`.

**Checked.** `Panel.run` and `ReviewLoop.run` compile and run under the compiler at this VIP's revision; the case `experimental-patterns` runs both. The reference engine's program type-checks as shown. The other rows of the table are read from `@smthrs/patterns` at the reference engine's `main` `d99515a1`.

## Principles

- **TypeScript-first.** Function calls over records of functions.
- **Effect-second.** Every pattern is `Effect.forEach`, a loop and a tagged result. Effect has no module for these shapes; the module is written so each could be proposed upstream.
- **Optimized for agentic programs.** A review loop, a panel and an escalation ladder are the shapes agentic programs repeat. Naming them once removes the hand-written loop and its off-by-one round.
- **Highly forkable.** A fork adds a pattern by adding a function.
- **Factory-first.** The specification's own acceptance gate is a four-reviewer panel, and the factory's landing path is a merge queue. Both become programs in the language they gate.

## What this changes

- `Experimental.Patterns` is new.
- `PACKAGE.vibe` is a recognised build declaration. Nothing in the compiler changes for it.
- Nothing in the grammar.
- The built-in set index said the reference engine's build stays a product outside the language. Its declarations are now writable in VibeLang; the build system itself stays a product.

## Alternatives

- **Patterns as syntax**, such as `panel { … }` or `review loop { … }`. Twenty-two keywords for shapes a function expresses, each needing a grammar, a formatter rule and an exhaustiveness story.
- **Port `make` too.** It declares a `@smthrs/flow` graph. VibeLang's graph is the `workflow` plan the compiler derives, and two graph models is the debt [VIP-55](0055-durable-tasks-workflows.md) avoids.
- **Re-export `@smthrs/patterns`.** It depends on `@smthrs/flow` and `@smthrs/plan`; the runtime would gain the reference engine's durable engine as a dependency to run a loop.
- **Keep the build graph TypeScript only.** It leaves one file in every package that cannot be VibeLang, against the rule this VIP records.
- **A build-declaration file kind in the compiler**, with `S` in scope. An import is one line, and a file kind is a second scope rule to teach and test.

## Follow-up questions

1. **`WORKSPACE.vibe` and `FACTORY.vibe`.** The same rule covers them. Recommendation: accept them the same way once `PACKAGE.vibe` has run in one workspace.
2. **Targets in scope.** Should a `PACKAGE.vibe` see the target constructors with no import? Recommendation: no; an import says which build system the file is for.
3. **Durable fan-out.** When a workflow's panelists are `task` calls, does a resumed run skip the panelists that finished? Recommendation: yes, and the engine conformance cases of [std-test](0071-std-test.md) gain one for it.

## Depends on

- [platform-stdlib](0033-platform-stdlib.md): where an addition lives.
- [durable-tasks-workflows](0055-durable-tasks-workflows.md): the declared form that replaces `make`.
