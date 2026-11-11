# VIP-70: `Experimental.Fuzz`: fuzzing and deterministic fiber simulation

**Status:** open, 2026-11-11. Not part of the language: Will limited the alpha to the core VIPs and reopened this one as a proposal ([VIPs](README.md#the-built-in-set)). It was accepted optimistically on 2026-11-09 under his pre-alpha standing approval, since superseded; Will has not reviewed this VIP's decisions. An experimental implementation exists: the runtime modules `Experimental.Fuzz` and `Experimental.FuzzSimulation`.

## Will's words

> Ok so give me a list of [the reference engine's] features. We need to figure out what the VIP should look like. Some of the features outside of durable execution likely should simply be in the standard library I'm guessing but we should enumerate all of them

## Summary

**One sentence.** `Experimental.Fuzz.run` generates inputs from a schema, keeps the ones that made the program do something new, mutates them, and reports a shrunk, replayable failure; with `Experimental.FuzzSimulation` it also chooses how fibers interleave.

**One paragraph.** Property testing runs a law on random inputs. It misses a failure that hides behind conditions random inputs rarely meet together: a magic number, a protocol prefix, a precise sequence of commands, one interleaving of two fibers. The fuzz package of the reference engine (an existing Effect durable-execution framework these built-ins are modelled on) finds those. It uses the spans an Effect program already has as coverage, so `Effect.fn("Bank.withdraw")` is a coverage point with no instrumentation. Its simulation mode makes the scheduler and the clock part of the input, so a race is found, shrunk and replayed the same way a bad value is. This VIP ports it unchanged and adds one convenience: a Vibe `schema` is accepted where an `Arbitrary` is.

```text
 seed ─► pick a kept input ─► mutate ─► generate a value ─► run the property
                                                                 │
   kept inputs ◄── new feedback: spans, error tags, observations ┤
                                                                 │
                       failure ─► shrink, same signature ─► recheck ─► finding + replay token
```

## Decision

```ts
// proposed
schema Bytes = ReadonlyArray<number>

effect function parse(bytes: Bytes) {
  try Experimental.Fuzz.observe(`length:${Math.min(bytes.length, 4)}`)
  return bytes.length
}

export effect function campaign() {
  const report = try Experimental.Fuzz.run(Bytes, (bytes) => as(parse(bytes), true), { seed: 1, executions: 500_000 })
  return Experimental.Fuzz.formatReport(report)
}
```

### Module

`Experimental.Fuzz` and `Experimental.FuzzSimulation`, in scope with no import. Their code is `vibelang-runtime/experimental/Fuzz`. Of this set's modules, this one fits [VIP-33](0033-platform-stdlib.md)'s rule most exactly: the reference engine keeps the source "file for file with `smithersai/effect`" at a named commit, "because we intend to contribute it to Effect".

| Call | Meaning |
| --- | --- |
| `Fuzz.run(input, property, options?)` | Run a campaign. `input` is a schema or an `Arbitrary`. Gives a report |
| `Fuzz.target(input, property, { id, revision, codec? })`, `Fuzz.runTarget(target, options)` | A property with a stable identity, so a corpus store can keep its failures between runs |
| `Fuzz.observe(label)` | Record that execution reached a stage. Does nothing outside a fuzz run |
| `Fuzz.score(label, value)` | A number to maximize, which turns a needle into a hill |
| `Fuzz.formatReport(report)` | A printable diagnostic, or `undefined` when the run passed |
| `Fuzz.Corpus` | The service that stores inputs and confirmed failures |
| `FuzzSimulation.execution()` | An execution mode in which fiber scheduling and time are fuzzed |

Options of `Fuzz.run`: `seed`, `executions`, `duration`, `plateau`, `maxFindings`, `feedback`, `execution`, `replay`.

### Rules

1. **The property contract is `Arbitrary.checkEffect`'s.** Return `true`, or an Effect of `true`, to pass. Returning anything else, failing or dying is a finding. A defect is a finding because a crash is what fuzzing looks for.
2. **A run stops at the first of** `duration` (10 seconds when no budget is given), `executions`, `plateau` and `maxFindings` (1 by default). A run bounded only by `duration` does not run the same number of executions on every machine.
3. **Feedback comes from five sources**: spans, on by default; the exit tag and each error tag; `Fuzz.observe` labels; `Fuzz.score` values; and the structure of the generated input. A report that lists only structure and causes says nothing measured coverage.
4. **A finding has a signature**: `ReturnedFalse`, `PropertyError:<tag>`, `Died:<constructor>` or `Deadlock`. Shrinking keeps the signature, so one failure never shrinks into another.
5. **A finding is confirmed.** Its final input is run once more. One that does not fail the same way twice is reported as flaky, never as falsified.
6. **A finding replays.** `finding.replay` is a token holding the generator tape, the schedule tape and the shrink path. `Fuzz.run(input, property, { replay })` reproduces it. A token replayed against a changed generator is a mismatch, not a pass.
7. **Confirmed failures are saved as values**, encoded with the schema's JSON codec, so they survive a change to the generator. Kept inputs are a search cache tied to `revision`.
8. **Simulation is a closed world.** Under `FuzzSimulation.execution()`, each execution has its own scheduler and a virtual clock that jumps to the next timer when nothing can run. A program with nothing runnable, no pending timer and an unfinished property is a `Deadlock` finding.
9. **The closed world has edges.** Real I/O, a foreign Promise, `Date.now` and shared mutable state are outside it, and a property that touches them is not deterministic. A synchronous loop that never yields cannot be interrupted; bound such a property with a process or a worker.
10. **In a test,** `it.effect.fuzz` runs a property under the fuzzer for a bounded number of executions ([std-test](0071-std-test.md)).

Evidence from the reference engine's fuzz guide (`packages/fuzz/docs/README.md`): a parser with a four-byte magic number passes `checkEffect` after 100,000 runs. `Fuzz.run` finds the crash with each of seeds 1 to 8, in a median of 93,017.5 executions, guided only by the parser's own spans. Two withdrawals that read, check and write a balance are found as a lost update at execution 5 under the simulation and shrunk to amounts `[1, 1]`.

### Host needs

None. The package runs in a browser, a Worker, Node and Bun. A file-backed corpus needs `FileSystem` and lives with the test integration.

## Maintainers' decisions

This is the decision record for the design above, including each API signature, rule and diagnostic table entry. The code examples illustrate those decisions. Will has not reviewed these choices.

- `Experimental.Fuzz` and `Experimental.FuzzSimulation`, in scope with no import. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Their code is `vibelang-runtime/experimental/Fuzz`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Of this set's modules, this one fits [VIP-33](0033-platform-stdlib.md)'s rule most exactly: the reference engine keeps the source "file for file with `smithersai/effect`" at a named commit, "because we intend to contribute it to Effect". [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Fuzz.run(input, property, options?)`: Meaning: Run a campaign. `input` is a schema or an `Arbitrary`. Gives a report. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- `input` is a schema or an `Arbitrary`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Gives a report | [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Fuzz.target(input, property, { id, revision, codec? })`, `Fuzz.runTarget(target, options)`: Meaning: A property with a stable identity, so a corpus store can keep its failures between runs. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Fuzz.observe(label)`: Meaning: Record that execution reached a stage. Does nothing outside a fuzz run. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Does nothing outside a fuzz run | [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Fuzz.score(label, value)`: Meaning: A number to maximize, which turns a needle into a hill. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Fuzz.formatReport(report)`: Meaning: A printable diagnostic, or `undefined` when the run passed. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Fuzz.Corpus`: Meaning: The service that stores inputs and confirmed failures. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `FuzzSimulation.execution()`: Meaning: An execution mode in which fiber scheduling and time are fuzzed. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Options of `Fuzz.run`: `seed`, `executions`, `duration`, `plateau`, `maxFindings`, `feedback`, `execution`, `replay`. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- **The property contract is `Arbitrary.checkEffect`'s.** Return `true`, or an Effect of `true`, to pass. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Returning anything else, failing or dying is a finding. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A defect is a finding because a crash is what fuzzing looks for. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A run stops at the first of** `duration` (10 seconds when no budget is given), `executions`, `plateau` and `maxFindings` (1 by default). [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A run bounded only by `duration` does not run the same number of executions on every machine. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Feedback comes from five sources**: spans, on by default; the exit tag and each error tag; `Fuzz.observe` labels; `Fuzz.score` values; and the structure of the generated input. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A report that lists only structure and causes says nothing measured coverage. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A finding has a signature**: `ReturnedFalse`, `PropertyError:<tag>`, `Died:<constructor>` or `Deadlock`. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Shrinking keeps the signature, so one failure never shrinks into another. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A finding is confirmed.** Its final input is run once more. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- One that does not fail the same way twice is reported as flaky, never as falsified. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A finding replays.** `finding.replay` is a token holding the generator tape, the schedule tape and the shrink path. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `Fuzz.run(input, property, { replay })` reproduces it. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A token replayed against a changed generator is a mismatch, not a pass. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Confirmed failures are saved as values**, encoded with the schema's JSON codec, so they survive a change to the generator. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Kept inputs are a search cache tied to `revision`. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Simulation is a closed world.** Under `FuzzSimulation.execution()`, each execution has its own scheduler and a virtual clock that jumps to the next timer when nothing can run. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A program with nothing runnable, no pending timer and an unfinished property is a `Deadlock` finding. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **The closed world has edges.** Real I/O, a foreign Promise, `Date.now` and shared mutable state are outside it, and a property that touches them is not deterministic. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A synchronous loop that never yields cannot be interrupted; bound such a property with a process or a worker. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **In a test,** `it.effect.fuzz` runs a property under the fuzzer for a bounded number of executions ([std-test](0071-std-test.md)). [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Evidence from the reference engine's fuzz guide (`packages/fuzz/docs/README.md`): a parser with a four-byte magic number passes `checkEffect` after 100,000 runs. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `Fuzz.run` finds the crash with each of seeds 1 to 8, in a median of 93,017.5 executions, guided only by the parser's own spans. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Two withdrawals that read, check and write a balance are found as a lost update at execution 5 under the simulation and shrunk to amounts `[1, 1]`. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- None. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- The package runs in a browser, a Worker, Node and Bun. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- A file-backed corpus needs `FileSystem` and lives with the test integration. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- `Experimental.FuzzSimulation` has its own subpath, `vibelang-runtime/experimental/FuzzSimulation`, beside `vibelang-runtime/experimental/Fuzz`, as every `Experimental` module does; the upstream copy keeps it under `testing/`. [Design](#module).

### Adopted review answers

- Keep `Experimental.X` names under VIP-33. Promotion to a bare module name requires a later decision. [Review question 1](reviews/2026-11-09-built-in-set.md#1-experimentalagent-or-agent).

## Compared

The same campaign in the reference engine 1.x, in the form of the guide's first example.

```ts
import { Fuzz } from "@smthrs/fuzz"
import { Arbitrary, Effect, Schema } from "effect"

const Bytes = Schema.Array(Schema.Number)

const parse = (bytes: ReadonlyArray<number>) =>
  Effect.gen(function*() {
    yield* Fuzz.observe(`length:${Math.min(bytes.length, 4)}`)
    return bytes.length
  })

export const main = Effect.gen(function*() {
  const report = yield* Fuzz.run(Arbitrary.schema(Bytes), (bytes) => parse(bytes).pipe(Effect.as(true)), {
    seed: 1,
    executions: 500_000
  })
  return Fuzz.formatReport(report)
})
```

| Program | Tokens (o200k_base) | Lines |
| --- | --- | --- |
| Vibe, proposed | 90 | 11 |
| Reference engine 1.x | 143 | 18 |

**Checked.** The Vibe example uses only existing syntax and compiles under `vibelang` 0.0.13 against a declaration of `Experimental.Fuzz`. The reference engine program is not type-checked here: its fuzz package is private to the reference engine's repository and is not on npm.

## Principles

- **TypeScript-first.** Function calls.
- **Effect-second.** This is the module the principle describes best. It builds on Effect's `Arbitrary`, spans and scheduler, and it is written to go upstream.
- **Optimized for agentic programs.** Agentic programs are concurrent and long-lived. A race in a tool loop is found by a machine before a user finds it.
- **Highly forkable.** Feedback sources are injected. A fork adds coverage from another signal with one value.
- **Factory-first.** Vibe's own compiler is fuzzed; the factory's spec says the language is "built optimistically and fuzz tested". This module gives a user's program the same check.

## What this changes

- `Experimental.Fuzz` and `Experimental.FuzzSimulation` are new. No grammar changes.
- `Fuzz.run` accepts a schema directly. The reference engine's takes an `Arbitrary`; the port adds one overload that calls `Arbitrary.schema`.

## Alternatives

- **Property tests only**, with `it.effect.prop`. In scope today. The guide's evidence shows what it misses.
- **A `property` or `fuzz` declaration**, as `theorem` is. A theorem is proved and erased. A property is run, and a function already says everything it needs.
- **Simulation as the default execution.** It finds races, and it runs each execution on its own scheduler, which costs time a pure parser does not need. It stays an option.
- **A native fuzzer**, such as libFuzzer through a binding. It sees bytes and branches, not fibers, spans or typed errors.

## Follow-up questions

1. **Fuzzing a workflow.** A `workflow` has a plan, and a durable engine has crash points. A fuzzer that picks where the process dies would test replay directly. The reference engine's testing package has restart suites, not a crash fuzzer. Recommendation: a follow-up VIP once [std-durable](0060-std-durable.md) is built.
2. **The package is private.** Porting it means publishing it or waiting for Effect. Recommendation: publish it in `vibelang-runtime` and keep the file-for-file copy, so the move to Effect's own module is a change of import.
3. **Upstream timing.** When Effect ships a `Fuzz` module, `Experimental.Fuzz` is retired and bare `Fuzz` is Effect's ([VIP-14](0014-effect-modules-in-scope.md)). Who proposes it upstream, and when? Recommendation: the reference engine's team, after one Vibe release has used it.

## Depends on

- Nothing in this set. [std-test](0071-std-test.md) uses it.
