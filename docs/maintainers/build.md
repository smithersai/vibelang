# The build graph

The compiler package gate also runs `//typescript/tsc:go-vibelangfmt`, so formatter Go regressions run before a compiler change lands. Schema-optional oracles quote the conditional specification table and retain both project-setting branches; wording updates do not replace semantic or declaration checks.

Negative compiler fixtures in formatter corpora retain explicit refusal checks; valid fixtures retain their round-trip and idempotence checks.

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

The native compiler, mapper and forms-generator keys exclude `internal/vibelangfuzz/**`: those executables do not import the fuzz packages. Go test targets retain those oracle sources. Production Go files, embedded data, module checksums and compiler tools remain native inputs. `//typescript:native-inputs` runs actual Smithers cache-key fixtures, including 64 generated fuzz-file neighbours, while the fast `//typescript:native-deps` target checks the three commands' transitive dependencies with `go list -deps`. A production import of a fuzz package fails that check and requires restoring its native inputs. The cache-key fixtures rerun on build-declaration or SDK changes; production changes rerun the independently cached dependency audit.

The forms-generator test distinguishes the native source group from Go test inputs. Its real cache-key fixtures also copy the parser corpus that target declarations read while loading. Production code, embedded tables, module files and compiler tools must still change native keys.

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

For remote checks, `scripts/remote.sh` restores tracked fixtures under
`node_modules/` and `dist/` after the initial source sync. It checks
`jj file list` and the fixture filter separately; a failed discovery or
filter stops the check with its diagnostics and exit status. An empty fixture
list is valid. Temporary discovery files are removed on success and failure.

The `//:api-identity-test` target checks [published declaration identity](api-identity.md), including harmless rewrites and semantic mutations.

Migration integration fixtures keep valid lockfile syntax and published package names and versions. Fixtures that bypass setup record real upstream pack receipts before checking declaration exits, build provenance or test regressions. Their pack commands must succeed before the intended checks run.

The run-phase binding corpus quotes Chapter 7's current requirement to preserve evaluation order, coldness, types, comments and declaration output. Contract wording updates preserve the binding-provenance cases and property counts; they do not change run-phase verification.

Fixtures that bypass setup use `recordDeclarationSurface` to preserve entrypoint aliases and output layout, and record actual `packRepository` results. A hand-written root list does not contain the metadata needed to reproject the baseline independently of the candidate tree.

Private-declaration and one-pass record fixtures capture actual upstream packs, including the empty published set when every package is private. Private declarations remain gated by their original opt-in rules; pack prerequisites must not prevent those positive and negative cases from executing.

Forced-record fixtures use complete receipts from `verify`, with real upstream packs and test-command results. A staged compiler descriptor supports zero-package proof fixtures; a case that intentionally uses its package-local compiler stub keeps that binding. These fixtures retain assertion-mutation, binary, BOM, source-path and native formatter controls.

Migration tool-configuration tests load generated Knip modules and check both `.vibe` and `.vibex` compiler bindings, retained package settings and sidecar excludes.

The formatted-declaration certification file must parse and execute its complete property suites: 40 signature cases and 12 formatter-mutation runs plus explicit mutation examples. A file-level syntax failure is a failed suite, not an omitted property.

Upgrade fixtures use real named and versioned toolchain archives. Public workspaces assert the release dependency and the managed local install pin separately, and compare the staged archive bytes with the producing artifact.

The `//packages:migrate-test` target retains both complete migrate and convert test globs and a bounded 90-minute aggregate budget. Property sample counts, worker deadlines and Node's concurrency remain unchanged. Only this aggregate target's budget changed.

On a four-vCPU Cloudflare box, an exact Node 26 run selected 261 files and completed in 37m03.7s with 37 failures, 1646 passes, 42 skips and 1 TODO. Its 1580 API worker calls all returned without signals (median 2.872s, maximum 10.931s). Fixing previously failing properties restores about 10 more minutes of measured work. Focused successful properties also varied by 2.5–2.7x across boxes. The 90-minute bound allows more of this work to finish and remains a sizing choice, not a guarantee on the slowest host or a claim that the suite is green.

The migration progress reporter prints the complete selected-file list, each file summary and a heartbeat every 30 seconds. Counts cover completed file summaries; pending files remain named. Unabridged assertion errors accompany Node's standard spec output. A file that cannot load or a terminated run remains incomplete, and the reporter preserves Node's exit behavior. `scripts/migrate-progress.test.mjs` checks real child processes, full assertion witnesses, missing file summaries and termination against an unmodified Node runner.

The `//:release` target runs Node's test files with `--test-concurrency=8`.
This bounds the number of simultaneous file workers independently of the host's
CPU count and the graph's `--jobs` setting. Every selected file still runs,
and a failing file keeps the target's nonzero exit status. Tests within a file
keep their own concurrency settings; child processes they spawn are additional
to the eight file workers.

The release target runs `typescript/vibelang/coverage-stock-twins.test.mjs`. Its controls check changes to `Exit` values and public types, plus Effect version mismatches. It also runs `typescript/vibelang/vip7-reference.test.mjs`, which checks concurrent reference installation and lock cleanup after a failed install. These tests use fixture packages and need no reference compiler install. The test inventory keeps both suites registered.

## Go package coverage

Migration regression fixtures use the accepted source syntax and the pinned dependency package layout. Retired trailing blocks are decoded through the migration program. Fixed compiler-case twins preserve the input's rule-evidence comments, and schema expectations preserve decoded field modifiers and mandatory declaration sidecar imports even under `noEmit`.

Full validation's `//typescript/tsc/...` selection includes
`//typescript/tsc:go-vibelangestree` for the ESLint exporter and
`//typescript/tsc:go-vibelangfmt` for formatting and dprint packaging, and
`//typescript/tsc:go-ls` for the language service and VibeLang editor integration.
Each target keys on its package's tests and fixtures as well as the compiler
sources, and the validation graph runs each package independently. Go does not run
a dependency's tests when another package imports it.

`scripts/go-test-inventory.test.mjs` discovers VibeLang-owned Go test
packages and the language service and checks the graph's package selectors. Add a target when adding
a sibling package; `./internal/vibelang/...` covers that directory and
its children, including no sibling such as `internal/vibelangfmt`.

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

The hosted workflow installs Chromium only when browser prerequisites cannot
be ruled out. `scripts/ci-browser-needed.mjs` asks `smthrs ci --plan` for the
complete dependency plan of explicit, reviewed targets such as `//:release`
and `//packages:compiler-test`. Every executable target in that closure must
be on its reviewed list; a browser target reached through another target
therefore keeps setup. Broad selectors, new targets, unfamiliar rules, incomplete
plans and planner failures all retain `npm ci` and Chromium installation.
Add a target to the reviewed list only after checking that its own command
does not use a browser. The plan check does not execute any target.

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
For every ordinary dependency tree, including an existing one, the script runs
`bun install --frozen-lockfile` before starting the graph. An unchanged Effect
version does not prove that the other dependencies match the current manifest
and lockfile. Bun verifies unchanged trees too. Provisioned `node_modules`
symlinks retain the separate owner responsibility above.

