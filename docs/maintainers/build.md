# The build graph

The compiler package gate also runs `//typescript/tsc:go-vibelangfmt`, so formatter Go regressions run before a compiler change lands.

VibeLang's checks run as targets of `smthrs`, Smithers' build tool. Each
`PACKAGE.ts` declares targets; the files, tools and targets a target names are
its inputs, and their content digests are its key. `smthrs ci` runs each
target whose key changed and replays every other result from the cache in
`.flows/`. A change reruns the targets that read what it changed, and nothing
else.

```sh
sh scripts/ci.sh                                    # install, then smthrs ci //... --jobs 8
sh scripts/ci.sh //typescript/vibelang/... --jobs 8 # compiler cases and editor smoke
.smithers/node_modules/.bin/smthrs targets //...
.smithers/node_modules/.bin/smthrs explain //typescript/vibelang:await-ops
```

`scripts/ci.sh` installs what the targets read (`.smithers`, the runtime, the
compiler package, `experiments`, `docs/tools`) from their lockfiles, then runs
`smthrs ci`, which runs build and test targets alike. `explain` prints a
target's inputs, its key and whether the cache holds a result for it.

## Remote contributor checks

`scripts/remote.sh <command...>` synchronizes the current workspace to a
Linux build host and runs the command there, in the same relative directory.
Set `ES_REMOTE_HOST` and, if needed, `ES_REMOTE_KEY` as its header describes.
After synchronization, it runs `bun install --frozen-lockfile` in
`experiments`, `docs/tools` and `packages/runtime` before preparing the
runtime output. Existing directories and source timestamps do not establish
that an install matches the synchronized lockfile. An install error reports
Bun's diagnostic and stops before the requested command. A provisioned
`node_modules` symlink stays untouched; its owner must keep it current.

## The merge queue's pre-gate

The merge queue tests every queued change alone on current `main`, and a landing
batch takes only changes that passed. Most of that testing runs on the project's
build hosts. `.github/workflows/mq-pregate.yml` adds GitHub-hosted runners: one
run checks out a commit of `main`, applies one change's patch, runs `scripts/ci.sh`
with the gate's targets, and uploads the graph's results as an artifact named
after the run.

The queue dispatches it with a `repository_dispatch` event, `mq-pregate`, and a
person can dispatch the same inputs with `gh workflow run`:

```sh
gh workflow run mq-pregate.yml -f tag=<name> -f base=<commit on main> \
  -f targets='<targets>' -f patch=<base64 of the git diff, compressed with xz or gzip>
```

`scripts/apply-patch.sh` applies the patch. GitHub limits a dispatch payload to
65,535 characters, so the queue compresses with xz, and a change whose patch is
still too large runs only on the build hosts.

The workflow holds no secrets and its token only reads this repository. A hosted
pass counts; a hosted failure sends the change back to a build host, which is the
reference for rejecting it.

A hosted run compiles every Go package that changed since the Go cache it
restores. `.github/workflows/go-cache.yml` keeps that cache current: on each push
to `main` it runs `scripts/warm-go-cache.sh`, which compiles and vets what
the graph's Go targets and `scripts/check-forms-table.sh` compile, with their
flags, and saves the cache as `go-<commit>`. The pre-gate restores the newest
`go-` cache, the only cache that holds the graph's Go build. With one cache saved
a day, the hosted `//typescript:compiler` build took 41 s an hour after the save
and 393 s by the next morning (2026-10-31). The day's `gate-` cache holds the
modules, package and browser downloads; each day's restores the day before's, so
a Go build in it only grew, and hosted runs ran out of disk restoring it. The
run first deletes toolchains no target uses, about 10 GB.
Every Go build and test target, including `//typescript:forms-generator`, uses `GOCACHE=$HOME/.cache/go-build-smthrs`,
so one cache serves them all. `scripts/go-cache.test.mjs` fails when a target
compiles a package the script misses, or when the two workflows' cache paths
differ.

