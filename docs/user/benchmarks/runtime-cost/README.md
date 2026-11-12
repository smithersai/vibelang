# Runtime cost benchmark

This benchmark produces the table in [Runtime cost](../../src/vibelang-features/114-vibelang-for-effect-users.md#runtime-cost). It times five sequential loops: three written in VibeLang and two written in Effect TypeScript.

## Loops

Every loop calls a step that increments a number and fails with an `Overflow` error when the next value is a multiple of 250,000. The recovering loops reset the number to zero on that failure. The two 200,000-call loops end before the first failure.

| Loop | Source | Calls |
| --- | --- | ---: |
| `tryLoop`: `n = try step(n)`, where `step` is an `effect function` with the contract `number!Overflow` | `src/vibe-loops.vibe` | 200,000 |
| `fnLoop`: `n = yield* fnStep(n)`, where `fnStep` is an `Effect.fn` generator | `src/effect-loops.ts` | 200,000 |
| `catchLoop`: `n = step(n) catch () => 0` | `src/vibe-loops.vibe` | 1,000,000 |
| `orElseSucceedLoop`: `n = yield* Effect.orElseSucceed(directStep(n), () => 0)`, where `directStep` returns `Effect.succeed` or `Effect.fail` | `src/effect-loops.ts` | 1,000,000 |
| `plainLoop`: `n = plainStep(n)` in an `effect function`, where `plainStep` is a plain function with the same arithmetic | `src/vibe-loops.vibe` | 1,000,000 |

## Method

`run.mjs` compiles `src/` with one `vibelang -p .` run, then starts a separate Node process for each loop. Each process:

1. Checks the loop's result after 1,000 calls, after 250,001 calls for a recovering loop, and after the full count.
2. Runs the loop twice untimed, as a warm-up.
3. Runs the loop 10 times. Each run is one `Effect.runSync(loop(calls))` call between two `performance.now()` readings.

`results.json` records every run in milliseconds, the minimum, median and maximum, the median per call, the machine and the versions. `run.mjs` also prints the docs table rows.

The 0.0.9 benchmark behind the earlier table was not kept. This one keeps its loop shapes and call counts, with three changes:

- It times with `performance.now()` instead of `Clock.currentTimeMillis`, because the plain loop takes under one millisecond.
- The plain-function loop calls `plainStep`, which has the same arithmetic as `step`, instead of `double`.
- Each loop runs in its own process, with warm-up runs before the timed runs.

## Rerun

Install the packages that `package.json` pins, then run the benchmark:

```sh
npm install
node run.mjs
```

| Option | Default | Effect |
| --- | --- | --- |
| `--trials N` | `10` | Timed runs per loop. |
| `--warmup N` | `2` | Untimed runs per loop before the timed runs. |
| `--cpu N` | none | Runs each loop under `taskset -c N` (Linux). |
| `--commit ID` | none | Records the source commit of a compiler built from a checkout. |
| `--out FILE` | `results.json` | Where the results go. |
| `--no-build` | off | Times the existing `dist/` without compiling. |

To time a compiler built from a source checkout, set `VIBELANG` to its binary, as in `VIBELANG=/path/to/vibelang node run.mjs --commit <id>`. The runtime and Effect still come from `node_modules`.

After a rerun, paste the printed rows into the docs table and update the versions and machine it states. `bun test runtime-cost-benchmark.test.mjs` in `docs/tools` fails until the page matches `results.json`, and until the run used the Effect version that `packages/runtime/package.json` pins.

## Committed results

The committed `results.json` comes from a shared Linux x64 server with an AMD EPYC 7443P 24-Core Processor and 48 logical CPUs. Other jobs were running: the 1-minute load average was 39 at the start and 41 at the end. The run used the 0.0.13 compiler built from commit `d8981f70`, `vibelang-runtime` 0.0.13, Effect 4.1.1 and Node 26.5.0.

The run was not pinned to a CPU. On this machine `--cpu` did not narrow the spread between runs: a pinned process shares its one CPU with V8's garbage collector threads, and other jobs can still run on it.
