# The build graph

The Vite plugin packages a copy of the compiler's alias resolver. After changing
`packages/compiler/paths-imports.mjs`, copy it to
`packages/vite/src/paths-imports.js`, changing only its relative import of
`relative-imports.mjs` to `relative-imports.js`. Run
`node --test packages/vite/test/paths.test.mjs` to verify source parity and
resolution through the plugin. The compiler's optional native-launcher and
in-memory-file settings keep their defaults for Vite callers.

When editing a `PACKAGE.ts` or `WORKSPACE.ts` declaration, run
`node --test scripts/build-declarations.test.mjs` before the longer checks.
The test loads the real workspace through `smthrs graph` without executing
builds. `S.Filegroup` takes targets in `srcs`: use `S.file("path")` for one
file or spread `S.glob(["pattern"])` for a group. String paths belong in
the arguments to those helpers. Invalid declarations fail before any target
can run; successful tests of a target's command alone do not validate them.

The declaration fixtures share `scripts/testing/package-declaration.mjs`,
which imports the production input-helper modules. New exports from those
modules reach every fixture without separate binding lists. A missing imported
binding reports the declaration file and identifier. Callers supply dependency
identities and environment values; the adapter keeps environments independent.
These fixtures check dependency identity and command transport. The real SDK
check above still validates declarations. Run both the adapter's export-mutation
controls and its consumers with:

```sh
node --test scripts/package-declaration.test.mjs scripts/forms-generator.test.mjs \
  scripts/fuzz-hangs-target.test.mjs \
  scripts/native-output.test.mjs scripts/spec-progress-target.test.mjs
```


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

For a focused check on a fresh checkout, prepare the same prerequisites first:

```sh
sh scripts/ci.sh --prepare-only
```

This uses the same frozen installs, Effect sharing and two stock TypeScript
baselines as the complete check. It stops before gate selection and graph
execution. Run the desired build or test command afterward. This mode accepts
no target arguments. A failed install retains its diagnostic and nonzero exit
status; provisioned `node_modules` symlinks stay with their owner.

`scripts/ci.sh` installs what the targets read (`.smithers`, the runtime, the
compiler package, `packages/compiler/test/tools`, `experiments`, `docs/tools`) from their lockfiles, then runs
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

The changed-path selection fixtures prepare both the current and historical
stock compiler baselines in each temporary project. They reject package
downloads, so the selection probes run offline. Missing-baseline controls
still make the real setup attempt its install and stop before graph dispatch.
Run them with `node --test scripts/fuzz-gate.test.mjs`.

The CI install fixtures allow `30` seconds for their child shell as a hang
guard. Their install, lockfile and shared-symlink assertions remain independent
of elapsed time. A deliberately delayed installer checks this distinction.
Failures retain elapsed time, exit status, signal, spawn error, started
installer directories and both output streams, so a timeout can be separated
from an installer refusal.

The `//:api-identity-test` target checks [published declaration identity](api-identity.md), including harmless rewrites and semantic mutations. Its bounded-heap scale probes retain the child exit status, signal, process error, elapsed time and unchanged heap and timeout budgets on failure, together with comparator stage and memory records. `scripts/api-identity-scale-failures.test.mjs` injects process outcomes into those same probes and verifies both failure diagnostics and complete successful receipts.

Migration integration fixtures keep valid lockfile syntax and published package names and versions. Fixtures that bypass setup record real upstream pack receipts before checking declaration exits, build provenance or test regressions. Their pack commands must succeed before the intended checks run.

The custom pipeline stage-order property compiles all `16` combinations of
stage count and library-stage positions in one fixture. It checks construction
and execution traces over fixed inputs and `100` generated values, preserving
the `120`-second test deadline. A stage record reports the program count and
compile time so repeated compiler startup is visible separately from assertions.

The run-phase binding corpus quotes Chapter 7's current requirement to preserve evaluation order, coldness, types, comments and declaration output. Contract wording updates preserve the binding-provenance cases and property counts; they do not change run-phase verification.

Fixtures that bypass setup use `recordDeclarationSurface` to preserve entrypoint aliases and output layout, and record actual `packRepository` results. A hand-written root list does not contain the metadata needed to reproject the baseline independently of the candidate tree.

Private-declaration and one-pass record fixtures capture actual upstream packs, including the empty published set when every package is private. Private declarations remain gated by their original opt-in rules; pack prerequisites must not prevent those positive and negative cases from executing.

Forced-record fixtures use complete receipts from `verify`, with real upstream packs and test-command results. A staged compiler descriptor supports zero-package proof fixtures; a case that intentionally uses its package-local compiler stub keeps that binding. These fixtures retain assertion-mutation, binary, BOM, source-path and native formatter controls.

Migration tool-configuration tests load generated Knip modules and check both `.vibe` and `.vibex` compiler bindings, retained package settings and sidecar excludes.

The formatted-declaration certification file must parse and execute its complete property suites: 40 signature cases and 12 formatter-mutation runs plus explicit mutation examples. A file-level syntax failure is a failed suite, not an omitted property.

Upgrade fixtures use real named and versioned toolchain archives. Public workspaces assert the release dependency and the managed local install pin separately, and compare the staged archive bytes with the producing artifact.

The `//packages:migrate-test` target retains both complete migrate and convert test globs and a bounded 90-minute aggregate budget. Property sample counts, worker deadlines and Node's concurrency remain unchanged. Only this aggregate target's budget changed.

On a four-vCPU Cloudflare box, an exact Node 26 run selected 261 files and completed in 37m03.7s with 37 failures, 1646 passes, 42 skips and 1 TODO. Its 1580 API worker calls all returned without signals (median 2.872s, maximum 10.931s). Fixing previously failing properties restores about 10 more minutes of measured work. Focused successful properties also varied by 2.5–2.7x across boxes. The 90-minute bound allows more of this work to finish and remains a sizing choice, not a guarantee on the slowest host or a claim that the suite is green.

A gate can split `//packages:migrate-test` across boxes. `scripts/testing/migrate-slice.mjs` reads one git-ignored line, `i/n <host>`, from `scripts/migrate-test-slice`, sorts the selected files and runs every n-th one starting at i. The line applies only on the host it names, so every other run selects both complete globs, and a malformed or empty slice fails the target. The whole suite takes over an hour on four vCPUs, which is longer than a Cloudflare box reliably keeps its stream.

The migration progress reporter prints the selected-file list, failure details, aggregate counts and a heartbeat every 30 seconds. A `test-failed` record retains Node's `todo` and `skip` flags and reasons, so an expected todo failure remains distinguishable from an ordinary failure even when the command succeeds. Successful tests and file summaries update counts without consuming the graph's live output budget. Pending files remain named, and a failed file includes its captured output and unabridged assertion error. A file that cannot load or a terminated run remains incomplete, and Node retains responsibility for the exit status. `scripts/migrate-progress.test.mjs` checks late failures beyond 200 files, real child processes, full assertion witnesses, missing file summaries and termination against an unmodified Node runner.

The `//:release` target runs Node's test files with `--test-concurrency=4`.
This bounds the number of simultaneous file workers independently of the host's
CPU count and the graph's `--jobs` setting. Four matches a gate box's four
vCPUs: with eight workers, a child process in `api-inputs.test.mjs` passed its
120-second limit there. Every selected file still runs, and a failing file keeps
the target's nonzero exit status. Tests within a file keep their own concurrency
settings; child processes they spawn are additional to the four file workers.

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

For ZIP-writer work, `//typescript/tsc:go-plugin-archive` runs the archive tests
and saved corpus without compiling the formatter. Its inputs are `pack.go`,
the two archive test files, the archive corpus, this module’s `go.mod` and
`go.sum`, and the Go tool. `GOWORK=off` keeps the command independent of the
workspace’s other modules. A formatter implementation edit does not re-key this target.
The full formatter target still runs these tests too.

Run a focused fuzz search from the package directory so Go reads and writes
its normal corpus there:

```sh
cd typescript/tsc/internal/vibelangfmt
GOWORK=off go test -p 8 -trimpath -run '^$' -fuzz '^FuzzWriteArchiveTemporaryOwnership$' -fuzztime 30s \
  pack.go pack_test.go pack_concurrent_test.go
```

`PluginName` remains the same exported constant in the same package; it lives
beside the ZIP writer so this file set has only standard-library imports.

`scripts/go-test-inventory.test.mjs` discovers VibeLang-owned Go test
packages and the language service and checks the graph's package selectors. Add a target when adding
a sibling package; `./internal/vibelang/...` covers that directory and
its children, including no sibling such as `internal/vibelangfmt`.

The specification coverage census test target runs Bun with an explicit
sixty-second test budget within its two-minute target limit. This avoids
Bun's default five-second deadline on loaded build hosts.

The `//packages:migrate-plain-probe` target checks the migration toolchain's
plain-function probe with generated declarations and the actual compiler.
VIP-27 permits a generated `@throws {never}` tag on this undocumented probe;
an unknown result type or any other annotation still refuses migration before
source files are rewritten. The target checks the emitted fixed probe plus generated whitespace,
result types and failed compiler outcomes. The full suite also keeps the
minimized schema-helper pattern and plain-helper properties.
The gate selects it for changes to the probe, its tests, compiler declaration
emission or VIP-27. The broader migration suite remains unchanged.

## The merge queue's pre-gate

Contributors base new work on `vibe`; `main` advances through green commits.
The merge queue can dispatch a pre-gate to check one queued change against a
full base commit id. `.github/workflows/mq-pregate.yml` checks out that supplied
commit, applies the change's patch, runs `scripts/ci.sh` with the gate's targets,
and uploads the graph's results as an artifact named after the run.