A `node_modules` symlink in any of these directories, including `.smithers`,
is provisioned by whoever made the link. `scripts/ci.sh` uses it as is and never
runs `bun install` through it. The link owner must keep that install current.
For other existing installs outside `.smithers`, the script checks the installed
Effect version against the package's exact pin, including `devDependencies` and
`peerDependencies`, and reuses a matching tree. Stale or missing local trees and
local `.smithers` installs run `bun install --frozen-lockfile`.

`scripts/ci.sh` then runs `scripts/share-effect.mjs`, which links the Effect
packages in `packages/runtime/node_modules` to the copies in `experiments`. A
fixture links `vibelang-runtime` to `packages/runtime`, so a separate copy lies
beneath that link, and a declaration sidecar can name its types only by that
path (`TS2883`). A symlinked `packages/runtime/node_modules` stays as it is.

Migration alias properties also use the built checkout compiler at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), or the explicit `VIBELANG_BINARY` override. Build it first with `sh scripts/build-vibelang.sh`. Their compiler-discovery regression runs the minimized alias witness with both environments and requires an invalid override to fail instead of falling back or skipping.

Native compiler property tests use the built checkout compiler at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), while `VIBELANG_BINARY` selects an explicit compiler. Build the checkout compiler before running these tests. The properties execute with the variable unset in their validation so a missing manual environment setting cannot skip or prevent the compiler witnesses.

Native compiler property tests use the built checkout compiler at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), while `VIBELANG_BINARY` selects an explicit compiler. Build the checkout compiler before running these tests. The properties execute with the variable unset in their validation so a missing manual environment setting cannot skip or prevent the compiler witnesses.

Native compiler property tests use the built checkout compiler at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), while `VIBELANG_BINARY` selects an explicit compiler. Build the checkout compiler before running these tests. The properties execute with the variable unset in their validation so a missing manual environment setting cannot skip or prevent the compiler witnesses.

Docs checks use `VIBELANG_BINARY` when set, otherwise the native checkout build at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), then `typescript/built/local/tsc`, then `vibelang` on `PATH`. Build the native compiler with `sh scripts/build-vibelang.sh`. The `:release`, `:snippets` and `:docs-tools` targets declare `:compiler-native` so its build and cache key cover the selected binary. The release warning fixture also declares `:runtime-dist`.

Every native build and copy uses `scripts/native-output.sh`: it writes a private sibling temporary output, closes the writer, then renames the executable into place. Concurrent readers keep executing the previous binary until the complete replacement is published, avoiding `ETXTBSY`. Failed builds leave the previous executable intact and clean up their temporary output. This applies to the compiler, forms generator, mapper, standalone test builds and release platform binaries; release rebuilds retain existing binaries while compiling replacements. Remote release transfers use `rsync` without `--inplace`, which also replaces completed files by rename.

### Pending hang probes

The `//:go-vibelangfuzz-pending` merge-gate target requires the independently
cached `//:go-vibelangfuzz-hangs` target. Named pending seeds skip known hangs;
`TestPendingHangs` runs each reproduction in a child with a 15-second stage
watchdog and a 30-second outer deadline, and fails if it completes. It runs
probes in parallel. Its cache inputs include the source, saved corpus,
documentation, cases and runtime that the child fuzz targets read during setup.

Run only the bounded hang validation with:

```sh
sh scripts/ci.sh //:go-vibelangfuzz-hangs --jobs 8
```

## Native repair properties

The handler-repair properties run the CLI repair, editor repair and manual
control in separate Node processes and compare their `Exit` values. Repeated
runs within a test share a private `NODE_COMPILE_CACHE` directory so Node can
reuse compiled runtime dependencies. Each child still has its own module cache
and global state. The directory is removed when that test ends.
`NODE_DISABLE_COMPILE_CACHE` and `NODE_V8_COVERAGE` disable this optimization;
coverage collection keeps its ordinary behavior.

## Forms-table checks

