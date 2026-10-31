# The ts-bump flow: move the TypeScript fork to a newer upstream commit

The ts-bump flow moves `typescript/`, VibeLang's fork of microsoft/TypeScript,
to a newer upstream commit and reports what that breaks. It does the
mechanical part of a bump; the report is the input to the fix commits. No step
calls a model.

```text
fetch ──▶ merge ──▶ regenerate ──▶ build ──▶ probe ──▶ report
```

| Step | What it does | Writes |
| --- | --- | --- |
| fetch | Reads the pinned upstream commit from `typescript/VIBELANG.md`, resolves the target (a commit, or an npm `typescript` dist-tag or version, through its `gitHead`), and downloads both trees from GitHub without `tsc/testdata` | `fetch.json`, `upstream/<sha>/` |
| merge | Merges three ways, file by file, with the pinned tree as the base: a file only upstream changed takes upstream's text, a file only the fork changed keeps the fork's, a file both changed goes through `diff3 -m` and keeps its conflict markers. Upstream's new files are added and its deleted files removed. Then it moves the pin in `VIBELANG.md` | `merge.json` |
| regenerate | `sh tsc/internal/effecttsgo/sync.sh <tag>` at the tag `effecttsgo/UPSTREAM` records: it reapplies no patch it already applied, regenerates `tsc/internal/diagnostics`, and generates the Effect rules' shims over the merged compiler's structs | `regenerate.json` |
| build | `go vet ./...` in `typescript/tsc` (compiles every package and test) and `sh scripts/build-vibelang.sh` | `build.json` |
| probe | `sh scripts/ci.sh` over the graph targets that cover the fork (`lib/steps.mjs` `TARGETS`: the compiler, `//:spec-tests`, `//:go-vibelang`, `//:go-vibelangmapper` and every compiler case), unless the build failed | `probe.json` |
| report | The conflicts with the seam each touches (from `VIBELANG.md`'s "Seams in upstream files"), the files merged without conflict, the compile errors, and the failing targets and tests | `report.json`, `report.md` |

Each step reads and writes the run directory, so a step that already recorded
its result returns it, and a stopped run resumes where it stopped.
`docs/maintainers/typescript-upgrade.md` says what to do with each section of
the report.

## Run it

Run it in a checkout you can throw away, such as a `jj workspace add`, because
it rewrites `typescript/`:

```sh
cd .smithers && bun flows/ts-bump/run.ts --run <run dir> --repo <checkout> --to next
cd .smithers && bun flows/ts-bump/run.ts --run <run dir> --repo <checkout> --to <commit> --targets "//typescript:compiler"
```

## The eval

`eval.ts` runs the flow, unmocked, on a fresh jj workspace of this repository
for two real `typescript@next` nightlies after the pin, and scores it against
facts measured by hand on 2026-10-31:

| Case | Target | Facts |
| --- | --- | --- |
| `upstream-20261022` | `98add1b` (7.1.0-dev.20261022.1) | no conflict; the build fails in `internal/effecttsgo/lint/command.go`, which passes a `vfs.FS` where `tsoptions.GetParsedCommandLineOfConfigFilePath` now takes a `ParseConfigHost` |
| `upstream-20261031` | `6161772` (7.1.0-dev.20261031.1) | `tsc/internal/compiler/emitter.go` and `tsc/internal/ls/utilities.go` conflict |

| Scorer | 1 when |
| --- | --- |
| `preserved` | In each file both sides changed, every line the fork added and every line upstream added is in the result: an oracle independent of `diff3` |
| `pinned` | `VIBELANG.md` names the target |
| `conflicts` | The report names the case's conflicting files (none for the first) |
| `found` | The report names the case's compile errors |

```sh
cd .smithers && bun flows/ts-bump/eval.ts            # compare with baseline.json; exit 1 on a drop
cd .smithers && bun flows/ts-bump/eval.ts --update   # record baseline.json
```

The eval fails a broken merge. With `merge3` planted to take upstream's text
and drop the fork's lines (2026-11-01), `preserved` fell to 0.11 and 0.07,
`conflicts` and `found` to 0, and the run exited 1 at a mean of 0.52.

A run downloads two upstream trees, builds the compiler and runs Go tests.
`TS_BUMP_KEEP=1` keeps the workspaces and the run directories. The facts hold
for the fork as it was on 2026-10-31; when a seam change or a bump moves them,
measure them again with a kept run and update the cases.