`scripts/ci.sh` then runs `scripts/share-effect.mjs`, which links the Effect
packages in `packages/runtime/node_modules` to the copies in `experiments`. A
fixture links `vibelang-runtime` to `packages/runtime`, so a separate copy lies
beneath that link, and a declaration sidecar can name its types only by that
path (`TS2883`). A symlinked `packages/runtime/node_modules` or a symlinked scope beneath it stays as its owner provisioned it; the script never replaces packages through a shared scope alias. A private runtime scope can still read packages from an aliased input installation.

Migration alias properties also use the built checkout compiler at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), or the explicit `VIBELANG_BINARY` override. Build it first with `sh scripts/build-vibelang.sh`. Their compiler-discovery regression runs the minimized alias witness with both environments and requires an invalid override to fail instead of falling back or skipping.

Native compiler property tests use the built checkout compiler at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), while `VIBELANG_BINARY` selects an explicit compiler. Build the checkout compiler before running these tests. The properties execute with the variable unset in their validation so a missing manual environment setting cannot skip or prevent the compiler witnesses.

Native compiler property tests use the built checkout compiler at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), while `VIBELANG_BINARY` selects an explicit compiler. Build the checkout compiler before running these tests. The properties execute with the variable unset in their validation so a missing manual environment setting cannot skip or prevent the compiler witnesses.

Native compiler property tests use the built checkout compiler at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), while `VIBELANG_BINARY` selects an explicit compiler. Build the checkout compiler before running these tests. The properties execute with the variable unset in their validation so a missing manual environment setting cannot skip or prevent the compiler witnesses.

Go editor fixtures reject an explicitly requested package directory that is missing,
a dangling link, or a regular file, with the package name, path and
`sh scripts/setup.sh` hint. Packages deliberately omitted by a negative test remain
omitted. A remote test runner must provision the runtime and its Effect links,
as `scripts/ci.sh` does; a fixture setup failure is not a compiler regression.

The experimental mapper's standalone runtime-parity CLI,
`bun packages/ts-mapper/test/parity/runtime.ts`, uses the `PARITY_*`
paths prepared by `packages/ts-mapper/test/parity/run.sh`. It prints one
`ok` or `FAIL` row per selected case and a `runtime parity: passed/total`
summary. Any failed case, including a compiler launch or harness failure,
sets exit status `1`; a batch whose selected cases all pass exits `0`.
`node --test scripts/mapper-runtime-parity.test.mjs` checks that contract
with the pinned stock TypeScript compiler and real Effect programs.

The mapper runtime-parity column requires a zero process exit together with
the expected result marker. A nonzero exit or signal fails the case while
retaining the actual value and a bounded exit/stderr diagnostic, including
failures from an exit hook after the result was printed.
`node --test scripts/mapper-runtime-result.test.mjs` checks real compiled
programs, exit codes, POSIX signals and generated mixed batches.

Docs checks use `VIBELANG_BINARY` when set, otherwise the native checkout build at `packages/compiler/native/vibelang` (`vibelang.exe` on Windows), then `typescript/built/local/tsc`, then `vibelang` on `PATH`. Build the native compiler with `sh scripts/build-vibelang.sh`. The `:release`, `:snippets` and `:docs-tools` targets declare `:compiler-native` so its build and cache key cover the selected binary. The release warning fixture also declares `:runtime-dist`.

The direct compile steps in `sh scripts/check-examples.sh` use `VIBELANG` when set, otherwise the native build in this checkout (`vibelang.exe` on Windows), then `vibelang` on `PATH`, then the legacy `typescript/built/local/tsc`. This keeps a native-only build usable even without a global launcher and avoids checking against a stale global compiler. Set `VIBELANG_BINARY` as well when selecting the compiler for nested package scripts, Vite and Vitest.

The compiler benchmark checks both its VibeLang compiler's version and any
compiler passed with `--upstream` before starting measurements. If either
`--version` command fails, it returns that command's exit status and keeps
its `stderr` visible.

Every native build and copy uses `scripts/native-output.sh`: it writes a private sibling temporary output, closes the writer, then renames the executable into place. Concurrent readers keep executing the previous binary until the complete replacement is published, avoiding `ETXTBSY`. Failed builds leave the previous executable intact and clean up their temporary output. This applies to the compiler, forms generator, mapper, standalone test builds and release platform binaries; release rebuilds retain existing binaries while compiling replacements. Remote release transfers use `rsync` without `--inplace`, which also replaces completed files by rename.

### Changed-path fast targets

The merge queue lands on `vibe` after a build, so the full suites run only after
landing. The queue's `validate.sh` adds a few fast targets to that build when a
batch changes the files they cover, so a commit that breaks one stops at the
queue:

| Target | Runs when a batch changes |
| --- | --- |
| `//:effect-pin` | a `package.json` or `scripts/effect-pin*` |
| `//:flow-layout` | the migrate flow's `lib/steps.mjs` or its layout test |
| `//:grammar-inventory` | a VibeLang parser file, a file in `internal/vibelang/`, or the admission table |
| `//:mapper-scripts` | `scripts/mapper-*`, `packages/ts-mapper/`, the compiler's `cache.mjs` or the LSP fixture |
| `//typescript/vibelang:lsp-smoke` | `typescript/vibelang/lsp-*`, its `PACKAGE.ts`, or the compiler's `format.mjs` |
| `//:go-vibelangfuzz-editor` | the language service, `typescript/tsc/internal/ls/` |
| `//:go-vibelang-fix-twins` | a non-test Go source in the parser, `internal/vibelang/` or `internal/effectglobals/` |

The editor oracles take about a minute after their build. They join for the
language service, which they judge: main went RED post-merge on
`FuzzEditorConsistency` when a rename change reached it unchecked. The `--fix`
fixed twins and cost guards take about a minute after their build. They join for
any compiler source because a change outside `--fix` can move what it writes:
VIP-6's parser and prelude change turned every qualified `Effect` call into a
bare global in `--fix` output, and only post-merge saw it. The other fuzz
suites, `//:docs-tools` and `//:snippets` stay out of this list. They take
minutes and depend on most of the tree, so no small set of paths selects them.

### Changed-path fuzz seeds

Hosted pre-gates set `CI_GATE_BASE` to their tested base. Before running the
graph, `scripts/ci.sh` asks `scripts/fuzz-gate/select.mjs` for the additional
targets selected by the changed paths. The selector uses Jujutsu and stops
the gate if the base revision cannot be read. A mirror without Jujutsu can
supply `CI_CHANGED_PATHS`, a file containing one repository-relative changed
path per line; an empty file selects no additional targets.

The reviewed map is `scripts/fuzz-gate/map.json`. Formatter changes select
`FuzzFormat`; VibeLang parser changes select `FuzzParse`, `FuzzSplice` and
`TestSpliceMutation`; mapped specification chapters select their quote,
coverage and static-rule checks; editor changes select editor fuzz seeds.
The map deliberately does not claim coverage of every compiler change.
Changing the map or selector selects every mapped family.

