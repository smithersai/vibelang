# The build graph

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
  -f targets='<targets>' -f patch=<base64 of the gzipped git diff>
```

The workflow holds no secrets and its token only reads this repository. A hosted
pass counts; a hosted failure sends the change back to a build host, which is the
reference for rejecting it.

A `node_modules` symlink in any of these directories, including `.smithers`,
is provisioned by whoever made the link. `scripts/ci.sh` uses it as is and never
runs `bun install` through it. The link owner must keep that install current.
For other existing installs outside `.smithers`, the script checks the installed
Effect version against the package's exact pin, including `devDependencies` and
`peerDependencies`, and reuses a matching tree. Stale or missing local trees and
local `.smithers` installs run `bun install --frozen-lockfile`.

## Packages

```text
.smithers/WORKSPACE.ts          toolchain (node, go, bun), cache in .flows/
//typescript/tsc                the Go module
  :srcs                         Filegroup: what go build reads (no *_test.go, no testdata/)
  :go-checker :go-parser        go test, one target per Go package tree
  :go-format :go-core
  :vibelang-files ...           Filegroups: one Go package's tests and testdata
//typescript
  :compiler                     go build ./cmd/tsc -> typescript/built/local/tsc
//typescript/vibelang
  :<case>                       harness.mjs <case>, one target per case (809)
  :lsp-smoke                    headless language-server editor checks
//packages
  :runtime-dist                 bun run build -> packages/runtime/dist
  :runtime-test                 bun test (runtime)
  :compiler-native              the binary and dprint plugin in packages/compiler
  :compiler-test                node --test (compiler package)
  :vite-test :unplugin-test      the bundler plugins' test/run.sh (source maps, builds, watch)
//                              checks that read the whole repository
  :tree                         Filegroup: every file
  :go-vibelang :go-vibelang-race :go-vibelangmapper :go-vibelangfuzz
  :go-vibelangfuzz-pending      the inputs testdata/pending/ lists, which must still fail (merge gate)
  :go-vibelangfuzz-editor       the editor oracles over documentation examples and cases (merge gate)
  :release :snippets :tokens :forms :docs-tools :docs-check :site-spec-links
  :site-contrast                exclusive: runs only with --include-exclusive
  :design-files                 Filegroup: docs/design
  :spec-tests                   the Go tests that read docs/design (registry, VIP citations, pending lines), the cost guards of --fix and flow narrowing
```

```text
:srcs ─► :compiler ─┬─► :<case> x809 ◄─┬─ :runtime-dist ─► :runtime-test
                    ├─► :compiler-native ─► :compiler-test, :vite-test, :unplugin-test
                    ├─► :lsp-smoke ◄─ :runtime-dist
                    └─► :snippets, :docs-tools
:tree ─► :release :snippets :tokens :forms :docs-tools :docs-check :go-vibelang*
:design-files, :srcs, :vibelang-files, :vibelangfuzz-files ─► :spec-tests
```

The runtime entry tests start up to three host processes in sequence. Each
child has a `10_000` ms deadline; the whole test allows `35_000` ms so the
outer deadline covers all three on a busy build host.

The documented debugging recipe test compiles an application and then starts
Node.js to check its failing source-mapped exit. Its test deadline is
`30_000` ms so both host processes can finish on a busy build host; it still
checks the compiler result, failure marker and original source location.

The `//typescript/vibelang:lsp-smoke` target runs `lsp-smoke.sh --no-build`
against the graph's compiler and runtime outputs. Its inputs cover the Go
language service through `:compiler`, the runtime, the Effect lockfiles,
`lsp-smoke.sh`, `lsp-smoke.mjs` and `lsp-fixture/**`. Unchanged inputs
replay the cached result. Run it alone with:

```sh
sh scripts/ci.sh //typescript/vibelang:lsp-smoke --jobs 8
```

