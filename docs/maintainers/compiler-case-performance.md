# Compiler-case performance reports

A compiler case's deadline catches a hang. It does not show that a passing case has become slower. Retain repeated measurements separately from the correctness gate; performance alerts are informational while a reserved-capacity baseline is being established.

## Record trials

Build the compiler and runtime as described in [the compiler guide](../../typescript/VIBELANG.md#build-and-test). The harness uses `typescript/built/local/tsc`; record that binary's build revision. From `typescript/`, with the pinned Effect install and an absolute runtime path:

```sh
EFFECT_NODE_MODULES=$PWD/../experiments/node_modules \
VIBELANG_RUNTIME=$PWD/../packages/runtime \
  node vibelang/harness.mjs --isolated --jobs 1 \
  --report ../.cache/case-baseline/1.json stack-depth ts-hello
```

Repeat with new paths `2.json` and `3.json`, then measure the candidate build into a separate directory such as `.cache/case-current/`. Use the same case sources, runtime files, dependencies, tool versions, scheduling settings and reserved CPU capacity. Record their revisions alongside the reports. The harness records the compiler's SHA-256 and environment; package versions and CPU metadata alone do not prove that runtime contents, sources or competing host work stayed the same.

A survey can select the ten slowest successful cases plus `stack-depth`; collect the comparison trials with that exact selection and `--jobs 1`. Each directory must contain only its trial JSON reports, at least three from independent invocations of one compiler build. Keep all trials; select capacity and case sets before collecting them.

## Compare trials

Run from the repository root, writing outside the input directories:

```sh
node scripts/bench/case-timings.mjs \
  --baseline .cache/case-baseline --current .cache/case-current \
  --out .cache/case-comparison.json
```

The tool computes each case's median total wall time and median time per command phase, summing repeated commands in the same phase within a trial. It prints the ten slowest current cases and a `REGRESSION` line wherever the current median is **more than 50%** above baseline. Exactly `1.5x` produces no alert. The JSON retains every row, both compiler hashes and all input paths. Raw timings remain in the original reports.

A valid comparison exits `0`, alerts included, so collecting this report does not turn the correctness gate red. Invalid evidence exits `2` and writes `valid: false` with the cause. Interrupted reports, non-`ok` case outcomes, missing phases, invalid timings, failed processes, fewer than three trials, duplicate invocations and mixed compiler builds within a group are invalid. Expected compiler-error cases with status `ok` and compiler exit `1` or `2` remain valid samples.

The case and phase sets and reported environments must match across all trials. The baseline and candidate compiler hashes may differ; Node, dependency versions, CPU metadata, worker count, isolation and delayed scheduling must agree. Existing output paths are refused. The tool reads the inputs without changing them and does not update a baseline or change any deadline.

An alert identifies a case and phase to investigate; it does not establish a compiler regression by itself. Reproduce on reserved capacity, inspect the retained commands and outputs, and compare unchanged workloads before attributing a slowdown. A self-comparison or a deliberately mutated receipt checks the reporter, not compiler speed.