`//typescript:forms-generator` builds `typescript/built/local/vibelang-forms`
from the compiler build inputs, `go.work`, and the Go launcher. The executable
is cached separately from `//:forms`: documentation and test edits still rerun
the check without entering Go build admission again. Compiler source and module
changes rebuild the executable.

`//:forms` passes that executable to `scripts/check-forms-table.sh` through the
absolute `FORMS_BINARY` path. Every check freshly generates the table and the
repository decision snapshot and checks the data-method declarations; those
results still depend on the whole tree, including the pinned package lockfiles.
The executable cache never replaces the table comparison or decision approvals.

A standalone `bash scripts/check-forms-table.sh` retains `go run`. To use a
prepared executable for local regeneration:

```sh
.smithers/node_modules/.bin/smthrs build //typescript:forms-generator --jobs 8
FORMS_BINARY="$PWD/typescript/built/local/vibelang-forms" \
  bash scripts/check-forms-table.sh --write
```

`--write` still requires a line in `forms_decisions_approved.txt` for each moved
decision. An invalid `FORMS_BINARY` fails immediately. It cannot be combined
with `VIBELANG_FORMS_EXPORT`: unset `FORMS_BINARY` to compile an overlay with
`go run`. The graph manages executable freshness; when supplying a path by
hand, rebuild it after changing compiler sources.

## Benchmark command receipts

`python3 scripts/bench/measure.py <command...>` prints the command's combined
output followed by a `MEASURE` receipt with wall time, peak RSS and the child
exit status. The wrapper returns the same exit status. If a signal kills the
child, the receipt records the negative signal number and the wrapper returns
`128 + signal`, so shell scripts detect the failure.

`scripts/bench/compiler.sh` deliberately continues after a measured command
fails: its docs corpus includes expected diagnostics. Each table row reports
the recorded exit statuses and diagnostic count beside its measurements.

## Runtime test budgets

The static runtime/kernel import-order cases run two child processes, each
bounded at ten seconds, under a thirty-second parent deadline.
`packages/runtime/tests/package-budget.test.ts` checks that the parent budget
exceeds the sum of the child budgets and remains bounded. This catches the
five-second default that previously killed healthy slow imports.

```sh
(cd packages/runtime && bun test tests/package-budget.test.ts tests/package.test.ts)
```

## Packages

```text
.smithers/WORKSPACE.ts          toolchain (node, go, bun), cache in .flows/
//typescript/tsc                the Go module
  :srcs                         Filegroup: what go build reads (no *_test.go, no testdata/)
  :go-checker :go-parser        go test, one target per Go package tree (merge gate,
  :go-format :go-core           when the change edits that tree)
  :go-vibelangfmt               VibeLang formatter Go tests; required by :compiler-test
  :vibelang-files ...           Filegroups: one Go package's tests and testdata
//typescript
  :compiler                     go build ./cmd/tsc -> typescript/built/local/tsc
  :forms-generator              cached go build ./cmd/vibelang-forms -> typescript/built/local/vibelang-forms
//typescript/vibelang
  :<case>                       harness.mjs <case>, one target per case (809)
  :lsp-smoke                    headless language-server editor checks
//packages
  :runtime-dist                 bun run build -> packages/runtime/dist
  :runtime-test                 bun test (runtime)
  :compiler-native              the binary and dprint plugin in packages/compiler
  :compiler-test                node --test (compiler package)
  :migrate-test                 node --test (the migrate and convert flows)
  :vite-test :unplugin-test      the bundler plugins' test/run.sh (source maps, builds, watch)
//                              checks that read the whole repository
  :tree                         Filegroup: every file
  :go-vibelang :go-vibelang-race :go-vibelangmapper :go-vibelangfuzz
  :go-vibelangfuzz-hangs        bounded child probes for stale hang markers (merge gate)
  :go-vibelangfuzz-pending      the inputs testdata/pending/ lists, which must still fail, and every VIP and data probe (merge gate)
  :go-vibelangfuzz-editor       the editor oracles over documentation examples and cases (merge gate)
  :go-vibelangfuzz-compile      the compile oracles over their short sample of cases and documentation examples (merge gate)
  :go-vibelangfuzz-config       the project-settings oracles over every case's vibelang section (merge gate)
  :go-vibelangfuzz-topic-<t>    the Fuzz and Test functions of internal/vibelangfuzz/<t>_*_test.go (merge gate,
                                when the change edits a compiler source or fuzz test of topic <t>)
  :go-vibelang-topic-<t>        the Test functions of internal/vibelang/<t>_test.go and <t>_*_test.go (merge gate,
                                when the change edits a source or test file of internal/vibelang of topic <t>)
  :release :snippets :tokens :forms :docs-tools :docs-check :site-spec-links
  :site-contrast                npm ci and a production build of a private copy of site/, then the contrast audit
  :spec-lint                    the specification linters over docs/design (merge gate, through :docs-tools)
  :design-files                 Filegroup: docs/design
  :spec-tests                   the Go tests that read docs/design (registry, whole printed diagnostic numbers, VIP citations, pending lines), the cost guards of --fix and flow narrowing
```

