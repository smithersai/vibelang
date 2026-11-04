# The ci-health flow: rank slow and flaky targets

The ci-health flow reads the build graph's results and logs and says where CI
loses time and trust: which targets cost the most, which got slower, which gave
two answers for the same inputs, which tests failed again after their target passed, and which tests and causes are behind them. It writes a report
a person or a lane acts on. No step calls a model.

```text
collect ──▶ analyze ──▶ report
```

| Step | What it does | Writes |
| --- | --- | --- |
| collect | Reads each `<id>-graph.json` (`CI_RESULTS` in `scripts/ci.sh`) in the results directory. A file cut off mid-write is counted, not read | `collect.json` |
| analyze | Finds each target and key that both passed and failed, and each test that failed, passed with its target, and failed again under any keys, reads the matching `<id>-graph.log`, names the failed tests (bun, `node --test`, `go test`) and classifies the cause. Ranks targets by total run time; a cache replay proves a key passed, but its time does not count. Compares each target's median run time after `--split` with its median before | `analyze.json` |
| report | The flaky targets with their causes, next step and last failure, the flaky tests, the intermittent tests, the slower targets, and the slow targets | `report.json`, `report.md` |

A key hashes a target's declared inputs. A key that passed and failed is a flake
or an undeclared input: code cannot explain it, because the code did not change.
A key that only failed is a real break, and the flow ignores it. A property test
draws a new seed each run, so its key can pass and fail too. The report names that
cause `property counterexample`: it is a real bug, and the log prints the replay.

Post-merge runs change most keys every run, so a timing flake there seldom
repeats a key. The intermittent tests catch it instead: a test that failed,
then passed with its target, then failed again, under any keys. On 2026-11-03
and 2026-11-04 a 200 ms deadline test failed `//:mapper-scripts` in 4 of 11
post-merge runs under four keys while the flaky list stayed empty. A break
that was fixed and came back looks the same, so read the last failure.

`Go cache archive` identifies a Go import whose content-addressed compiled archive was missing. The hash must match its two-digit cache bucket. Inspect the cache and its cleanup or transport; this log does not identify what removed the file. Missing repository inputs keep the separate `missing file` cause and its input-declaration guidance.

`missing package` identifies Node package-resolution failures before an enclosing assertion can mask them. Check the importing module's pinned package installation and module root; missing source files retain the separate `missing file` cause.

The graph can place a failure's only diagnostic on the target summary line.
The analyzer retains that diagnostic, excluding command arguments from failure
evidence. `process startup` identifies a supervisor that could not start a
process in time; inspect startup handling and host capacity. It does not name a
failed test or imply that a test deadline needs changing.

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

The `missing-package` eval runs the actual flow on `fixture-missing-package/`: one unchanged target succeeds with its local package installed and fails after only that package is removed. It checks the cause and an empty test-name set. The real-run, duration-regression and Go-cache cases remain independent.

The `process-startup` eval runs the flow on `fixture-startup/`: a real
runtime-build startup failure and successful retry with the same declared key.
It checks startup attribution and the absence of invented test names. Existing
package, cache and duration fixtures remain independent.

The `intermittent` eval runs the flow on `fixture-intermittent/`: four real
post-merge runs, each under new keys. `//:mapper-scripts` failed its deadline
test, passed, failed it again and passed; `//:grammar-inventory` failed once
and then passed twice. Only the deadline test is intermittent, and neither
target is flaky.

| Scorer | 1 when |
| --- | --- |
| `flaky` | The report names exactly the known flaky targets for each fixture, excluding targets that never passed |
| `tests` | The report names the known flaky tests |
| `intermittent` | The report names exactly the tests that failed again after their target passed |
| `causes` | Each target's top cause matches the logs |
| `slow` | Targets rank by run time, and a target that only replayed never ranks |
| `regressed` | The report names exactly `//packages:compiler-test` as slower, with its two timeouts; `//:docs-tools`, 1.4 times slower under load, is not named |

A scorer whose field a case does not state scores 1 there.

```sh
cd .smithers && bun flows/ci-health/eval.ts            # compare with baseline.json; exit 1 on a drop
cd .smithers && bun flows/ci-health/eval.ts --update   # record baseline.json
```