In stacked mode, changes land on `vibe` after the apply-and-build check without
waiting for a pre-gate pass. Full validation runs after landing; `main` advances
only through commits whose post-merge checks passed. Build toolchains from
`main` unless a required change is available only on `vibe`, as
[the repository guidance](../../AGENTS.md#vibe-and-main) describes.

The queue dispatches it with a `repository_dispatch` event, `mq-pregate`, and a
person can dispatch the same inputs with `gh workflow run`:

```sh
gh workflow run mq-pregate.yml -f tag=<name> -f base=<full-base-commit-id> \
  -f targets='<targets>' -f patch=<base64 of the git diff, compressed with xz or gzip>
```

`scripts/apply-patch.sh` applies the patch. GitHub limits a dispatch payload to
65,535 characters, so the queue compresses with xz, and a change whose patch is
still too large runs only on the build hosts.

The hosted workflow installs Chromium only when browser prerequisites cannot
be ruled out. `scripts/ci-browser-needed.mjs` asks `smthrs ci --plan` for the
complete dependency plan of explicit, reviewed targets such as `//:release`
and `//packages:compiler-test-1` to `-4`. Every executable target in that closure must
be on its reviewed list; a browser target reached through another target
therefore keeps setup. Broad selectors, new targets, unfamiliar rules, incomplete
plans and planner failures all retain `npm ci` and Chromium installation.
Add a target to the reviewed list only after checking that its own command
does not use a browser. The plan check does not execute any target.

The workflow holds no secrets and its token only reads this repository. A hosted
pass counts; a hosted failure sends the change back to a build host, which is the
reference for rejecting it.

Cache preparation reads literal `./internal/` and `./cmd/` package selectors
from `PACKAGE.ts`, `typescript/PACKAGE.ts`, `typescript/tsc/PACKAGE.ts` and
`scripts/check-forms-table.sh`; adding a literal package there needs no second
cache list. The POSIX shell and `awk` reader needs no Node or Bun installation.
It retains exact package boundaries and recursive `...` selectors, removes
duplicates and refuses missing declarations, incomplete inventories or dynamic
selector suffixes. Literals in comments remain included conservatively.
`scripts/warm-go-cache.sh --print` prints the sorted inventory. The independent
coverage audit and a real graph/Go fixture check a new exact package, invalid
neighboring packages and compilation without running its tests.

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
so one cache serves them all. All three native executable targets pass Go's
`-p 8` limit. The compiler appends `-trimpath` to inherited `GOFLAGS`,
preserving module, build tag and linker settings. The graph's `--jobs` controls simultaneous targets; it does not
limit package compilation inside one target. `scripts/go-cache.test.mjs` fails when a target
compiles a package the script misses, or when the two workflows' cache paths
differ. `scripts/mq-pregate.test.mjs` checks the pre-gate's base guidance and
verifies that both dispatch paths carry the supplied commit into checkout and
target selection.

The runtime suite uses Bun's `--only-failures` reporter. Every test still runs,
and the summary retains pass, skip and failure counts. Omitting individual
passing lines keeps late failure details inside the graph's bounded output preview.

Each Go test invocation passes `-trimpath` explicitly, including every
invocation in an `&&` chain. This keeps portable workers on the same
package-cache key convention as local builds. New loader and migration
checks follow the same convention; a later target addition must retain it.

The build flag audit checks each target's shell declaration independently.
An inline `GOFLAGS` assignment cannot supply flags to another target in the
same file. It also checks every invocation in a mixed command chain, so one
command's explicit flag or inline environment cannot cover a later command.
Quoted selectors keep their shell boundaries; text inside a selector does not
supply a compilation flag.

Each generated build flag fixture runs the real audit in its own child process.
Node runs the selected test inside that child with `--experimental-test-isolation=none`,
avoiding an extra worker for each command. The fixture returns the audit's
exit status. A regression records the executing process and verifies that
it is the spawned child.

Go applies repeated flags in order, and command-line flags override
the defaults in `GOFLAGS`. The audit follows that effective setting:
`GOFLAGS=-trimpath go test -trimpath=false ./pkg` is rejected, while
`GOFLAGS=-trimpath=false go test -trimpath ./pkg` is accepted.
A shell script can export `GOFLAGS` before running its commands; a later
assignment or `unset GOFLAGS` ends that allowance. Regression mutations remove
`-trimpath` from the actual native build declarations and insert independent
build and test commands before and after them.
Parameter expansions stay inside their shell word, including the space in
`GOFLAGS=${GOFLAGS:+$GOFLAGS }-trimpath`. The audit reaches the compiler's
native helper and rejects removal of that appended flag.
The same check follows the Go test command passed through
`scripts/go-test-progress.mjs`. The observer forwards its arguments and
environment unchanged, so wrapping a command does not exempt it from
`-trimpath` checks. Removing the flag from the actual specification-check
declaration must fail the audit; selector text and test-binary arguments
cannot supply it.


A `node_modules` symlink in any of these directories, including `.smithers`,
is provisioned by whoever made the link. `scripts/ci.sh` uses it as is and never
runs `bun install` through it. The link owner must keep that install current.
For every ordinary dependency tree, including an existing one, the script runs
`bun install --frozen-lockfile` before starting the graph. An unchanged Effect
version does not prove that the other dependencies match the current manifest
and lockfile. Bun verifies unchanged trees too. Provisioned `node_modules`
symlinks retain the separate owner responsibility above.
Compiler test shards reuse that completed installation. They never run
`bun install` concurrently in `packages/compiler`, where relinking
package executables can fail with `EEXIST`. Running a shard directly
requires provisioning its dependencies first, as for other graph targets.

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
| `//typescript/tsc:go-vibelangfmt` | Formatter sources/tests, the parser retirement check or VIP-35; retains retired syntax as refusal witnesses and tests admitted syntax round trips. |
| `//:spec-rule-table` | Public specification chapters or the Go rule-injection table and its quotation check; preserves all injection programs and expected diagnostics. |
| `//:docs-check` | Public spec sources or generated pages and the provenance checker; rejects internal review attribution while keeping the public policy text. |
| `//typescript/tsc:go-parser` | `typescript/tsc/internal/parser/`, `typescript/vibelang/cases/vibex-clash/` or `typescript/tsc/PACKAGE.ts` |
| `//:spec-diagnostic-blocks` | Diagnostic appendix, table linter and regression tests; every retained out-of-block assignment needs an explicit exception, and removed exceptions remain errors. |
| `//:spec-example-prerequisites` | JSX example metadata and outcome checking; active examples require ordinary success, while explicit prerequisites reject unrelated errors and stale markers. |
| `//:spec-diagnostic-authority` | Diagnostic authority rows, source proposals and their linter tests; accepted migration rules retain authority while denied proposals remain rejected. |
| `//:spec-proposed-diagnostics` | Diagnostic allocation tables and proposal-fixture generation; unassigned proposal codes stay unresolved while published assignments remain intact. |
| `//:spec-registry-go` | Published specification/VIP assignments, compiler/core diagnostic declarations and fuzz registry inventories; validates registrations, paired debt records and declaration-only allowances; none permits an unassigned diagnostic to be emitted. |
| `//:tooling-citations` | Service/tooling chapters, their owning VIPs, configuration/core options and the four covered fuzz sources; checks exact public quotations, syntax-diagnostic ownership rows and retired-setting properties without a runtime build. |
| `//:lint-config` | Configuration/core options, imported lint options or hooks, fixer/config diagnostics, lint fuzz tests, or the VIP-38 contract; checks warning, activation and preserving migration without building runtime packages. |
| `//:docs-contracts` | Specification chapters/VIPs, user pages, covered contract tests and fixtures, or `docs/tools` dependencies; runs native examples and mutation guards without building the compiler. Appendix B owner checks run here; the complete compiler-backed no-throw suite remains in `//:docs-tools`. |
| `//packages:runtime-package` | `packages/runtime/`, `packages/PACKAGE.ts` or `docs/tools/bugbash4-docs.test.mjs` |
| `//:effect-pin` | a `package.json` or `scripts/effect-pin*` |
| `//:flow-layout` | the migrate flow's `lib/steps.mjs` or its layout test |
| `//:docs-check` | Public spec sources or generated pages and the provenance checker; rejects internal review attribution while keeping the public policy text. |
| `//:grammar-inventory` | a VibeLang parser file, a file in `internal/vibelang/`, or the admission table |
| `//:mapper-scripts` | `scripts/mapper-*`, `packages/ts-mapper/`, the compiler's `cache.mjs` or the LSP fixture |
| `//:spec-appendix-replays` | Appendix B and failing-case changes; checks that each replay of a failing case names a diagnostic the case expects, without a compiler build. |
| `//:spec-lint-unit` | Public chapters/VIPs and spec-linter sources or tests; checks diagnostic ownership and mutation properties without a compiler build. |
| `//typescript/vibelang:lsp-smoke` | `typescript/vibelang/lsp-*`, its `PACKAGE.ts`, or the compiler's `format.mjs` |
| `//:go-vibelangfuzz-editor` | the language service, `typescript/tsc/internal/ls/` |
| `//:go-error-inheritance` | Error declaration parsing/checking, diagnostic filtering and their regression tests; checks `EK2117` ownership and preserves independent native errors. |
| `//:go-module-highlights` | Module reference/rename and document-highlight implementations and regression tests; verifies merged module bindings in ordinary and multi-document highlighting. |
| `//:go-vibelang-fix-twins` | a non-test Go source in the parser, `internal/vibelang/` or `internal/effectglobals/` |

The complete parser package takes less than a second after compilation and includes the clash-corpus expectations. Parser and corpus changes select it from their first matching train.

The runtime package check runs the existing entrypoint, export-identity and Effect-version tests, plus 500 generated error-matcher subclass histories and checks the README's public export table after building the runtime. It takes about eight seconds after the build. It joins the first matching train, without waiting for a post-merge receipt: adding a helper to the main entry while omitting it from the guarded entry must fail before landing.

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
Concurrent loop head, label and lowering changes select the `concurrent-heads`
family: quoted rules and saved seeds for RHS bindings, labels and jumps in
`do` expressions in loop heads.
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
CI_GATE_BASE=main@github sh scripts/ci.sh //packages:compiler-test-1 //packages:compiler-test-2 //packages:compiler-test-3 //packages:compiler-test-4 --jobs 8
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

The `//packages:migrate-record-provenance` target checks producer identity,
source digests and the final generated bytes before a migration is recorded.
Its staged fixture first proves that missing producer metadata refuses even
with `force`, then supplies the fixture identity and proves a later generated
regression still refuses without creating a commit or record.

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

The data-method execution tests compile the current runtime sources. Before
running the mapper Go suites, install the runtime dependencies with
`(cd packages/runtime && bun install)`, as well as the Effect and stock
TypeScript prerequisites in `CONTRIBUTING.md`.

The stock projection snapshots in
`typescript/tsc/internal/vibelangmapper/testdata/stock/` pin both checking
and executable output. The executable snapshots follow the compiler's runtime
helper entrypoint. After reviewing an intended projection change, regenerate
with `UPDATE_STOCK_GOLDENS=1 go test -count=1 -run '^TestStockProjectionGoldens$' ./internal/vibelangmapper/...`
from `typescript/tsc/`. The test also checks the checking projection with the
pinned stock TypeScript; keep that dependency installed so the check runs.

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

The scope writes `[mapper-scope]` JSON records to stderr when handing over a
prebuilt tool, building either tool, or compiling the runtime. Each stage emits
`start`, `progress` every 30 seconds while pending, and `pass` or `fail`, with
process and stage IDs and elapsed milliseconds. Completion includes the captured
output byte count and exit code; `cause` distinguishes an exit, a signal and an
operation failure. A build stage includes any Go admission wait. Records omit
paths, arguments, environment values and captured output. Failures still retain
the complete command output in the test error. Use `go test -v` or `-json` to
see these records during passing checks.

The example checker reads each compiled example's `package.json` to decide
whether to run its test script. A manifest read or parse failure fails that
example as `test script discovery`, keeps the diagnostic in
`.cache/check-examples/<name>.log` and continues checking the other examples.
Only a successful read with no test script skips the test step.

The optional ESLint suite uses `fixtures/forms.vibe` as a clean source witness. Its `match` arms must end with `;`, including the final arm. `match-arm-fixture.property.test.mjs` checks the real fixture for recovered invalid arms and exercises generated layouts while retaining warnings on authored multiline calls.

`error_constructor_members_test.go` checks that plain error payload fields and source methods survive together, including a field named `constructor`. The optional ESLint suite also checks the minimized compiler-case pattern and generated field names, getters, trivia and Unicode positions; an authored unused parameter must still be reported.

## Source labels in the ESLint corpus

The ESLint corpus includes formatter and control-flow fixtures with deliberately
unused labels. Its `no-unused-labels` check accepts a diagnostic only when the
reported label is an ordinary identifier at that source location. A missing,
renamed or synthesized label remains a corpus failure; normal unused-label
diagnostics remain visible to ESLint users.

`packages/compiler/test/eslint-corpus-labels.test.mjs` runs the native guard in
the `//packages:compiler-test-N` shards without the optional ESLint install. The standalone
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

CI-health retains inline target-summary diagnostics and classifies supervisor startup failures as `process startup`. Command arguments are metadata and cannot supply failure evidence. The `process-startup` eval replays a real same-key runtime-build failure and success; startup failures have no failing test name and call for startup and host-capacity investigation.

CI-health reports distinguish `Go cache archive` failures from missing repository inputs. The former identifies a missing compiled archive with a matching content hash and bucket; it calls for cache investigation without guessing what removed the archive. `.smithers/flows/ci-health/test/go-cache.test.mjs` covers the real log pair, generated diagnostic neighbours and competing causes, and the `go-cache-archive` eval runs the actual workflow on that pair.

The `//typescript/vibelang:coverage-twin-oracle` target runs the parity oracle's five positive and negative controls with real stock TypeScript and the checkout's pinned Effect install. It checks success, error and service types separately from runtime `Exit` values, and needs no VibeLang compiler build. `scripts/test-runners.test.mjs` keeps this suite connected to its declared runner.

CI-health reports identify Node `Cannot find package` errors as `missing package` before a surrounding assertion can mask the missing install. The requester's pinned package installation and module root are the first checks. Native Node diagnostics and real same-key graph receipts cover this classification; the `missing-package` eval runs the actual workflow, preserving its Go-cache and duration-regression cases.

### Go test progress

The `//:spec-tests` target runs `go test -json` through
`scripts/go-test-progress.mjs`. The original JSON stream is preserved, including
failures, and `go-progress` records appear immediately, every ten seconds, at
package boundaries and on exit. Each record includes a run identifier,
elapsed time and counts of started and finished packages and tests.
The target uses the shared graph check deadline. Its regression reads that
default from the actual check factory and verifies the target retains it;
changing the default does not leave a stale deadline assertion. Missing,
unbounded and mismatched deadlines still fail the check.


On Linux, a bounded sample of the child process tree reports executable kinds:
`launcher`, `go`, `compile`, `link`, `test` and `other`. A `launcher` phase with no
`go` process identifies a shell launcher before Go starts; `go-setup-or-build`
covers Go preparation when no compiler child is sampled, and `tests` starts
with the JSON package-start event. On other hosts, JSON events still report
test progress. Linux child lists belong to individual threads, so the sampler
checks the main thread and up to 63 other threads per process, following at most
64 processes in total. This includes compiler and test subprocesses started by
Go's runtime threads; a disappearing thread does not hide its surviving peers.
Sampling reads no process arguments or environment values.
These samples describe the observed phase; they do not establish why a launcher
waited or why a test took time.

On POSIX hosts, each invocation owns a separate process group. Cancelling the
reporter with `SIGINT`, `SIGTERM` or `SIGHUP` forwards that signal to the
whole group, including test binaries and their children. An immediate
`event=cancel` record identifies the signal, and the final record retains the
signal-derived exit status. On Windows, cancellation forwards to the direct
child.

The target retains its 15-minute deadline, required dependency checks,
`VIBELANG_FUZZ_HANG=120s` and `-count=1` to rerun external oracles.
Run it with:

```sh
sh scripts/ci.sh //:spec-tests --jobs 8
```

## Packages

```text
.smithers/WORKSPACE.ts          toolchain (node, go, bun), cache in .flows/
//typescript/tsc                the Go module
  :srcs                         Filegroup: Go test build inputs (no *_test.go, no testdata/)
  :native-srcs                  Filegroup: native build inputs, excluding fuzz helpers and decision snapshots
  :go-checker :go-parser :go-ls go test, one target per Go package tree (merge gate,
  :go-format :go-core           when the change edits that tree)
  :go-vibelangfmt               VibeLang formatter Go tests; required by :compiler-test-1
  :go-project-vibelang          VibeLang manifest-change invalidation tests
  :go-tsoptions-vibelang        VibeLang configuration and diagnostic tests
  :go-ast-vibelang              VibeLang // @vibe directive recognition tests
  :go-tspath-vibelang           VibeLang and .vibex extension recognition tests
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
  :compiler-test-1 .. -4        node --test (compiler package), sharded by file
  :migrate-test                 node --test (the migrate and convert flows)
  :vite-test :unplugin-test      the bundler plugins' test/run.sh (source maps, builds, watch)
  :source-map-tools-test         source maps through each tool that reads them (docs/maintainers/source-maps.md)
//                              repository and focused checks
  :create-cli                   node --test (fast scaffolder CLI unit tests; no compiler or install)
  :tree                         Filegroup: every file
  :go-vibelang :go-vibelang-race :go-vibelangmapper :go-vibelangfuzz
  :go-vibelangfuzz-hangs        bounded child probes for stale hang markers (merge gate)
  :go-vibelangfuzz-pending      the inputs testdata/pending/ lists, which must still fail, and every VIP and data probe (merge gate)
  :go-vibelangfuzz-editor       the editor oracles over documentation examples and cases (merge gate)
  :go-vibelang-fix-twins        the --fix fixed twins of the TypeScript-form and migration cases, the --fix cost guards and the platform-wrapper repairs (merge gate)
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

Migration and convert suites run only in `//packages:migrate-test`. The compiler target runs its own tests; importing a flow test into a compiler entrypoint repeats that suite. `scripts/test-runners.test.mjs` checks discovery coverage and this ownership boundary.


```text
:native-srcs ─► :compiler ─┬─► :<case> x809 ◄─┬─ :runtime-dist ─► :runtime-test, :compiler-test-N, :migrate-test
                           ├─► :compiler-native ─► :compiler-test-N, :migrate-test, :vite-test, :unplugin-test, :release, :snippets, :docs-tools
                           ├─► :lsp-smoke ◄─ :runtime-dist
                           └─► :snippets, :docs-tools
:tree ─► :release :snippets :tokens :forms :docs-tools :docs-check :go-vibelang*
:native-srcs ─► :forms-generator ─► :forms
:native-srcs ─► :compiler, :mapper ─► :go-vibelangmapper
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
`lsp-smoke.sh`, `lsp-smoke.mjs`, `lsp-connection.mjs`, `lsp-framing.mjs` and `lsp-fixture/**`. Unchanged inputs
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

Every JavaScript LSP client in the repository frames messages through
`typescript/vibelang/lsp-framing.mjs`: `encodeFrame` writes a frame, and
`FrameDecoder.push` yields the messages a chunk completes and throws a
`FramingError` naming the stage, `header`, `JSON` or `message`, where the stream
stopped being valid. The error quotes no response bytes. Each client keeps its own
lifecycle and reporting. `scripts/lsp-framing.test.mjs` decodes every split of a
stream and refuses every malformed neighbour.

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

A shared helper that is such a pipeline carries the line itself, and a runner
without its own takes the largest `N` among the helpers it imports, so a new
case on `cov-ch004-twin.mjs` or `census-vibex.mjs` needs no line.
A runner without a line also never gets less than the sum of the stage
deadlines written in it and its helpers, so a new case cannot fall short.
`//:harness-deadlines` holds an explicit line to that sum. It reads files only,
so a line that would get a runner killed as a whole, without naming a stage,
fails in under a second. `//:release` runs the same test, so post-merge, which
names its targets, keeps the rule too.

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

The stock command applies `--singleThreaded` and native memory settings only
to the native compiler; the JavaScript baseline keeps its original arguments.
`TestStockCompileCLICompatibility` checks concurrent calls, exact emitted
JavaScript and declarations, and paths containing spaces and Unicode against
independent legacy and native command-line fixtures. A parity emission failure
records the stock process result and output byte count beside the file difference.

The fuzz checks use the mapper's pinned stock TypeScript, the historical
declaration baseline named in
`typescript/tsc/internal/vibelangfuzz/recursive_parity_baseline.go`, and the
runtime's TypeScript inference baseline. Install `packages/compiler` test
dependencies for the `dprint` formatter oracle too. Preserve package-manager
links in `node_modules/.bin`: copying a script there changes its relative
module lookup.

`:go-vibelangfuzz` runs its test binary through `scripts/go-test-shards.sh`
(`go test -exec`): six processes at once, or one per core on a smaller machine, sharing two threads per core through `GOMAXPROCS`, each with its own `-run` list and the
40-minute deadline. Go runs a package's tests and each seed corpus one after
another unless they call `t.Parallel`, so the package was one chain: 686 s on a
quiet host, and it hit its 40-minute deadline on the loaded post-merges of
`1180893af776` and `42c771e16b1c`. The script puts the slowest names, by
`internal/vibelangfuzz/testdata/shard-seconds.txt`, in different processes. To
run the suite the same way by hand, from `typescript/tsc`:

```sh
go test -short -count=1 -exec "$PWD/../../scripts/go-test-shards.sh" ./internal/vibelangfuzz/
```

The launcher reports discovery, each process's assigned test names and each completed process's exit status immediately on stderr. A held or slow sibling therefore leaves the current stage and assignments visible while test stdout remains grouped until all processes finish. Discovery failures include the binary's exit status and preserve its output. `scripts/go-test-shards-progress.test.mjs` checks held discovery, held siblings, success and failure, native selector pass-through, and generated shard/slice layouts.

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

When discovery finds no test, fuzz target or example, slice `1` runs the
native binary unchanged and the other slices skip it. The launcher removes
its discovery scratch before that native handoff, including for packages
that contain only benchmarks; `TestMain` retains its arguments and exit status.
Native output remains intact alongside the discovery diagnostics.

Coverage and profiling runs (`-coverprofile`, `-cpuprofile`, `-memprofile`, `-blockprofile`, `-mutexprofile`, `-trace`)
also run the binary once. The output file then contains the complete run;
shards would overwrite the same file. Setting only a sampling rate or fraction
keeps ordinary test sharding.

`GO_TEST_SLICE=i/n` requires `1 <= i <= n`, with both values representable
by the shell’s integer comparisons. Malformed or overflowing values exit `2`
before the test binary is listed or run, including values read from the
host-local `scripts/go-test-slice` file.

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
tests and causes behind each flaky target, and names each test that failed
again after its target passed, which catches post-merge flakes whose keys
change every run: `.smithers/flows/ci-health/README.md`.

Migration failure names come from the `[migrate-test]` reporter's `test-failed` records. Health reports include nested and cancelled tests, retain escaped names, and exclude skipped and todo failures. A `skip` or `todo` reason of `""` still marks an expected failure, as it does in Node. Names containing `U+2028` or `U+2029` are retained. The `migrate-reporter` eval executes the actual flow on four real reporter runs with exact expected failure and returning-test names.

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

`//:spec-registry-go` checks assigned-code registration, stale legacy-code exceptions, and grammar-inventory citations, with sentence-boundary properties for historical references. `mq.py spec-push` runs it with the spec linters, so a spec-only commit that assigns an Appendix B code needs a registered message or a `specAhead` entry naming the lane that registers it. This focused target still blocks a push while `//:spec-tests` is red for other reasons, because `spec-push` tolerates a target `main` already fails.

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

The `//packages:migrate-toolchain-baseline` target runs the complete upgrade-baseline regression file when baseline admission, capability probing, its fixtures, or the target definition changes. Its offline installer checks the staged runtime and Effect pins; its compiler separates successful capability probes from failing project compiles. The tests retain new collection failures, missing tests, exit regressions, compiler errors and downstream refusal checks.

## Cache contracts

The `cache-loaders` property logs each child before and after execution with
its revision, engine (`node` or `bun`) and cache mode (`cached` or `fresh`).
The completion record includes elapsed milliseconds, exit status, signal,
spawn error code and the last `4000` characters of each output pipe. These
records distinguish a loader timeout from a compiler failure while retaining
the original `30000` millisecond child budget. Replay the property with the
`FC_PROPERTY`, `FC_SEED` and `FC_PATH` printed in its failure.


The full `smthrs ci //...` validation includes VibeLang's regressions in
the shared `internal/ast`, `internal/project`, `internal/tsoptions` and `internal/tspath`
Go packages. Their targets select the owned tests with anchored `-run`
patterns, so optional upstream fixtures are not prerequisites. Each target keys
on production sources and its package's tests. The Go warm-cache script also
compiles these packages. `scripts/go-shared-test-inventory.test.mjs` discovers
owned `vibelang*_test.go` files in shared packages and rejects missing,
narrowed or overly broad selectors, and duplicate target names. Each target name
must be declared once, even when two declarations select the same tests.
The directive target retains both its unit and fuzz witnesses after declaration
cleanup; generated prefix and suffix neighbours must remain outside its selector.

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
  The compiler-package migration properties also spawn `jj`; it is declared in the workspace host binaries and on `//packages:compiler-test-1` to `-4` and `//packages:migrate-test`.
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

The shared compiler support package also builds independently with `cd typescript/tsc && go build ./internal/vibelangfuzz`. Helpers used by ordinary builds belong in regular `.go` files: Go excludes `_test.go` files from those builds. `TestFuzzPackageBuildWithoutTestFiles` runs an actual standalone build to retain that boundary.

The `//:spec-registry-go` gate also checks that every fuzz target starts its short-seed CPU budget. A new fuzz oracle must register its budget before adding seeds; the gate selects changes to any VibeLang fuzz source so a newly added target cannot bypass this check.

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

Source-child loader declaration tests use the migration API identity gate in
twin-to-emitted order. VIP-27 allows an added generated `@throws {never}`
contract when the twin has no authored throw contract. Changes to descriptions,
other tags, authored throw contracts and exported types still fail; mutation
controls exercise that boundary alongside the native Node and Bun helpers.

The targeted `//packages:migrate-helper-identity` gate runs the identity controls on changes to declaration comparison, the helper fixture, or its target definition. The complete native helper tests retain their file-placement and runtime assertions in the full migration suite.

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

The `//packages:migrate-lost-wrapper` gate runs the wrapper-loss suite when migration emission, wrapper analysis, its fixtures, or the package target declaration changes. It checks normal emission for private packages without exports and the scratch fallback for a skipped project. Both paths must still report a function that lost its Effect wrapper; scratch output must stay outside the target tree.

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
- **Not yet in the graph.** `ts-mapper`, the editors, the examples and
  `scripts/e2e.sh` run outside it. The `create-vibelang` install/build,
  package-manager property and formatting fixtures also require their own
  setup. Its dependency-free CLI unit suite runs separately in
  `//:create-cli`, keyed on the CLI, template,
  manifest, test file and documentation Essentials.

The [specification contracts](#specification-contracts) run in `//:spec-lint`. A new class of inconsistency gets a rule and a failing-defect test in the commit that fixes it.

The release documentation check, `node docs/tools/release-docs.mjs --check`, rejects unresolved merge-conflict boundaries in its Markdown and MDX inputs, including historical release notes and generated site copies. It reports the first marker's file and line. The `--write` mode also rejects these pages and leaves their text intact for manual resolution; regeneration cannot discard a conflict inside a generated compatibility box. Markdown heading underlines and inline marker examples remain valid. `node --test docs/tools/release-conflicts.test.mjs` checks real jj conflicts in `diff`, `snapshot` and `git` marker styles, resolved notes retaining both fixes, and generated marker widths, line endings and page locations.

The `//:docs-tools` target runs its test files with `bun test --timeout 60000 --parallel=3 --no-isolate`.
Three worker processes run files in parallel; tests within each file retain their normal order.
Each worker reuses its module registry between files, as the serial runner does.
All `docs/tools/*.test.*` files are discovered on each run, except the separately declared
`site-contrast` and `site-spec-links` tests. A failure in any worker fails the target.
`scripts/docs-tools-parallel.test.mjs` exercises that command with real files, a
cross-file barrier, per-file ordering checks and a failing worker.

`//:site-spec-links` checks the generated specification and VIP pages for unconverted `.md` links, missing pages and missing anchors. `//:docs-tools` depends on it, so the pre-merge gate runs it. Its inputs are `site/src/pages/spec/**`, `site/src/pages/vips/**` and `docs/tools/site-spec-links.test.ts`; unrelated changes reuse its cached result.

The contrast test emits `site contrast stage result:` JSON after each of its
six commands: dependency installation, infrastructure tests, typecheck,
production build, 404 checks and browser audit. Each record includes the command,
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

Local media requests additionally emit `media-request`, `media-response` and
`media-finished` or `media-failed` records. A request still open when its page
closes emits `media-pending-at-close`. The request sequence and original operation
sequence correlate its header and terminal timings with navigation. These
records retain the path, numeric byte-range metadata, media content type and
response status; query strings and other headers are omitted. Each page traces
at most 16 local media requests, including retries. Compare header arrival with
completion or cancellation before changing response handling or navigation
readiness; an aborted metadata request alone does not establish a failure.

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

The built-site router serves MP4 files as `video/mp4` and honors a single
`Range` request with a `206` response and the requested bytes. Closed,
open-ended and suffix ranges retain their byte boundaries; an unsatisfiable
range returns an empty `416` response with the full size in `Content-Range`.
Malformed or unsupported multiple ranges fall back to the full `200` response.
This lets Chromium finish metadata navigation without waiting for its media
request to time out. The audit keeps its `networkidle` wait, every page and
theme, and all contrast assertions. A real-video browser regression checks
metadata loading through the same router.

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
unchanged. The same command runs `site/scripts/patch-vocs-llms.test.mjs` against the real generator: repeated and concurrent build environments share one computation while every output is restored, watch and new builds refresh, rejected work retries, and version/source/ownership guards preserve dependencies. The pinned patch is applied by `npm ci`; its runtime and source map are generated from the reviewed source. Run the same installed-site checks with:

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

The sidecar source-selection properties cite the current Chapter 007 summary of discovery, explicit-input overwrite protection and final physical/logical resolution. Keep each citation check together with its original native/stock compiler controls, literal corpus hashes, generated dimensions and sample counts.

Async conversion integration tests retain every refusal fixture in the LSP project, then compile each positive repair in a separate project. This keeps intentionally invalid neighbours from stopping the runtime check. Converted async returns may use a Promise-adoption bridge, so the execution check awaits `Effect.runPromise`. The fresh data checks compare against stock TypeScript twins and exercise 100 generated primitive values while retaining getter and alias refusals.

Declaration comparison fixtures follow the API identity contract in Functions: equivalent target spellings may compare equal only with matching exported names, mutually identical types and export documentation. Preserve explicit type/name/doc counterexamples and incomplete-environment refusals alongside the original 80-run module-resolution property.

The Knip JSDoc and local-type-query properties and their paired Go citation guard share the exact current Chapter 007 tool-input sentence. Refresh the Go and Node citations atomically; retain the Chapter 000 counterpart rule, all 300/80 discovery samples and strict saved-regression guards.

The native declaration-spelling property reads the current Specifiers contract in Functions. Its 12 stock TypeScript cases continue to check written .ts imports, quote styles and actual emitted declaration text; moving the citation changes neither compiler options nor emit assertions.

Publication helper properties cite Chapter 007’s native output names: x.js and ordinary x.d.ts in outDir. Citation maintenance retains both 100-case properties and their distribution paths, shadowing, unsupported-expression and source-form controls.

The retained-schema-constructor gate cites the current preserving-fix rule in Chapter 007. Its real compiler fixture, constructor/refused-class warning checks and generated diagnostic-policy controls remain required when refreshing that citation.

The compiler package test target passes its declared compiler-native artifact through VIBELANG_BINARY after entering packages/compiler. Keep that path absolute and quoted so the native configuration-contract tests run in workspace paths containing spaces; retain the existing target selection, dependency and deadline.

The corpus for build entries and the properties for packages, wildcards, reversion and workspace resolution quote Chapter 007’s current contract for TypeScript and tools. Run both consumers of the shared corpus when refreshing its quotation, preserving their literal sources, variant sets, hashes and original property counts.

The workspace-package cache regression uses TypeScript's `strictNullChecks` setting, with a stock TypeScript twin, to check that changing a dependency's `tsconfig.json` invalidates both real warm compiles. Generated newline, indentation, blank-line and Unicode-value cases retain runtime-success controls before requiring `TS2322` after the setting changes. Retired `trustedPackages` settings and missing Effect dependencies must not supply the failure witness.

### Grammar admission tables

Edit `docs/design/registry/grammar-admission.tsv`, one reviewed hook per line.
The five columns are hook, form, specification authority, status and reason.
The source preserves the census's existing order and records exactly; it does
not authorize syntax. The independent fuzz oracle still reads Appendix A's
productions and prose.

`//:grammar-admission` declares both generated outputs with Smithers
`S.Generate`: the fuzz inventory and Appendix A's collapsible census table.
Run `smthrs run //:grammar-admission` to regenerate, or
`smthrs lint //:grammar-admission` to check drift. The portable command is
`node scripts/generate-grammar-admission.mjs [--check]`. The check regenerates
into a temporary tree, names every stale file, and leaves committed copies
untouched. The merge gate's `//:forms` target depends on
`//:grammar-admission-check`. The Go inventory check independently verifies
that hooks and specification authorities exist; generated projections do not
turn a `pending` row into a language rule.

Update this source when adding or renaming a parser/support or lowering helper,
including diagnostic recovery. Check every discovered helper with `cd typescript/tsc && go test -p 8 ./internal/vibelangfuzz/grammaradmission` before regenerating.


The full `//:site-contrast` check runs `npm run test:404` after its production
build and before the browser contrast checks. It passes the built
`dist/public` directory through `VIBELANG_DOCS_TEST_OUTPUT`, so the 404
metadata assertions reuse that output. Standalone `npm run test:404` still
builds the site first. Missing or invalid supplied output fails without a
second build. `scripts/site-404-output.test.mjs` covers publication metadata,
missing output and generated directory-name neighbours without build tools.

Lowered `do` method calls retain the written callee and receiver ranges in
ESTree. Generated `.bind` wrappers are omitted from the source view, while
source-written calls, computed-access newlines and scope reads remain visible.
The native `eslint-source-calls.property.test.mjs`, real ESLint
`source-calls-property.test.mjs` and keyed corpus exercise those boundaries;
`TestDoMethodCallSourceBoundaries` checks the Go exporter directly.

The ESLint source view represents `for concurrent` as
`VibeForConcurrentStatement`, with `iterable`, `concurrency` and `body`
visitor keys. Its callback keeps the item binding scope; only a written limit
has a concurrency node. Native and real ESLint concurrent-form properties,
the keyed concurrent-head corpus and `TestConcurrentStatementSourceForm`
check the loop without suppressing reports on written calls in its children.

The ESLint adapter hides generated variables from both scope lists and
`getDeclaredVariables` queries. Rules such as `prefer-const` use that
node-declaration lookup even after scope lists have been filtered. Preserve
all authored variable objects, including dollar-prefixed names, in both views.
The pinned ESLint synthetic-declarations property replays the minimized
optional-`do` witness and checks generated scope, provenance and write controls.

The Go target catalog declares every literal target name once. `scripts/fast-gate-targets.test.mjs` rejects duplicate declarations before a later object property can silently replace one, and exercises nonadjacent duplicates across generated layouts.


The `//:docs-contracts` target runs the published colon/example, catch-pipe, sidecar-root, schema-documentation, direct-try-advisory and sidecar-input contracts, their mutation properties and native TypeScript/Effect counterparts. It needs no VibeLang compiler build. Its inputs cover the contract tests and their native counterparts, so unrelated compiler edits reuse the cached result. The merge gate selects it from its first declared train; the complete `//:docs-tools` suite remains in post-merge validation.


The ESTree token and synthesized-name fixture matrix keeps both an ordinary
span callback and a cold program value, `Effect.withSpan(effect { ... }, name)`,
with a nested `do` expression. `TestSharedSourceFixturesRetainColdProgramBlocks`
checks that the shared matrix still reaches a synthesized program builder.
When refreshing syntax, retain cold blocks in the checks for source tokens
and generated names as well as the dedicated tests of program values.

The `//:api-identity-test` cache key uses `api-inputs.ts` rather than the
whole repository tree. It includes scripts and corpus files, specification
chapters (including historical chapter lookup), all package sources, the
`docs/tools` and `experiments` sources and lockfiles, the staged checker
copies, and the root JSON project configurations and Smithers install declarations. The installed tool
and lockfiles still identify the TypeScript environment. Compiler Go,
acceptance cases, user prose and generated site pages do not invalidate this
Node-only check. Other root checks retain their existing inputs.

The real SDK fixtures in `.smithers/flows/test/api-inputs.test.mjs` check the
actual root key, 64 generated unrelated path neighbours, each selected input
family, cache replay and a failing declaration through the real TypeScript
comparator. The whole-tree control runs `smthrs affected ci --list` on the
actual root, which reads the declarations without digesting the tree: all 64
neighbours must reach `//:release` through its direct `//:tree` input and must
not select `//:api-identity-test`. A narrowed declaration must fail that guard,
and the cache fixture proves a whole-tree input changes its consumer's key. The
fixtures also audit current relative API imports and specification lookups.
When an API test gains another repository read, extend the input
group and its selected-input control before relying on cached results. The
target command, source-sync guard, property counts and failure rules are
unchanged.


The JSDoc-link API identity fixture explicitly loads `lib.esnext.d.ts` for
both its independent TypeScript checks and the comparator. Its declarations
need no browser globals. The fixture rejects accidental `lib.dom.*` loading
while retaining strict diagnostics, all 24 generated samples, private-binding
controls, and counterexamples for changed link targets, labels and rendering
kinds. Keep browser-dependent API fixtures on the libraries they require.

## Retirement admission

Will's codemod-before-error rule is recorded in the VIP process. The offline
`docs/tools/retirement-gate.mjs` reads immutable jj snapshots and checks every
commit in the requested range, including each parent of a merge. A later fix
cannot excuse an earlier retirement. New error severities and new or changed
error witnesses in `typescript/vibelang/cases/*.fail` require a fix or a scoped,
reviewed exception. Changes only to diagnostic wording on unchanged failing
source do not establish a newly retired form. The first-line harness comment
`// expect: EK1703 TS2345` is metadata: changing its code list alone preserves
the existing error set. New diagnostic codes, written program changes,
compiler directives, configuration changes and added source files still
require retirement authority. Without an earlier compiler, the check
conservatively treats new failing witnesses as retirements.

Register a fix in `docs/design/retirement-fixes.json`:

```json
[
  {
    "code": "EK1010",
    "cases": [
      {
        "input": "typescript/vibelang/cases/throw-parenthesize.fail",
        "output": "typescript/vibelang/cases/throw-parenthesize-fixed"
      }
    ]
  }
]
```

Both directories are committed fixtures; the input includes `tsconfig.json`.
Every widened failing case needs its own matching input. The runner requires
the original error, a nonzero applied-fix count for that diagnostic, exact
expected source output, unchanged configuration, and successful compilation
with and without `--fix`. Dependencies come only from this checkout's local
install. Missing compilers, malformed registries and unavailable checks refuse
admission. A reviewed `retirement-allowlist.json` entry must contain `code`,
`vip` (for example `VIP-41`), `reason`, `approval: { "by": "Will",
"reference": "<approval record>" }`, and either a matching `case` directory
or `severity: "error"`.

The identity-allocation checkpoint compares the recorded before/after allocation
transition in `docs/design/diagnostic-identity-allocation.json`. Its original
normalized hashes remain in `diagnostic-identity-renames.json`; later compiler
fixes keep their own semantic regression tests. Recreate the capture with
`node scripts/capture-diagnostic-identity-allocation.mjs --write` from a
repository retaining the recorded revisions. The generator verifies both full
source snapshots against the original hashes before capturing the transition;
portable checks retain those references and reject added checker predicates.

Run `node docs/tools/retirement-gate.mjs --base BASE --head HEAD`, or select
`//:spec-retirement-gate` with full commit IDs in `RETIREMENT_BASE` and
`RETIREMENT_HEAD`. The normal `//:spec-linters-test` includes the regression
fixtures and 500 seeded fast-check registry diffs. An optional
`--previous-compiler PATH` can establish that a failing form was already
rejected. Its `PATH.retirement.json` receipt must contain the exact parent
`commit` and binary `sha256`; a missing or mismatched receipt fails closed.
Only an earlier source EK error can exempt a witness, never a missing module,
bad option or failed compiler process. This checkout's forms command has no
`-legacy` mode, so that flag is not used as an acceptance oracle.

The queue adapter is `scripts/mq-retirement-precheck.py`; its external queue
hooks are preserved in `scripts/mq-retirement-integration.patch`. Install it
as `checks/retirement_precheck.py` beside `retirement-gate.mjs` and
`diagnostic-identity.mjs` in the queue's directory. The precheck rejects missing
evidence before expensive builds, and final admission executes the witnesses
after building the candidate compiler. The validation hooks also cover queue
processes started before the adapter was installed. Neither known-red target
tolerance nor an optional semantic judge disables this check.

Go progress records count explicit `build-fail` JSON frames separately as
`build_failures`. A build failure emits `event=build-fail` and the final
record uses `phase=build-failed`, including when no tests started. Other
packages can still report their normal test progress. These counts refer to
the failure frames Go emits; a package's later `fail` record does not add
another build failure. Source diagnostics, import paths, arguments and
environment values stay outside the added metadata. Go's original output,
exit status and signal handling remain intact.

The captured parser-arity failure in
`scripts/testdata/go-progress/vibelang-parser-arity-build-fail.jsonl`
covers a real compiler error before testing. The observer tests also check
mixed test/build events, 128 stream partitions, oversized output recovery
and a real native Go compilation failure.

The release script glob excludes `scripts/api-identity*.test.mjs`. The release
target depends on `//:api-identity-test`, so a focused release runs the API
prerequisite and full CI shares its result. The exclusion is a quoted Node glob,
so the shell leaves its negated prefix for Node to expand. The dedicated API
target retains its source-sync check, regression assertions, property sample
counts and the precise inputs declared in `api-inputs.ts`. Real SDK fixtures
check shared execution, cache replay and failure propagation; generated
filename neighbours check complete ownership of the two commands.

The `//packages:migrate-warning-provenance` target checks both journaled-source
and retained-declaration provenance through migration's compile stage. A warning
is retained with its location in `warningExceptions`; promoting it to an error
blocks the style and new-error checks in either provenance case. The full global
error property corpus remains in the migration suite.

The `//packages:migrate-native-loadpaths` target installs `esbuild` from the
compiler package's locked development dependencies. The load-path tests resolve
it from that package rather than relying on an incidental runtime install.
The target retains both original Node/esbuild commands, protected test bytes,
generated import forms and idempotent routing and restoration checks.

The `//packages:migrate-loader-validation` gate checks each loader record's
own validation outcome: unavailable validators, exceptions and cache misses
cannot inherit a previous successful check. Its quotation follows the published
migration guide; the complete ten-mode matrix and generated record histories
remain active when that guide or the validation implementation changes.

The root-target regression inspectors execute the production `createApiIdentityInputs`
helper when evaluating `PACKAGE.ts`. This keeps the spec-progress, forms,
native-output and fuzz-hang checks able to inspect their target declarations
after API input selection changes; they retain their existing dependency,
command and failure assertions.


The ambient-import API fixture uses `lib.es5.d.ts` explicitly. Its authored
virtual modules, `Promise` declarations and private classes require no newer
ECMAScript or browser declarations. A native source-file guard allows only
ES5 and its decorator libraries in validation and comparison programs.
Strict diagnostics, nominal-class and selected-module mutations,
missing-module checks and all 24 generated samples remain enabled with
`skipLibCheck: false`. A same-box A–B–B–A fixed-witness measurement observed
median wall time fall from 6.47 seconds with ESNext libraries to 2.53 seconds
with ES5 libraries (two samples per variant). This measures that fixture,
not the complete API target or a reserved-host guarantee. Separate browser
and explicit library-reference witnesses retain their own environments.


Self-namespace-export API fixtures select `lib.es5.d.ts` for independent
native TypeScript validation and every comparison program. The loaded-library
guard requires ES5 and allows only its decorator declarations; it checks after
comparison returns so an unavailable result cannot absorb a resource violation.
All 13 tests and 24 generated samples retain bidirectional native assignments,
resolved-normalization profile records, nominal distinctions and type, name,
documentation and dependency mutation checks. Other API fixtures retain the
libraries their declarations require.

The shared ES5 fixture library guard records distinct library names and a total,
with at most 16 example names in a failure. It omits installation paths and checks
after comparison returns. Its five native TypeScript controls and four generated
library/repetition samples preserve real declaration validity, missing ES5 and
`BigInt` errors, and stable diagnostic counts across repeated programs.

Physical-sidecar import fixtures select `lib.es5.d.ts` for native TypeScript
validation and every comparator program. Their loaded-library guard runs outside
comparison failure handling. All seven tests and eight generated mirror depths,
inline imports and literal types retain physical-path resolution, the wrong
logical-path decoy, beside-source precedence, inherited directories, changed
public types and missing-dependency `TS2307` checks. The saved declarations and
project configuration remain unchanged.

Conditional-resolution API fixtures select `lib.es5.d.ts` in independent
native TypeScript oracles and every comparison program. Their loaded-library
guard runs outside comparison failure handling. All six tests and four generated
samples retain package export conditions, `import` and `require` branch types,
two uses of one specifier, declaration import attributes, quote and self identity,
and changed dependencies with the native type difference and `TS2344` checks.

Generated-contract documentation fixtures select `lib.es5.d.ts` for every
comparison and independently validate both original declarations with stock
TypeScript. The loaded-library guard requires ES5, allows its decorator libraries
and checks outside comparison failure handling. Failure diagnostics list each
library name once. All 29 tests retain callable
forms, overloads, optional methods, nested signatures, inherited prose and the
authored, duplicate and extra-tag negative controls. Library scoping belongs to
these pure declarations; browser-dependent fixtures retain their own environment.

Nested ambient-ownership API fixtures select `lib.es5.d.ts` for both their
native TypeScript validation and every comparator program. A native source-file
guard rejects accidental browser-library loading. The fixture still checks
published and referenced wildcard modules, nested roots in both directions,
private generic-class mutations and all 24 generated samples. This library
scope belongs only to this fixture; browser and explicit library-reference
witnesses keep their own environments.

Project-root API fixtures use `lib.es5.d.ts` in native programs and `es5`
in their written TypeScript project configuration. A source-file guard
rejects accidental browser-library loading in validation and comparison
programs. The fixture retains explicit and implicit project roots,
composite projects, JSON exports, unused checks and all 24 generated
option layouts. Its real outside-root sources must still produce `TS6059`
and make the comparison unavailable.

Import-type-argument API fixtures select `lib.es5.d.ts` for native validation
and every comparator program. A native source-file guard rejects unrelated
browser declarations. All 24 generated literal arguments, const type
parameters, readonly arrays and tuple forms remain active, together with
the path-looking literal mutation and dependency-shape mutation checks.

Canonical declaration-identity fixtures select `lib.es5.d.ts` for comparison
programs and the independent stock-TypeScript JSON consumer. A native
source-file guard rejects unrelated browser declarations. All 32 generated
cases retain authored `@throws` and `@rethrows` documentation, function,
arrow and overload forms, JSON value types, export conditions and key order.
The JSON consumer still independently requires `TS2322` for a changed value
type and no diagnostic for key-order changes.

Dependency-diagnostics cache fixtures explicitly retain `lib.esnext.d.ts`
and the native `SymbolConstructor` library augmentation target, while a
source-file guard rejects unrelated browser declarations. Resource assertions
run outside the comparison call so its failure-reporting contract cannot
absorb them. All 13 tests retain fresh-versus-cached result equality, actual
cache hits, content and resolution invalidation, documentation changes,
18 changing environments, 20 file-group errors and bounded retention.

Pure declaration and JSON helpers in `scripts/api-identity.test.mjs` select
`lib.es5.d.ts` for comparison and independent native validation. The resource
guard inspects the actual programs and asserts after comparison returns, so
an intentional invalid-comparison result cannot absorb a library violation.
All property samples, type/name/comment mutations, private-member native
assignability checks and JSON rejection controls remain enabled. Direct
configuration discovery, caller-option overrides, CLI and compiler-exception
tests keep their existing environments.

Ambient self-identity helpers select `lib.es5.d.ts` for pure module and
global fixtures, including generated JSON and intrinsic-array cases.
Independent native checks for module-resolution changes and invalid ambient
inputs use the same ES5 selection as their comparisons. They still require
native `TS2304` errors for unresolved names and `TS2583` for missing
`BigInt`; shared invalid inputs must make comparison unavailable.
Global `Request` declarations and `Window` augmentations retain their
browser environment. Guards inspect native programs and require the actual
browser-library declaration to participate in those bindings. Resource
assertions run after comparison returns, so an invalid result cannot absorb
them. All 24 ambient-shape samples, four independent-import samples and
type, documentation, nominal-origin and invalid-input controls remain enabled.

The compiler-package module-identity declaration fixtures carry explicit
`no-default-lib` and `es5` reference directives. This scopes their TypeScript
programs, including the migration gate's child worker, to the libraries the
fixtures use. The resource regression checks both original declaration trees
with native TypeScript. All 80 generated resolution samples and the export,
type, literal, documentation and invalid-target controls remain in the suite.

Nominal-reference API fixtures use `lib.es5.d.ts` in both native validation
and comparison programs. Authored `es2020` directives still supply
`BigInt`; removing one must produce `TS2583` and make comparison
unavailable. Missing path references still require `TS6053`. The original
24 generated path, ambient-value and library-reference samples remain active.
Loaded-library guards run outside comparison failure handling.

Private-member API fixtures use the same ES5 library baseline for native
validation and comparison, including all 24 generated class shapes. Their
loaded-library guards also cover fixed private signatures and comparisons
against the same package directory. Native private, protected and ECMAScript
private-member incompatibility checks remain active.

Companion namespace fixtures select ES5 declarations in the shared project
configuration used by stock TypeScript and the native compiler. Both retain
the real ES5 library and reject unrelated browser libraries. All 80 generated
samples, declaration suffix combinations, both `skipLibCheck` settings and
real `TS2339` counterexamples remain enabled; every input file keeps its
original content hash during compilation.

Helper re-export fixtures select ES5 for native compilation and the stock
TypeScript consumer. A separate `fixture-libraries.d.ts` selects the same
environment for the migration API gate. The two native declaration outputs
are counted and saved before adding that ambient fixture; their bytes and
the throwing TypeScript helper remain unchanged. All eight generated samples
and type, documentation and missing-dependency negatives remain enabled.
Stock and native loaded-library guards retain the actual ES5 declarations.
A missing `BigInt` library must produce `TS2583` and make API comparison
unavailable, matching independent stock TypeScript validation. This negative
case also detects removal of the comparison worker's library boundary.

Absent-declaration fixtures select ES5 for pure declaration comparisons while
retaining the default browser libraries for server declarations returning `URL`.
The native browser control requires `URL` to bind to `lib.dom.d.ts`, requires
`TS2304` without that library and detects a changed return type. Pure fixture
guards run after comparison and retain native `TS2583` missing-library errors.
Empty entry batches have no roots or sources and need no library; a program
with actual roots still requires ES5, including when `noLib` is set.
All 20 generated absence graphs, per-export availability, emit-evidence,
reference-mutation, ambient-environment and batching controls remain enabled.

Unrelated-diagnostic API fixtures use `lib.es2015.d.ts` because their owned
error controls pass arguments through native `Map`. A shared bounded guard
rejects later and browser libraries after comparison, retaining all 12 original
generated shared/owned-error samples. Native controls require the actual
`lib.es2015.collection.d.ts` binding, `TS2583` when `Map` has only ES5 or
`BigInt` has only ES2015, and changed `Map` arguments to remain observable.
Four additional generated `Map` mutations vary comparison direction and
unrelated shared diagnostics.

Reserved export-alias fixtures select `lib.es5.d.ts` for comparison and
independent stock-TypeScript validation of both declaration trees. A native
consumer checks assignments in both directions through each namespace depth:
renamed local bindings remain compatible, while changed return types produce
two `TS2322` diagnostics. All 24 generated aliases retain the original fixed
seed. Guards run outside comparison failure handling, and missing `BigInt`
must retain native `TS2583` diagnostics and an unavailable comparison.

The five fixed variance forms use guarded ES5 programs for native TypeScript
validation and API comparison. Their original target and strictness settings
remain in force. The `in`, `out` and `in out` forms, class/interface/type
shapes and four generated changed-field samples remain enabled.

The `//:go-failure-aliases` target checks that failure aliases preserve the declaration-tag admission rule, including repaired inputs retained in the failure corpus.

The diagnostic registry gate also requires a keyed preservation generator for every registered quick fix. It reads the compiler case corpus used to build those generators, so changing a fixture re-keys the check.

The `//:go-generator-return-contracts` target checks generator migration against written result types, including incompatible bare returns, optional and `void` results, nested functions and source trivia.

The API self-comparison property selects ES5 through entry declaration references,
without overriding comparison options or project discovery. All eight generated
samples retain nominal declarations and unrelated missing-name diagnostics.
Four fixed nominal/diagnostic combinations require unchanged declarations to
pass and a changed exported field to fail. A stock TypeScript control still
requires `TS2583` for `BigInt` without its library, and comparison must remain
unavailable for that declaration.

Sidecar discovery fixtures select ES5 through their entry declarations and keep
the comparison options untouched. The direct mirrored-tree and saved journal
examples still resolve declarations through the actual discovered configuration,
and retain their changed-field checks. Configuration and source bytes must remain
unchanged during comparison; the journal corpus itself is unchanged. Adjacent
and both mirrored layouts still require `TS2583` and an unavailable comparison
when a public declaration refers to `BigInt` without its library.

The `//:go-registry-witnesses` target checks reachable compatibility diagnostics and the current type rules for module-level cold calls. A retained diagnostic allocation does not override a language rule that replaced its old execution behavior.

The `//:go-foreign-validation` target compiles the factory validation examples and checks foreign callback admission. Its negative controls retain `EK0402`; explicit defect bridges preserve a `never` failure channel.

The `//:http-api-example` target compiles the HTTP example with the local compiler and packed runtime, then runs its request test. The `//:go-module-foreign-factories` target checks the corresponding foreign callback rule, module adapter variants and lazy acquisition fixture.

The Effect-parameter oracle inventories the pinned Effect exports. Nested Promise-returning root runners must report both `EK1005` and `EK0404` at the same call. Its scope controls reject unrelated Promise diagnostics and native `TS1005`; the declared-parameter and plain-generic warning controls remain separate.

The `//:emission-snapshots` target checks exact emitted JavaScript, declaration files and runtime results for direct and delegated cold functions. It also retains the native tail-delegation error-message controls. Run it after changing lowering, primitive matcher extraction or generated source ranges; regenerate an expected file from compiler output only after reviewing every changed statement and its existing runtime checks.

The generated valid-self sidecar fixtures select ES5 with reference directives
in their entry declaration. Their `vibe.sidecarDir` configuration stays unchanged,
and comparison still discovers it through the real project path without caller
option overrides. Guards reject browser-library loading; independent stock
TypeScript and the comparison gate both report `TS2583` for an unavailable
`BigInt`. Adjacent and mirrored declarations retain nominal and structural
self-identity checks, and changed public fields still produce type differences.

The `//packages:runtime-dist` build runs Node's package-entry export audit after compiling the runtime. The audit checks every runtime value and identity and replays generated family matchers. Because the conditional `//packages:runtime-package` gate depends on this build, export drift fails before its package tests.

Kernel differential fixtures use Effect's interruption and yielding primitives. Their runtime branch still exercises the runtime's catch, masks, restore, service provision and finalization wrappers; compare the full Exit and ordered trace with the independent Effect branch.

The `//packages:runtime-kernel-contracts` target replays retained interruption/yield inputs and generated programs against Effect, preserving complete Exit and trace comparisons. The conditional runtime gate selects it for runtime and property-runner changes.

The `//packages:runtime-readme-exports` target checks every package export against the runtime README. Mutation controls remove documented names or replace them with child paths, so a prefix cannot hide an omitted export. This check is also a dependency of `//packages:runtime-package`.

The `//:go-interim-severities` target replays the saved compatibility-warning inputs with their legacy severity maps. Its synthetic controls keep those warnings outside modern configurable keys and require unconfigured default-off warnings and unrelated category violations to remain rejected.

The `//:emission-snapshots` target includes the pinned negation-pattern declaration and Exit comparison. It uses the shared VIP-27 API identity comparator, retains the unmodified TypeScript twin and rejects changed native union types or authored documentation. The release target runs generated union and metadata mutation controls.

The `//:appendix-oracles` target runs the Appendix B probe, quick-fix and stock-TypeScript twin controls. The chapter 4 reference-oracle controls run in `//:release`. Their test-runner catalog entries must match the commands that execute them.

Give services explicit keys in isolated migration fixtures when the service-key repair is outside the assertion being tested. Keep exact source comparisons so an unrelated repair cannot obscure the callback or requirement migration under test.

The cached-default oracle in `//:appendix-oracles` follows VIP-9's preserving native-class migration. It compares exact repaired source, recompiles its type reads, checks shared cached value identity and mutation visibility, and repeats those observations across generated field names and initial values.

For rejected trailing blocks, ordinary parser recovery output is not a legacy runtime reference. The appendix oracle compares a repair's exact emitted JavaScript with an independently written valid form and checks the program, Effect callback and plain callback runtime results, including generated comment and line-ending variants.

The `//:deep-type-repair` target checks required shorthand grouping through 32 nested Effect or array boundaries. It retains exact declaration output and the native deep-rewrite runtime and idempotence checks.

The `//:reserved-error-repair` target checks independent reserved-payload and inheritance diagnostics across generated declaration forms, with each violation removed separately. Its native case retains exact declaration output, complete runtime Exit and idempotent class repairs.

The `//:go-error-inheritance` target also replays every ambient error-class preservation input. It checks the specific diagnostic, independently written native declaration, editor edit, emitted erasure and second repair. Both Go packages share one compilation invocation; named test progress distinguishes compilation from test execution. Resolved inputs retain their corpus files and become mandatory passing cases.

The `//:build-contracts` target checks explicit Bun test deadlines before graph or package-script changes land. Service-call, table-row and runtime export documentation checks receive 30 seconds rather than inheriting Bun’s five-second default.

Compiler test prerequisite checks read the package’s TypeScript syntax, including the shared shard factory. Every compiler shard must declare `runtime-dist` before reading its output; each registration must call the checked factory with its own shard index. A direct target, a factory or a returned target keeps the same prerequisite rule.

Appendix Go checks use `-trimpath` to share compiled packages with the compiler and `-count=1` to reread their test inputs. Put the flags before the selector and package paths so the command’s build settings and cache policy are visible together.

The Go warmup includes `./internal/effecttsgo/lint`, which the lint configuration checks execute alongside the compiler packages. The warmup inventory checks that every declared package is covered without broadening exact package patterns to siblings.

The bounded project-service target runs both manifest invalidation and stale-manifest preservation tests, including disk and editor content paths. Its selector excludes unrelated upstream fixtures.

The `//:api-inputs-cache` target replays actual SDK caching with transitive local comparator helpers. It checks successful reuse, unrelated Go edits, changed comparator source, changed declaration types and restored bytes. Dependency fixtures include static and dynamic imports, file URLs and cycles; command stage records identify a stalled SDK invocation without printing workspace paths or environment values. The larger whole-repository key mutation check remains in the release suite.

Configuration validation selects the retired declaration-import option regression as well as VibeLang-prefixed tests. Deprecated spellings must retain warning severity and diagnostic code while being omitted from parsed configuration and serialization.

The `//:promise-data-bridge` check keeps Promise construction inside an explicit synchronous Effect boundary when testing data retention. It compares catch-result identity and thenable laziness with the ordinary TypeScript counterpart, and compiles keyed Promise, constructor and thenable neighborhoods without awaiting the retained value.

The `//:native-using-advisories` check covers native resource bindings in each callable context and every configurable severity. TypeScript disposal errors remain present even when the Effect advice is disabled. The native regression snapshots retain both disposal and jump errors alongside the advice.

The `//:optional-foreign-contracts` target gives reviewed pure TypeScript fixture helpers explicit never-throw contracts. It retains all optional receiver, argument and execution observations and separately checks that unannotated scalar, Config and Exit callbacks are rejected by fresh no-throw callback types.

The `//:native-inferred-declarations` target covers inferred native consumer imports as well as written re-exports. Stock TypeScript controls vary relative suffixes, quotes, nested paths and extension-rewriting settings; native consumers must not acquire VibeLang sidecars.

The `//:pipe-topic-regressions` target executes the implemented direct and nested missing-topic cases without pending markers. Its keyed corpus covers ordinary and Effect callables, with explicit positive controls that supply the correct outer topic.

Runtime IPv6 and base64 compatibility properties use actual Node oracle
processes, one per test, and send each sample or shrink attempt as a correlated
JSON-line request. They keep their original seeds and run counts. The oracle
bounds each response and request wait; child failures identify the request
without printing inputs. `packages/runtime/tests/node-oracle-budget.test.ts`
reruns the two suites with a real Node launch counter to prevent repeated
startup from returning.

The `//:build-contracts` target runs bounded declaration checks: Bun deadlines, compiler shard prerequisites, Go build flags, shared cache warmup, shared-package test selection and uncached Go test replay. It declares both Node and Go because cache replay verifies a real Go test against a changed external oracle.

The release target depends on this same check and derives its script-glob
exclusions from the registered suite list in `build-contract-inputs.ts`. Selecting both targets executes the command
audits once; selecting only `//:release` still runs them as a prerequisite.
The runner inventory accounts for every excluded suite, and real Node filename
controls retain neighbouring suites and propagate failures from each owner.

Its cache inputs are the inspected declarations, scripts, manifests and
lockfiles in `build-contract-inputs.ts`, plus compiler test files and
VibeLang-prefixed Go test files discovered on each plan. Acceptance cases,
compiler implementations, user guides and site output do not rerun this
command audit. `//:build-contract-inputs-cache` checks the actual SDK key
across unrelated edits, every declared file and newly added inventory
members. It also requires a changed runtime-child budget to rerun and fail
the real contract suite before restored bytes can reuse a successful result.
This separate check shares the inspected input group and SDK lockfiles; unrelated
acceptance cases do not rerun its key fixtures. Each SDK invocation records its
stage, elapsed time and process outcome, and each execution writes a unique
results receipt.


The `//:declaration-contract-twins` check compares ordinary, unmodified stock declaration twins with emitted declarations and sidecars. Generated never-throw contracts are the only documentation exception; exported types and authored comments remain checked. It includes function signatures, callbacks, constructors and JSX containers.

The `//:trusted-callback-contracts` check verifies foreign callback contracts, native constructor shadowing and all runtime observations in the throwing-callback fixture.

The `//:declaration-manifest-retirement` target verifies complete package file sets against stock TypeScript in five emission layouts, checks that no provenance manifest is emitted, and retains the forms fixture’s exact declarations and runtime observations. Foreign-call contracts travel in declarations; stale provenance files do not grant permission.

The `//:class-evaluation-repairs` check exercises preserving repairs in class bases and generated schema error bases, including parentheses, nested calls and repeated fixes.

The `//:whole-service-declarations` check compares whole-shape services with native declarations across namespace imports, defaults and enclosing namespaces.


The `//:legacy-provider-identities` target keeps missing-provider and version-pin identities distinct. It checks union and variadic-tuple provider cases with renamed services, trivia and both flag values, and uses stored Effect values as controls that require no runner providers.


The `//:legacy-json-advisory` check replays the JSON advisory registry witness through legacy project configuration and checks each interim severity independently.

The `//:optional-callback-identities` check retains both missing channels and optional-operand admission, plus guarded and unguarded call, method, receiver and computed-access controls.

The `//:native-setup-exit-behavior` check executes stock TypeScript and VibeLang on the same native source. Unpatched defaults retain successful exit and emission while the lint error still prints; explicit false flags keep the error blocking, and explicit true flags remain unchanged.

The `//:interim-severity-probes` check retains the eight original compatibility keys, covers the complete current inventory and runs every supported severity through the actual compiler.

The `//:join-message-regressions` check retains all awaited-value diagnostics and Deferred guidance, with direct and nested Deferred operands, parentheses and independent native type errors.

The `//:lint-activation-regressions` check covers configured and unconfigured projects, inherited plugin settings, explicit disablement and idempotent legacy plugin migration.

The `//:service-member-controls` check preserves all eight invalid service-member errors and the native service-class advisory, including record shapes with import aliases and retained bodies.

The `//:plain-runner-promise-data` check preserves eager Promise creation, the original result and page observations, and retained, discarded and parenthesized boundary mutations.

The `//:option-direct-consumption` check covers direct and parenthesized `try` operands alongside assigned, returned, passed and stored generic Effect results.

The `//:lexical-restore-regressions` check retains nested mask entry state, restored interruption, outward returns and rejection of masks in plain activations.

The `//:native-value-boundaries` check retains native process comparison, missing identity, root identity and failure classification, with tagged and untagged foreign boundary mutations.

The `//:object-runner-promise-data` check retains method, arrow-property and Effect-method runner results as Promise data, including the original cold-work counter and all prior bridge forms.

The `//:stream-loop-head-identities` check retains assignment, property, `var`, `using` and `await using` rejection witnesses and valid native head controls.

The `//:host-clock-identities` check covers direct, computed and optional host clock reads in named functions, retired settings, local shadows and native ECMAScript controls.

The `//:native-written-declaration-routes` check covers ordinary TypeScript consumers of VibeLang sources, quote styles, nested paths, rewrite settings and both source extensions.

The `//:setup-lint-exit-policy` check retains modern severities and authored plugin flags across unpatched and Effect-patched setup, with inherited configurations and JSONC mutations.

Setup follows TypeScript’s resolved `extends` chain when preserving an unpatched compiler’s Effect exit policy. It updates owned shared bases even without a `tsconfig` filename; protected and foreign bases remain unchanged and receive a diagnostic when their missing exit options require attention.

The `//:catch-value-identities` check preserves invalid handler errors, independent native diagnostics and source parentheses/comments, and rejects generic-call advisories on catch execution syntax.

The `//:throws-documentation-preservation` gate runs located-refusal tests and generated comment variations, then compiles each manually migrated source.

The `//:trusted-empty-forwarding` gate replays the legacy migration input, checks its fixed point and public API, and compares generated defect bridges with native Effect exits.

The `//:negative-promise-boundaries` check requires exact independent diagnostic sets for native Promise calls, foreign synchronous calls, host fetches and root runners.

The `//:error-family-native-patterns` gate checks native family patterns, unsupported-extractor controls, exact public declarations, and all runtime error-family observations.

The `//:pattern-predicate-contracts` gate checks foreign and source predicate contracts and runs all fixed-pattern, ordinary-class, and global-object identity controls.

The `//:relocated-sidecar-layout` check covers explicit and inferred source roots, package/paths/import routes, symlink identity and negative forward-mapping controls. Mismatches include the route and root configuration in their diagnostic context.

The `//:catch-error-data-advisories` gate checks tagged-error migration twins, their runtime values, and catch-result advisories with independent native-error controls.

The `//:plain-unknown-contracts` gate checks unannotated foreign calls in plain and effect code, with known-throwing and caught-call controls.

The `//:producer-native-annotations` gate checks every reviewed producer contract and runs stock TypeScript 5.9.3 comparisons across nested declarations, aliases, and incompatible return types.

The `//:stream-loop-body-identities` gate checks every Stream-loop body restriction alongside aliased imports and valid local-break controls.

The `//:missing-data-method-diagnostics` gate retains all native lookup errors and checks the corresponding valid receiver controls.

The `//:tagged-pattern-binding-renames` gate exercises reference and rename operations across tagged variants, binding keywords, Unicode names, trivia, and explicit-key controls.

The `//:nothrow-rethrow-escape-controls` gate retains every escape shape and adds plain-call and deeper-return controls for each independently admitted array callback.

The `//:native-import-preference-twins` gate retains byte-exact unchanged-importer controls and compares explicit source imports with independent native twins and stock TypeScript 5.9.3.

The `//:legacy-schema-key-defect-repairs` gate checks both input diagnostics, zero-error fixed output, defect identity bridges, and idempotence across class heritage and four nested schema layouts.

The `//:throw-repair-native-twins` gate retains every repair and idempotence invocation. It batches the native twin and declaration comparisons into one TypeScript program each, snapshots every declaration before the next repair, and records fixture/stage timing without source payloads. The runner keeps its existing deadline and adds deterministic input variations.

The `//:option-generator-iterator-refusals` gate distinguishes native generators from explicit producers and retains every active-iterator refusal across binding, discard, return, nested-loop, alias, and option-state variations.

The `//:error-tag-inheritance-identities` check retains all inheritance rejections and the native property error, with literal and union reserved-tag mutations in both error forms.

The `//:automatic-catch-data-preservation` target checks returned data, native contracts, advisories and editor actions across catch handler variations.

The `//:native-repair-argument-thunks` target checks method-argument repairs across calls, defaults, receivers, native narrowing and declaration identity.

The `//:lexical-capture-diagnostic-retirement` gate validates the retired fixture inventory and its resurrection guard, then checks captured values with independent native-error controls.

The `//:qualified-interruption-call-controls` gate retains all running-rule controls and rejects, enforces the qualified-call pairs without pending allowances, and replays their keyed corpus.

The `//:native-await-declaration-twins` gate retains byte-exact declaration comparisons against explicitly annotated native twins, all shadowing and generic-domain variations, and runtime operand-evaluation controls.

The `//:async-match-throw-contexts` gate enforces the implemented async-match oracle without pending allowances and retains every ordinary, async, and Effect context and the minimized keyed corpus.

The `//:formatter-written-jump-controls` gate reads original jump tokens after concurrent-loop lowering, covers comments and automatic semicolon insertion, and retains the formatter guard unchanged with explicit program-changing negative controls.

The `//:platform-callback-contracts` gate retains all platform diagnostics and tests unknown and non-throwing callback signatures independently.

Conditional-export API fixtures select `lib.es5.d.ts` for their scalar type
aliases. Their loaded-library guard covers both the comparator and independent
stock TypeScript programs. The 24 generated condition-order samples retain
native module-resolution checks; selected and unreachable type mutations,
inherited sidecar settings and self-comparisons remain active. Independent
bidirectional assignments accept unchanged aliases and require two `TS2322`
diagnostics for changed selected types. A missing `BigInt` still produces
native `TS2583` and an incomplete API comparison.

Ambient declaration API fixtures select `lib.es5.d.ts`. Independent stock
TypeScript programs validate each snapshot separately, so its global
declarations cannot merge with the other snapshot. Native consumers require
the declared property type in each conflicting global and retain `TS2322`
for the opposite type. Missing `BigInt` retains native `TS2583` and an
unavailable API comparison. Global, referenced-script, inherited-interface
and module-augmentation controls, documentation normalization and all four
generated reflexivity/mutation samples remain active.

Browser fixtures in `scripts/api-identity-self.test.mjs` reuse pinned library
documents through TypeScript's bounded document registry. Programs still load
the native `Request` and `Window` bindings and check each snapshot
independently. Resource guards require unchanged browser libraries to retain
their parsed document identity. All 24 ambient samples still compare self,
formatting and type mutations.

The `//:schema-alias-native-properties` target checks alias repairs against native writable-property errors across optional, nested and imported schema variations.

The `//:implicit-generator-defect-bridges` target compares implicit generator repairs against native declarations and Effect exits across foreign invocation and contract variations.

The `//:trusted-legacy-client-actions` target checks the legacy client diagnostics at current synchronous-call boundaries through public language-service document edits.

The `//:recursive-legacy-slot-diagnostics` check retains recursive legacy call-cycle and native recursion errors while testing fully written positive contracts for argument, logical and generic call positions.

The `//:fork-object-operands` check proves the seven object operands are legal TypeScript expressions but not assignable to Effect, requires all seven `EK1703` errors and retains embedded native return errors in wrapped and unwrapped controls.

The `//:plain-handler-regressions` check retains direct and internally caught plain throws alongside valid Effect handlers and nested Effect functions, across source placements.

Destructuring-default differential observers normalize an `Exit` with `Exit.match` callbacks so they also type-check after generated outward jumps. `FuzzDoBindingObserverAfterJump` covers reachable observers and observers after `return`, `throw`, `break`, `continue` and a constant-false branch.

The `//:abstract-error-family-membership` target compares legacy abstract roots with native error classes across subclasses, aliases, tags and unrelated values.

The `//:native-identity-receipt-inputs` target validates frozen source and configuration inputs on clean source trees. Generated declaration sidecars are compiler output, not additional authored inputs.

The `//:parser-error-registration-members` target checks the complete parser suite and generated matcher blocks across error forms and authored member variations.

The `//:migration-source-twins` target checks complete source equality and declaration identity for implicit-run and imported generator migrations, including their evidence comments.


JSDoc-link API fixtures select `lib.es5.d.ts` for independent native validation
and every comparison program. The loaded-library guard requires ES5 and permits
only its decorator libraries; it asserts outside comparison failure handling.
The original comment-kind, export/member/tag, label and reverse-direction
matrix and all 24 generated samples remain enabled. Structural type mutations
must still differ independently of unchanged comments, and missing `BigInt`
must retain native `TS2583` and make comparison unavailable.

The `//:schema-codec-native-return-inference` target checks generated schema factory return inference, writable codec references, lexical scopes and migration idempotence.

The `//:scoped-wrapper-refusal-progress` target checks scoped platform refusals, independent listed-file repairs, omitted companions and unchanged unlisted modules, including interrupted verification.

The `//:explicit-diagnostic-category-variants` target checks fixed throw-syntax error severity and contextual host warning categories against Appendix B.

The `//:unique-diagnostic-authorizations` target checks that a retired diagnostic and its source fixture have one authorization record, preserving approval references and protected source/configuration digests when records are consolidated.

The `//:syntax-error-matcher-registration` target checks complete syntax goldens and parse/print fuzz seeds, including matcher registrations and authored error members.

The `//:continuation-contract-retirement` target keeps continuation retirement identities consistent across the registry, full-project corpus, native namesake controls and Appendix examples.

The `//:generator-binding-refusal-contracts` target checks complete generator refusal diagnostics and object, defaulted, nested and tuple parameter migration corpus controls.

The `//:resolved-fuzz-gap-regressions` target replays native source resolution, declaration spelling, generator arguments, grouped completion, and execution diagnostics after their compiler gaps are resolved. Changes to those implementations or pending records select it before landing.

The `//:inherited-error-constructor-arity` target checks zero, single, multiple, optional, rest and object constructor shapes, retaining arity errors in authored methods.

The `//:generic-handler-requirement-migration` check covers inferred requirement types in legacy error handlers and their public contract preservation.

The `//:diagnostic-example-source-locations` target replays located JSON and provider examples and the archive decoder guards. The complete Appendix runner continues to replay every example. It runs at most four single-threaded compilers concurrently, keeps witnesses from the same native project sequential, and waits for active compilers before cleaning up a failed run. Receipts retain the example order and each code, category and source-location check.

The `//:error-constructor-diagnostic-retirement` target checks the retired subclass-constructor identity and the current inheritance rejection across native constructor signatures.

The `//:filtered-bundler-entry-cleanup` check runs the entry module with an empty name selection, verifying that teardown does not require setup to have run.

The `//:anonymous-cycle-parity` check compares recursive declaration bytes with stock TypeScript `7.0.2` under VIP-27, retaining current native diagnostics, spans, JavaScript and unrelated outputs.

Computed class member probes keep the final method observation inside `Effect.sync` in both the VibeLang program and its native reference. This prevents `EK0403` on an `any`-typed observation from hiding the computed-name evaluation order the probe measures. Keyed minimal and composed inputs retain the original result and ordered events.

The `//:bundler-service-receivers` check builds and runs the esbuild service example with source maps and exercises explicit receiver lookup and native class-static rejections under VIP-10.

The `//:module-implicit-run-retirement` check rejects the retired implicit-execution identity, preserves original explicit-execution and service-key failures, and exercises cold module, class and parameter calls with native type controls.

This check also compares native and mapper `EK0504` keyword spans across module, function, class, parameter and callback contexts, with valid Effect-body controls.

The `//:native-and-legacy-catch-bindings` target checks unchanged native catch bindings with stock TypeScript, full declaration identity and JavaScript equality, alongside legacy typed-filter rejection controls.

The schema codec return check also replays grouped, required-field, and readonly-field migration fixtures, with mutable, optional, grouped, and readonly codec fuzz inputs.

The trusted class visibility check replays the located compatibility example and varies private versus exported classes, import aliases, namespaces, and Unicode names against stock TypeScript visibility controls.

The tagged match repair check compares complete migration output and compiles it, with exhaustive-tag handler and refutable-combinator fuzz controls.

The loader sidecar root check varies explicit, inherited, inferred, and composite roots through public and loader compiles, then runs the embedded bundler declaration checks. Failures report the relative declaration paths actually written.

The error registration projection check preserves authored native static blocks while checking error fields, getters, methods, empty declarations, and schema controls in both renderings against native and stock TypeScript.

The layer repair check preserves `LF` and `CRLF` comments while using explicit service lookup; keyed service-call inputs cover `try`, `catch`, pipes, and nested handlers with the same member name.

The grouped schema boundary check retains exactly one inheritance error after a field-only repair, then compiles full migrations across parent, child, nested-array, namespace, and Unicode field variants.

The `//:build-repair-cli-contracts` target checks build aliases, repair flag order, repeated runs and source line endings against VIP-34. It also retains watch refusal controls and the dependency-order, cycle, ownership and cancellation tests for project builds.

The `//:abstract-error-constructor-migrations` target checks abstract root and inherited constructor repairs across ordinary, migration-only and VIP-only runs, including imported bases, namespaces, Unicode and declaration preservation. Runtime controls retain field filtering, tags, getters, constructor identity and repeated repair behavior.

The binding-free pattern check compiles checking projections with actual runtime cache types, independently of prelude export inventory, and verifies empty, literal, nested, negated and alternative patterns plus iterator closing and getter reads.

The Effect parameter diagnostic check varies callable form, throwing contract, and default binding shape. It retains strict initialization checks and records each diagnostic span when the expected count differs.

The `//:migration-style-severity-controls` target checks printed diagnostic severities independently of safe-fix refusal notes. Warning provenance remains recorded; promoted style errors still block the affected module. Keyed inputs cover all printed severities with both newline styles.

The `//:vite-service-coverage` target runs the real coverage provider with native TypeScript twins and keyed service lookup controls. It retains authored function counts and uncovered statement and branch comparisons, including failure and fallback paths.

Optional array-pattern bindings use the same conditional lexical-cell initialization as optional extractor bindings. An absent element skips initialization, a present `undefined` initializes the cell, and direct reads retain native definite-assignment errors. `match-list-optional-cells` compares plain, Effect, `is`, nested and elision forms with native TypeScript; keyed VIP-7 witnesses exercise `let` and `const` with absent and present values.

Computed schema keys in TypeScript projections keep their native expressions, including calls, getters and symbol keys. They are evaluated in the generated schema object at the same position as before. Keys containing VibeLang operations, or lexical values that need an Effect frame, report `EK9001` and require the compiler; they are not silently copied after removing a keyword. Native `await` and `yield` keep their native function context. Ordinary `this` keys retain the Effect function receiver in checking and executable projections. `FuzzMapperSchemaComputedKeys` covers writable and readonly fields in schemas, aliases and nested structs, with keyed inputs and changing names and literals.

The `//:http-request-pipe-rollback-controls` target retains canonical HTTP setter repairs, observable argument refusal and exact declaration controls across namespace and named imports, aliases, reexports, Unicode and stage order. The complete pipeline-order preservation controls also run in `//:pure-request-pipe-receiver-controls`.

The `//:sync-builtin-call-bridge-controls` target retains exact sync wrapper checks and compares generated call bridges with native TypeScript. Keyed inputs cover JSON values and parse failures, property reads, Unicode and helper name collisions; runtime traces include construction, repeated runs, receivers, arguments and defect details.

The mapper prelude helper check type-checks generated iterable projections with both native and stock TypeScript, preserves runtime helper types, and runs iterator cleanup controls.

The `//:mapper-explicit-catch-owner-controls` target retains lazy catch and pipe-topic projection assertions under explicit effect owners. It also checks native and mapped `EK0504` spans for ordinary functions, arrows and shadowed callbacks, while marked owners remain valid. Legacy hatch and value-handler projection controls keep their existing coverage.

The `//:migration-metadata-comment-twins` target checks exact narrowed-call and parameter-cell repair twins and executes both fixed cases. Keyed comment controls cover headers, footers, trailing comments, Unicode and line endings without erasing source metadata from comparisons.

`//:mapper-catch-declaration-imports` checks inferred and partial catch channels with stock TypeScript and namespace-alias controls.

The abstract error constructor controls also retain an existing `Data` and `Schema` import while migrating a fieldless base and a child with fields and a getter. This reproduces overlapping import insertions in all three repair modes; the import-free cases remain positive controls.

The `//:mapper-subtype-callable-controls` target keeps five unresolved host callback checks while retaining effect blocks in the source mutation. Written callback controls, runtime cases and the effect-marker comment property remain required.

`//:legacy-inferred-service-receiver-order` checks the original service migration and a keyed matrix of marked and unmarked inferred-channel annotations against native TypeScript declarations.

`//:native-generator-refusal-site-controls` checks unchanged native generator returns, original source coordinates after earlier repairs, refused-only files and protected prelude edits, including the keyed inside/outside edit matrix.

The corrected pipeline repair check retains all original factory-order, mutable-stage, receiver, callback, runner and accessor-option cases. Canonical HTTP setters additionally keep their proven-safe data-first form and exact declaration output across import layouts and stage order.

`//:service-member-diagnostic-ownership` checks single member diagnostics across whole shapes, generic declarations, invalid keys and call or construct signatures, including keyed fuzz inputs.

Compiler shards use `scripts/testing/node-failures.mjs` to report failures with their original error details, ordinary test output, and Node's execution totals. Successful test names do not crowd the graph preview. A progress record lists completed files and files awaiting a summary every 30 seconds. The reporter preserves exit status, nested failures, cancellation, skips and todos; `scripts/compiler-failure-output.test.mjs` runs each real shard command against controlled files to verify those boundaries.

The module-body corpus follows accepted VIP-40: the original throwing helper and all retained names and export forms must compile without diagnostics. Ordinary namespace controls, extracted bodies and identifier-import rejection are checked with stock TypeScript; twelve seeded mutations retain the same checks without a pending acceptance exception.

The `//:legacy-directive-category-controls` target retains the original spliced JSON witness and compares source-scoped legacy severities with actual diagnostics. Keyed cases cover file and next-line scope, unrelated files, strings, block comments, wildcard precedence, near-miss codes and both line endings. Injected wrong categories must still fail the oracle; no original corpus input is removed.

Optional object-property bindings initialize their lexical cell only after a successful presence check and value read. Missing properties leave the cell uninitialized; present `undefined` initializes it. `match-object-optional-cells` covers plain, Effect, `is` and nested forms, while keyed VIP-7 witnesses cover `let`, `const`, inherited properties and receiver-preserving getter reads.

`//:mapper-effect-block-source-ownership` checks explicit program blocks, blocks run directly by `try`, nested plain callback boundaries, resolver controls and keyed native-to-mapper diagnostic comparisons.

`//:catch-completion-declaration-surface` checks nested catch runtime results, the exact declaration goldens, and keyed literal-return and normal-completion controls.

The runner inventory identifies the documentation suites by their file selector. Reporting flags and option order can change without losing that identity; the Bun budget check still requires the explicit deadline. Real Bun fixtures retain the selected suites, exclusions and failure status across reporting and worker-count profiles.
