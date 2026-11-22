# VibeLang fork of the TypeScript compiler

This directory contains the TypeScript 7 Go compiler (`tsc/`) with VibeLang syntax, checking, and emit. A function without an `effect` modifier keeps its plain or async TypeScript meaning. Calling an `effect` function returns an unrun `Effect<A, E, R>`. In effect code, `try` runs an Effect and yields its success value, propagating failure. The compiler checks VibeLang and TypeScript together and emits JavaScript and declarations for Effect 4. See [Functions](../docs/design/src/001-functions.md), [Running Effects](../docs/design/src/002-running.md), and [Failures](../docs/design/src/003-failures.md) for the source rules.

## Base

| Item | Value |
| --- | --- |
| Upstream commit | `257e87406c6a8be277cb8cd5ef8d7b458a650390`, "[api] Fix named pipe / UDS creation (#64818)", 2026-10-14 |
| Why that commit | It is the `gitHead` of npm `typescript@next` 7.1.0-dev.20261015.1 (`npm view typescript@next gitHead version`) |
| Go | `tsc/go.mod` says `go 1.27`; with Go 1.26 installed, `GOTOOLCHAIN=auto` downloads go1.27.0 |
| History | `typescript/` is upstream's tree at that commit without `tsc/testdata` (61,721 test baselines, 349 MB), imported by one commit of the VibeLang repository. The compiler commits are interleaved with the rest of the repository's history, so a move to a newer upstream commit merges instead of rebasing: the ts-bump flow merges upstream's changes since this commit three ways and moves this row (`docs/maintainers/typescript-upgrade.md`). |

## Build and test

From the repository root:

```sh
(cd typescript/tsc && CGO_ENABLED=0 go build -trimpath -o ../built/local/tsc ./cmd/tsc)
sh typescript/vibelang/smoke.sh --status
sh typescript/vibelang/smoke.sh ch04
sh typescript/vibelang/lsp-smoke.sh
bun docs/tools/check-snippets.ts --root docs/design/src
```

The compiler embeds the TypeScript libraries in the default build. The case harness uses `typescript/built/local/tsc`, and the spec snippet checker also accepts `VIBELANG_BINARY`. Build with `-trimpath` so independent jj workspaces can share Go build cache entries. See the [maintainer build guide](../docs/maintainers/build.md) for dependency and runtime setup.

## Seams in upstream files

From the repository root, compare your revision with the upstream import recorded above. This produces the file inventory directly from the trees, including changes that contain no VibeLang identifier. After an upstream upgrade, use the import for the new pin.

```sh
jj --no-pager diff --summary --from unpwqpnz --to @ typescript/
```

The status column identifies modified, added, and removed paths. Filter the summary to modified paths to see the existing upstream files first. To inspect a particular seam, replace `typescript/` with the file path and drop `--summary`. Review both modified upstream files and added sibling files when upstream adds a similarly named file or changes an API they share. The [upgrade procedure](../docs/maintainers/typescript-upgrade.md) covers text conflicts, regenerated tables, and semantic changes in clean merges.

| Area under `tsc/` | Where to start |
| --- | --- |
| `internal/ast`, `scanner`, `parser`, `binder` | Source classification, token and node representation, grammar, recovery, and binding. Read `parser/parser.go` alongside `parser/vibelang*.go`. |
| `internal/checker`, `pseudochecker`, `transformers/declarations` | Hook definitions in the checker's `extensions*.go` files and their call sites in inference, flow, node building, and declaration emit. Follow registrations back to the VibeLang implementation. |
| `internal/compiler`, `module`, `modulespecifiers`, `outputpaths` | Project loading, module resolution and specifiers, sidecar paths, and emit staging. Include new compiler files in the review. |
| `internal/execute`, `tsoptions`, `core`, `diagnostics` | Project configuration, diagnostic routing, and exit status. Refresh generated tables through their generators. |
| `internal/printer`, `transformers` | Emit and source-map behavior, including synthesized nodes and class elements. |
| `internal/ls`, `lsp`, `cmd/tsc` | Editor navigation, rename, formatting, diagnostics, and executable dispatch. |

