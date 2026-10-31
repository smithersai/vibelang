# The migrate flow: an Effect TypeScript codebase to VibeLang

The migrate flow moves an existing Effect TypeScript codebase to idiomatic VibeLang the way a codemod would: in small planned batches, mechanically wherever a rule can do the work, with an agent only where none can, and gated on the target's own tests and public API. Every run also produces the list of what the codemod could not do and what VibeLang got wrong, which is how the next run gets better.

```text
upgrade-effect ──▶ setup ──▶ plan ──▶ for each batch: codemod ──▶ compile ──▶ repair ──▶ verify ──▶ record ──▶ report
(no model)        (no model) (agent)                 (no model)  (no model)  (agent)    (no model) (no model)  (no model)
```

| Step | Model | What it does | Writes |
| --- | --- | --- | --- |
| upgrade-effect | none | Installs and runs the target's tests as they are; moves `effect` and every `@effect/*` package on Effect's major line to the exact version the VibeLang runtime requires, wherever the repository declares it (dependencies, catalogs, overrides), with overrides that keep one copy installed, written to every overrides table the repository declares (`pnpm-workspace.yaml`'s, `package.json`'s `overrides` and `pnpm.overrides`; with none, the package manager's) in the quoting of the entries beside them; moves each `name@version` selector and patched dependency that names an old version to the new one (pnpm's `minimumReleaseAgeExclude`, `allowBuilds` and `patchedDependencies`, renaming a patch named for the old version and carrying its `package.json` hunks); in a repository VibeLang already set up, moves the `vibelang`, `vibelang-runtime`, `vibelang-vite` and `vibelang-unplugin` it depends on to this run's release, which requires that Effect, with `.vibelang-toolchain/` in `.gitignore` for a staged toolchain, and carries each patched dependency that names an old VibeLang version: one the new release already contains goes with its patch file, one that still applies moves to the new version, and one that does neither stops the step (`vibelangPatches` in `upgrade-effect.json`); installs and runs the tests again; commits the upgrade alone, before any VibeLang change. Separately versioned tools such as `@effect/tsgo` keep their versions, and an Effect peer range keeps its operator; VibeLang peer ranges and optional peer metadata stay as written, including when installed dependencies move to staged tarballs In a repository an earlier run migrated, it first runs the installed `vibelang --fix --fix-vip-only` on each project with a tracked `.vibe` file, so the compiler that wrote those modules applies its VIP migrations before the new one replaces it, and the commit carries them. | `upgrade-effect.json`, `baseline/upstream-tests.json`, `baseline/upgraded-tests.json` |
| setup | none | On the upgrade's commit, sets VibeLang up in the repository's own packages, the root and each workspace member, leaving a vendored tree that no workspace names as it is, and every Git submodule too: a commit cannot hold a submodule's edits, so a package the run names inside one is left with a warning (dependencies, `tsc`, `tsgo` and `tsrs` to `vibelang` in scripts, the `vibelang-vite` plugin, `vibelang()` from `vibelang-unplugin/bun` in each `Bun.build` of a package that reaches a migrated one, in its scripts and sources, and `vibelang()` from `vibelang-unplugin/esbuild`, last in the plugins, in each esbuild `build` and `context` call in the scripts and sources of such a package (an options object, a const or local helper that gives one, spreads of literals; a warning names the file and line of a call it cannot edit, a `buildSync`, or an esbuild loaded with `import()` or `require()`), never in a test, a fixture or a file only tests import, which keep every byte (decided detail 272) and get a warning when they bundle, `rewriteRelativeImportExtensions`, a `.vibe` include pattern beside each `.ts` one (`src/**/*.vibe` beside `src/**/*.ts`) in each package's tsconfigs, `allowArbitraryExtensions` in every tsconfig that extends none of the repository's others, `*.d.vibe.ts` in `.prettierignore`, `**/*.d.vibe.ts` in the Oxlint configuration's `ignorePatterns`, in each `dprint.json`'s `excludes` and as the first entry, `{ ignores: ["**/*.d.vibe.ts"] }`, of each ESLint flat configuration (a warning names one it cannot edit), VibeLang's dprint plugin in each `dprint.json` unless that configuration pins every plugin by checksum, where the dprint scripts it governs run `vibelang-format` after dprint instead (with a warning), and, under pnpm, `dprint` in `allowBuilds` in `pnpm-workspace.yaml`; `preload = ["vibelang/bun"]` under `[test]` in the `bunfig.toml` of a test command that runs `bun test`, and of every package that runs `bun test` and reaches a migrated package through workspace dependencies, and at the top level of the `bunfig.toml` of each such package where a script runs a program under Bun, `bun file` or a bin such as `bun alchemy-test`, which `[test]` does not reach; Knip's compiler for `.vibe`, `vibelang/knip`, in a `knip.config.ts` that keeps a JSON configuration's settings); installs; formats the `.vibe` files the repository already has in its own packages with `vibelang-format`, since its format check now reads them; runs the tests as the baseline, compared with the upgraded tests; checks each package with `vibelang`; emits its declarations; inventories every source file and the local modules it imports, by a relative path or through its package's tsconfig `paths` alias (`~/main`), resolved as TypeScript does; runs `vibelang agents init`, so the target's coding agents get the VibeLang skill, the language server and a check after each edit; commits | `setup.json`, `baseline/`, `inventory.json` |
| plan | one agent call | Orders the Effect files into small batches, leaves and tested modules first, each with a reason; the answer is validated before anything reads it | `plan.prompt.md`, `plan.draft.json`, `plan.json` |
| codemod | none | First moves a batch module's platform code, each top-level declaration that uses a Node or Bun builtin imported as a value, with the module's own declarations it reads, verbatim into `<Name>.platform.ts` beside it (EK4402's fix: "move the code into a sibling `.ts` module"); an export that moved stays in the module as a function with the same written signature that calls the moved one, so the module's declarations are unchanged, and a module whose moved exports are not such functions keeps its platform code (`platform` in `codemod.json` lists both, and `revert` removes the sibling). Renames the batch to `.vibe`, points each package's `exports`, `imports`, `main`, `module` and `types` at the renamed modules (a `types` field or condition at the declaration sidecar `x.d.vibe.ts`, every other target at `x.vibe`, and a bare entry at both, `{ "types": "./x.d.vibe.ts", "default": "./x.vibe" }`, since stock TypeScript names a consumer's inferred type only through a target that is the sidecar; a pattern such as `"./*": "./src/*.ts"` gains an exact entry for each, and revert takes it back), rewrites imports by VibeLang's rules, runs `vibelang --fix` until it fixes nothing, keeping the rewrites of the batch's files only (an earlier batch's committed files stay as committed), and records each rewrite it applied or refused | `batches/NN/codemod.json` |
| compile | none | `vibelang --noEmit`: the batch's diagnostics and any error new against the baseline | `batches/NN/compile.json` |
| repair | agent | Fixes what is left and finishes the idiomatic rewrite, with `context.md` as its system prompt; records codemod gaps, VibeLang issues and idiom lessons; returns a file it cannot migrate to `.ts` | `batches/NN/repair.prompt.md`, `repair.json`, `issues.jsonl` |
| verify | none | The tests pass with no new failure and no missing test against the baseline, each test matched by its name with any date it prints (`Date#toString`, `toUTCString`, an ISO timestamp) set aside; published declarations remain byte-identical, new private declarations are listed as `addedPrivate`, and older baselines without public-surface metadata retain the canonical comparison (comments, member order, redundant type parentheses, and relative source/emitted names proven to identify the same declaration module), and their emit reports no error in a migrated file, since a baseline that fails the same way (`TS7056`) makes equal declarations prove nothing; the batch has no error, no EK48xx but EK4832, no EK4402 and no EK9204 | `batches/NN/verify.json` |
| record | none | Commits the batch with jj, naming its files, with o200k token counts before and after | `batches/NN/record.json` |
| report | none | Batches, tests, declaration identity, tokens, codemod gaps, issues and idiom lessons | `report.md`, `report.json` |

Setup also rewrites compiler commands in the root package, even when the run names only leaf packages, and installs the compiler there. Each command keeps its working directory, project arguments, flags and surrounding commands: `tsrs -b` becomes `vibelang -b`, and a separate `tsrs --noEmit -p tsconfig.test.json` keeps that project. The existing solution references decide what gets built; setup does not add shared base configs as source projects. A base config with no `files` or `include` has an implicit repository-wide include and can check excluded tests, demos and submodule sources under the wrong options.

Setup warns with the file and line when a string source-extension allowlist includes `.ts` but omits `.vibe`. It checks arrays and `Set` initializers in the repository’s own source and configuration files; comments, code embedded in strings and vendored packages are excluded. Review the collector, include native sources and exclude generated `.d.vibe.ts` sidecars. These warnings appear in `setup.json` under `wired.warnings`; setup leaves the allowlists for the repository to configure.

### Test and fixture identity

Decided detail 272 keeps tests and fixtures as the migration's oracle. Each batch's `verify` compares pinned jj trees from before setup through the current batch, using the flow's test-file detection and fixture directories. Adding, deleting or renaming a test or fixture fails. Changed TypeScript files are parsed with the TypeScript AST; every byte outside the permitted literal or selector must stay unchanged, including embedded configs and setup. Source-text assertions remain protected.

Exactly five edits are permitted:

- A module-path literal in an `import`, `export … from`, `import()`, `require()`, `vi.mock()` or `jest.mock()` may name the same migrated module with its new extension: `.ts` to `.vibe`, `.tsx` to `.vibex`, or the project's `declarationImportStyle` spelling. Call path arguments may also be parenthesized literals or templates without substitutions. The rename map must correspond to files actually removed and added in the snapshots.
- A file selector may gain the matching VibeLang extension and exclude `*.d.vibe.ts`. Its selected paths, mapped to base names, must have exactly the same count and names before and after. A widening that adds or drops one file fails, even if the target's tests still pass.
- A path literal may change `.ts` to `.vibe` or `.tsx` to `.vibex` only when both pinned inventories resolve it uniquely to the rename map's source and destination. Relative and repo-rooted paths, static `path.join`/`path.resolve` fragments based on `__dirname`, `import.meta.dirname` or a constant repository root, and `new URL(…, import.meta.url)` qualify. A dynamic base is rejected as `not statically resolvable`. Reads through `readFile*`, imported aliases, `fs.promises` and `Bun.file(...).text()` are traced through local aliases and expressions; asserted source text, callbacks and unknown text consumers are refused with `keep .ts, send to migfix`. An edited expected path is also refused.
- An expected dependency list or object in an equality assertion may gain exactly one `"vibelang-runtime"` entry, only when the test's nearest owning `package.json` gained it in `dependencies` between the pinned trees. Object entries must use the actual new version. Every existing token and comment in the collection is preserved; an extra name, removal, duplicate entry, version change, negated assertion or change to another part of the assertion fails. The report lists these separately under `assertion edits`.

A test already present as `.vibe` in the baseline may also take formatter-only changes. The native VibeLang parser must parse both snapshots successfully, and their ASTs with locations and trivia stripped must match. Their token streams must also match, retaining comments in position with only internal comment whitespace normalized. Only whitespace, trailing commas and statement-terminating semicolons may differ; parentheses, empty statements and `for`-head semicolons remain protected. This allowance does not cover fixtures or newly converted tests. The report lists the proof separately under `formatter-only`. A missing parser or an unsupported parse fails the batch.

For `import.meta.glob`, the verifier uses the target Vite installation's own `tinyglobby` or `fast-glob`, with Vite's selection options. Literal patterns and pattern arrays, `exhaustive` and `caseSensitive` use the installed Vite transform's selection rules. Its literal matcher flags are read with the TypeScript AST; unsupported dynamic flags fail with a reason rather than guessing engine defaults. A distribution that bundles its glob engine without a separately loadable module is refused; the verifier never substitutes another package's Vite. Rooted patterns require an explicit repository-relative tool root (`test.globRoot` in the run's `config.json`); absolute roots and paths leaving the snapshots are refused; aliases and a custom `base` option require a root resolver and are refused. A `readdir` or `readdirSync` filter is evaluated directly over each tree's directory entries, relative to the configured test working directory. Only synchronous, non-generator callbacks with one plain filename parameter qualify. Supported predicates combine `endsWith` extension checks or extension regexes with `&&`, `||` and `!`. A named regex must be confined to that selector. No target code is executed; dynamic directories, mutable or shadowed bindings and other unsupported expressions fail with a reason. Locally declared loader or reader names must be standard imports (such as `vi` from `vitest` or `readdirSync` from `node:fs`); custom wrappers are refused. Same-spelled declarations in different scopes are treated as ambiguous.

Each batch writes `batches/NN/test-diff.json` and `test-diff.md`: every changed test or fixture, each permitted or forbidden edit, and every set check's counts and names. `record` repeats this check after formatting and sidecar emission, immediately before committing. `record --force` cannot waive it. Revert a forbidden edit and leave its module TypeScript when necessary.

The run's `report.md` and `report.json` include these proofs. Use `pr-body.md`, generated by `report`, in the migration pull request body so every touched test or fixture and its result is reviewable; the flow never posts it.

Declaration-only snapshots disable `sourceMap`, `inlineSourceMap`, `inlineSources` and `declarationMap` together, including values inherited through `extends`. They leave the target's configuration intact and still require successful emission and the published declaration identity check.

Declaration identity applies only to published packages. `verify` reports a package marked `"private": true` as `declarations: "not published"` and skips its declaration emit and comparison; its tests, compiler errors and style checks still gate the batch. The repository’s build, workspace typecheck, lint, format and Knip gates still apply.

Each step reads and writes the run directory, so a step that already recorded its result returns it, and a stopped run resumes where it stopped.

Before changing the target, `codemod` atomically writes and flushes
`batches/NN/codemod-state.json`: original source bytes, planned renames,
package exports and import edits. It replays interrupted mechanical edits
without overwriting a conflicting file. Before starting the compiler it
records the `fixing` phase, then each compiler attempt and project progress;
attempt logs have distinct names. Retrying the same run preserves already
renamed modules and checked hand repairs and runs the current compiler to a
fixed point. Only the completed `codemod.json` advances the flow. `revert`
can use the saved original and import/export bookkeeping before the compiler
finishes, even if the parent commit no longer contains the TypeScript source.
Keep the run directory private: its journal contains original source bytes.
Runs interrupted by an older flow before any journal was written still need
a fresh run from their saved TypeScript sources; no receipt is inferred.

For a migrated `.mts` module, declaration identity pairs a removed `x.d.mts` with its new `x.d.ts`, recorded under `renamed`. A destination already present in the baseline is a collision; a change in public reachability still fails. Published declarations remain byte-identical, including comments and quote spelling.

Public declarations reachable from `exports` or `types` must remain byte-identical; unreachable new declarations pass as `addedPrivate`. One difference is excused: a relative module specifier whose two spellings stock TypeScript resolves, under Bundler and Node10 resolution and in both trees, to the same listed declaration file, such as `export * as Runtime from "./runtime"` declared as `"./runtime.js"` once the codemod names the migrated module `./runtime.vibe`. `verify.json` lists each excused pair under `excusedSpecifiers` (package, file, line, before, after); copy the list into the pull request's description. Shipped hand-written `.d.ts` roots outside the compiler output are copied into each run's declaration snapshot and resolved through the package's actual output aliases. Their bytes, transitive reachability and resolved dependency edges stay part of the public comparison; a new file that shadows a directory index is public. Legacy runs recover those roots from their committed setup tree, never from candidate files. An unresolved root remains conservative even if it is unresolved on both sides. The gate follows declaration imports, re-exports, import types and reference paths, including conditional and wildcard entry points. Removed declarations still fail. Setup snapshots the published roots and emit aliases; unresolved entry points and older baselines without a snapshot conservatively check every addition. Verification reports the roots and unresolved paths.

The diagnostic reader accepts compiler output with `LF`, `CRLF`, or mixed line endings, preserving diagnostic codes, source locations and repair notes. A nonzero compiler exit with ordinary diagnostics is an error result; a crash, signal, or failing exit without diagnostics stops the step.

Every install the flow runs also rewrites each other lockfile at the repository's root, which the package manager's install leaves stale: `bun install --lockfile-only` for a `bun.lock` or `bun.lockb` beside `pnpm-lock.yaml`, and `npm install --package-lock-only --ignore-scripts` for a `package-lock.json` beside another manager's lockfile. A `--install` command replaces all of it.

Upgrade-effect, setup and record run the target's own formatter on the files they wrote or the batch changed, other than `.vibe` files, sidecars and lockfiles: the tool its root `package.json`'s format scripts run (`oxfmt`, `vp fmt`, `prettier`, `biome format`, `dprint fmt`), else one it installs. The target's format check then passes on them. Record then runs the target's `vibelang-format --write` on the batch's `.vibe` files, because `vibelang --fix` does not format what it rewrites and a format check covers them.

Record resolves jj's compact rename summaries to destination paths before formatting. Literal braces in shared prefixes, suffixes and filenames stay intact; rename and copy records retain their original path as `from`.

The ESLint bridge counts type-query reads for `no-unused-vars` as Oxlint does, including `declare const` symbol brands used only through `typeof`. Rule options and unused-variable diagnostics remain active. Its real-linter regression and 60-run property use `VIBELANG_UNUSED_ORACLE_NODE_MODULES` for Oxlint and the compiler package's installed ESLint test dependencies.

The ESLint bridge retains Oxlint `ignorePatterns` in their original order, including directory patterns, rooted paths, brace and source-extension globs, and negations. Patterns remain relative to the lint command's working directory. A `.ts`, `.mts` or `.tsx` file pattern also covers its migrated `.vibe` counterpart; ignored modules stay ignored and visible siblings stay checked. Set `VIBELANG_LINT_ORACLE_NODE_MODULES` to a directory containing `eslint`, `oxlint` and `espree` to run the real-linter property comparisons.

For tests that bundle a package's sources through Rolldown or Vite's bundled config loader without a native plugin, pass `--emitted-project packages/plugin/tsconfig.build.json` to `upgrade-effect` (repeat per project). Setup writes exact private `#vibelang/emitted/…` imports, with `vibelang-source` for compiler builds, `types` for type checkers and `default` for the JavaScript the package's existing build produces. It enables the source condition in the package's compiler projects so cold builds do not need sidecars. No tests, fixtures, test scripts or public exports change, and no build step is added. The project must already run from `build` or `prepare` and emit individual JavaScript files. `wired.emittedImports.modules` records the exact source/output set. For published packages, setup compares declaration bytes before and after and rolls back the wiring if they change. Run the real Rolldown/Vite regression and the emitted-JavaScript property with `VIBELANG_EMITTED_IMPORTS_ORACLE=1`, a built compiler and installed Vite test dependencies.

Reverting an importer and its dependency restores their original TypeScript specifiers in either order. Recorded import edits follow a restored importer back from its `.vibe` path; a still-native importer continues to name the explicit source file.

### Restart and measurement rules for a whole-scope pass

The pass banks each completed package in `fix-bank.json` and skips it after a
restart when its source digest still matches. Dependency packages run first;
among ready packages, smaller packages run first. A successful wide settle
banks package outcomes, kept modules and return causes in `done.json`.
A config whose `--fix` timed out is recorded in the bank and receives no more
`--fix` in that pass, including after a restart. Start a new run to retry it.

Own `EK` diagnostics blame only their own module. Ordinary type errors first
blame reachable migrated modules whose declaration differs from the baseline;
when none can be distinguished, settle widens to the reachable set. Dependency
roots are returned first and every return is checked. Missing declaration
evidence is treated as suspect. Both baseline and candidate declaration emits,
including sidecar checks, use `--singleThreaded`.

A statically resolved path string follows its renamed module in tests and
sources (detail 272 addendum 4). Relative paths, package-relative paths and
`new URL("x.ts", import.meta.url)` are resolved; bare names are resolved only
with `__dirname` or `import.meta.dirname`. An unknown directory or URL base
does not identify a module. Comments and prose strings stay as written.
`vi.mock` and `require.resolve` name modules. A module whose source text a
test reads stays `.ts`, with the reader recorded as its deferral cause.

Pass `--after-convert "<command>"` to `upgrade-effect` (repeat per hook).
The run stores these repository adapters in `config.json` and runs them before
every settle check and verification, including the final verification after
record formats the files. Use hooks for generated bundles and repository
build-graph paths; the flow contains no repository-specific adapter.
A failed hook stops the step and preserves its log in the run.

Whole-scope verification measures the candidate against both the previous
commit and the repository's main, in one measurement job. Main resolves from
`main@origin`, `main@github` or `main`; `--main <revision>` selects it
explicitly. Temporary jj workspaces use each revision's dependencies and are
removed afterward. The candidate must also pass the setup baseline.
Vitest JSON, Node's spec reporter and Bun's per-test output are read and
checked against their summaries. Zero tests, missing reports, contradictory
counts, unexplained exits, newly skipped passing tests and missing tests fail
admission. No exit-only fallback or automatic flaky rerun is used here.
Custom `--test-report` output must also print
`SUMMARY total=N passed=N failed=N skipped=N`.

For a box provider, set `--measure-command "<adapter>"`. The adapter receives
`VIBELANG_MEASURE_MANIFEST` and `VIBELANG_MEASURE_COMMAND`; it must run all
three sides in one box job, remapping paths as needed, and return
`receipts.json` to the manifest's output directory with the same job ID.
The manifest includes each side's target, revision and install command.
Separate jobs for different sides do not measure comparable green results.
The run retains raw per-side logs, normalized receipts and `comparison.json`.
`record` repeats verification after formatting and regeneration; `--force`
cannot bypass this whole-scope gate.

The style gate retains advisory `EK4804` when the compiler identifies the global `Error` and the enclosing native function writes `!Error` matching that function’s original declaration. `compile.json` records each decision under `styleExemptions`, with the declaration path and reason. Missing or ambiguous declarations, unwritten or changed failure types and shadowed `Error` names retain the warning as a style problem; real TypeScript-style Effect forms remain rejected.

## Run it

Every batch lands on a jj bookmark, `vibe` unless `--bookmark` names another: upgrade-effect starts it on the default branch (`trunk()`, or `--base <branch>`, such as `dev`, which restarts a bookmark an earlier run left elsewhere), or continues an earlier run's `vibe`, and each recorded batch is one commit on top of the last. The first two commits are the Effect upgrade and VibeLang's setup, so a reviewer reads the dependency upgrade, and any test it breaks, apart from the migration. The flow never pushes. After each run, the orchestrator pushes `vibe` to the library's fork and opens a pull request from it there, so the migration's diff is reviewable.

Both ways need a VibeLang toolchain: a published version (`--vibelang-version 0.0.11`), or a staged build of a checkout, which runs the compiler on main before it is published:

```sh
sh scripts/build-vibelang.sh && (cd packages/runtime && bun install && bun run build) && (cd docs/tools && bun install)
node .smithers/flows/migrate/step.mjs toolchain --vibelang . --out <toolchain>
```

The toolchain holds the native compiler, npm tarballs of `vibelang` (with that compiler), `vibelang-runtime`, `vibelang-vite` and `vibelang-unplugin`, and the TypeScript compiler API that reads declarations. Setup copies the tarballs into `.vibelang-toolchain/` at the target's root, each named for its content (`vibelang-0.0.11-<hash>.tgz`), adds that directory to the target's `.gitignore`, and names them relatively from each package (`file:../../.vibelang-toolchain/vibelang-0.0.11-<hash>.tgz`), so no commit names a path on the build host. Every build of one version packs to the same file name, and npm, Bun and pnpm can keep parts of what an unchanged `file:` specifier installed before, its files or its command links; the content's name makes a rebuilt toolchain install. Every commit the flow makes first checks the lines it adds for this machine's absolute paths and refuses them. The target must be a jj repository or a Git checkout, which upgrade-effect makes a colocated jj repository.
A `file:`, `link:` or `portal:` URI is machine-specific only when its
normalized, decoded path lies under the target, run, toolchain or home root.
Virtual editor URIs such as `file:///src/ui/message.ts` and
`file:///${path}` remain portable.

### Whole-scope conversion

Use the same run after `setup` to convert a scope in one pass. The scope file lists
one repository-relative source path per line. Every `.ts` source in it belongs to
one batch, including plain helpers and tests explicitly listed there; `.tsx`
sources stay deferred with the JSX cause. Declarations and existing `.vibe`
sources are recorded as deferred rather than renamed. A missing or escaping path
fails planning.

```sh
step="node .smithers/flows/migrate/step.mjs"
$step plan --run <run> --scope <scope.txt>
$step rename --run <run> --jobs 8
$step fix --run <run> --jobs 8 --timeout 3600 --rounds 4
$step check --run <run> --jobs 8
$step settle --run <run> --jobs 8 --rounds 12
$step verify --run <run>
$step record --run <run>
```

Each command uses only the run's target, packages and toolchain. Before
`rename`, every configured project and every project named by a package's
`typecheck` or `typecheck:tsc` script is checked into
`onepass-baseline.json`. A solution's source projects are expanded.
`rename` records the whole batch's renames, exports, relative import
specifiers and non-import path references (scripts, build entrypoints and
configuration) in `batches/01/codemod.json`.

`fix` processes dependency packages first, with at most `--jobs` concurrent
packages (maximum `8`); related packages never fix concurrently, and dependency
cycles run serially. Each project runs `--fix` to a fixed point. Projects above
`240` modules fix the selected sources and their dependencies in directory-packed,
transitive import-closed shards,
each at most `240` modules, using temporary projects that extend the original
options. Unselected roots remain in the full-project checks. Even a single
selected shard uses a temporary project when the full program is above the cap.
A closure larger than that cap stops with its file and size instead of
running an unsafe shard. Temporary projects are removed after failure too.
`--timeout` bounds each compiler invocation in seconds. A timeout, compiler
crash or exhausted fix limit fails the command and keeps timing, project, shard
and error receipts in `codemod.json` and `progress.jsonl`.

`settle` checks every project again and groups a failing module's diagnostics
by family in `settle-causes.json`. It returns dependency roots first, through
healthy intermediate importers and cycles, then checks again before deciding
whether an importer also needs to return. New errors in TypeScript importers
are traced to migrated dependencies only after own errors have been retried.
An unrelated or unattributed error stays visible and blocks completion.
`settle.json` records each round, causes and remaining diagnostics. The
command prints `SETTLED` and exits successfully only after a complete check
finds no migrated-module error or style violation, no new TypeScript error
beyond the per-project baseline, and no crash or global failure. An exhausted
round limit prints `NOT SETTLED` and exits unsuccessfully.

Bulk rollback uses repeated `--file` options:

```sh
$step revert --run <run> --file <a.vibe> --file <b.vibe> --reason "<cause>"
```

Every request is validated before the first restore. Each original `.ts`
must return, its `.vibe` and sidecar must disappear, and exports, recorded
paths and every importer's specifiers follow the restored source. Missing or
already reverted modules fail loudly. The library exposes the same operation as
`steps.revertMany({ run, batch, files, reason })`; `files` can also contain
`{ file, reason }` entries.

The existing flow uses this path when `plan.json` has `mode: "one-pass"`:
`codemod` runs `rename` then `fix`, and `repair` runs `settle`.
The target's test, declaration and style gates still run in `verify` before
`record`. A clean settle alone does not prove those gates passed.

### Registry versions

Once VibeLang publishes the version a migration needs, use the registry instead of a staged toolchain: start the run with `--vibelang-version <version>` in place of `--toolchain <dir>`. Setup then writes exact versions (`"vibelang": "0.0.12"`) and makes no `.vibelang-toolchain/`. Anyone can install the result, and the fork's pull request no longer depends on the tarballs.

To switch a target that a staged toolchain set up, start a new run on it with `--vibelang-version`. Upgrade-effect continues on the `vibe` bookmark, and commits only when the version needs another Effect. Setup then replaces the three `file:` specifiers with the version, deletes `.vibelang-toolchain/` and its `.gitignore` line, reinstalls, records a new baseline, and commits the switch on top. The batches already on `vibe` stay as they are.

### Step by step

Each command prints its result and the next step. A person, or an agent session driving the run, answers the two agent steps:

```sh
step="node .smithers/flows/migrate/step.mjs"
$step upgrade-effect --run <run> --target <repo> --package packages/core --test "pnpm exec vitest run" --test-cwd packages/core --toolchain <toolchain>
$step setup --run <run>                       # reads the run's options
$step plan --run <run>                        # writes plan.prompt.md and a deterministic draft
$step plan --run <run> --accept <answer.json> # validates and records the plan
$step codemod --run <run>
$step compile --run <run>
$step repair --run <run>                      # writes batches/NN/repair.prompt.md; do the repair it asks for,
                                              # checking with compile --no-record and verify as you go
$step repair --run <run> --done               # checks issues.jsonl and records the repair
$step verify --run <run>                      # a failure sends the batch back to repair
$step record --run <run>
$step report --run <run>
$step next --run <run>                        # what to run next
```

`--agent "<command>"` on `plan` or `repair` runs an agent instead: the command gets the prompt on stdin and its path in `MIGRATE_PROMPT`, runs in the target's root, and for `plan` writes its JSON answer to `MIGRATE_OUTPUT`. Any coding agent with a non-interactive mode fits; the flow has no code for any particular one. `revert --file <path.vibe> --reason "<text>"` returns one file to its `.ts` source, and points every import the codemod rewrote to `.vibe` back at the `.ts` file: a file of the current batch, or one an earlier recorded batch migrated, which comes back as it was before that batch, in the current batch's commit.

Directory imports with a trailing slash keep the selected index module when the flow adds its source extension: `./runtime/` becomes `./runtime/index.vibe` in a `.vibe` importer.

Every TypeScript checker of the repository reads the migrated modules: each `vibelang` compile of a migrated package writes `x.d.vibe.ts` beside `x.vibe`, and the batch commits it with the module. Stock `tsc`, `tsrs`, `bun check` and TypeDoc resolve `./x.vibe` to it under `allowArbitraryExtensions`, so the codemod writes that name in every `.ts` importer, for `./x.js` and `./x.ts` alike, including extensionless `./x` file and `./dir` directory imports and a tsconfig `paths` alias such as `@/x` (read with TypeScript's config reader, so `extends` and `baseUrl` apply), which becomes `@/x.vibe`, in every source file the repository tracks, the module's tests and other packages included, and `revert` takes it back there too; `vibelang` emits and declares it as `./x.js`. When an original import was extensionless, declaration comparison accepts the emitted `.js` spelling only when stock TypeScript resolves both names to the same listed `.d.ts` module inside their declaration tree. Explicit extensions, external names, missing targets and changed modules or types remain distinct. They read only the sidecars, so a `.vibe` file's type errors are reported by `vibelang`, which every migrated package's scripts run. `revert` puts back each importer's original specifier and deletes the sidecar. A specifier in a comment stays as written: declaration emit copies a doc comment.

When an Oxlint config's `jsPlugins` names a package the run migrates, setup preloads `vibelang/register` (`NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register"`, as for Vite configs) in every package script that runs Oxlint, `oxlint` or `vp lint`, and in that package's test scripts, whose RuleTester spawns Oxlint: Oxlint's plugin host is Node, which loads the plugin's `.vibe` modules only through the loader. Like the Vite wiring, the prefix needs a POSIX shell.

Setup adds the `vibelang-vite` plugin to the Vite or Vitest config the tests load, as `vibelang({ register: true })`, so a `node` or `bun` process a test starts on the sources, such as a command-line program, loads `.vibe` modules too; a config that already has the plugin gains `register: true` in its options unless it sets `register`. When the test command, or the package script it runs (`pnpm test`), names one with `--config`, such as a monorepo's shared `../../vite.config.ts`, setup wires that file, and the package that owns it gets `vibelang` and `vibelang-vite` as dev dependencies. Otherwise it wires each package's own config. It then adds the plugin to every other Vite or Vitest config that bundles migrated sources: each config in a migrated package, or in a package that depends on one through workspace packages (`"foldkit": "workspace:*"`), such as an app's, an example's or a website's, so their builds and dev servers load `.vibe` modules too. Configs under `templates/`, under a directory whose name contains `fixture`, or under a package's `test`, `tests` or `__tests__` directory are left alone, and a config whose shape the edit does not know, such as `defineConfig(() => ({ ... }))`, is named in setup's warnings for a person to wire.

When a Vite config's runtime import graph reaches a `.vibe` module or a selected source directory that setup will migrate, setup also wires its `vite` package scripts with `NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register"` and `--configLoader native`. This applies before config evaluation, including imports through helpers and re-exports; the application still uses `vibelang()`. Existing `NODE_OPTIONS` are retained, and rerunning setup does not duplicate the preload or flag. Type-only imports and unrelated commands stay as written. A config without a matching script produces a warning with the required settings. For direct invocations, use `NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" vite build --configLoader native` (and the same for dev or preview). Native loading uses Node's ESM resolution: config helpers need explicit source extensions and package exports instead of `tsconfig.paths`; their `.vibe` files need a project that includes them. A setting inside the config cannot select its own loader. See the [Vite guide](../../../docs/user/src/setup/vite.md#when-the-vite-config-imports-a-vibelang-module).

A package whose tsconfig is solution-style, `"files": []` with `references`, stands for the projects it references: setup wires each of them, and every check, `--fix` run and declaration emit goes over each, its declarations in a subdirectory of the package's own. `upgrade-effect` takes the run's options, which setup and the later steps read from the run: `--base` and `--bookmark` (above), `--package` and `--source` more than once, `--tsconfig` (default `tsconfig.json`, the project the tests check), `--dts-tsconfig` (default `tsconfig.build.json` when it exists: the project whose declarations are the public API), `--install`, `--test-report <pattern>` for a test runner without Vitest's JSON report, a regular expression whose named groups `name` and `status` read each test's printed line (so a baseline with failures, such as tests that need cloud credentials, is compared test by test rather than by exit status), `--no-wire` for a target that already has VibeLang, `--max-files` and `--max-lines` per batch (6 and 900), and `--allow-dirty`.

### As a Smithers flow

`flow.ts` declares the same steps as durable actions of `Flow.make("migrate", ...)`. One execution upgrades Effect, sets the run up and plans it the first time, then migrates the next batch and reports; the next execution migrates the batch after it. `run.ts` runs one execution on the in-memory engine:

```sh
MIGRATE_AGENT="<agent command>" bun .smithers/flows/migrate/run.ts --run <run> --target <repo> \
  --package packages/core --test "pnpm exec vitest run" --test-cwd packages/core --toolchain <toolchain>
```

The agent steps read `MIGRATE_AGENT` through Effect `Config`; without it, they fail with the prompt to answer, and the standalone steps take over from there. The agent is a command, not `@smthrs/agent`: a repair edits files and runs the target's compiler and tests in its repository on a build host, which a coding agent's non-interactive mode does today, and this repository's `.smithers` composes no model seat for `AgentAction`. A test supplies a scripted command.

## The idiom context

`context.md` is the repair agent's system prompt. `build-context.mjs` generates it, so it is never edited by hand:

- `rules.md`, this flow's own rules: the current call rule (a call runs where it stands; only a function literal defers it), every VibeLang form, wrapping Effect mindfully, platform access only through services, Effect's modules or `Experimental.*`, hatches only for real Promise and callback libraries, identical declarations, every test kept.
- The VibeLang skill, `packages/compiler/skills/vibelang/SKILL.md`.
- The convert flow's cheat sheet and worked examples (`../convert/`).
- The platform globals table, `docs/user/src/platform/platform-globals.md`.

```sh
node .smithers/flows/migrate/build-context.mjs           # write context.md
node .smithers/flows/migrate/build-context.mjs --check   # fail when it is stale
```

## Each run improves the next

A run's `issues.jsonl` is the input to the loop that improves the flow. The repair agent appends one entry per lesson; upgrade-effect and setup append one when the Effect upgrade or setting VibeLang up breaks a target test before any file moves, and still finish, so no batch is blamed for it. A runner without per-test results, such as `bun test`, is compared by its exit status, and the issue names the logs from before and after.

| Entry | Where it goes |
| --- | --- |
| `codemod-gap`: a rewrite made by hand that a rule could make (`pattern`, `before`, `after`, `count`) | A `--fix` rule in the compiler: a quick fix for the diagnostic (`typescript/tsc/internal/vibelang/tsforms_*.go` or `lsrules_fixes.go`), its code in `tsFormFixCodes` when it is safe, and a case in `typescript/vibelang/cases/` with the before and after. The next run's codemod applies it. |
| `idiom`: a lesson the context did not teach (`lesson`, `before`, `after`) | One line in `rules.md` (or the skill, when it is about the language rather than migrating), then `node build-context.mjs`. |
| `issue`: a VibeLang bug or missing feature (`title`, `repro`, `expected`, `actual`, `files`) | A VibeLang issue with the reproduction, fixed with a test. The blocked files stay `.ts` until it is fixed; the next run's plan picks them up. |

`report.md` lists all three, with the rewrites `--fix` applied and refused, so a run's report says which rule to write next.

### What `--fix` rewrites

| Effect TypeScript | `--fix` writes | Code |
| --- | --- | --- |
| `Effect.gen(function* () { … })`, as a value or the whole body of an arrow, a function or a method; `Effect.fn(function* (…) { … })`, `Effect.fn("name")(…)`, `Effect.fnUntraced(…)` | `effect { … }`, `effect (a) => { … }`, `effect function f(a) { … }`; a span as `try Effect.withSpan(effect { … }, "name")`. `yield* e` becomes `try e`, `try e.asEffect()` for a Yieldable, or `throw e` for an error in a statement; a held program `const p = load()` becomes `const p = effect { return try load() }`; a generator's `throw` becomes `return try Effect.die(e)` | EK1002 (D470) |
| `x.pipe(Effect.map(f), Effect.asVoid, stage)` whose receiver is an Effect or with a stage of `Effect` | `x \|> Effect.map(%, f) \|> Effect.asVoid(%) \|> stage(%)` | EK4502 (VIP-23) |
| A program a module holds, `export const p = load("x")`, in a variable, a field or an element | `effect { return try load("x") }` | EK1001 (VIP-2) |
| `Option.gen(function* () { const a = yield* maybe; return a })` with statement-position Option yields | An eager plain function body, checking each yielded Option once, returning its `None` early or a fresh `Some` on success; nested expressions, functions and `try`/`finally` keep a refusal | EK1002 (foldkit-36) |
| `Option.match(v, { onNone, onSome })` as a plain choice | `do { const $s = v; const { onNone, onSome } = handlers; match ($s) { when Option.Some(let value): onSome(value); default: onNone(); }; }`, keeping the handler object's construction and property reads before the choice; a choice returning a program keeps a refusal | EK4839 (foldkit-38) |
| `pipe(x, Option.map(make()))`, a stage whose argument is a call, a property read or an object | `do { const $input = x; const $arg0 = make(); $input.map($arg0); }`: the subject and every stage argument are evaluated first, in pipe order, then the method chain runs | EK4840 (foldkit-39) |
| `Match.orElse(({ _tag, value = fallback() }) => …)`, a default handler that destructures | `default let $v: do { const { _tag, value = fallback() } = $v; (…); }`, binding the value once and destructuring only when the default runs, so getter reads and defaults stay where they were | EK4839 (foldkit-49) |
| `Match.when(String.startsWith("Core"), …)`, `Match.whenOr("Exact", String.startsWith("Codec"), …)` | `when let $s and if ($s.startsWith("Core")): …`, and one guard joining the literal and prefix alternatives with `\|\|` (`&&` for `whenAnd`), keeping case order | EK4839 (foldkit-53) |
| `const withChoice = Match.withReturnType<T>()` passed as a stage, `Match.value(x).pipe(withChoice, …)` | the same `match` the inline hint gets, with the hint read kept before the subject (`do { const $s = x; withChoice; $s; }`) so its initialization order is unchanged; a hint whose type is shadowed at the choice keeps a refusal | EK4839 (foldkit-56) |
| `Match.value(x).pipe(Match.when(…), …, Match.exhaustive)`, `pipe(Match.value(x), …)`, `Match.type<T>().pipe(…)` | `match (x) { when …: …; default: …; }` | EK4839 (D472) |
| `pipe(x, Option.map(f), Option.getOrElse(g))`, `x.pipe(Option.…)` | `x.map(f).getOrElse(g)`, or `Option.fromNullishOr(x).map(f)` for a value that is not an Option | EK4840 (D473) |
| `type X = typeof X.Type` just before `const X = Schema.Literals([…])`, or another schema other than a struct whose every part has a type | `schema X = <type>` | EK4841 (D474) |
| In effect code, a call of a plain function of a `.ts` module or a package that says nothing about its exceptions, `Dialect.integer(sql)`, or whose `@throws` names a class the file can't reach | `try Effect.orDie(Effect.try({ try: () => Dialect.integer(sql), catch: (error) => error }))`: an exception stays the defect it was, and `E` and the declaration stay as they were. An operand that runs an Effect moves to a `const` before the statement, unless that would change what runs. Never `trusted` or `trustedPackages`: those are claims about code that someone read | EK4401 (VIP-4) |
| The same call in a function with no Effect operation | `: infer _` on the function, which stays plain, so its declaration does | EK4401 (D500) |
| `import { Array } from "effect"`, or another of Effect's modules a JavaScript global names (`String`, `Number`, `Boolean`, `Function`, `Symbol`, `BigInt`, `RegExp`) | `import { Array as Arr } from "effect"`, and `Arr.take(…)` for each use | EK4842 (D475) |
| Effect error classes, `Context.Service` classes, `Schema.Struct` constants, `Effect.Effect<A, E, R>`, a running `Effect.succeed` or `Effect.fail`, catch combinators, `Effect.withSpan`, `provide` and `provideService` | `error`, `service`, `schema`, `A!E!R`, the value or `throw`, `catch` and `match`, the block forms | EK4830-EK4836 |

Each rewrite keeps the program's meaning and type, or it is not made: the diagnostic it leaves says why in a note that starts `No quick fix:`.

#Match return-type hints keep checked type context: an untyped binding, including
a destructured binding, gains an annotation. In another expression position,
a local typed binding inside `do` preserves the result contract. The quick fix
never inserts an `as` assertion for the hint.

## Known codemod gaps

These patterns have no `--fix` rule yet. The counts are from the four first targets (foldkit, t3code, alchemy and opencode: 44,235 `Effect.gen` sites). A repair records a `codemod-gap` only for a pattern not listed here.

| Pattern | Count | Why there is no rule |
| --- | --- | --- |
| A call that builds a program no `yield*` runs and no `const` holds, as `Effect.log("x")` alone in a statement | | It would run where it stands |
| `Match.when` with a predicate or an array pattern, `Match.discriminator`, a handler that builds a program | | No pattern tests the same, or the arm's call would run |
| An Option stage whose argument is a call, `Option.getOrElse(makeDefault())` | | The chain would evaluate it after the stage before it runs |
| `Option.match(x, { onNone, onSome })` | 3 (foldkit) | EK4840 rewrites Option pipelines only; a `match` over `Option.None` and `Option.Some(let v)` is the target |
| A pure exported or callback helper that TypeScript consumers call synchronously, `(xs) => xs.filter(p)` | 20 (foldkit 13, t3code 5, opencode 2) | Before D550 lands, context can make it an Effect function; `: infer _` keeps it plain. Under D550 a function with no Effect form is plain by syntax, and the annotation is moot |
| `x.pipe(Stream.map(f))` on a Stream value | 1 (foldkit) | EK4840's method rewrite covers Option only |
| A cold `Effect.map` or `orElseSucceed` program, `Effect.currentParentSpan.pipe(Effect.map(f), Effect.orElseSucceed(() => undefined))` | 2 (alchemy) | The deferred direct-style body depends on each use of the value |
| A schema constant written before its type alias, `const X = Schema.…` then `type X = typeof X.Type` | 818 of 820 such pairs that are not structs; 1,474 struct pairs | A schema declaration's declaration file lists the type before the constant, so the rewrite would reorder the module's declarations: EK4841 leaves these pairs, and EK4832's rewrite of a struct pair changes the declarations |

## Tests

The optional lint-engine checks use `VIBELANG_OXLINT_NODE_MODULES` for an
installation of `eslint`, `typescript-eslint`, `oxlint` and `@oxlint/plugins`.
Set `VIBELANG_LINT_ORACLE_NODE_MODULES` to the same installation, including
`espree`, to compare ignore scopes against Oxlint. Those native comparisons
use `--no-error-on-unmatched-pattern`, so an all-ignored project still
produces JSON with an empty diagnostic list.

```sh
node --test .smithers/flows/migrate/test/*.test.mjs
# Also registered in the compiler package fast gate:
node --test packages/compiler/test/migrate-test-diff.test.mjs
```

The deterministic steps are tested against fixtures: import parsing and rewriting, `--fix` output, diagnostics, the plan's draft and validation, the setup edits, test-report comparison, declaration canonicalization (it needs `bun install` in `packages/runtime`, whose TypeScript has the compiler API), the run's state machine, issue validation and the generated context.

`Option.match` quick fixes preserve statement and expression contexts, including conditional bodies and line breaks; the flow still reports genuine stable refusals.

When a package script runs Oxlint directly or launches a JavaScript/TypeScript runner that does, setup keeps upstream `oxlint` and includes `.vibe` in extension selectors. It follows local imports of runners, retains their package and directory filters, and excludes `.d.vibe.ts` sidecars. Plain commands such as `oxlint src` retain their ESLint pass. File-list runners invoke `.vibelang/oxlint.mjs`: upstream Oxlint checks their TypeScript files and the generated ESLint configuration checks their VibeLang files with the repository's JS plugins, rule names, severities and override globs. JSON output merges both passes in Oxlint's diagnostic shape, preserving `.vibe` source lines and warning severity. `--deny-warnings` fails on warnings in either pass. No patch or fork is installed. An invocation that denies warnings keeps that policy when setup refreshes its generated ESLint pass; removing the native option removes that pass's warning limit.

The ESLint configuration preserves directory-wide overrides as well as extension globs. Its `oxc/no-accumulating-spread` counterpart is checked against upstream Oxlint; an enabled rule without a counterpart fails a file-list runner with the rule's name. This prevents silent rule loss when a repository adds another native rule.

A directory containing only `.vibe` files still runs the ESLint pass. Setup adds `--no-error-on-unmatched-pattern` to the native Oxlint invocations, which have no TypeScript left to lint, and file-list adapters handle empty native directory scans the same way.

Oxlint disable and enable comments keep their original scope and source locations. The generated parser bridge translates only parsed directive comments, including core and TypeScript rule aliases; it does not rewrite source strings or user files. Unused directives remain quiet, as in Oxlint's default configuration.

A toolchain switch must not turn new test failures or compiler errors into the next baseline. The flow compares the unchanged native sources with the installed predecessor and candidate compilers, saves raw test reports and compiler identities in `baseline/`, and rejects new failures, missing passing tests or a newly failing command. Setup repeats the test comparison after wiring. A rejected `baseline/admission.json` also blocks replay, planning, codemod, verification and recording; repair the toolchain and start a fresh run from the original source. Existing upstream failures remain visible.

Detail 279 keeps modules whose Effect imports are only types in TypeScript by default. The inventory and `report.json` keep every owned source and test, count automatic candidates separately, and name each retained type-only file and reason. Explicit selection still warns and must pass every original compile, declaration, runtime, tool and protected-test check; import spelling does not establish the validity of a source program. Existing plain `.vibe` modules remain legal.

Declaration verification requires a zero compiler exit as well as identical public bytes. Global option diagnostics and nonzero exits remain in the verification receipt even when files were emitted or the diagnostic names an unmigrated source.

A failed declaration command is labelled `EMIT FAILED` in the report even if its raw files compare equal.

When tests live in `test`, `tests` or `__tests__` outside their nearest `tsconfig.json`, setup can write that test directory’s `tsconfig.json` extending the existing complete test project. It checks the original options and complete file membership and records the selected project, prior configuration, files and identity hashes in `baseline/logs/test-projects.jsonl`. Existing local configs and submodules remain unchanged. Missing or ambiguous project evidence produces a warning instead of a guessed configuration. Test bodies remain byte-identical.

Staged VibeLang tarballs replace only entries in `dependencies` and `devDependencies`. Published peer and optional dependency ranges keep their original portable specifiers.

Upgrade test fixtures provide both predecessor and staged compiler checks. Only the predecessor’s VIP-only invocation mutates the original source; failed baseline checks retain the original manifest and sources.

Shipped-root resolution checks retain the exact declaration graph, including each target. A published specifier spelling may use only the existing `D298` same-declaration proof; it cannot excuse a retargeted edge or another changed byte.

The write-ahead codemod journal also includes platform siblings: it keeps the unsplit original module and plans sibling creation before any rename, write or compiler child. Replay completes a partial split, and per-file revert restores the unsplit source and removes only its recorded sibling. An existing companion is preserved.

The same durable rename journal covers whole-scope mode: an interrupted rename resumes before compiler work, and bulk reverts restore the original source bytes.