```text
:srcs ─► :compiler ─┬─► :<case> x809 ◄─┬─ :runtime-dist ─► :runtime-test, :compiler-test, :migrate-test
                    ├─► :compiler-native ─► :compiler-test, :migrate-test, :vite-test, :unplugin-test, :release, :snippets, :docs-tools
                    ├─► :lsp-smoke ◄─ :runtime-dist
                    └─► :snippets, :docs-tools
:tree ─► :release :snippets :tokens :forms :docs-tools :docs-check :go-vibelang*
:srcs ─► :forms-generator ─► :forms
:design-files, :srcs, :vibelang-files, :vibelangfuzz-files ─► :spec-tests
```

The runtime entry tests start up to three host processes in sequence. Each
child has a `10_000` ms deadline; the whole test allows `35_000` ms so the
outer deadline covers all three on a busy build host.

Bun gives a test 5 seconds unless the command says otherwise: `bunfig.toml`
has no timeout key, and a `setDefaultTimeout` in a preload reaches the first
test file only. Every `bun test` the graph or a package script runs therefore
passes `--timeout` (the runtime 30 s, which covers two 10 s children per test;
`docs/tools` 60 s; the kernel laws 30 s). `scripts/bun-test-budgets.test.mjs`
fails a `PACKAGE.ts` shell or a package script that drops the flag, and a
`main.test.ts` child deadline the runtime budget cannot cover twice.

The runtime's two stock-`tsc` checks (emitted declarations, experimental
identity) give the compiler the harness's compile budget, `120_000` ms, under a
`150_000` ms test deadline: alone a run takes about 6 s at load 118, and the
earlier `30_000` ms failed most logged runtime-test runs on loaded post-merge hosts.

The documented debugging recipe test compiles an application and then starts
Node.js to check its failing source-mapped exit. Its test deadline is
`30_000` ms so both host processes can finish on a busy build host; it still
checks the compiler result, failure marker and original source location.

The first-run guide check (`docs/tools/first-run.test.ts`) runs five commands in
sequence: scaffold, `vitest run`, `--version`, compile, run. Each is a stage with
its own `60_000` ms deadline (`first-run-stage.ts`), and the test's deadline is
the sum, so a slow stage is killed and named with its signal and deadline instead
of the whole test ending at a shared 30 s, as it did in 9 of 184 post-merge runs.
On POSIX, a deadline kills the command's process group, including children that
keep its output pipes open after it exits. Captured output and the kill reason
remain in the stage result.
`first-run-stage.test.ts` checks the kill, pipe-holding descendants, the plain exit and that the test's
deadline covers every stage it runs.