Each family has an explicit `//scripts/fuzz-gate:<family>` target. It runs
saved seeds with `-short -count=1` and a `90s` Go test deadline, eight Go
build jobs and eight processors. Admission and compilation have a separate
`30m` target budget. These targets are exclusive, so ordinary wildcard
runs do not repeat the post-merge fuzz suite; explicit labels always run.
They use the repository inputs and runtime that the seed oracles read.

Run the same selection locally, or inspect the labels without running tests:

```sh
CI_GATE_BASE=main@github sh scripts/ci.sh //packages:compiler-test --jobs 8
printf '%s\n' docs/design/src/003-failures.md | node scripts/fuzz-gate/select.mjs
```

The build-host queue adapter must pass `CI_GATE_BASE` or `CI_CHANGED_PATHS`
when invoking `scripts/ci.sh`, or append the selector's labels to its existing
changed-case list. A graph result from one of these families is a seed check,
not a fuzz campaign. The full fuzz suite and editor smoke remain required.

### Pending examples

A `// pending: VIP-n` line in a guide example holds it out of `:snippets` while
the compiler refuses it. `check-snippets.ts` tries every pending example on each
run and fails on one that compiles clean and prints its `// Output:`, because a
stale line leaves that example unchecked. Delete the stale lines with
`bun docs/tools/check-snippets.ts --retire-pending` in the commit that makes the
compiler take them. `--pending-list <file>` writes why each remaining example is
refused.

Before publishing, `scripts/native-output.sh` requires a nonempty regular executable file. A writer that returns success but produces a directory or a file without execute permission fails the build or copy; the previous executable stays in place. The helper preserves the source file's permissions when copying, so fix those permissions at the source before retrying.

Documentation snippet compiler and execution deadlines also cover output draining.
On POSIX, `docs/tools/check-snippets.ts` kills the command's own process group at
the deadline, including pipe-holding children whose parent has already exited.
The result preserves partial output and the parent's exit status, with
`timedOut: true`; Windows retains immediate-process termination.
`bun test docs/tools/snippet-command.test.ts` exercises real nested children,
both output pipes, concurrent command isolation and generated process trees.

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

## Mapper test executables

The `internal/vibelangmapper` tests run two executables: the compiler, which
compiles a copy of `packages/runtime` for their execution scope, and the mapper
CLI. `//typescript:compiler` and `//typescript:mapper` build both from the
compiler build inputs, and `//:go-vibelangmapper` hands them to the tests
through the absolute paths `VIBELANG_MAPPER_TEST_TSC` and
`VIBELANG_MAPPER_TEST_MAPPER`, so a gate links each executable once, not once
per test binary (`scope_test.go`). A set variable must name an executable
file; a missing file fails the tests instead of linking quietly. A plain
`go test ./internal/vibelangmapper/...` leaves both unset and links its own,
so it needs no graph.

The example checker reads each compiled example's `package.json` to decide
whether to run its test script. A manifest read or parse failure fails that
example as `test script discovery`, keeps the diagnostic in
`.cache/check-examples/<name>.log` and continues checking the other examples.
Only a successful read with no test script skips the test step.

## Source labels in the ESLint corpus

The ESLint corpus includes formatter and control-flow fixtures with deliberately
unused labels. Its `no-unused-labels` check accepts a diagnostic only when the
reported label is an ordinary identifier at that source location. A missing,
renamed or synthesized label remains a corpus failure; normal unused-label
diagnostics remain visible to ESLint users.

`packages/compiler/test/eslint-corpus-labels.test.mjs` runs the native guard in
`//packages:compiler-test` without the optional ESLint install. The standalone
suite also checks minimized real corpus runs and generated labels with ESLint's
actual `no-unused-labels` rule.

Dollar-prefixed bindings such as `$assertMatch` and `$freeze` are also deliberate source witnesses. The corpus compares a quoted name with the native `Identifier` at the diagnostic location, including its `synthesized` flag. A dollar name elsewhere in the file cannot excuse an unwritten helper. `packages/compiler/test/eslint-corpus-names.test.mjs` runs without the optional ESLint install; the standalone suite checks six real corpus shapes and generated names with the pinned unused-variable rule.

The editor fuzz target's declared-reference probes use distinct source token positions and exclude declaration-name tokens, including copies made by lowering. Completion, hover and definition checks remain on selected source references; TypeScript permits an empty completion response at a declaration name. The source-selection regression covers native classes, errors and schema errors with ASCII/Unicode names and shifted source positions.

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

Standalone `scripts/check-forms-table.sh` generation retries once when Go
reports a disappeared compiler-cache archive. Diagnostics stay live while
waiting or building; the first error is followed by an explicit retry message; a second failure stops the
check with its status. Each attempt uses the same arguments and a retry
discards the first attempt's temporary outputs. Ordinary compiler errors and
prepared `FORMS_BINARY` failures still stop immediately. The decision-approval
gate applies on both attempts.

## Known property-test failures

`scripts/testing/property.mjs` replays saved JSON inputs before generated
cases. A `knownFailure: true` entry must provide a nonempty `errorPattern`
regular expression matching the thrown error, including assertion details. Use a pattern
specific to the recorded diagnostic or assertion; missing tools, timeouts and
other failures must fail the check. Missing or invalid patterns fail before
the saved input runs. Unexpected failures name the corpus file, expected
pattern and actual error, retaining the original error as their cause.
A saved known failure that succeeds remains `XPASS`: remove its
`knownFailure` marker after fixing the defect.

The native ESLint corpus tree oracle compares each source token with the decoded `Identifier.name` at the same offset. Unicode escapes keep their written token ranges, diagnostics and contextual-keyword checks. `packages/compiler/test/eslint-escaped-name.property.test.mjs` runs in `compiler-test`, covering fixed and braced escapes in six declaration forms and missing-node mutations, including escaped `match` and `effect` bindings.

The same oracle requires a written identifier at the start of each ordinary `const`, `let` or `var` declarator, including `declare` declarations. Contextual words such as `match` and `service` used as variable names receive the same check as other names. `packages/compiler/test/eslint-contextual-bindings.property.test.mjs` mutates and removes native binding nodes across declaration, loop, effect and match neighbours; lowered match temporaries retain their syntax exemptions. Hoisted loop-condition and update temporaries outside the written declaration span also keep their operator exemptions.

Function names and parameter bindings also require written identifier nodes when named with contextual words, such as `match` or `service`. The oracle reads their source headers so removing the last parameter or function name cannot hide the defect. Parameter types, default expressions and Effect modifiers retain their syntax exemptions. `packages/compiler/test/eslint-function-bindings.property.test.mjs` checks native trees across declarations, arrows, methods, destructuring and generated missing-node mutations.