Post-merge selects it through `//typescript/vibelang/...` in the compiler-case
shard. The merge gate also selects it when it covers the `compiler` step.
The smoke runner continues after a failed check, prints each check's name on
its own `FAIL` line, and exits with status `1` if any check fails.

The `//typescript/vibelang:fork-late-start` target runs the fork startup
regressions with delayed scheduling as part of the regular compiler suite.
It passes the harness's `--isolated` switch, which copies each case into
`typescript/vibelang/.smthrs-harness-<run>/<case>/` before compiling and running
it. Keeping this directory beside `cases/` preserves custom runners' relative
imports of shared helpers. Its `out/`, `node_modules/`, custom runners and declaration-identity
outputs belong to that invocation, so it can run concurrently with the same
cases' individual targets. Successful copies are removed; failing copies and
command logs remain for inspection. Any aggregate harness target that overlaps
individual case targets must use `--isolated`.

The release check runs `typescript/vibelang/harness.test.mjs`, including a
barrier-controlled regression that executes both targets' actual shell commands
concurrently. The aggregate starts after the per-case compiler emits and before
its runner loads the result, so shared output directories fail deterministically.

To reproduce child-start races without a busy host, run the acceptance harness
with `--late-start` (or set `VIBELANG_LATE_START=1`). It delays queued
scheduler tasks by `100 ms` after the caller suspends, while timers can resume
the parent. A pause between the fork and sleep cannot consume this delay. The same
environment switch applies to `TestCompilerRuntimeCases` and runnable documentation
examples checked by `bun docs/tools/check-snippets.ts --run`. For example:

```sh
cd typescript
EFFECT_NODE_MODULES=$PWD/../experiments/node_modules VIBELANG_RUNTIME=$PWD/../packages/runtime node vibelang/harness.mjs --late-start uninterruptible-using fork-named-region
cd tsc
VIBELANG_LATE_START=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -count=1 -p 8 ./internal/vibelang -run 'TestCompilerRuntimeCases/(uninterruptible-using|fork-named-region)$'
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

The native compiler corpus, `:go-vibelang`, runs Go with `-timeout 45m`.
Its shell target allows 70 minutes, including waiting for a Go build slot and
compiling the test binary. Each native runtime case has a 20-second Node
execution deadline.

The fuzz shell caps `GOMAXPROCS` at the smaller of `24` and the machine CPU count and declares `GOFLAGS=-p=6`, matching the
post-merge shard allocation. Smithers withholds ambient Go variables, so
setting them only on the outer CI process does not constrain the test.
These declared values also enter the target cache key.

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
`sh scripts/ci.sh //... --include-exclusive --jobs 8`. Each checkout keeps its
`.flows/` between runs, so a long-lived CI checkout replays everything an
earlier run already proved.

## Cache contracts

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
- **Its installs.** `node_modules` trees are installed from lockfiles before
  `smthrs` runs, as Smithers installs its own. The lockfile and `package.json`
  are the install's identity and inputs of every target that reads it.
- **Its outputs.** A build target declares its outputs; `smthrs` digests them
  after the run and restores them on a cache hit.
- **Its scratch.** `.flows/` and `.smthrs-*` are gitignored. `smthrs` restores
  an output by writing a sibling `.smthrs-*` tree and renaming it into place,
  and `jj file list`, which the docs check runs while other targets restore
  their outputs, snapshots the working copy: an unignored temporary tree is
  tracked, then vanishes before the check reads it.

The command-line fuzz target builds its nested compiler with `-trimpath`,
matching the outer Go test build. This lets the two builds share compiler
package artifacts in the Go build cache on a fresh validation mirror.

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

`//:site-spec-links` checks the generated specification and VIP pages for unconverted `.md` links, missing pages and missing anchors. `//:docs-tools` depends on it, so the pre-merge gate runs it. Its inputs are `site/src/pages/spec/**`, `site/src/pages/vips/**` and `docs/tools/site-spec-links.test.ts`; unrelated changes reuse its cached result.