`tsc/internal/vibelang/vibelang.go` registers the checker and emit hooks from `init`. Use the registrations and their definitions as the hook inventory, including changes in adjacent packages such as the pseudochecker.

```sh
rg -n 'Register[A-Za-z0-9_]+' typescript/tsc/internal/vibelang --glob '*.go' --glob '!**/*_test.go'
```

The vendored Effect rules, local integration, applied upstream patches and generated shims live under `tsc/internal/effecttsgo/`. See the [Effect upgrade procedure](../docs/maintainers/effect-upgrade.md).

## Compilation

- The parser and AST classify VibeLang source and preserve the nodes and positions used by the checker, emitter, and editor. [Appendix A](../docs/design/src/900-appendices.md#appendix-a-grammar) defines declaration starts, recovery, and the `[Effect]` grammar parameter. See [source modes](../docs/design/src/007-tooling.md) for file extensions and the first-line directive.
- Checker hooks interpret effect return types, resolve implicit Effect names and produce diagnostics. `newLowering` in `tsc/internal/vibelang/lower.go` creates the per-file transformer. The fork lowers effect bodies into generators and emits declarations through separate hooks. The Hack pipe's topic and evaluation semantics are defined in [Running Effects](../docs/design/src/002-running.md#the-pipe-operator). Start with `pipes.go` and `pipes_lower.go` when debugging the implementation.
- VibeLang diagnostics use source `EK` in `tsc/internal/vibelang/diagnostics.go`. TypeScript diagnostics keep their `TS` codes. [Appendix B](../docs/design/src/900-appendices.md#appendix-b-diagnostics) records current and transitional codes. [Configuration and tooling](../docs/design/src/007-tooling.md) defines severity overrides.
- `tsc/internal/vibelang/platform.go` reports `EK4402` for Node builtin value imports and recognized platform references, including the host reads `Crypto.randomUUID`, `Crypto.getRandomValues` and `Performance.now`. ECMAScript's `Date` and `Math.random` are allowed. See [Services](../docs/design/src/005-services.md#the-platform-standard-library) for migration warning behavior and the platform boundary.

## Compiler and tooling entry points

`tsc/cmd/tsc/main.go` dispatches these entry points before normal compilation:

| Invocation | Purpose |
| --- | --- |
| `vibelang --estree <file>` | Reads source text from stdin and returns an ESTree AST or a structured parse error for the ESLint adapter. |
| `vibelang --ts-projection <file>` | Reads source text from stdin and returns virtual TypeScript with source mappings and diagnostics for the Oxlint adapter. |
| `vibelang lint -p tsconfig.json` | Runs checks and configured Effect lint rules without emitting files. |
| `vibelang --write-dprint-plugin <package-directory>` | Writes the dprint plugin for the compiler package using the running executable. |
| `vibelang --parent-pid <pid> [--init]` | Serves the dprint process-plugin protocol, started by dprint. |
| `vibelang prove` | Checks theorem proof obligations under VIP-43. |
| `vibelang --lsp` and `vibelang --api` | Start the language server and TypeScript API service. |

TypeScript's built-in editor code fixes remain available. VibeLang-specific source repairs are manual in the first release. See [explicit source changes](../docs/design/src/007-tooling.md#explicit-source-changes).

## Performance

The measurements below are historical and name the compiler revision or date used for each run.

`compiler.sh` checks its workload before looking for a compiler, creating output or staging dependencies. `--modules`, `--runs` and every `--scale` entry must be positive decimal integers no larger than `9007199254740991`; `--shapes` accepts `chain`, `dense` and `single`. Separate list entries with spaces, tabs or newlines. An empty `--scale ""` or `--shapes ""` skips scaling. A missing option value or invalid workload names the option and exits with status `2`.

Benchmark staging links the pinned `effect` and checkout `vibelang-runtime` into the output directory. Existing links can be refreshed on reruns. A real file or directory at either package path makes staging fail without replacing it; choose a fresh `--out` directory instead of reusing an installed project. This keeps measurements from silently loading an older package.

Benchmark output needs its own `node_modules` directory. Staging rejects an output `node_modules` symlink before writing package links, so an aliased installation stays unchanged; choose a fresh `--out` directory. Dependency installations used as staging inputs can still be symlinks.

Use `--report new.json` with the case harness to retain full-precision case and command wall times, outcomes, compiler hash and environment metadata. Existing report paths are refused before a case runs; interrupted invocations remain incomplete.

Compiler-case timing reports have a separate, informational comparator: see [compiler-case performance reports](../docs/maintainers/compiler-case-performance.md) for repeated `--report` trials, phase medians and alerts above `1.5x`. It does not alter case deadlines or fail a correctness gate on a timing alert.

Run the benchmarks on the build host, which is quieter and larger than a laptop; other suites running there at the same time add noise, so the tables report medians:

```sh
# Run from the repository root, using a sibling upstream workspace.
jj workspace add ../upstream --name upstream -r 0c804b2f
(cd ../upstream/typescript/tsc && go build -trimpath -o ../built/local/tsc ./cmd/tsc)
# The compiler benchmark, then the language server benchmark.
(cd typescript/tsc && go build -trimpath -o ../built/local/tsc ./cmd/tsc)
sh scripts/bench/compiler.sh --upstream ../upstream/typescript/built/local/tsc --runs 5
node scripts/bench/gen-synthetic.mjs .cache/lsp 400
node scripts/bench/lsp.mjs typescript/built/local/tsc .cache/lsp/vibelang
```

The LSP benchmark requires a server binary and project directory. Its optional hover count defaults to `20` and must be a positive safe integer; invalid or missing arguments exit with status `2` before project discovery or server startup.

`scripts/bench/gen-synthetic.mjs` writes the same N modules twice, in VibeLang and in hand-written Effect 4 TypeScript. Each module declares two errors, a schema, a service and its layer, a plain helper, and functions that call into the previous module, catch with `match`, fork and join two fibers, provide the layer, and pipe the result. Its shapes are `chain` (small contracts), `dense` (each module's `deep` function also loads four earlier modules' services and calls the previous `deep`, so requirement and error unions grow with depth), and `single` (every module in one file). `compiler.sh` compiles the synthetic projects, the examples, the template, and the docs snippet corpus as one program with `--extendedDiagnostics`, and measures wall time and peak RSS with `scripts/bench/measure.py`. It prints a unique `measurements/run-*` directory under its working directory. Each numbered target there retains `command.json` (label, working directory, start time and compiler arguments), `run-N.log` for every trial, `runs.txt` and a `result.json` with every parsed sample, including nonzero exits. Reusing `--out` preserves earlier measurement directories; the top-level `run.log` and `runs.txt` still describe the latest trial and target.

Docs extraction must finish successfully before the corpus is measured. If it fails, `compiler.sh` exits with the extractor's status, names the failed stage and keeps stdout in `docs-corpus.log` and stderr in `docs-corpus.stderr.log` under the working directory. It retains the incomplete corpus and omits the final completion footer.

The `MEASURE wall_s=... rss_mb=... exit=...` record starts on its own line, even when the compiler's last diagnostic has no final newline. A compiler killed by a signal retains a measurement row with Python's negative signal status, such as `exit -9` for `SIGKILL` or `exit -15` for `SIGTERM`; ordinary nonzero exits are recorded too. These rows describe failed compilations, not passing benchmark workloads.

The `MEASURE wall_s=... rss_mb=... exit=...` record starts on its own line, even when the compiler's last diagnostic has no final newline. A compiler killed by a signal retains a measurement row with Python's negative signal status, such as `exit -9` for `SIGKILL` or `exit -15` for `SIGTERM`; ordinary nonzero exits are recorded too. These rows describe failed compilations, not passing benchmark workloads.

The LSP benchmark counts only numbered `.vibe` or `.ts` source files in the project's selected language. Declaration sidecars (for example, `m0.d.vibe.ts`), emitted JavaScript, source maps and backup files do not count as modules.

The LSP benchmark pulls cold diagnostics from the last numbered module and warm diagnostics from a different source module. A two-module project opens `m1` and then `m0`, so the warm measurement does not reuse the first file.

Measured 2026-10-17 on the build server, VibeLang at `main` plus the plain-function fix below, against upstream tsgo 7.1.0-dev at 257e874 (medians of 5 runs; seconds and MiB):

| Project | VibeLang wall | VibeLang check | Effect TS wall (upstream) | Effect TS check | Peak RSS, VibeLang / Effect TS |
| --- | ---: | ---: | ---: | ---: | ---: |
| chain, 200 modules | 0.39 | 0.13 | 0.31 | 0.15 | 281 / 221 |
| chain, 400 modules | 0.62 | 0.29 | 0.50 | 0.30 | 348 / 313 |
| dense, 200 modules | 0.53 | 0.26 | 1.98 | 1.75 | 336 / 440 |
| dense, 400 modules | 1.15 | 0.71 | 12.34 | 11.95 | 549 / 977 |
| single file, 400 modules | 1.59 | 1.01 | 2.96 | 2.25 | 254 / 286 |

- **Measured scaling on these synthetic shapes.** Chain time rose from 0.39 s at 200 modules to 0.62 s at 400; dense time rose from 0.53 s to 1.15 s. The table has one single-file measurement. These finite measurements do not establish a complexity bound for every VibeLang pass or for other programs. Hand-written Effect TypeScript is the one that blows up on the dense shape: checking `yield*` over requirement and error unions that grow with depth takes 12 s at 400 modules, against VibeLang's 1.2 s, because VibeLang infers each function's contract once instead of through generator types.
- **VibeLang's own passes** take 19% of the CPU samples on the 400-module chain and 27% on the dense shape (`go tool pprof -focus='internal/vibelang\.'` over `--pprofDir` profiles); TypeScript's checker does the rest. The largest are contract inference (`effectTypeOf`, `solve`) and expected-failure and trust analysis (`expectedFailures`, `callTrust`).
- **The hooks cost nothing on plain TypeScript:** this compiler checks the Effect TS project 3% slower than upstream tsgo.
- **The fixed cost is the effect root.** A file that uses any effect root name (D146), even `log`, makes the program import `effect` itself, whose index loads every module: about 515 more declaration files. The examples load 738 files, spend about 0.10 s parsing them and 2 ms checking, and peak at 220 MiB; the single-file shape, which uses no root name, loads 241. Importing each used module implicitly (`effect/Console`, `effect/Effect` for the bare functions), as the emitted JavaScript already does, would remove most of that. Name resolution (`preludeSymbol`), completions (`completions.go`), and method syntax (`effectModuleNamespace`) read the root module's symbol today and would need the per-module symbols instead.
- **The docs corpus** (684 VibeLang and TypeScript files as one program, 1594 files with dependencies) compiles in 0.57 s.

The LSP benchmark reports a failed request's id and method when its server exits or its transport closes, then terminates and reaps the server. A server that ignores `SIGTERM` is killed with `SIGKILL` after one second. Failures include the server stderr tail (at most `8 KiB`); stderr is drained throughout the run. Requests to a live server retain their `120 s` deadline.

Language server, `scripts/bench/lsp.mjs` on the chain shape (open the last module, pull its diagnostics, hover the call into the previous module):

| | VibeLang, 200 modules | VibeLang, 400 modules | Effect TS (upstream), 200 or 400 |
| --- | ---: | ---: | ---: |
| First diagnostics, before the fix | 270 ms | 380 ms | 80 to 90 ms |
| First diagnostics, after | 150 ms | 175 ms | |
| First hover, before the fix | 105 ms | 200 ms | 3 to 6 ms |
| First hover, after | 11 ms | 12 ms | |
| Later hovers | 0.2 ms | 0.2 ms | 0.2 ms |
| Peak RSS, after | 260 MiB | 277 MiB | 130 to 145 MiB |

**The fix:** `isPlainFunction` (plain.go) explored the transitive closure of a function's callees before deciding, even when the function's own body ruled it out, such as a `provide` block or a `throw` outside a `try`. The CLI pays that once per program, but the language server's checkers start empty, so the first hover in a module walked every function the call graph reached, through each module's `run` into the one before it. It now stops at a body that rules itself out and stops walking a body at the first call that rules it out; verdicts are unchanged. `TestPlainFunctionStopsAtItsOwnBody` pins it: deciding the last of 50 throwing functions decides only that one (before the fix, all 50). What remains of the first-diagnostics gap is parsing the effect root's declaration files (55% of the server's CPU in a 400-module session).

### Cold start through the loaders

`scripts/bench/register.mjs` measures what `vibelang/register` spends compiling when a program loads `.vibe` modules from many workspace packages, each with its own `tsconfig.json`, and nothing is cached yet:

```sh
sh scripts/build-vibelang.sh
node scripts/bench/register.mjs --runs 3
```

It writes 12 packages of 24 `.vibe` modules, each beside an Effect TypeScript module, where each package calls the one below it through its package name, and times one `vibelang -p --noEmit` of the top package (`check`, every package checked once), a one-module package's compile (`start`), and `node --import vibelang/register` with an empty cache (`cold`) and again with that cache (`warm`). It fails when `(cold - warm - 12 * start) / (check - start)`, the hook's compile time in checks of the workspace, exceeds `4.5`. Each run needs `check > start`, `cold - warm >= packages * start`, and a finite ratio. Otherwise it exits with status `1`, reports an inconclusive sample with all four phase times, and asks for a rerun on a quiet host; an unusable run cannot pass the budget through a negative ratio or `NaN`.

`--packages` must be a safe integer of at least `2`; `--modules` and `--runs` must be safe integers of at least `1`. `--budget` must be finite and nonnegative; `0` is allowed. Invalid numeric options exit with status `2` before setup creates the output directory, so a fractional count cannot generate a mismatched workspace and `NaN` cannot silently disable the budget check.

Measured 2026-10-28 on the build server under a load of 22 to 33 (medians of 3 runs, two rounds each):

| | cold | warm | ratio |
| --- | ---: | ---: | ---: |
| `main` at `cf8cede6` | 9.9 to 10.3 s | 1.0 to 1.1 s | 7.0 to 8.0 |
| A loader's compile checks only its own files | 6.2 to 6.3 s | 1.1 s | 2.4 to 2.8 |

A compile that checked the source of every package its program imports checked the top package's whole chain, then the chain below it, and so on: about 6.5 checks of the workspace at 12 packages. Each compile now checks its own files, and still parses and binds every package below it for their types, so the ratio keeps growing slowly with the depth of the package graph. In the Smithers migration that reported it, a program that loads 22 workspace packages took 29 to 43 s to start cold on the build server, against 10 s without VibeLang, and 20 to 25 s after the fix. The compiler's own time for its 22 projects fell from 24 s to 12 s, which splits into about 5 s parsing, 4 s checking, 2 s binding and 1 s emitting. Sharing parsed declaration files across a process's compiles, as `vibelang -b` does, is what remains.

Region lowering preserves the enclosing function's `arguments`, including through `using`, block-owned forks and lowered arrows (case `arguments-through-regions`). The LSP smoke suite verifies `serverInfo.name === "vibelang"` and the compiler version.