CI-health reports distinguish `Go cache archive` failures from missing repository inputs. The former identifies a missing compiled archive with a matching content hash and bucket; it calls for cache investigation without guessing what removed the archive. `.smithers/flows/ci-health/test/go-cache.test.mjs` covers the real log pair, generated diagnostic neighbours and competing causes, and the `go-cache-archive` eval runs the actual workflow on that pair.

The `//typescript/vibelang:coverage-twin-oracle` target runs the parity oracle's five positive and negative controls with real stock TypeScript and the checkout's pinned Effect install. It checks success, error and service types separately from runtime `Exit` values, and needs no VibeLang compiler build. `scripts/test-runners.test.mjs` keeps this suite connected to its declared runner.

CI-health reports identify Node `Cannot find package` errors as `missing package` before a surrounding assertion can mask the missing install. The requester's pinned package installation and module root are the first checks. Native Node diagnostics and real same-key graph receipts cover this classification; the `missing-package` eval runs the actual workflow, preserving its Go-cache and duration-regression cases.

## Packages

```text
.smithers/WORKSPACE.ts          toolchain (node, go, bun), cache in .flows/
//typescript/tsc                the Go module
  :srcs                         Filegroup: what go build reads (no *_test.go, no testdata/)
  :go-checker :go-parser :go-ls go test, one target per Go package tree (merge gate,
  :go-format :go-core           when the change edits that tree)
  :go-vibelangfmt               VibeLang formatter Go tests; required by :compiler-test
  :vibelang-files ...           Filegroups: one Go package's tests and testdata
//typescript
  :compiler                     go build ./cmd/tsc -> typescript/built/local/tsc
  :forms-generator              cached go build ./cmd/vibelang-forms -> typescript/built/local/vibelang-forms
  :mapper                       cached go build ./cmd/vibelang-mapper -> typescript/built/local/vibelang-mapper
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
  :go-vibelang-fix-twins        the --fix fixed twins of the TypeScript-form and migration cases and the --fix cost guards (merge gate)
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
  :spec-tests                   the Go tests that read docs/design (every Test...Quoted by name, registry, whole printed diagnostic numbers, VIP citations, pending lines), the cost guards of --fix and flow narrowing
```

```text
:srcs ─► :compiler ─┬─► :<case> x809 ◄─┬─ :runtime-dist ─► :runtime-test, :compiler-test, :migrate-test
                    ├─► :compiler-native ─► :compiler-test, :migrate-test, :vite-test, :unplugin-test, :release, :snippets, :docs-tools
                    ├─► :lsp-smoke ◄─ :runtime-dist
                    └─► :snippets, :docs-tools
:tree ─► :release :snippets :tokens :forms :docs-tools :docs-check :go-vibelang*
:srcs ─► :forms-generator ─► :forms
:srcs ─► :compiler, :mapper ─► :go-vibelangmapper
:design-files, :srcs, :vibelang-files, :vibelangfuzz-files ─► :spec-tests
```

The bundler lifecycle probes hold their short compiler until the parent has
retained its process handle and called `closeBundle` or `closeWatcher`.
A delayed-parent regression outlasts the former `200` ms exit timer. The close
promise must remain pending until the compiler is released by `SIGUSR2`; the
finishing probe holds the backend grace clock with Node mock timers. All
process, pipe, grace-period and hang-guard checks still run.

The mapper hover runner, `packages/ts-mapper/test/lsp-hover.mjs`, shares
`protocol-client.mjs` with the mapper protocol checks. Success, failed checks
and transport errors all await owned-server cleanup; a peer that ignores
termination is killed after one second. `//:release` runs
`scripts/mapper-hover.test.mjs`: real peers cover success and failure paths,
and generated checks vary frame chunks and server stderr pressure.

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

The compiler launcher's watcher test registers teardown with `TestContext.after`
before waiting for stdout. A timed-out test does not settle an outstanding
`once(stdout, "data")`, so `finally` alone cannot clean up a watcher whose
ready message never arrived. Teardown sends `SIGTERM` through the real
launcher and awaits its close, which reaps the native child. The cancellation
regression mutes that child's stdout, exercises the unchanged five-second test
deadline, and checks that the runner exits and the native PID is gone.

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

For `// expect-result:` cases, the generated `out/run.mjs` drains stdout and
stderr after printing the result or defect, before its forced exit. Large
JSON values and failure details therefore reach the parent intact, while the
forced exit still stops the runner's timer and background work.
`scripts/harness-result.test.mjs` exercises the generated adapter with the real
pinned Effect package, large strings, escapes, structured values and defects.

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

The harness decodes compiler and runner output as UTF-8 across pipe chunks,
with separate decoders for stdout and stderr. A character split between reads
stays intact in comparisons and retained command tails.
`scripts/harness-utf8.test.mjs` checks real child processes with shifted
multi-byte output, generated mixed text, nonzero exits and incomplete final bytes.

Before selecting or staging cases, the harness checks that
`EFFECT_NODE_MODULES/effect` is a directory with a `package.json` file.
A missing install, dangling link or incomplete package exits with status `2`
and an install hint, preserving each case's previous outputs. Package and
`node_modules` symlinks to valid installations are supported.

The release check also runs the dependency-free site generator unit suites:
`site/scripts/sync-spec-docs.test.mjs` and
`site/scripts/sync-user-docs.test.mjs`. These check specification links and
page rendering in temporary fixtures; they need
neither a site install nor a browser or site build.
`scripts/test-runners.test.mjs` guards their registration and lists the
remaining site suites with their required installs or build outputs.

Direct harness runs require `VIBELANG_RUNTIME` to name an absolute directory containing the `vibelang-runtime` manifest and its built `dist/index.js`. A missing, malformed or unbuilt runtime exits with status `2` before selecting or staging cases, preserving their existing outputs. Use the built `packages/runtime` directory, or run `vibelang/smoke.sh`.

The release check runs `typescript/vibelang/harness.test.mjs`, including a
barrier-controlled regression that executes both targets' actual shell commands
concurrently. The aggregate starts after the per-case compiler emits and before
its runner loads the result, so shared output directories fail deterministically.

The harness sets `VIBELANG_BINARY` to the absolute compiler executable it used when launching every custom runner, including an isolated case. A runner's nested compiler calls therefore check the same build as the case.

A case's custom `run.mjs` has 60 seconds unless one of its lines says
`// run-seconds: N`. The twelve `rewrite-*` runners call `compareRewrite`, a
pipeline of six stages (two compiles, two runs, two `--fix` passes) that each
have a 30-second deadline, and declare `// run-seconds: 180`, their sum: a slow
stage then trips its own deadline, which names the stage in
`out/rewrite-evidence/<stage>.log` with its duration, instead of the runner
being killed as a whole. Under the 60-second default, post-merge killed healthy
runs after four compiles on loaded hosts (medians of 13 to 20 seconds, maxima of
86 to 115 seconds over 214 runs).