The `//typescript/vibelang:lsp-smoke` target runs `lsp-smoke.sh --no-build`
against the graph's compiler and runtime outputs. Its inputs cover the Go
language service through `:compiler`, the runtime, the Effect lockfiles,
`lsp-smoke.sh`, `lsp-smoke.mjs`, `lsp-connection.mjs` and `lsp-fixture/**`. Unchanged inputs
replay the cached result. Run it alone with:

```sh
sh scripts/ci.sh //typescript/vibelang:lsp-smoke --jobs 8
```

Post-merge selects it through `//typescript/vibelang/...` in the compiler-case
shard. The merge gate also selects it when it covers the `compiler` step.
The smoke runner continues after a failed check, prints each check's name on
its own `FAIL` line, and exits with status `1` if any check fails.

The smoke transport rejects outstanding requests as soon as the server closes,
including failed starts, and reports the request method, ID and exit cause.
Requests keep their `60_000` ms deadline while the server is alive; settled
requests leave no pending waiter. Shutdown allows another `5_000` ms before
killing a server that ignores EOF. Run the process-lifecycle regressions with
`node --test scripts/lsp-connection.test.mjs` (also part of `//:release`).

The `//typescript/vibelang:fork-late-start` target runs the fork startup
regressions with delayed scheduling as part of the regular compiler suite.
It passes the harness's `--isolated` switch, which copies each case into
`typescript/vibelang/.smthrs-harness-<run>/<case>/` before compiling and running
it. Keeping this directory beside `cases/` preserves custom runners' relative
imports of shared helpers. Its `out/`, `node_modules/`, custom runners and declaration-identity
outputs belong to that invocation, so it can run concurrently with the same
cases' individual targets. Successful copies are removed; failing copies and
command logs remain for inspection. The root `node_modules/` install is rebuilt for the invocation; nested fixture packages, including copies below `stubs/`, are preserved. Relative fixture symlinks keep their written targets so they resolve inside the private copy. Any aggregate harness target that overlaps
individual case targets must use `--isolated`.

The release check runs `typescript/vibelang/harness.test.mjs`, including a
barrier-controlled regression that executes both targets' actual shell commands
concurrently. The aggregate starts after the per-case compiler emits and before
its runner loads the result, so shared output directories fail deterministically.

A case's custom `run.mjs` has 60 seconds unless one of its lines says
`// run-seconds: N`. The twelve `rewrite-*` runners call `compareRewrite`, a
pipeline of six stages (two compiles, two runs, two `--fix` passes) that each
have a 30-second deadline, and declare `// run-seconds: 180`, their sum: a slow
stage then trips its own deadline, which names the stage in
`out/rewrite-evidence/<stage>.log` with its duration, instead of the runner
being killed as a whole. Under the 60-second default, post-merge killed healthy
runs after four compiles on loaded hosts (medians of 13 to 20 seconds, maxima of
86 to 115 seconds over 214 runs).

To reproduce child-start races without a busy host, run the acceptance harness
with `--late-start` (or set `VIBELANG_LATE_START=1`). It delays queued
scheduler tasks by `100 ms` after the caller suspends, while timers can resume
the parent. A pause between the fork and sleep cannot consume this delay. The same
environment switch applies to runnable documentation examples checked by
`bun docs/tools/check-snippets.ts --run`. For example:

```sh
cd typescript
EFFECT_NODE_MODULES=$PWD/../experiments/node_modules VIBELANG_RUNTIME=$PWD/../packages/runtime node vibelang/harness.mjs --late-start uninterruptible-using fork-named-region
```

A child must signal a `Deferred` after it enters its protected region or
registers cleanup; its parent awaits that signal before interrupting or leaving
the region. Neither `sleep` nor `yieldNow` proves readiness.

A case's key is the compiler's key, the runtime's `dist/` key, the Effect
install's lockfiles, the harness files and the digests of the files in that
case's directory. The compiler's key is the Go module's sources and the `go`
launcher's bytes. The VibeLang Go tests read cases, docs and installs through
the repository root, so they and the other repository-wide checks take `:tree`.
Tests also read repository oracles outside the Go module, such as Appendix B.
Go's test-result cache can miss changes to those files;
`scripts/go-test-cache.test.mjs` checks that changing an external oracle reruns the test.

