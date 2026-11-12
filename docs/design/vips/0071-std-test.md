# VIP-71: `Experimental.Test`: doubles, assertions and conformance for agentic programs

**Status:** accepted optimistically, 2026-11-09, under Will's pre-alpha standing approval. Will has not reviewed this VIP's decisions.

## Will's words

> Ok so give me a list of [the reference engine's] features. We need to figure out what the VIP should look like. Some of the features outside of durable execution likely should simply be in the standard library I'm guessing but we should enumerate all of them

## Summary

**One sentence.** `Experimental.Test` is a module of layers and assertions that make an agentic program testable: a model that replays a recording, a host with fixed files, an engine that can crash on purpose, and assertions over a plan and a journal.

**One paragraph.** Vibe tests are `@effect/vitest` tests, and that does not change. What an agentic program adds is three things a unit test cannot hold still: a model, a machine and a crash. The testing package of the reference engine (an existing Effect durable-execution framework these built-ins are modelled on) has a double for each. A recorded model replays what a provider once answered, with no network. A test host serves files and commands from a record. A restartable engine kills a run between steps and resumes it, so a test proves replay. This VIP ports them as layers a test provides, and ports the assertions that read a plan and a journal as values. Conformance suites let a fork prove that its own engine or host behaves like the standard one.

```text
 the program under test                  in production                         in a test
 ──────────────────────                  ─────────────                         ─────────
 LanguageModel.generateObject  ◄───────  Experimental.Model.use("anthropic:…")  Test.replay(recorded)     no network, no key
 FileSystem, ChildProcess      ◄───────  NodeServices.layer                     Test.host({ files })      fixed files
 workflow steps                ◄───────  Experimental.Durable.sqlite(…)         Test.restartable          crashes between steps
 time                          ◄───────  the clock                              TestClock (Effect)        moved by the test
```

## Decision

```ts
// proposed
import { expect, it } from "@effect/vitest"
import recorded from "./fixtures/label.json" with { type: "json" }

schema Label { type: "bug" | "feature" | "question" | "chore" }

effect function label(title: string) {
  const reply = try LanguageModel.generateObject({ prompt: `Label this issue: ${title}`, schema: Label })
  return reply.value
}

it.effect("labels a crash as a bug", () => effect {
  provide Experimental.Test.replay(recorded) {
    const result = try label("Crash on start")
    try Effect.try(() => expect(result.type).toBe("bug"))
  }
})
```

### Module

`Experimental.Test`, in scope with no import, as [VIP-33](0033-platform-stdlib.md) rules. Its code is `vibelang-runtime/experimental/Test`. It ports the reference engine's testing package. Effect's `TestClock` and `TestConsole` keep their names and are in scope today.

**Doubles**, each a layer:

| Layer | Stands in for | Behavior | Reference engine |
| --- | --- | --- | --- |
| `Test.replay(fixture)` | `LanguageModel` | Strict. Each recorded call is claimed once; a request the fixture does not describe is a defect. It never calls a provider | `RecordedModel` |
| `Test.record(path, { live })` | `LanguageModel` | Replays `path`; on a miss it calls the `live` layer and writes the answer | `CachedModel`, `FixtureStore.makeFile` |
| `Test.decisions(fixture)`, `Test.recordDecisions(path, { live })` | `DecisionModel` | The same pair for decision models | `CachedEvaluator` |
| `Test.host({ files, commands? })` | `FileSystem`, `Path`, `ChildProcessSpawner` | A deterministic machine from a record | `TestHost.layer` |
| `Test.durable` | The durable engine | In memory, on a test clock | `TestLayers.unit`, `MemoryEngine` |
| `Test.restartable` | The durable engine | In memory, with `Test.crash` to kill and resume a run between steps | `RestartableEngine` |
| `Test.poisoned` | Every service | Any service read fails. Proves a workflow body is pure at plan time | `TestLayers.poisoned` |

**Assertions**, each an Effect:

| Call | Asserts | Reference engine |
| --- | --- | --- |
| `Test.plan(W, ...args)` | Nodes, edges and keys of the plan, before anything runs | `PlanAssertions` |
| `Test.journal(run)` | Which steps ran, in what order, how many attempts | `JournalAssertions` |
| `Test.divergence(runA, runB)` | The first attributable difference between two journals | `Divergence` |

**Conformance**, for a fork:

| Suite | Certifies | Reference engine |
| --- | --- | --- |
| `Test.conformance.engine()` | An engine: nine black-box cases for identity, interruption, replay and race | `Conformance.coreSuite` |
| `Test.conformance.host()` | A host bundle | `HostSuite.hostSuite` |
| `Experimental.Sandbox.check(provider)` | A sandbox provider ([std-sandbox](0067-std-sandbox.md)) | `SandboxConformance.check` |

### Rules

1. **The runner is `@effect/vitest`.** `it.effect` runs on a test clock, `it.live` on real time, as today. `it.effect.fuzz` runs a property under [std-fuzz](0070-std-fuzz.md).
2. **Replay never spends.** `Test.replay` holds no live model. Recording is a different call, `Test.record`, that names its live layer. A missing recording is a failed test, never a silent network call.
3. **A fixture is executable state.** An interrupted call is not recorded, because a truncated stream would replay as an aborted turn. A call the permission kernel refused is not recorded, because the provider never saw it.
4. **Matching ignores the model id.** A recording made with one model replays under another, so a test does not break when a seat changes.
5. **A recording holds no key.** The recorder reads a key from `Config` and never writes it.
6. **No environment variable decides.** Whether a suite records or replays is the suite's own code. The library reads no `process.env`.
7. **A model in another process** is served over HTTP: `Test.modelServer({ fixture })` answers Chat Completions requests from a fixture, and a request it does not hold is a `501`, as in the reference engine's model server.
8. **A memory engine is not a crash test.** `Test.durable` proves a plan and a journal. Only `Test.restartable`, or a real store closed and reopened, proves recovery.
9. **Nine cases certify what they test.** `Test.conformance.engine()` is the reference engine's nine pins. A promise this set adds, such as signal delivery, needs its own case before a fork may claim it.
10. **Assertions are Effects and conformance cases are values.** They run under any runner.

### Host needs

`Test.replay`, `Test.host`, `Test.durable` and every assertion need nothing and run in a browser. `Test.record` writes a file and needs `FileSystem`. `Test.modelServer` needs an HTTP server.

## Maintainers' decisions

This is the decision record for the design above, including each API signature, rule and diagnostic table entry. The code examples illustrate those decisions. Will has not reviewed these choices.

- `Experimental.Test`, in scope with no import, as [VIP-33](0033-platform-stdlib.md) rules. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Its code is `vibelang-runtime/experimental/Test`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- It ports the reference engine's testing package. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Effect's `TestClock` and `TestConsole` keep their names and are in scope today. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- **Doubles**, each a layer: [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Layer `Test.replay(fixture)`: Stands in for: `LanguageModel`; Behavior: Strict. Each recorded call is claimed once; a request the fixture does not describe is a defect. It never calls a provider; Reference engine: `RecordedModel`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Each recorded call is claimed once; a request the fixture does not describe is a defect. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- It never calls a provider | `RecordedModel` | [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Layer `Test.record(path, { live })`: Stands in for: `LanguageModel`; Behavior: Replays `path`; on a miss it calls the `live` layer and writes the answer; Reference engine: `CachedModel`, `FixtureStore.makeFile`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Layer `Test.decisions(fixture)`, `Test.recordDecisions(path, { live })`: Stands in for: `DecisionModel`; Behavior: The same pair for decision models; Reference engine: `CachedEvaluator`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Layer `Test.host({ files, commands? })`: Stands in for: `FileSystem`, `Path`, `ChildProcessSpawner`; Behavior: A deterministic machine from a record; Reference engine: `TestHost.layer`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Layer `Test.durable`: Stands in for: The durable engine; Behavior: In memory, on a test clock; Reference engine: `TestLayers.unit`, `MemoryEngine`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Layer `Test.restartable`: Stands in for: The durable engine; Behavior: In memory, with `Test.crash` to kill and resume a run between steps; Reference engine: `RestartableEngine`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Layer `Test.poisoned`: Stands in for: Every service; Behavior: Any service read fails. Proves a workflow body is pure at plan time; Reference engine: `TestLayers.poisoned`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Proves a workflow body is pure at plan time | `TestLayers.poisoned` | [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- **Assertions**, each an Effect: [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Test.plan(W, ...args)`: Asserts: Nodes, edges and keys of the plan, before anything runs; Reference engine: `PlanAssertions`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Test.journal(run)`: Asserts: Which steps ran, in what order, how many attempts; Reference engine: `JournalAssertions`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Test.divergence(runA, runB)`: Asserts: The first attributable difference between two journals; Reference engine: `Divergence`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- **Conformance**, for a fork: [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Suite `Test.conformance.engine()`: Certifies: An engine: nine black-box cases for identity, interruption, replay and race; Reference engine: `Conformance.coreSuite`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Suite `Test.conformance.host()`: Certifies: A host bundle; Reference engine: `HostSuite.hostSuite`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Suite `Experimental.Sandbox.check(provider)`: Certifies: A sandbox provider ([std-sandbox](0067-std-sandbox.md)); Reference engine: `SandboxConformance.check`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- **The runner is `@effect/vitest`.** `it.effect` runs on a test clock, `it.live` on real time, as today. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `it.effect.fuzz` runs a property under [std-fuzz](0070-std-fuzz.md). [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Replay never spends.** `Test.replay` holds no live model. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Recording is a different call, `Test.record`, that names its live layer. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A missing recording is a failed test, never a silent network call. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A fixture is executable state.** An interrupted call is not recorded, because a truncated stream would replay as an aborted turn. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A call the permission kernel refused is not recorded, because the provider never saw it. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Matching ignores the model id.** A recording made with one model replays under another, so a test does not break when a seat changes. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A recording holds no key.** The recorder reads a key from `Config` and never writes it. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **No environment variable decides.** Whether a suite records or replays is the suite's own code. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- The library reads no `process.env`. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A model in another process** is served over HTTP: `Test.modelServer({ fixture })` answers Chat Completions requests from a fixture, and a request it does not hold is a `501`, as in the reference engine's model server. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A memory engine is not a crash test.** `Test.durable` proves a plan and a journal. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Only `Test.restartable`, or a real store closed and reopened, proves recovery. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Nine cases certify what they test.** `Test.conformance.engine()` is the reference engine's nine pins. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A promise this set adds, such as signal delivery, needs its own case before a fork may claim it. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Assertions are Effects and conformance cases are values.** They run under any runner. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `Test.replay`, `Test.host`, `Test.durable` and every assertion need nothing and run in a browser. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- `Test.record` writes a file and needs `FileSystem`. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- `Test.modelServer` needs an HTTP server. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).

### Adopted review answers

- Keep `Experimental.X` names under VIP-33. Promotion to a bare module name requires a later decision. [Review question 1](reviews/2026-11-09-built-in-set.md#1-experimentalagent-or-agent).

## Compared

The same test in the reference engine 1.x: the `label` function from [std-model](0062-std-model.md)'s comparison, under a recorded model. It type-checks against the reference engine's testing and model packages at 1.0.0-rc.16.

```ts
import { Model } from "@smthrs/model"
import { CachedModel, FixtureStore } from "@smthrs/testing"
import { expect, it } from "@smthrs/testing/Vitest"
import { Effect, Layer } from "effect"
import { label, layer } from "./std-model.js"

const model = Layer.unwrap(
  Effect.gen(function*() {
    const live = yield* Model.Model
    const store = yield* Effect.acquireRelease(FixtureStore.makeFile("fixtures/label.json"), (store) => store.flush())
    return CachedModel.layer({ live, fixture: store })
  })
).pipe(Layer.provide(layer("")))

it.effect("labels a crash as a bug", () =>
  Effect.gen(function*() {
    const result = yield* label("Crash on start")
    expect(result.type).toBe("bug")
  }).pipe(Effect.provide(model)))
```

| Program | Tokens (o200k_base) | Lines |
| --- | --- | --- |
| Vibe, proposed: the test and the 7-line function under test | 142 | 16 |
| Reference engine 1.x: the test alone; its function under test is 317 tokens more | 185 | 19 |

The reference engine test records and replays through one file store. The Vibe test replays an imported fixture; the recording form is `provide Experimental.Test.record("fixtures/label.json", { live: Experimental.Model.use(seat) })`.

**Checked.** The Vibe example uses only existing syntax and compiles under `vibelang` 0.0.13 against a declaration of `Experimental.Test.replay`, including the JSON import attribute and `it.effect` from `@effect/vitest` 4.1.1. The reference engine program type-checks as shown.

## Principles

- **TypeScript-first.** Vitest, unchanged. A double is a layer.
- **Effect-second.** `@effect/vitest`, `TestClock` and `TestConsole` are Effect's and stay. This module adds doubles for what Effect has no double of: a model, a durable engine, a guarded host.
- **Optimized for agentic programs.** A test of an agent runs in CI with no key and no network, in milliseconds.
- **Highly forkable.** Principle 4 asks that a fork be simple. Conformance suites are how a fork knows its engine or host still behaves.
- **Factory-first.** The factory records its model calls. A recording is a public artifact that replays.

## What this changes

- `Experimental.Test` is new. No grammar changes.
- `vibelang eval` ([eval-declarations](0059-eval-declarations.md)) provides `Test.replay` by default and `Test.record` under `--live`.

## Alternatives

- **One call that records on a miss and replays on a hit**, as the reference engine's `CachedModel` is. One name fewer. A deleted fixture then turns a free test run into a paid one with no change to the test. Two names keep the spend in the source.
- **Mock the model with a function.** It tests the mock. A recording is the provider's real answer.
- **A `test` keyword.** Vibe has none and needs none; see [eval-declarations](0059-eval-declarations.md) for the same decision about evals.
- **Record at the HTTP layer**, with a generic cassette library. It records keys unless scrubbed, breaks on a header change, and cannot ignore the model id.
- **Fold it into `Durable` and `Model`** as `Durable.test` and `Model.recorded`. Production modules would then carry test code into bundles.

## Follow-up questions

1. **Where fixtures live.** Beside the test, as `fixtures/<name>.json`? Recommendation: yes, and `Test.record` with a relative path resolves from the test file.
2. **A crash fuzzer.** `Test.restartable` crashes where a test says. [std-fuzz](0070-std-fuzz.md) could choose where. Listed there as a follow-up.
3. **Node 26.** The reference engine's testing package requires Node.js 26.4.0 or later; the rest of the reference engine requires 22.19.0. A standard-library module should not raise the floor. Recommendation: find and remove the Node 26 dependency in the port.

## Depends on

- [std-durable](0060-std-durable.md): the engines the doubles stand in for.
- [std-model](0062-std-model.md): the services the model doubles provide.
- [std-fuzz](0070-std-fuzz.md): `it.effect.fuzz`.