The Chapter 15 failure case uses `TestClock.layer()` and advances virtual time
with `TestClock.adjust` before joining its scenario. This checks timeout,
uninterruptible debit/credit and cleanup ordering without racing host timers.
The release check runs `scripts/chapter-failures-clock.test.mjs` against the
real compiler and the case's exact expected result, including seven schedules
that pause the host while registering a timer.

Compiler-case and editor smoke targets depend on `//packages:compiler-native` as well as the compiler executable. This prepares `packages/compiler/native/` and `dprint-plugin.json` before a custom runner formats a source. Case cache keys also include shared runner helpers, the API comparison scripts and their pinned TypeScript install.

The `schema-internal-companion-pair` and `schema-jsdoc-stripinternal-constant-only` cases deliberately test the dangling aliases that native `stripInternal` leaves behind. Their TypeScript twins use `typescript/tsconfig.emit.json` and a custom runner: it compares every emitted declaration byte against both the compiler's TypeScript twin and stock TypeScript, then requires the exact `TS2693` diagnostics for the retained aliases. These fixtures test emission; the API identity checker continues to reject invalid declarations. `scripts/schema-stripinternal-property.test.mjs` generates schema names, struct and alias forms, namespace placement and line endings against the same stock TypeScript oracle.

The harness sets its final exit status and lets stdout drain before it exits.
Piped failure reports and verbose compiler logs retain their final lines and
the case summary, including large lines with Unicode text.
`scripts/harness-report.test.mjs` covers successful, failed and pending cases,
with quiet and `--status` controls.

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

The case harness accepts a positive safe integer for `--jobs`. It starts no more workers than there are selected cases. Invalid, missing, zero, negative or fractional counts exit with status `2` before any case is read or modified; a zero-worker run cannot report success.

The harness gives each command a private process group on Unix and terminates that group when the command finishes or reaches its deadline. At the deadline it also closes inherited output pipes, so a descendant outside that group cannot keep the harness waiting for EOF. A timeout fails the command even if its parent already exited with status `0`. Receipts retain the process and group IDs, the timeout flag, the parent's actual exit or signal, and separate output tails. On Windows the harness kills the direct child and bounds pipe waiting; Unix process-group cleanup is unavailable.

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

The case harness requires compilation to exit with status `0` when no error diagnostic was reported. Status `1` or `2` is accepted only with error diagnostics that the case expects; a nonzero status without errors fails before declaration comparison or execution. The failure receipt retains the compiler's status and output, including under `--status` and for pending cases.

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

A compiler case's `pending` file must start with its owner's lane. An empty or
whitespace-only file fails that case before installing dependencies or compiling;
its retained log names the metadata error and has no command records. A valid
owned marker keeps the existing `pending` and `XPASS` behavior.
`scripts/harness-pending.test.mjs` checks both paths, including generated
whitespace markers.

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

A run with `-run`, `-bench`, `-fuzz` or `-json`, or with `GO_TEST_SHARDS=1`,
runs the binary once, as before. Active fuzz selections accept both native binary flag
forms, `-test.fuzz=FuzzTarget` and `-test.fuzz FuzzTarget`; the script
preserves their arguments and exit status without adding a shard's
`-test.run` selector. Fuzz limits and corpus-directory flags alone still
run the seed corpus in shards. In particular, benchmark selections pass
through unchanged so a benchmark runs once, rather than once in every shard.

Go's flag parser stops at a positional argument, a standalone `-` or `--`. The launcher forwards these invocations unchanged once, before discovery. Split values such as `-test.timeout 40m` also take this conservative path, since a custom flag's value can look like a positional argument. Flags such as `-test.short=true` keep the ordinary sharding policy.

Discovery retains Unicode names from Go for tests, fuzz targets and examples,
including when `LC_ALL=C`. Benchmark names and diagnostic lines containing
whitespace do not become shard selectors.

Native binary selectors, JSON mode and profile output flags accept Go's
one-dash and two-dash forms, such as `-test.run=TestA` and
`--test.run TestA`. Both forms pass through unchanged to one process; ordinary
settings such as `--test.fuzztime=1x` still permit sharding.

Discovery and execution both receive the original test arguments, including
`-short`, `-timeout` and custom test flags. A `TestMain` that reads them sees
the same configuration before the script assigns tests to shards.

Cancelling the shard launcher with `SIGTERM`, `SIGINT` or `SIGHUP` stops and
reaps its active test binaries before removing temporary shard output and
returning `143`. This also covers cancellation while listing test names, when
the package's `TestMain` can already be running. Discovery keeps the original
test flags.

Coverage and profiling runs (`-coverprofile`, `-cpuprofile`, `-memprofile`, `-blockprofile`, `-mutexprofile`, `-trace`)
also run the binary once. The output file then contains the complete run;
shards would overwrite the same file. Setting only a sampling rate or fraction
keeps ordinary test sharding.

Weighting, sorting, slice selection and shard assignment must all succeed
before a test process starts. A failed stage names itself in the diagnostic,
keeps the tool's error output and fails the run; a partial partition cannot
report a successful subset of the suite. Temporary partition files are removed.

Explicit `-test.failfast` flags also run once, so the first failing test
stops the whole suite. Their original values and repeated flags reach Go
unchanged, including `false` settings and invalid values that Go rejects.
Ordinary runs without this flag still shard.

The fuzz shell caps `GOMAXPROCS` at the smaller of `24` and the CPUs allowed
by the process affinity, using Node's `os.availableParallelism()`. A lane
restricted to four CPUs therefore starts four seed workers, rather than sizing
workers from every CPU on the host. It declares `GOFLAGS=-p=6`, matching the
post-merge build allocation. Smithers withholds ambient Go variables, so
setting them only on the outer CI process does not constrain the test.
These declared values also enter the target cache key.

## Finding slow and flaky targets

The ci-health flow ranks them from `CI_RESULTS` files and graph logs, with the
tests and causes behind each flaky target: `.smithers/flows/ci-health/README.md`.

## Finding the commit that broke a target

The first-bad flow reruns targets that fail at a bad commit, to separate breaks
from flakes, and bisects each break to the first commit after a good one that
fails it: `.smithers/flows/first-bad/README.md`.

Shard selectors are joined with shell builtins, so a failing external `paste` command cannot turn a shard into an empty test selection.

Launcher fixtures that expect the whole suite set `GO_TEST_SLICE=1/1` explicitly. This overrides both the host-local `scripts/go-test-slice` file and the invoking process's slice; tests of slicing supply their own value. The `go-test-shards-isolation.test.mjs` regression runs the original selector, positional-argument and cancellation assertions beside a host slice file and with inherited slice values, including an invalid value.

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

The `//:spec-tests` selector includes every `Test…Quoted` in its declared Go packages by name. Quote checks need no explicit list entry. `node --test scripts/spec-tests.test.mjs` and `bun test docs/tools/spec-quote-gates.test.mjs` check the executable selector, its package scope and the listed tests together.