They run `go test -count=1`: the graph caches their results, and Go's own test
cache would first hash every file the tests opened. `:go-vibelangfuzz` opens
about 25 million, which took 14 minutes on one core after its tests passed.

The compiler corpus runs through `harness.mjs` only, as one target per case in
`//typescript/vibelang/...`. `:go-vibelang` does not rerun it: three Go tests did
until 2026-10-31, took 700 s of the package's 900 s, and over 114 red post-merge
runs reported no product failure the case targets missed. `:go-vibelang` runs Go
with `-timeout 45m`, and its shell target allows 70 minutes, including waiting
for a Go build slot and compiling the test binary.
It runs its test binary through `scripts/go-test-shards.sh` like
`:go-vibelangfuzz` (below), with weights in
`internal/vibelang/testdata/shard-seconds.txt`: 339 s as one process, 153 s as
six, on the same host at load 75 (2026-11-01).

`:go-vibelangfuzz` runs its test binary through `scripts/go-test-shards.sh`
(`go test -exec`): six processes at once, each with its own `-run` list and the
40-minute deadline. Go runs a package's tests and each seed corpus one after
another unless they call `t.Parallel`, so the package was one chain: 686 s on a
quiet host, and it hit its 40-minute deadline on the loaded post-merges of
`1180893af776` and `42c771e16b1c`. The script puts the slowest names, by
`internal/vibelangfuzz/testdata/shard-seconds.txt`, in different processes. To
run the suite the same way by hand, from `typescript/tsc`:

```sh
go test -short -count=1 -exec "$PWD/../../scripts/go-test-shards.sh" ./internal/vibelangfuzz/
```

A run with `-run`, `-fuzz` or `-json`, or with `GO_TEST_SHARDS=1`, runs the
binary once, as before.

Discovery and execution both receive the original test arguments, including
`-short`, `-timeout` and custom test flags. A `TestMain` that reads them sees
the same configuration before the script assigns tests to shards.

The fuzz shell caps `GOMAXPROCS` at the smaller of `24` and the machine CPU count and declares `GOFLAGS=-p=6`, matching the
post-merge shard allocation. Smithers withholds ambient Go variables, so
setting them only on the outer CI process does not constrain the test.
These declared values also enter the target cache key.

## Finding slow and flaky targets

The ci-health flow ranks them from `CI_RESULTS` files and graph logs, with the
tests and causes behind each flaky target: `.smithers/flows/ci-health/README.md`.

## Finding the commit that broke a target

The first-bad flow reruns targets that fail at a bad commit, to separate breaks
from flakes, and bisects each break to the first commit after a good one that
fails it: `.smithers/flows/first-bad/README.md`.

## What a change reruns

| Change | Reruns | Replays |
| --- | --- | --- |
| A doc page | the `:tree` checks | compiler, runtime, every case, the upstream Go tests |
| A page in `docs/design` | `:spec-tests` and the `:tree` checks | compiler, runtime, every case, the upstream Go tests |
| One case's files | that case and the `:tree` checks | compiler, runtime, 808 cases |
| The runtime's `src/` | `:runtime-*`, every case, the `:tree` checks | compiler, compiler package |
| A Go source file | `:compiler`, every case, every Go test, the `:tree` checks | runtime |
| `harness.mjs` | every case and the `:tree` checks | compiler, runtime |
| A `PACKAGE.ts` | the targets it declares and their dependents | everything else |

A gate that needs only some checks names their labels, for example
`sh scripts/ci.sh //packages/... //:docs-check --jobs 8`; a full run is
`sh scripts/ci.sh //... --jobs 8`. Each checkout keeps its
`.flows/` between runs, so a long-lived CI checkout replays everything an
earlier run already proved.

## Synthetic compiler benchmark fixtures

