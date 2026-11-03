# The ci-health flow: rank slow and flaky targets

The ci-health flow reads the build graph's results and logs and says where CI
loses time and trust: which targets cost the most, which got slower, which gave
two answers for the same inputs, and which tests and causes are behind them. It writes a report
a person or a lane acts on. No step calls a model.

```text
collect ──▶ analyze ──▶ report
```

| Step | What it does | Writes |
| --- | --- | --- |
| collect | Reads each `<id>-graph.json` (`CI_RESULTS` in `scripts/ci.sh`) in the results directory. A file cut off mid-write is counted, not read | `collect.json` |
| analyze | Finds each target and key that both passed and failed, reads the matching `<id>-graph.log`, names the failed tests (bun, `node --test`, `go test`) and classifies the cause. Ranks targets by total run time; a cache replay proves a key passed, but its time does not count. Compares each target's median run time after `--split` with its median before | `analyze.json` |
| report | The flaky targets with their causes, next step and last failure, the flaky tests, the slower targets, and the slow targets | `report.json`, `report.md` |

A key hashes a target's declared inputs. A key that passed and failed is a flake
or an undeclared input: code cannot explain it, because the code did not change.
A key that only failed is a real break, and the flow ignores it. A property test
draws a new seed each run, so its key can pass and fail too. The report names that
cause `property counterexample`: it is a real bug, and the log prints the replay.

`Go cache archive` identifies a Go import whose content-addressed compiled archive was missing. The hash must match its two-digit cache bucket. Inspect the cache and its cleanup or transport; this log does not identify what removed the file. Missing repository inputs keep the separate `missing file` cause and its input-declaration guidance.

Check a test's last failure before fixing it. An old date usually means someone
already did.

A target got slower when, with at least five runs on each side of the split,
its median after it is at least 1.5 times its median before it and 30 s
longer, or when a run after the split ended with `timed out after`. The report
names the first slow run, from which most of the next five were slow: look at
what landed just before it. On 2026-11-02 `//packages:compiler-test` went from
a 138 s to a 478 s median on cf pre-gate boxes, with two timeouts, when the
migrate suites joined it, and no report said so for four hours.

## Run it

```sh
cd .smithers && bun flows/ci-health/run.ts --run <run dir> --results <results dir>
cd .smithers && bun flows/ci-health/run.ts --run <run dir> --results <results dir> --since 2026-10-30T00:00:00Z
cd .smithers && bun flows/ci-health/run.ts --run <run dir> --results <results dir> --split 2026-11-02T00:00:00Z
```

Without `--split`, the split falls at the middle run.

Point `--results` at a directory where CI runs write `CI_RESULTS` and the graph
log beside it. Use a new run directory each time: a finished run returns its
recorded result.

## The eval

`eval.ts` runs the flow, unmocked, over `fixture/`: real results and logs cut
from 2026-10-30 and 2026-10-31, with paths scrubbed and runs renamed.

A second case, `regression`, runs it over `fixture-regression/`:
`//packages:compiler-test` and `//:docs-tools` from 22 real cf pre-gates, 10
on 2026-11-01 and 12 on 2026-11-02 after the migrate suites joined
compiler-test, two of which timed out. `times.json` gives each run's time; the
eval sets it as the file's mtime on a copy, which is what `collect` reads.

The `go-cache-archive` eval runs the flow on `fixture-go-cache/`: a real failed build and its same-key successful retry. It checks cache attribution and the absence of fictional test names because compilation failed before tests ran. The duration-regression case remains separate.

| Scorer | 1 when |
| --- | --- |
| `flaky` | The report names exactly the three flaky targets, and not the target that was really broken |
| `tests` | The report names the known flaky tests |
| `causes` | Each target's top cause matches the logs |
| `slow` | Targets rank by run time, and a target that only replayed never ranks |
| `regressed` | The report names exactly `//packages:compiler-test` as slower, with its two timeouts; `//:docs-tools`, 1.4 times slower under load, is not named |

A scorer whose field a case does not state scores 1 there.

```sh
cd .smithers && bun flows/ci-health/eval.ts            # compare with baseline.json; exit 1 on a drop
cd .smithers && bun flows/ci-health/eval.ts --update   # record baseline.json
```