`//:spec-registry-go` runs `TestRegistryMatchesSpec` alone. `mq.py spec-push` runs it with the spec linters, so a spec-only commit that assigns an Appendix B code needs a registered message or a `specAhead` entry naming the lane that registers it. A target of one test still blocks a push while `//:spec-tests` is red for other reasons, because `spec-push` tolerates a target `main` already fails.

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

The `cache-loaders` property logs each child before and after execution with
its revision, engine (`node` or `bun`) and cache mode (`cached` or `fresh`).
The completion record includes elapsed milliseconds, exit status, signal,
spawn error code and the last `4000` characters of each output pipe. These
records distinguish a loader timeout from a compiler failure while retaining
the original `30000` millisecond child budget. Replay the property with the
`FC_PROPERTY`, `FC_SEED` and `FC_PATH` printed in its failure.


The compiler and Vite package tests consume `//:migration-sources`, a root-owned filegroup that holds every file of the migrate flow, so a new flow file needs no entry in any `PACKAGE.ts`, and `packages/compiler/test/migrate-inputs-paths.test.mjs` fails when `packages/PACKAGE.ts` names a migrate or convert flow file by path. A `//` prefix roots a glob's path but does not change its package scope: a glob declared in `packages/PACKAGE.ts` selects none of the root-owned `.smithers/flows/migrate/` files, and `smthrs explain` shows it with `"files": []`. `migration-inputs.ts` defines the shared group without a declaration-module import cycle. The compiler package's cache-contract test (`packages/compiler/test/migrate-inputs.test.mjs`) reads `packages/PACKAGE.ts` to check that each consumer lists `migrationSources`, and uses `smthrs explain //:migration-sources` to check that every file under `.smithers/flows/migrate/` and `.smithers/flows/convert/` is an input with its current content digest. It explains only the filegroup: every `smthrs explain` walks the whole workspace and fails with `explain_failed` when a directory disappears during the walk, and the graph runs the test while other targets create and remove directories. A test that writes temporary files under a flow directory makes this check fail; put them in a directory from `mkdtemp(join(tmpdir(), ...))` instead.


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

Native builds and copies publish executables through `scripts/native-output.sh`.
The helper refuses a directory at the executable path, including a symlink
to a directory, before starting the writer and again before publication.
It reports the path and leaves the directory and its contents intact.

The command-line fuzz target builds its nested compiler with `-trimpath`,
matching the outer Go test build. This lets the two builds share compiler
package artifacts in the Go build cache on a fresh validation mirror.

## Benchmark corpus generation

The compiler benchmark stops if docs corpus generation fails, returns the
generator's exit status and prints its diagnostics. Its output directory keeps
`docs-corpus.log` and `docs-corpus.stderr.log`; the failed corpus remains
available for diagnosis. Only successful generation is used for measurement.

The LSP benchmark, `node scripts/bench/lsp.mjs <server> <project>`, reports
malformed response headers, JSON or messages with the active request and its
method. It terminates and reaps the owned server before returning failure,
escalating to `SIGKILL` if the server ignores `SIGTERM`. Response bodies are
omitted from malformed-response diagnostics.

The docs hover client's `docs/tools/lsp.ts` rejects every pending request
when the response stream ends, a frame is malformed, or a server request
cannot be decoded. The error names the request and protocol stage without
copying a malformed response's body. Hover generation can then close its
server and remove its temporary projects; a server that ignores termination
is killed after the existing two-second cleanup deadline.

## Mapper protocol checks

The mapper test client's `packages/ts-mapper/test/protocol-client.mjs`
remembers a failed transport. EOF, malformed frames and pipe errors reject
every pending request and reject future requests immediately. Errors identify
the request id, method and transport stage without copying malformed response
bodies. Callers close the owned server in `finally`; `close()` also rejects
pending work and escalates to `SIGKILL` after one second if needed.

`node --test scripts/mapper-rpc.test.mjs`, also run by `//:release`, checks
real stdio peers, concurrent failures, repeated cleanup and response-error
recovery. Its `fast-check` property varies Unicode results, request counts
and frame chunk sizes, including reversed response order.


The mapper parity harness shares `parseJsonc` from `packages/compiler/cache.mjs` between its declaration and runtime columns. Configuration strings remain literal, including commas before `]` or `}`, comment lookalikes and escaped quotes; comments, trailing commas outside strings and an initial byte-order mark are accepted. `node --test scripts/mapper-parity-jsonc.test.mjs` checks generated JSON data and compiles and runs real TypeScript fixtures through the runtime column with the mapper package's pinned stock compiler and Effect install. It also checks the emitted paths against the source configuration. The release target includes this suite.


The declaration and runtime columns of mapper parity share `packages/ts-mapper/test/parity/command.ts`. A command's deadline covers both process exit and stdout/stderr draining. On POSIX, the command owns a separate process group; a timeout stops that group, including descendants holding inherited pipes after their parent exits. The reported status names the timeout even when the parent exited `0`; spontaneous signals keep their signal status, and ordinary commands keep their exit code and separate output streams. Windows retains direct-child termination. `node --test scripts/mapper-parity-command.test.mjs` checks real process trees, generated stream ownership and nesting, partial output, isolated concurrent commands and spawn failures; the release target runs it.


The mapper runtime parity column requires stock TypeScript to exit `0` before it runs any emitted JavaScript. `noCheck` deliberately skips type checking, but syntax errors still fail compilation even when `noEmitOnError: false` leaves executable output. A failure names the compile stage, exit status and first diagnostic, bounded to `300` characters. `node --test scripts/mapper-runtime-compile.test.mjs` uses the pinned real compiler to cover emitted output after syntax errors, verify that top-level side effects never run after a failed compile, and retain healthy and deliberately unchecked controls. Generated mixed batches check isolation between failing and passing cases; the release target runs the suite.

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
- **Not yet in the graph.** `ts-mapper`, `create-vibelang`, the
  editors, the examples and `scripts/e2e.sh` run outside it.