The `//scripts/bench:synthetic` target generates VibeLang and Effect TypeScript
projects, compiles both without diagnostics, and runs the emitted JavaScript
with the pinned Effect runtime. It checks `chain`, `dense` and `single` with
`1`, `3` and `6` modules: no predecessor, partial fan-in and all four dense
predecessors. A fast-check property varies the shape, module count and branch
inputs, including negative values, the successful `k1` lookup and missing keys.

Both languages must match an independent arithmetic oracle for plain helpers,
successful service calls, typed failures, catch handlers, fork/join, nested
service layers and dense dependencies. The plain helper has a `number` return
annotation so it also stays plain before the VIP-1 compiler transition.

The target requires the graph's compiler and runtime outputs and the compiler
package's pinned fast-check install. Missing prerequisites fail in CI rather
than skipping. Run it before collecting synthetic timings after a language or
Effect upgrade:

~~~sh
sh scripts/ci.sh //scripts/bench:synthetic --jobs 8
~~~

The VibeLang compiler checks both extensions; its TypeScript path checks
`effect-ts`. This verifies fixture correctness and equivalence, without
measuring compiler performance.

## Cache contracts

The compiler and Vite package tests consume `//:migration-sources`, a root-owned filegroup that holds every file of the migrate flow, so a new flow file needs no entry in any `PACKAGE.ts`. A `//` prefix roots a glob's path but does not change its package scope: a glob declared in `packages/PACKAGE.ts` selects none of the root-owned `.smithers/flows/migrate/` files, and `smthrs explain` shows it with `"files": []`. `migration-inputs.ts` defines the shared group without a declaration-module import cycle. The compiler package's cache-contract tests use `smthrs explain` to check the real dependency and that every file under `.smithers/flows/migrate/` is an input with its current content digest.


A cached result is only as correct as its key is complete. Each target names:

- **Its toolchain.** Every program a target spawns is a declared host binary
  (`S.Host.bin("go")`, `"node"`, `"bun"`), and `smthrs` keys the bytes of the
  binary it resolves. Go's `GOTOOLCHAIN=auto` then selects the release named by
  `go.mod`'s `go` line, an input of `:srcs`, and verifies it against Go's
  checksum database.
- **Its environment.** A target's process gets `HOME`, `PATH` and `LANG`, and
  `PATH` enters the key. Everything else a target needs is in its command
  text. `GOCACHE` is set there to `$HOME/.cache/go-build-smthrs`; Go keys its
  own cache by content, so it is not an input.
  The fuzz targets (`//:go-vibelangfuzz` and its `-pending`,
  `-editor`, `-compile`, `-config` and `-hangs` siblings) explicitly declare the optional
  `VIBELANG_FUZZ_BUDGET_LOG` path. Set it before invoking `smthrs` to append
  CPU baselines from passing and failing target runs. The path enters each
  target's cache key; a cache hit does not rerun tests or append records.
- **Its installs.** `node_modules` trees are installed from lockfiles before
  `smthrs` runs, as Smithers installs its own. The lockfile and `package.json`
  are the install's identity and inputs of every target that reads it.
- **Its outputs.** A build target declares its outputs; `smthrs` digests them
  after the run and restores them on a cache hit.
- **Its scratch.** `.flows/` and `.smthrs-*` are gitignored. `smthrs` restores
  an output by writing a sibling `.smthrs-*` tree and renaming it into place,
  and `jj file list`, which the docs check runs while other targets restore
  their outputs, snapshots the working copy: an unignored temporary tree is
  tracked, then vanishes before the check reads it. Discovery prunes the Vite
  The compiler-package migration fixtures also spawn `jj`; it is declared in the workspace host binaries and on `//packages:compiler-test` and `//packages:migrate-test`.
  and unplugin test `.fixtures/` trees and the compiler case directory, which
  has no package declarations: their generated outputs may change while the
  compiler tests explain their migration-source cache inputs. This excludes
  declaration discovery only; case sources still enter their declared inputs.

