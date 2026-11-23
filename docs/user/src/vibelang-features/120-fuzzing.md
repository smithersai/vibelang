# Fuzzing with Experimental.Fuzz

> **Open proposal ([VIP-70](https://vibelang.sh/vips/0070-std-fuzz)), experimental, not part of the alpha.** Requires `"vibe": { "experimental": ["builtins"] }` in `tsconfig.json` or `vibe.config.json`; without it the compiler reports `EK3013`. Any release may change or remove it.

`Experimental.Fuzz.run` generates inputs from a schema, keeps inputs that trigger new coverage feedback, mutates them, and reports shrunk, replayable failures. Paired with `Experimental.FuzzSimulation.execution()`, it also controls fiber interleaving and virtual timers to find, shrink, and replay concurrency races and deadlocks. Both modules are in scope once opted in (implemented at `vibelang-runtime/experimental/Fuzz` and `vibelang-runtime/experimental/FuzzSimulation`), require no layer, and run in browsers, Workers, Node, and Bun.

Mirrored file-for-file from a `Fuzz` module written for Effect so it can transition directly when Effect ships one ([VIP-70](https://vibelang.sh/vips/0070-std-fuzz#decision)). Like the other [experimental APIs](118-experimental-platform-apis.md), any release may change or remove it.

```text
 seed ─► pick a kept input ─► mutate ─► generate a value ─► run the property
                                                                 │
   kept inputs ◄── new feedback: spans, error tags, observations ┤
                                                                 │
                       failure ─► shrink, same signature ─► recheck ─► finding + replay token
```

## When to use it

Use `Arbitrary.checkEffect` for laws that random inputs test well. Use `Experimental.Fuzz` when failures hide behind narrow conditions—magic bytes, protocol prefixes, command sequences, or rare fiber interleavings.

## A first run

The parser below fails only when input starts with `0x7f 0x45`. `Fuzz.observe` labels mark each matched byte so the fuzzer keeps closer inputs and reaches the failure:

```vibe
// run: try Console.log(try firstRun())
// experimental: builtins
const Byte = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))

effect function parse(bytes: ReadonlyArray<number>) {
  if (bytes[0] !== 0x7f) return true
  try Experimental.Fuzz.observe("magic 1")
  if (bytes[1] !== 0x45) return true
  try Experimental.Fuzz.observe("magic 2")
  return false
}

export effect function firstRun() {
  const report = try Experimental.Fuzz.run(Schema.Array(Byte), parse, { seed: 1, executions: 50_000 })
  return report._tag === "Falsified" ? report.findings[0].input : report._tag
}
// Output: [ 127, 69 ]
```

The first argument is a schema (compiled via `Arbitrary.schema`, including `schema` declarations) or an Effect `Arbitrary`. `Fuzz.formatReport(report)` returns a diagnostic string, or `undefined` on pass.

The property contract matches `Arbitrary.checkEffect`: return `true` (or an Effect of `true`) to pass; any other value, typed failure, or defect is a finding, while interruption propagates. Properties must be deterministic and must not mutate their input.

## Budgets

A run stops at the first reached limit:

| Option | Stops after | Default |
| --- | --- | --- |
| `duration` | Wall time | `10 seconds` (when no other budget is set) |
| `executions` | Execution count | None |
| `plateau` | Executions without new feedback or findings | None |
| `maxFindings` | Distinct failure signatures | `1` |

Use `executions` in tests for machine-independent determinism. `seed` makes runs reproducible (otherwise drawn randomly and recorded in `report.stats.seed`). `size` defaults to `100` and `maxShrinks` defaults to `1,000`.

## What guides the search

| Source | Records | Setup |
| --- | --- | --- |
| Spans | `(parent span, span)` edges (`Effect.fn("Bank.withdraw")` or `withSpan`) | On by default (`feedback: []` disables) |
| Causes | Exit tag, error `_tag`, defect constructor | Always |
| Observations | `Experimental.Fuzz.observe(label)` calls | Call at milestones |
| Scores | Highest `Experimental.Fuzz.score(label, value)` per label | Call to climb toward a goal |
| Structure | Generated input shape | Always |

VibeLang does not emit automatic spans; wrap `effect function` calls with `withSpan(program, "name")` ([Tracing](../observability/033-tracing.md)) or use `observe`/`score` (no-ops outside a fuzz run, safe to leave in production code). Passing negative distance to `score` turns a needle into a hill:

```vibe
// run: try Console.log(try climb())
// experimental: builtins
const Wide = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000_000 }))

export effect function climb() {
  const report = try Experimental.Fuzz.run(Wide, effect (n) => {
    try Experimental.Fuzz.score("closeness", -Math.abs(n - 777_777_777))
    return n !== 777_777_777
  }, { seed: 1, executions: 100_000, feedback: [] })
  return report._tag === "Falsified" ? report.findings[0].input : report._tag
}
// Output: 777777777
```

`feedback` replaces spans with custom `Experimental.Fuzz.Feedback` (`{ name, measure }`) collectors. Disable spans if span names include dynamic data such as IDs. A report showing `"structural exploration"` means only structure and causes were active.

## Findings

| Report `_tag` | Meaning |
| --- | --- |
| `Passed` | No failure within budget |
| `Falsified` | `findings` holds distinct failures; `flaky` holds non-repeating failures |
| `Flaky` | Every failure was flaky |
| `Exhausted` | Every execution was discarded |
| `ReplayMismatch` | Replay token no longer regenerates its input |

Each finding has a `signature` (`ReturnedFalse`, `PropertyError:<tag>`, `Died:<constructor>`, or `Deadlock`) preserved during shrinking. Every final shrunk input is rechecked; non-repeating failures are classified as flaky (indicating shared state or real-time dependence).

`finding.replay` stores the generator tape, schedule tape, and shrink path. `Experimental.Fuzz.run(input, property, { replay })` reproduces it (ignoring all options except `execution`), reporting `ReplayMismatch` if the generator changed.

## Keeping failures between runs

`Experimental.Fuzz.target(input, property, { id, revision, codec? })` gives a property a stable identity, and `Experimental.Fuzz.runTarget(target, options)` runs it against the `Experimental.Fuzz.Corpus` service (replaying saved failures, then saved inputs, then searching; defaults to an in-memory corpus per run):

```vibe
// run: try Console.log(try twice())
// experimental: builtins
const Digit = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 }))
const pin = Experimental.Fuzz.target(Schema.Array(Digit), (digits) => !(digits[0] === 7 && digits[1] === 9), { id: "pin", revision: "1" })

export effect function twice() {
  provide Layer.succeed(Experimental.Fuzz.Corpus, Experimental.Fuzz.memoryCorpus()) {
    const first = try Experimental.Fuzz.runTarget(pin, { seed: 1, executions: 20_000 })
    const second = try Experimental.Fuzz.runTarget(pin, { seed: 2, executions: 0 })
    return [first._tag, second._tag === "Falsified" ? second.findings[0].execution : second._tag]
  }
}
// Output: [ 'Falsified', 0 ]
```

Schema-backed failures save as JSON values (surviving generator changes); `Arbitrary` failures without a codec save as tapes tied to `revision`, as do cached inputs. `executions: 0` replays saved failures only (regression mode). A corpus store is any `{ load, save }` value—store errors fail the run with `FuzzError` (`reason: "Corpus"`), and file-backed stores use `FileSystem`.

## Races and deadlocks

`Experimental.FuzzSimulation.execution()` runs in a closed world with a controlled scheduler and virtual clock (jumping to the next timer when idle). The fuzzer mutates the schedule tape (operations per fiber before yield) alongside inputs, exposing races invisible under the default scheduler:

```vibe
// run: try Console.log(try lostUpdate())
// experimental: builtins
effect function withdraw(balance: Ref<number>, paid: Ref<number>, amount: number) {
  const current = try Ref.get(balance)
  if (current < amount) return
  try Ref.set(balance, current - amount)
  try Ref.update(paid, (total) => total + amount)
}

const Amount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))

effect function conserved(amounts: readonly [number, number]) {
  const balance = try Ref.make(100)
  const paid = try Ref.make(0)
  try Effect.all([withdraw(balance, paid, amounts[0]), withdraw(balance, paid, amounts[1])], { concurrency: 2 })
  return (try Ref.get(balance)) + (try Ref.get(paid)) === 100
}

export effect function lostUpdate() {
  const report = try Experimental.Fuzz.run(Schema.Tuple([Amount, Amount]), conserved, {
    seed: 1,
    executions: 2_000,
    execution: Experimental.FuzzSimulation.execution(),
  })
  return report._tag === "Falsified" ? report.findings[0].input : report._tag
}
// Output: [ 1, 1 ]
```

Same seed reproduces the exact schedule, and `finding.replay` replays the interleaving. No runnable fibers, no pending timers, and an unfinished property reports `Deadlock`; hitting `maxSteps` (default `100,000`) discards the execution.

**Closed-world boundaries:** Real I/O, external Promises, `Date.now`, `Math.random`, and shared mutable state break determinism (causing false deadlocks or replay divergence)—provide in-memory services instead. Unyielding synchronous loops cannot be interrupted; bound them with a process or worker.
