# The first-bad flow: which commit broke a target

When post-merge reports a target RED on main, the first question is whether a
commit broke it, and which one. The first-bad flow answers it. Give it the last
commit where the targets passed (good), the commit where they failed (bad), and
the targets. It reruns each target at bad to separate real breaks from flakes,
then bisects each real break to the first commit after good that fails it. It
writes a report a lane acts on. No step calls a model.

```text
prepare ──▶ reproduce ──▶ bisect ──▶ report
```

| Step | What it does | Writes |
| --- | --- | --- |
| prepare | Resolves good and bad, lists the commits between them (refusing a history with merges), and adds the flow's jj workspace at bad | `prepare.json` |
| reproduce | Runs the targets at bad, then reruns each failing target until it passes or the tries run out (3 by default) | `reproduce.json` |
| bisect | Runs the broken targets at good, then bisects each one that passes there; targets whose ranges overlap share a run; a Go target runs only the tests that failed at bad | `bisect.json` |
| report | Each target's state, and for a broken one the first bad commit, the files it changes, the failing tests and the end of their output | `report.json`, `report.md` |

Every run checks out one commit in the flow's workspace (without a snapshot,
so files a run leaves never become a commit) and runs `sh scripts/ci.sh
<targets>` there, so the commit's own graph and lockfiles decide what runs. The
result cache keeps only passes: a failing target runs again on every try, and
dependencies whose inputs did not change (the compiler, usually) replay. Each
run's results and graph log stay in `runs/`.

| State | Meaning | What to do |
| --- | --- | --- |
| `broken` | Failed every try at bad, passes at good | Read the first bad commit and its failing tests; fix forward or revert |
| `broken-at-good` | Fails at good too | Run again from an older good |
| `flaky` | Failed, then passed with the same inputs | No commit broke it; the report names the cause (the ci-health flow's classes) |
| `not-reproduced` | Passed at bad on the first try | The RED came from the host (load, disk); check the post-merge log |
| `untestable` | Never ran at bad: a dependency failed | Name the dependency as the target instead |

Bisection narrows a Go target (`//:go-vibelangfuzz`, its topic targets and
`//:go-vibelang`) to the tests that failed at bad. At each commit the graph
builds `//packages:runtime-dist`, and the flow runs `go test -run
'^(<names>)$'` with the package and environment `PACKAGE.ts` gives the target
(`GO_TARGETS` in `lib/steps.mjs`; a test checks them against `PACKAGE.ts`). A
whole `//:go-vibelangfuzz` run took over 15 minutes on loaded nyc-01; one test
takes its compile. The graph cannot run part of a target, because its cache
would record the part's pass as the target's. A commit where the tests do not
build is untestable. Reproduce runs whole targets unless `--tests` names a Go
target's failing tests, as post-merge's RED line does; then every run, at bad
too, runs only those tests. A whole `//:go-vibelangfuzz` run at bad waited 55
minutes for the loaded host on 11-02. A narrowed target that passes at bad is
`not-reproduced` for the named tests only.

A run where a target never ran (a dependency failed) is retried once at the
same commit: on a shared host a build can die of the host, such as a cache file
deleted mid-link, not of the commit. A commit where a target still cannot run
is skipped, as `git bisect skip` does, and the answer widens: the report says
the first bad commit is this one or one of the untestable commits before it.
A target that cannot run at good is taken as passing there, as `git bisect`
takes a good mark, and the report says so; only a failure at good is
`broken-at-good`.

## Run it

Run from a jj workspace of the repository. Use a new run directory each time:
a finished run returns its recorded result.

```sh
cd .smithers && bun flows/first-bad/run.ts --run <run dir> --repo .. \
  --good <rev> --bad <rev> //typescript/vibelang:some-case //:docs-tools
```

`--tests '<target>=<Test>,<Test>'` (repeatable) runs only those tests of a Go
target, at bad and at every bisection commit. `--tries N` sets the runs at bad
before a failing target counts as broken,
`--jobs N` is passed to `scripts/ci.sh`, and `--keep` keeps the flow's
workspace after the run. A commit that changes the compiler rebuilds it; the
Go build cache makes that incremental.

## The eval

`eval.ts` runs the flow, unmocked, on two real post-merge RED reports from this
repository's main:

| Case | Good, bad | Known answer |
| --- | --- | --- |
| `match-error-tags` | `8b4abee2dbae`, `f6fe7a68d976` (15 commits) | `decl-error-family` and `match-class-patterns` are broken, both first at `f6fe7a68d976`, and the report names both cases |
| `load-timeouts` | `9d38528780b3`, `bd9b5e296a19` | Two case targets that were spawn timeouts at load 269 are `not-reproduced`; no commit is blamed |

| Scorer | 1 when |
| --- | --- |
| `state` | Each target's state is the known one |
| `culprit` | The first bad commit is the known one, and nothing is blamed when nothing broke |
| `tests` | The report names the failing tests (here, the compiler cases) at the first bad commit |
| `runs` | Bisection took at most one run at good plus log2 of the commits |

```sh
cd .smithers && bun flows/first-bad/eval.ts            # compare with baseline.json; exit 1 on a drop
cd .smithers && bun flows/first-bad/eval.ts --update   # record baseline.json
```