The command-line fuzz target builds its nested compiler with `-trimpath`,
matching the outer Go test build. This lets the two builds share compiler
package artifacts in the Go build cache on a fresh validation mirror.

## Benchmark corpus generation

The compiler benchmark stops if docs corpus generation fails, returns the
generator's exit status and prints its diagnostics. Its output directory keeps
`docs-corpus.log` and `docs-corpus.stderr.log`; the failed corpus remains
available for diagnosis. Only successful generation is used for measurement.

## Known gaps

- **Sandboxing.** The targets run with `sandbox: "none"`: the harness writes
  `out/` and `node_modules/` into each case directory, which a confined test
  may not write. Unconfined results stay in the local cache and are never
  published to a remote cache. Making the harness compile a copy of the case
  under `$TMPDIR` would let the cases run confined.
- **One cache per checkout.** `.flows/` must live inside the checkout, so each
  checkout keeps its own cache. Sharing one across checkouts or hosts needs
  `smthrs`'s remote cache, which accepts only confined results.
- **`packages/runtime/PACKAGE.ts`.** `smthrs` refuses a declaration whose
  directory resolves `effect` to a copy other than the CLI's, and the runtime
  installs its own. Its targets are declared in `packages/PACKAGE.ts`.
- **`:tree` is coarse.** Any change reruns the repository-wide checks. Naming
  what each one reads would let a case change skip the docs checks.
- **Not yet in the graph.** ts-mapper, create-vibelang, the
  editors, the examples, `scripts/e2e.sh` and the LSP smoke test run outside
  it.

`//:spec-lint` runs `docs/tools/spec-lint.ts`, the specification linters. Each rule is one class of inconsistency a specification review found, such as a resolution claim VIP-39's table does not list, and `docs/tools/spec-lint.test.ts` shows each rule failing on the defect it was written for. `//:docs-tools` depends on it, so the pre-merge gate runs it. Its inputs are `docs/design/**` and the linter's two files. Run it alone with `bun docs/tools/spec-lint.ts`. A new class of inconsistency gets a rule and a failing-defect test in the commit that fixes it.

`//:site-spec-links` checks the generated specification and VIP pages for unconverted `.md` links, missing pages and missing anchors. `//:docs-tools` depends on it, so the pre-merge gate runs it. Its inputs are `site/src/pages/spec/**`, `site/src/pages/vips/**` and `docs/tools/site-spec-links.test.ts`; unrelated changes reuse its cached result.

The `//:site-contrast` browser audit emits `site contrast diagnostic:` JSON
records before and after each navigation and axe audit. Each names the theme,
page, state, operation sequence and elapsed time. A `renderer-crash` or
`browser-disconnected` event names the operation in flight; memory pressure,
available memory and cgroup memory events distinguish resource exhaustion
from an audit assertion. Failed requests include their path and error, with
query strings omitted. `CONTRAST_ARTIFACTS` additionally saves screenshots
and the completed contrast observations.

The contrast audit uses `axe.run` in the current document rather than the
partial-results adapter, which opens a blank helper page and transfers a
serialized copy of the results to its renderer. Post-merge diagnostics caught
OOM kills while finishing an audit under build-host memory pressure. The built
pages have no child frames; the audit checks that invariant before running,
so adding frames requires an explicit frame-aware audit strategy. Shadow DOM
remains covered. The browser regression checks both themes with readable and
unreadable text, including shadow roots, and forbids opening a helper page.

Contrast crash records include an `active` flag: a renderer can exit after
the last reported stage completed. The browser protocol also reports the
native termination `status` and `errorCode`, without target URLs or IDs.
Resource snapshots include `MemAvailable`, allowed CPUs and memory nodes,
cgroup anonymous/file/shared/kernel accounting, and aggregate RSS/counts for
fixed executable classes. Executable paths, process names and arguments are
never logged; unreadable or disappearing processes are counted and skipped.
RSS sums can count shared pages more than once, so compare the classes with
memory availability and cgroup accounting before choosing a resource bound.
