# The ci-health flow: rank slow and flaky targets

The ci-health flow reads the build graph's results and logs and says where CI
loses time and trust: which targets cost the most, which gave two answers for
the same inputs, and which tests and causes are behind them. It writes a report
a person or a lane acts on. No step calls a model.

```text
collect ──▶ analyze ──▶ report
```

| Step | What it does | Writes |
| --- | --- | --- |
| collect | Reads each `<id>-graph.json` (`CI_RESULTS` in `scripts/ci.sh`) in the results directory. A file cut off mid-write is counted, not read | `collect.json` |
| analyze | Finds each target and key that both passed and failed, reads the matching `<id>-graph.log`, names the failed tests (bun, `node --test`, `go test`) and classifies the cause. Ranks targets by total run time; a cache replay proves a key passed, but its time does not count | `analyze.json` |
| report | The flaky targets with their causes, next step and last failure, the flaky tests, and the slow targets | `report.json`, `report.md` |

A key hashes a target's declared inputs. A key that passed and failed is a flake
or an undeclared input: code cannot explain it, because the code did not change.
A key that only failed is a real break, and the flow ignores it. A property test
draws a new seed each run, so its key can pass and fail too. The report names that
cause `property counterexample`: it is a real bug, and the log prints the replay.

Check a test's last failure before fixing it. An old date usually means someone
already did.

## Run it

```sh
cd .smithers && bun flows/ci-health/run.ts --run <run dir> --results <results dir>
cd .smithers && bun flows/ci-health/run.ts --run <run dir> --results <results dir> --since 2026-10-30T00:00:00Z
```

Point `--results` at a directory where CI runs write `CI_RESULTS` and the graph
log beside it. Use a new run directory each time: a finished run returns its
recorded result.

## The eval

`eval.ts` runs the flow, unmocked, over `fixture/`: real results and logs cut
from 2026-10-30 and 2026-10-31, with paths scrubbed and runs renamed.

| Scorer | 1 when |
| --- | --- |
| `flaky` | The report names exactly the three flaky targets, and not the target that was really broken |
| `tests` | The report names the known flaky tests |
| `causes` | Each target's top cause matches the logs |
| `slow` | Targets rank by run time, and a target that only replayed never ranks |

```sh
cd .smithers && bun flows/ci-health/eval.ts            # compare with baseline.json; exit 1 on a drop
cd .smithers && bun flows/ci-health/eval.ts --update   # record baseline.json
```