The [specification contracts](#specification-contracts) run in `//:spec-lint`. A new class of inconsistency gets a rule and a failing-defect test in the commit that fixes it.

The `//:docs-tools` target runs its test files with `bun test --timeout 60000 --parallel=3 --no-isolate`.
Three worker processes run files in parallel; tests within each file retain their normal order.
Each worker reuses its module registry between files, as the serial runner does.
All `docs/tools/*.test.*` files are discovered on each run, except the separately declared
`site-contrast` and `site-spec-links` tests. A failure in any worker fails the target.
`scripts/docs-tools-parallel.test.mjs` exercises that command with real files, a
cross-file barrier, per-file ordering checks and a failing worker.

`//:site-spec-links` checks the generated specification and VIP pages for unconverted `.md` links, missing pages and missing anchors. `//:docs-tools` depends on it, so the pre-merge gate runs it. Its inputs are `site/src/pages/spec/**`, `site/src/pages/vips/**` and `docs/tools/site-spec-links.test.ts`; unrelated changes reuse its cached result.

The contrast test emits `site contrast stage result:` JSON after each of its
five commands: dependency installation, infrastructure tests, typecheck,
production build and browser audit. Each record includes the command,
`elapsedMs`, exit `code` and `signal`; a command that cannot start records
its error and a null code. Records appear before the exit assertion, so a
failed stage retains its cost. Compare these costs before changing the audit's
inputs or budget. The private site copy, registry snapshot, release-environment
sanitization, successful browser output and failing-command output are retained.

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

## Specification contracts

Both `//:forms` and `//:docs-tools` require the static `//:spec-lint` aggregate, which selects `//:spec-registry`,
`//:spec-tables`, `//:spec-copies`, `//:spec-authority`,
`//:spec-linters-test`. They use the normal
Smithers graph and cache; no extra pre-gate script is needed.

The registry check reads Appendix B until the one-file diagnostic registry
lands. One adapter selects that source when present. TypeScript codes and
options come from the pinned compiler registry. The registry also reads JSON/JSONC option keys and VibeLang CLI fences. Explicit `EK3007` or `TS5023` rejection witnesses do not assign a new option; other tools do not contribute compiler flags. VibeLang names require
published VIP authority; unresolved authority is reported as a warning. An open VIP is not approval, even when its diagnostic already has a registry row. A denied VIP may explain a rejection in its own sentence; a neighbouring rejection sentence cannot authorize a positive citation.
The table check compares decided config keys, denied VIP membership and
repair forms, and resolution order. A property signature such as `sidecarDir?: string` is qualified by the top-level option object its VIP declares; an unrelated object's field does not authorize a `vibe` key. The copy check compares shared tables
and explicitly marked `spec-copy` sections byte for byte. The
`//:spec-shared-tables` generated target derives the resolution reference
from VIP-39. After editing that source table, run `node docs/tools/spec-rules.mjs generate` and commit the generated reference. Its regression check compares the committed bytes with a fresh generation.

VIP examples, including fences indented under list items, run through the native compiler. A negative example uses
`// expect-error: EK0509` with its required code; an inline marker also checks the source line. A different diagnostic or
an unexpectedly successful compilation fails. Missing fixture bindings,
schematic ellipses and explicitly marked fragments are visible warnings.
They are not evidence that an example compiles. Removed value handlers are
checked even in schematic examples, so `catch guest` cannot hide behind a
missing binding or a parser cascade. Compiler launch failures fail the target. A future example may name an exact `// compiler-gap:` code under its published prerequisites; unrelated errors remain checked, and the marker fails once that code disappears.

Run the focused contracts with:

```sh
sh scripts/ci.sh //:spec-lint --jobs 8
```

Each diagnostic names the source file and line. The historical regressions
name their review finding; fast-check mutates registry tokens and resolution
order with reproducible seeds.


Each check has one owning target and a source-keyed cache entry. Review rules in `docs/tools/spec-lint.ts`
are assigned to those targets by `lintKind`; option authority belongs to the
registry, resolution bytes to generated copies, and accepted VIP catch-handler
syntax to the compiler checker.

`//:spec-copy-sections` regenerates chapter tables and marked sections from
their VIP source; `//:spec-shared-tables` produces the standalone resolution
projection. The diagnostic adapter reads `docs/design/registry/diagnostics.json`
once it is available and otherwise Appendix B. Unsupported authority is a
visible warning until an accepted source settles it. A compatibility number
explicitly described as still emitted is not a new diagnostic assignment. An accepted VIP's `Decision` section that cites a diagnostic must also appear in that code's registry authority; statements describing an old code are historical.

Denied VIPs retain their historical status. An explicit `*Superseded by [VIP-N](...)` record removes the old VIP from the current denied table only when its link names that accepted successor. The authority check permits the historical supersession citation and still rejects positive claims based on the denied VIP, including later claims in the same sentence. Filesystem and in-memory source snapshots use the same checks.

Run the compiler-backed VIP contract separately with `sh scripts/ci.sh //:spec-vip-examples --jobs 8`. It reports missing assigned diagnostics as errors; schematic examples remain visible warnings.

The throws inventory CLI, `node docs/tools/throws-inventory.mjs --check` or
`--write`, reuses a successful analysis from `.cache/throws-inventory.json`.
Each invocation hashes the bundled declarations and version, Effect sources,
declarations and package metadata, the installed TypeScript parser, both package
pins, and the generator, analyzer and receipt implementation. It also verifies
the current `docs/design/inventory/throws.json` bytes. A changed input or artifact,
or a missing or corrupt receipt, runs the analysis again; a failed check never
saves a receipt. Delete the receipt to force analysis. The direct inventory
regression test always regenerates the expected inventory without this cache.

## Example compile diagnostics

`sh scripts/check-examples.sh` keeps complete logs in `.cache/check-examples/`. A compiler failure includes the child's exit status in the summary and prints the last `40` log lines, capped at `8192` bytes, to stderr so retained CI receipts show the cause. It continues checking later examples and returns failure if any example failed.

## Throws-inventory formatting benchmark

Each inventory generation creates a fresh TypeScript program. Signature text is
memoized within that checker, including aliases exported from several modules.
The ordinary property test compares cached text with the real checker across
overloads, generic and recursive types, constructors, re-exports, and shuffled
queries.

Run the full pinned-library benchmark separately:

```sh
node docs/tools/benchmarks/throws-signature-format.mjs
```

It delegates to the installed TypeScript compiler, counts actual
`signatureToString` calls, and requires byte-identical `throws.json` output.
The full library surface is expensive, so this counter check runs through the
benchmark command rather than adding a second inventory generation to each gate.

The `//:site-contrast` check runs `npm run test:infrastructure` after
`npm ci` and before typechecking and building. That command also runs
`site/scripts/patch-vocs-search.test.mjs` against the installed Vocs package.
Its five tests check patch idempotence, refusal of an unsupported version or
changed source or compiled module, and refusal to modify borrowed dependencies.
They use temporary copies of the vendor files and leave the installed package
unchanged. Run the same installed-site checks with:

```sh
cd site
npm ci --no-audit --no-fund
npm run test:infrastructure
```


Packaging properties inspect extracted archive filenames through Node's filesystem API. A `tar` listing can quote Unicode bytes differently under `LC_ALL=C`. The regression includes both package managers, explicit C and UTF-8 child locales, and offline installed Node/Bun consumers. Reproduce the locale boundary with:

```sh
LC_ALL=C node --test .smithers/flows/migrate/test/emitted-pack.property.test.mjs
LC_ALL=C.UTF-8 node --test .smithers/flows/migrate/test/emitted-pack.property.test.mjs
```

### Captured pattern source forms

The native `eslint-is-calls.property.test.mjs` guards captured `is` subjects,
with a keyed regression minimized from `match-subject-once`.
The optional `test/eslint/is-calls-property.test.mjs` checks the actual
`no-unexpected-multiline` rule over guards, extractors, pattern combinators,
subject calls, source trivia and Unicode offsets. Matcher invocations have
the source node `VibeIsExpression`; source arrow calls remain
`CallExpression`. The matcher and subject stay reachable to scope analysis,
and source call newlines keep their reports.

## Specification rule authority

The optional `//:spec-rule-judge` run target checks added specification rules
and compiler diagnostic messages with `gpt-6-luna`, after deterministic
linters. It rejects grounded rules without accepted authority and contradictions
by default. Platform owns its attachment to the pre-gate. Its private
revision/diff/policy cache prevents retries from changing a verdict; missing
decisions or an unavailable model warn and allow the entry.
`//:spec-rule-judge-test` checks its tooling without a model.
See [the configuration and fixed historical eval](../../scripts/spec-rule-judge/README.md)
for external authority paths, the `smthrs eval` command and calibration results.


The mapper runtime-parity runner maps entry filenames with the same rule as
its emitted-file checks: `.ts` and `.vibe` run as `.js`, `.mts` as
`.mjs`, and `.cts` as `.cjs`. The first source in alphabetical order with
an `expect-result` header supplies the entry. Run
`node --test scripts/mapper-runtime-entry.test.mjs` to check real pinned
stock-TypeScript output and generated mixed entry batches. These tests run
in `//:release`; the full mapper parity corpus remains outside the graph.

The ESLint corpus includes two deliberately malformed fixtures:
`fiber-unary-exponentiation-error/main.vibe` checks `EK0510`, and
`lsp-fixture/src/malformed-pipe.vibe` checks `TS1109` while editing. Its
`helpers.mjs` records their exact repository paths, messages, lines and columns.
Both corpus checks require the intended parser failure; a different error, a
neighboring unlisted file or a fixture that now parses still fails. Update an
expectation only with evidence from its owning compiler or LSP test. The native
guard `test/eslint-corpus-parse-errors.test.mjs` runs in `compiler-test`; the
optional `test/eslint/corpus-parse-errors*.test.mjs` suites exercise both actual
corpus checks and generated real ESLint fatal reports.


The mapper runtime-parity runner treats each entry filename as a literal URL
path segment and quotes its generated import. A filename containing `#`,
`?`, `%20` or `"` keeps those characters rather than changing the imported
path or JavaScript syntax. Run
`node --test scripts/mapper-runtime-entry-url.test.mjs` for real pinned
stock-TypeScript regressions and generated filename batches in `//:release`.


Each mapper runtime-parity runner lives in its own directory under the
case's output directory, so a dependency named `run.mjs` keeps its emitted
exports. Run `node --test scripts/mapper-runtime-runner.test.mjs` for real
pinned stock-TypeScript module graphs, byte comparisons against an
independent emit, and generated direct/reexport graphs in `//:release`.

## Evidence for specification rule changes

`//:spec-rule-evidence` checks the diff from `RULE_EVIDENCE_BASE` to
`RULE_EVIDENCE_HEAD`, both supplied by the caller. A changed normative
sentence in a design chapter or VIP needs a relevant changed compiler case,
an adjacent VibeLang / Effect TypeScript example whose declarations compile
and match, or an exact pending witness. Deletions add no evidence obligation.
A reworded rule can inherit an existing test when its exact citation is
repointed and the executable checks stay unchanged; shared diagnostic codes
alone do not establish equivalence. `//:spec-rule-evidence-test` runs rejection,
exemption, mutation and real compiler regressions. The diff target is independently selectable,
keys its result on both immutable commit IDs, and is not wired into the pre-gate.
It requires explicit selection, so wildcard CI does not need a diff. See
[the evidence contract](../tools/README.md#evidence-for-changed-specification-rules)
for sentence classification, case references, twin layout and exit codes.

The manual Smithers target `//:spec-coverage-census` inventories immutable
`main@github` rules and their passing, pending, tag-linked and missing test evidence,
excluding reviewed `not-rules/*.csv` rows;
`//:spec-coverage-census-test` checks its extraction and matching contracts.
See [the docs tools census contract](../tools/README.md#specification-coverage-census)
for outputs, confidence rules, compiled twins and the 15-minute watcher.

### Diagnostic identity inventory

`//:spec-diagnostic-identity` checks actual compiler message declarations,
the compiler's reserved-category registry, imported lint registrations, Appendix B
definition rows and current user/reference citations in both directions.
A prose mention or range does not replace a definition row. Disabled warnings
and editor-only suggestions count; whole decimal suffixes remain distinct.
The existing `//:spec-registry` checks VIP authority and citations in specification
chapters; it does not inventory every compiler message declaration.

This target is exclusive and omitted from normal wildcard test runs while `fold-details` folds the complete Appendix B
inventory from `gate6-codes`. Its mutation tests and the unused-factory-diagnostic retirement properties run in
`//:spec-linters-test`. To require the real inventory, fold the missing rows,
regenerate compiler category/doc projections, run
`node docs/tools/diagnostic-identity.mjs` with zero findings, remove
`exclusive: true` from `specDiagnosticIdentity`, then add it to `specLint.data`.
No compatibility-code allowlist bypasses missing definition rows.
Historical proposals, the versioned code map and release/decision logs are
migration records; current chapters and guides are scanned. Appendix B's
explicit retired-code declaration preserves its non-reassignment history.

### Evidence for generated implementation inventories

The `rule-evidence` checker recognizes the exact generated grammar-census
format and valid, uniquely keyed hook rows as implementation metadata. It
retains evidence requirements for real grammar rules, malformed markers and
handwritten additions, preserving heading context and original source line numbers.

Native executable build keys exclude `forms_decisions.txt` and
`forms_decisions_approved.txt`: the forms checker reads them at execution
time, while Go embeds `forms_table.jsonl`. Go-test and full-tree check inputs
retain the snapshots. `//typescript:native-inputs` checks all three executable
keys with actual SDK fixtures; `//typescript:native-deps` reads Go's real
dependency and embed lists and rejects a future import or embed of an excluded
input. Real minimal Go fixtures cover both forbidden snapshot embeds and the
retained production table.
The dependency audit uses `CGO_ENABLED=0`, matching native builds even when the caller enables cgo.

The ESLint corpus guard accepts a source-written constant literal only when its
reported `Literal` node, UTF-16 range and raw text match the source. The
`no-constant-condition` rule remains enabled, and generated literals or
unclassified conditions still fail the guard. Native provenance tests run in
`compiler-test`; the pinned ESLint fixture also tests the real corpus checker
and generated provenance mutations.

The alias-revert injected-I/O and asset-import properties quote Chapter 007’s current declaration-file and source-tool split. Refresh those citations when that sentence changes; retain their alias roundtrip and host asset-resolution checks and all sample counts.

The hidden-native cache property requires real misses for the fixed .vibe leading-dot cases, including all visible/hidden file and directory combinations with include globs or explicit files. Its remaining .vibex allowances keep strict stale-result and XPASS guards until their own product repairs land; the32 discovery samples remain unchanged.

Migration helper, runtime enumeration, pinned formatter and workspace reachability property citations use Chapter 007’s current declaration-file and source-tool split. Citation refreshes preserve their generated inputs, negative controls, assertions and sample counts.
